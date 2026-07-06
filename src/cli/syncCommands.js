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
    "  palsync test   [--workflow console|web|transaction] [--preview] [--keep-lock] [--dir <ws>]",
    "  palsync fetch <page> [--expect <str> ...] [--selector <css>] [--max-chars <n>]  Fetch ONE served page (verify a route renders)",
    "                                                               Server-validate a workflow (preview opens only with --preview)",
    "  palsync preview [--workflow console|web|transaction] [--open|--no-open] [--keep-lock] [--dir <ws>]",
    "                                                               Render the pal (web: prints HTML; console: opens in an interactive terminal)",
    "  palsync screenshot [<page>] [--viewport desktop|mobile] [--full-page] [--keep-lock] [--dir <ws>]",
    "                                                               Render a WEB pal to a PNG (saves the file, prints the path)",
    "  palsync seo-audit [--keep-lock] [--dir <ws>]             On-page SEO audit of a WEB pal's rendered page",
    "  palsync exercise --steps '<json>' | --steps-file <path> [--workflow console|web|transaction] [--viewport desktop|mobile] [--keep-lock] [--dir <ws>]",
    "                                                               Exercise workflow actions end-to-end; assert expect/absent strings in the rendered result",
    "  palsync scaffold  [--template <name>] [--list] [--dir <ws>]  Apply a starter template (offline; --list shows them)",
    "  palsync cost   [--dir <workspace>]                           palsync's own context contribution: tool calls + bytes returned + injected-block size (offline)",
    "  palsync regression [--keep-lock] [--dir <ws>]                Brownfield regression vs baseline/baseline.json (freshness -> validate/test/H1; caused vs inherited)",
    "  palsync spec-lint [<SPEC.md>] [--dir <ws>]                   Mechanical reality-check of a SPEC.md (offline): placeholders, dead links, §8a types, §12 floor",
    "  palsync task list [--ready] [--dir <ws>]                     List EXECUTION.md tasks; --ready prints the first todo whose depends are all done",
    "  palsync task <id> <status> [--dir <ws>]                      Set exactly one task's status (todo|in_progress|done|blocked|needs-frontier|needs-human)",
    "  palsync checkpoint \"<line>\" [--dir <ws>]                     Append a line to EXECUTION.md's Checkpoints section",
    "  palsync sync-datasets [--datasets a,b] [--recreate] [--keep-lock] [--dir <ws>]",
    "                                                               Provision dataset tables from pal.json (safe by default)",
    "",
    "  --force            push: override the server-drift refusal · pull: overwrite locally-modified files",
    "  --skip-validation  push: push even if the offline code check finds errors (not recommended)",
    "  --keep-lock        push/test/sync-datasets: keep holding the pal lock afterwards (default releases it)",
    "  --workflow         test: which engine to test (default: auto-detected from the pal)",
    "  --preview          test: open a live browser preview for human review (default: validate only)",
    "  --open             preview: open console/transaction preview in a browser (default: open only in an interactive terminal)",
    "  --no-open          preview: do not open a browser, even in an interactive terminal",
    "  --viewport         screenshot: desktop (default 1280x800) | mobile (~390x844)",
    "  --full-page        screenshot: capture the whole scroll height, not just the viewport",
    "  --expect <str>     fetch/preview: assert the served page contains <str> (repeatable); prints found/missing per string, NOT the HTML",
    "  --selector <css>   fetch/preview: return only that region's markup (simple tag/.class/#id selector)",
    "  --max-chars <n>    fetch/preview: cap the returned markup to n characters",
    "  --datasets         sync-datasets: comma-separated dataset names (default: all defined in pal.json)",
    "  --recreate         sync-datasets: DROP + REBUILD tables (DELETES ALL DATA) — asks for a typed YES",
    "  --dir <ws>         workspace directory (default: current directory)",
    "",
    "validate needs only the local files (no .palsync.json, no login). The other commands need a",
    "workspace set up once by `palsync` (.palsync.json + keychain login)."
].join("\n");

function parseFlags(argv) {
    const flags = { force: false, keepLock: false, dir: undefined, help: false, workflow: undefined, preview: false, open: undefined, skipValidation: false, datasets: undefined, recreate: false, template: undefined, list: false, viewport: undefined, fullPage: false, expect: undefined, selector: undefined, maxChars: undefined };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--force" || a === "-f") flags.force = true;
        else if (a === "--keep-lock") flags.keepLock = true;
        else if (a === "--preview") flags.preview = true;
        else if (a === "--no-preview") flags.preview = false;
        else if (a === "--open") flags.open = true;
        else if (a === "--no-open") flags.open = false;
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
        else if (a === "--expect") { const v = argv[++i]; if (!v) throw new Error("--expect requires a value"); (flags.expect = flags.expect || []).push(v); }
        else if (a.startsWith("--expect=")) (flags.expect = flags.expect || []).push(a.slice("--expect=".length));
        else if (a === "--selector") { flags.selector = argv[++i]; if (!flags.selector) throw new Error("--selector requires a value"); }
        else if (a.startsWith("--selector=")) flags.selector = a.slice("--selector=".length);
        else if (a === "--max-chars") { flags.maxChars = Number(argv[++i]); if (!flags.maxChars) throw new Error("--max-chars requires a number"); }
        else if (a.startsWith("--max-chars=")) flags.maxChars = Number(a.slice("--max-chars=".length));
        else if (a === "--steps") { flags.steps = argv[++i]; if (!flags.steps) throw new Error("--steps requires a JSON array value"); }
        else if (a.startsWith("--steps=")) flags.steps = a.slice("--steps=".length);
        else if (a === "--steps-file") { flags.stepsFile = argv[++i]; if (!flags.stepsFile) throw new Error("--steps-file requires a path"); }
        else if (a.startsWith("--steps-file=")) flags.stepsFile = a.slice("--steps-file=".length);
        else if (a === "--dir") { flags.dir = argv[++i]; if (!flags.dir) throw new Error("--dir requires a value"); }
        else if (a.startsWith("--dir=")) flags.dir = a.slice("--dir=".length);
        else if (a.charAt(0) !== "-" && flags._positional === undefined) flags._positional = a;
        else throw new Error("Unknown flag for this subcommand: " + a + "\n\n" + USAGE);
    }
    return flags;
}

function toolByName(name) { return TOOLS.find(t => t.name === name); }

function defaultPreviewOpen() {
    return !!(process.stdin && process.stdin.isTTY && process.stdout && process.stdout.isTTY);
}

// Best-effort lock release after a one-shot command (no live session remains to hold it).
// Failure is swallowed: your own next session auto-reclaims the lock.
async function releaseLock(ctx) {
    try { await lock.releaseByGuid(ctx.session, ctx.record.palGuid); } catch (e) { /* own next session reclaims */ }
}

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

// `palsync task` / `palsync checkpoint` — OFFLINE EXECUTION.md edits (no login/lock). Their args
// aren't the shared --force/--workflow set, so they get their own tolerant parsing.
async function runTaskCommand(cmd, argv) {
    const ts = require("../core/taskState");
    let dir = process.cwd(); const pos = []; let ready = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dir") dir = argv[++i];
        else if (a.startsWith("--dir=")) dir = a.slice("--dir=".length);
        else if (a === "--ready") ready = true;
        else pos.push(a);
    }
    const file = path.join(path.resolve(dir), "EXECUTION.md");
    let text;
    try { text = ts.readExecution(file); }
    catch (e) { console.error("Could not read " + file + " — " + (e && e.message ? e.message : e)); return 1; }

    if (cmd === "checkpoint") {
        const line = pos.join(" ");
        const r = ts.appendCheckpoint(text, line);
        if (!r.ok) { console.error("checkpoint failed: " + r.error + " (nothing changed)"); return 1; }
        ts.writeExecution(file, r.text);
        console.log("Checkpoint appended:\n  - " + line.replace(/[\r\n]+/g, " ").trim());
        return 0;
    }
    // cmd === "task"
    if (pos.length === 0 || pos[0] === "list") {
        const r = ts.listTasks(text, { ready });
        if (!r.ok) { console.error("task list failed: " + r.error); return 1; }
        if (ready) {
            if (!r.next) { console.log("No ready task — every todo is blocked by an unfinished dependency, or none remain."); return 1; }
            console.log(r.next.id + "\t" + r.next.status + "\t" + r.next.task);
            return 0;
        }
        for (const t of r.tasks) console.log(t.id + "\t" + t.status + "\t" + (t.depends.length ? "depends:" + t.depends.join(",") : "—") + "\t" + t.task);
        return 0;
    }
    if (pos.length >= 2) {
        const r = ts.setStatus(text, pos[0], pos[1]);
        if (!r.ok) { console.error("task update failed: " + r.error + " (nothing changed)"); return 1; }
        if (r.unchanged) { console.log(r.id + " already " + pos[1] + " — no change."); return 0; }
        ts.writeExecution(file, r.text);
        console.log(r.id + ": " + r.from + " -> " + r.to);
        return 0;
    }
    console.error("Usage: palsync task list [--ready] | palsync task <id> <status> | palsync checkpoint \"<line>\"");
    return 1;
}

// Returns the process exit code (0 ok, 1 refused/failed).
async function run(cmd, argv) {
    if (cmd === "task" || cmd === "checkpoint") return runTaskCommand(cmd, argv);
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

    // cost is OFFLINE: reads the per-session usage tally (.palsync.usage.json, written live by the
    // MCP server) and measures the injected context block from the workspace files. No login/lock.
    if (cmd === "cost") {
        const usage = require("../core/usage");
        console.log(usage.formatCost(dir, TOOLS));
        return 0;
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

    // spec-lint is OFFLINE: reads a SPEC.md (+ optional sibling MAP.md), no login/lock.
    if (cmd === "spec-lint") {
        const { lintSpec, formatSpecLint } = require("../core/specLint");
        const specPath = path.resolve(flags._positional || path.join(dir, "SPEC.md"));
        let text;
        try { text = require("fs").readFileSync(specPath, "utf8"); }
        catch (e) { console.error("Could not read " + specPath + " — " + (e && e.message ? e.message : e)); return 1; }
        const res = lintSpec(text, { workspaceDir: path.dirname(specPath) });
        console.log("palsync spec-lint — " + specPath + "\n");
        console.log(formatSpecLint(res));
        return res.counts.HARD_FLAG > 0 ? 1 : 0;
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
        if (!flags.keepLock && ctx.session.lockInfo) await releaseLock(ctx);
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
        if (!flags.keepLock && ctx.session.lockInfo) await releaseLock(ctx);
        return res.synced ? 0 : 1;
    }

    if (cmd === "preview") {
        const open = flags.open === undefined ? defaultPreviewOpen() : flags.open;
        const res = await toolByName("pal_preview").run(ctx, { workflow: flags.workflow, expect: flags.expect, selector: flags.selector, maxChars: flags.maxChars, open });
        console.log(res.message);
        if (!flags.keepLock && ctx.session.lockInfo) await releaseLock(ctx);
        return res.previewed ? 0 : 1;
    }

    if (cmd === "fetch") {
        const pagePath = flags._positional || flags.path;
        if (!pagePath) { console.error("Usage: palsync fetch <page-path>   e.g. palsync fetch about.html"); return 1; }
        const res = await toolByName("pal_fetch").run(ctx, { path: pagePath, expect: flags.expect, selector: flags.selector, maxChars: flags.maxChars });
        console.log(res.message);
        if (!flags.keepLock && ctx.session.lockInfo) await releaseLock(ctx);
        // With expect, exit reflects the verdict (pass=all found); otherwise a 200 fetch.
        if (flags.expect) return res.fetched && res.pass ? 0 : 1;
        return res.fetched && res.status === 200 ? 0 : 1;
    }

    if (cmd === "screenshot") {
        // page is an optional positional (default: home page), like fetch's <page>.
        const res = await toolByName("pal_screenshot").run(ctx, { page: flags._positional, viewport: flags.viewport, fullPage: flags.fullPage });
        console.log(res.message); // includes the saved PNG path — CLI can't return the image inline
        if (!flags.keepLock && ctx.session.lockInfo) await releaseLock(ctx);
        return res.captured ? 0 : 1;
    }

    if (cmd === "exercise") {
        let raw = flags.steps;
        if (!raw && flags.stepsFile) {
            try { raw = require("fs").readFileSync(path.resolve(flags.stepsFile), "utf8"); }
            catch (e) { console.error("Could not read --steps-file: " + (e && e.message ? e.message : e)); return 1; }
        }
        if (!raw) {
            console.error("Usage: palsync exercise --steps '<json array>' | --steps-file <path>\n" +
                "  e.g. --steps '[{\"fill\":{\"name\":\"Camera\"},\"click\":\"Save\",\"expect\":[\"Camera\"]}]'");
            return 1;
        }
        let steps;
        try { steps = JSON.parse(raw); }
        catch (e) { console.error("--steps is not valid JSON: " + (e && e.message ? e.message : e)); return 1; }
        const res = await toolByName("pal_exercise").run(ctx, { steps, workflow: flags.workflow, viewport: flags.viewport });
        console.log(res.message);
        if (!flags.keepLock && ctx.session.lockInfo) await releaseLock(ctx);
        return res.ran && res.pass ? 0 : 1;
    }

    if (cmd === "regression") {
        const res = await toolByName("pal_regression").run(ctx, {});
        console.log(res.message);
        if (!flags.keepLock && ctx.session.lockInfo) await releaseLock(ctx);
        // Exit non-zero on a stale baseline or any CAUSED failure; inherited/needs-human don't fail the run.
        if (res.stale || (res.ran && res.caused && res.caused.length)) return 1;
        return 0;
    }

    if (cmd === "seo-audit") {
        const res = await toolByName("pal_seo_audit").run(ctx, {});
        console.log(res.message);
        if (!flags.keepLock && ctx.session.lockInfo) await releaseLock(ctx);
        return res.audited && res.errors === 0 ? 0 : 1;
    }

    if (cmd === "test") {
        const res = await toolByName("pal_test").run(ctx, { workflow: flags.workflow, preview: flags.preview });
        console.log(res.message);
        // pal_test acquires the lock; release it unless asked to hold (no live session here).
        if (!flags.keepLock && ctx.session.lockInfo) await releaseLock(ctx);
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

module.exports = { run, parseFlags, defaultPreviewOpen, USAGE };
