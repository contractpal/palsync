"use strict";
// Standalone sync subcommands: `palsync push|pull|status` — the fallback path that works with
// NO MCP server and NO agent. If the MCP server died mid-session (or you just prefer the
// terminal), these read .palsync.json from the workspace, authenticate from the OS keychain,
// and run the EXACT same tool logic the MCP server exposes (src/mcp/tools.js), so semantics —
// drift guard, per-file refusals, preserve-on-pull, uncreatable-type backstop — are identical.
//
// push acquires the pal lock (the server requires it to save) and releases it afterwards by
// default, since there is no session to keep holding it; --keep-lock leaves it held (e.g. when
// you're about to relaunch palsync and want to stay the holder).
const path = require("path");
const readline = require("readline");
const { buildContext } = require("../mcp/context");
const { TOOLS } = require("../mcp/tools");
const { readDatasetDefs, recreatePhrase } = require("../core/datasets");
const lock = require("../core/lock");
const contextInject = require("../launcher/contextInject");

// Read one line from the user (for the recreate typed-YES). Resolves to the trimmed input.
function askLine(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (ans) => { rl.close(); resolve(String(ans)); });
    });
}

const USAGE = [
    "Usage:",
    "  palsync validate [--dir <workspace>]                         Offline code check (no server/login needed)",
    "  palsync push   [--force] [--skip-validation] [--keep-lock] [--dir <ws>]   Push local changes (no MCP server needed)",
    "  palsync pull   [--force] [--dir <workspace>]                 Pull/sync from the server",
    "  palsync merge  [--keep-lock] [--dir <workspace>]            3-way merge local + server changes (keeps both where they don't collide)",
    "  palsync status [--dir <workspace>]                           Server drift, local changes, lock holder",
    "  palsync test   [--workflow console|web|transaction] [--no-preview] [--keep-lock] [--dir <ws>]",
    "  palsync fetch <page>  Fetch ONE served page from the test instance (verify a route renders)",
    "                                                               Server-validate a workflow + open a live preview",
    "  palsync preview [--workflow console|web|transaction] [--keep-lock] [--dir <ws>]",
    "                                                               Render the pal (web: prints the HTML; console: opens a browser)",
    "  palsync screenshot [<page>] [--viewport desktop|mobile] [--full-page] [--keep-lock] [--dir <ws>]",
    "                                                               Render a WEB pal to a PNG (saves the file, prints the path)",
    "  palsync seo-audit [--keep-lock] [--dir <ws>]             On-page SEO audit of a WEB pal's rendered page",
    "  palsync scaffold  [--template <name>] [--list] [--dir <ws>]  Apply a starter template (offline; --list shows them)",
    "  palsync sync-datasets [--datasets a,b] [--recreate] [--keep-lock] [--dir <ws>]",
    "                                                               Provision dataset tables from pal.json (safe by default)",
    "",
    "  --force            push: override the server-drift refusal · pull: overwrite locally-modified files",
    "  --skip-validation  push: push even if the offline code check finds errors (not recommended)",
    "  --keep-lock        push/test/sync-datasets: keep holding the pal lock afterwards (default releases it)",
    "  --workflow         test: which engine to test (default: auto-detected from the pal)",
    "  --no-preview       test: validate only, don't open the browser preview",
    "  --viewport         screenshot: desktop (default 1280x800) | mobile (~390x844)",
    "  --full-page        screenshot: capture the whole scroll height, not just the viewport",
    "  --datasets         sync-datasets: comma-separated dataset names (default: all defined in pal.json)",
    "  --recreate         sync-datasets: DROP + REBUILD tables (DELETES ALL DATA) — asks for a typed YES",
    "  --dir <ws>         workspace directory (default: current directory)",
    "",
    "validate needs only the local files (no .palsync.json, no login). The other commands need a",
    "workspace set up once by `palsync` (.palsync.json + keychain login)."
].join("\n");

function parseFlags(argv) {
    const flags = { force: false, keepLock: false, dir: undefined, help: false, workflow: undefined, preview: true, skipValidation: false, datasets: undefined, recreate: false, template: undefined, list: false, viewport: undefined, fullPage: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--force" || a === "-f") flags.force = true;
        else if (a === "--keep-lock") flags.keepLock = true;
        else if (a === "--no-preview") flags.preview = false;
        else if (a === "--list") flags.list = true;
        else if (a === "--template") { flags.template = argv[++i]; if (!flags.template) throw new Error("--template requires a value"); }
        else if (a.startsWith("--template=")) flags.template = a.slice("--template=".length);
        else if (a === "--skip-validation") flags.skipValidation = true;
        else if (a === "--recreate") flags.recreate = true;
        else if (a === "--help" || a === "-h") flags.help = true;
        else if (a === "--workflow") { flags.workflow = argv[++i]; if (!flags.workflow) throw new Error("--workflow requires a value"); }
        else if (a.startsWith("--workflow=")) flags.workflow = a.slice("--workflow=".length);
        else if (a === "--datasets") { flags.datasets = argv[++i]; if (!flags.datasets) throw new Error("--datasets requires a value"); }
        else if (a.startsWith("--datasets=")) flags.datasets = a.slice("--datasets=".length);
        else if (a === "--viewport") { flags.viewport = argv[++i]; if (!flags.viewport) throw new Error("--viewport requires a value"); }
        else if (a.startsWith("--viewport=")) flags.viewport = a.slice("--viewport=".length);
        else if (a === "--full-page") flags.fullPage = true;
        else if (a === "--dir") { flags.dir = argv[++i]; if (!flags.dir) throw new Error("--dir requires a value"); }
        else if (a.startsWith("--dir=")) flags.dir = a.slice("--dir=".length);
        else if (a.charAt(0) !== "-" && flags._positional === undefined) flags._positional = a;
        else throw new Error("Unknown flag for this subcommand: " + a + "\n\n" + USAGE);
    }
    return flags;
}

function toolByName(name) { return TOOLS.find(t => t.name === name); }

async function buildCliContext(dir) {
    try {
        // acquireLock:false — no session lifecycle here. push takes (and we then release) the
        // lock itself; pull and status never need one.
        return await buildContext(dir, { acquireLock: false, log: (m) => process.stderr.write("[palsync] " + m + "\n") });
    } catch (e) {
        if (e && e.code === "ENOENT") {
            throw new Error(
                "No .palsync.json found in " + dir + " — this isn't a palsync workspace yet.\n" +
                "Run `palsync` once to log in and set it up, or point at the workspace with --dir."
            );
        }
        throw e;
    }
}

// Returns the process exit code (0 ok, 1 refused/failed).
async function run(cmd, argv) {
    const flags = parseFlags(argv);
    if (flags.help) { console.log(USAGE); return 0; }
    const dir = path.resolve(flags.dir || process.cwd());

    // validate is fully OFFLINE: no .palsync.json, no keychain, no login, no lock. It only
    // reads the local files, so it works even in a half-set-up or disconnected workspace.
    if (cmd === "validate") {
        const { validateWorkspace, formatValidation: formatLint } = require("../core/validate");
        const lint = validateWorkspace(dir);
        console.log("palsync validate — " + dir + "\n");
        console.log(formatLint(lint, { context: "validate" }));
        return lint.errors > 0 ? 1 : 0;
    }

    // scaffold is OFFLINE too (writes template files + pal.json entries; push ships them later).
    if (cmd === "scaffold") {
        const { applyTemplate, listTemplates, formatScaffoldReport } = require("../core/scaffold");
        if (flags.list || !flags.template) {
            const all = listTemplates();
            console.log("Available templates:\n" + all.map(t => "  " + t.name + " — " + t.description).join("\n") +
                "\n\nApply one with: palsync scaffold --template <name> [--dir <workspace>]");
            return flags.template ? 1 : 0;
        }
        const report = applyTemplate(dir, flags.template, {});
        console.log("palsync scaffold — " + dir + "\n");
        console.log(formatScaffoldReport(report));
        return 0;
    }

    const ctx = await buildCliContext(dir);
    console.log("palsync " + cmd + " — " + ctx.record.palName + " @ " + ctx.record.cloudUrl + "\n");

    if (cmd === "status") {
        const res = await toolByName("pal_status").run(ctx, {});
        console.log(res.message);
        const cs = await contextInject.contextStatus(dir);
        if (cs.stale) {
            console.log("\n⚠ PalBuilder context is " +
                (cs.present ? "stale (generated by palsync v" + (cs.version || "?") + ", installed is v" + cs.current + ")" : "missing") +
                " — relaunch `palsync` for this pal to refresh CLAUDE.palsync.md, skills, and rules.");
        }
        return 0;
    }

    if (cmd === "merge") {
        const res = await toolByName("pal_merge").run(ctx, {});
        console.log(res.message);
        if (!flags.keepLock && ctx.session.lockInfo) {
            try { await lock.releaseByGuid(ctx.session, ctx.record.palGuid); } catch (e) { /* own next session reclaims */ }
        }
        return res.merged && (!res.conflicts || res.conflicts.length === 0) ? 0 : 1;
    }

    if (cmd === "pull") {
        const res = await toolByName("pal_pull").run(ctx, { force: flags.force });
        console.log(res.message);
        return res.pulled ? 0 : 1;
    }

    if (cmd === "sync-datasets") {
        const names = flags.datasets ? flags.datasets.split(",").map(s => s.trim()).filter(Boolean) : undefined;
        let confirmRecreate;
        if (flags.recreate) {
            // Resolve the exact targets so the typed-YES phrase matches what the tool expects.
            const defs = readDatasetDefs(dir);
            const targets = (names && names.length) ? names : [...defs.keys()];
            const phrase = recreatePhrase(targets);
            console.log("⚠ RECREATE will DROP and REBUILD these tables, DELETING ALL THEIR DATA:");
            for (const t of targets) console.log("   - " + t);
            console.log("\nThis cannot be undone. To proceed, type the following line EXACTLY (or anything else to cancel):");
            console.log("  " + phrase + "\n");
            const typed = await askLine("> ");
            if (typed.trim() !== phrase) {
                console.log("\nCancelled — no tables were recreated, no data deleted.");
                return 1;
            }
            confirmRecreate = phrase;
        }
        const res = await toolByName("pal_sync_datasets").run(ctx, { datasets: names, recreate: flags.recreate, confirmRecreate, force: flags.force });
        console.log(res.message);
        if (!flags.keepLock && ctx.session.lockInfo) {
            try { await lock.releaseByGuid(ctx.session, ctx.record.palGuid); } catch (e) { /* own next session reclaims */ }
        }
        return res.synced ? 0 : 1;
    }

    if (cmd === "preview") {
        const res = await toolByName("pal_preview").run(ctx, { workflow: flags.workflow });
        console.log(res.message);
        if (!flags.keepLock && ctx.session.lockInfo) {
            try { await lock.releaseByGuid(ctx.session, ctx.record.palGuid); } catch (e) { /* own next session reclaims */ }
        }
        return res.previewed ? 0 : 1;
    }

    if (cmd === "fetch") {
        const pagePath = flags._positional || flags.path;
        if (!pagePath) { console.error("Usage: palsync fetch <page-path>   e.g. palsync fetch about.html"); return 1; }
        const res = await toolByName("pal_fetch").run(ctx, { path: pagePath });
        console.log(res.message);
        if (!flags.keepLock && ctx.session.lockInfo) {
            try { await lock.releaseByGuid(ctx.session, ctx.record.palGuid); } catch (e) { /* own next session reclaims */ }
        }
        return res.fetched && res.status === 200 ? 0 : 1;
    }

    if (cmd === "screenshot") {
        // page is an optional positional (default: home page), like fetch's <page>.
        const res = await toolByName("pal_screenshot").run(ctx, { page: flags._positional, viewport: flags.viewport, fullPage: flags.fullPage });
        console.log(res.message); // includes the saved PNG path — CLI can't return the image inline
        if (!flags.keepLock && ctx.session.lockInfo) {
            try { await lock.releaseByGuid(ctx.session, ctx.record.palGuid); } catch (e) { /* own next session reclaims */ }
        }
        return res.captured ? 0 : 1;
    }

    if (cmd === "seo-audit") {
        const res = await toolByName("pal_seo_audit").run(ctx, {});
        console.log(res.message);
        if (!flags.keepLock && ctx.session.lockInfo) {
            try { await lock.releaseByGuid(ctx.session, ctx.record.palGuid); } catch (e) { /* own next session reclaims */ }
        }
        return res.audited && res.errors === 0 ? 0 : 1;
    }

    if (cmd === "test") {
        const res = await toolByName("pal_test").run(ctx, { workflow: flags.workflow, preview: flags.preview });
        console.log(res.message);
        // pal_test acquires the lock; release it unless asked to hold (no live session here).
        if (!flags.keepLock && ctx.session.lockInfo) {
            try { await lock.releaseByGuid(ctx.session, ctx.record.palGuid); } catch (e) { /* own next session reclaims */ }
        }
        return res.ran && res.validated ? 0 : 1;
    }

    if (cmd === "push") {
        const res = await toolByName("pal_push").run(ctx, { force: flags.force, skipValidation: flags.skipValidation });
        console.log(res.message);
        // Release the lock the push acquired — no live session remains to hold it. (If the
        // push was refused before locking, releaseByGuid is a clean no-op.)
        if (!flags.keepLock && ctx.session.lockInfo) {
            try {
                const rel = await lock.releaseByGuid(ctx.session, ctx.record.palGuid);
                if (rel.released) console.log("\nLock released (use --keep-lock to stay the holder).");
            } catch (e) {
                console.error("Warning: lock release failed (" + (e && e.message ? e.message : e) + ") — your own next session auto-reclaims it.");
            }
        } else if (flags.keepLock && ctx.session.lockInfo) {
            console.log("\nLock kept (you still hold " + ctx.record.palName + ").");
        }
        return res.pushed ? 0 : 1;
    }

    throw new Error("Unknown subcommand: " + cmd + "\n\n" + USAGE);
}

module.exports = { run, parseFlags, USAGE };
