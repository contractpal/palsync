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
const { runPreview } = require("../core/preview");
const { openUrl } = require("../platform/openUrl");

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
    "  palsync doctor                                               Offline environment report: Node, keychain, credentials, Chromium, git, gh (always exits 0)",
    "  palsync push   [--force] [--skip-validation] [--keep-lock] [--dir <ws>]   Push local changes (no MCP server needed)",
    "  palsync pull   [--force] [--dir <workspace>]                 Pull/sync from the server",
    "  palsync merge  [--keep-lock] [--dir <workspace>]            3-way merge local + server changes (keeps both where they don't collide)",
    "  palsync status [--dir <workspace>]                           Server drift, local changes, lock holder",
    "  palsync test   [--workflow console|web|transaction] [--preview] [--keep-lock] [--dir <ws>]",
    "  palsync fetch <page> [--expect <str> ...] [--selector <css>] [--max-chars <n>]  Fetch ONE served page (verify a route renders)",
    "                                                               Server-validate a workflow (preview opens only with --preview)",
    "  palsync preview [--workflow console|web|transaction] [--open|--no-open] [--keep-lock] [--dir <ws>]",
    "                                                               Render the pal (opens console/transaction previews in a browser by default)",
    "  palsync open    [--workflow console|web|transaction] [--keep-lock] [--dir <ws>]",
    "                                                               Open the rendered pal in a real browser window (human review)",
    "  palsync screenshot [<page>] [--viewport desktop|mobile] [--full-page] [--keep-lock] [--dir <ws>]",
    "                                                               Render a WEB pal to a PNG (saves the file, prints the path)",
    "  palsync seo-audit [--keep-lock] [--dir <ws>]             On-page SEO audit of a WEB pal's rendered page",
    "  palsync exercise --steps '<json>' | --steps-file <path> [--workflow console|web|transaction] [--viewport desktop|mobile] [--keep-lock] [--dir <ws>]",
    "                                                               Exercise workflow actions end-to-end; assert expect/absent strings in the rendered result",
    "  palsync cost   [--dir <workspace>]                           palsync's own context contribution: tool calls + bytes returned + injected-block size (offline)",
    "  palsync cost record --model X --provider Y --in N --cached N --out N [--cost N] [--currency USD] [--phase build|review] [--dir <ws>]",
    "  palsync ctx inspect|diff [--dir <workspace>]                 Inspect locally stable context or compare the last changed generation (offline)",
    "  palsync review check|brief [--dir <workspace>]              Check REVIEW.md evidence or print the pre-review evidence ledger (offline)",
    "  palsync completion check [--dir <workspace>]                Enforce all-done independent review or allow a reasoned handoff (offline)",
    "  palsync regression [--keep-lock] [--dir <ws>]                Brownfield regression vs baseline/baseline.json (freshness -> validate/test/H1; caused vs inherited)",
    "  palsync spec-lint [<SPEC.md>] [--dir <ws>]                   Mechanical reality-check of a SPEC.md (offline): placeholders, dead links, §8a types, §12 floor",
    "  palsync task list [--ready] [--dir <ws>]                     List EXECUTION.md tasks; --ready prints the first todo whose depends are all done",
    "  palsync task <id> <status> [--reason \"<why>\"] [--tried \"<workaround>\"] [--dir <ws>]",
    "                                                               Set one task status; --reason is required for blocked|needs-frontier|needs-human,",
    "                                                               --tried (the automated workaround you attempted) also for blocked|needs-human",
    "  palsync checkpoint \"<line>\" [--dir <ws>]                     Append a line to EXECUTION.md's Checkpoints section",
    "  palsync sync-datasets [--datasets a,b] [--recreate] [--keep-lock] [--dir <ws>]",
    "                                                               Provision dataset tables from pal.json (safe by default)",
    "  palsync hook completion|guard|post-write --mode claude|json [--dir <ws>] [--event <json>]  Agent-harness hook adapters (event on stdin or --event; always exit 0).",
    "                                                               completion = Stop gate; guard = PreToolUse deny on writes to .palsync.json.",
    "                                                               Installed into .claude/settings.json automatically for the claude agent.",
    "  palsync hooks check|repair [--dir <ws>]   offline hook-settings health check and repair",
    "",
    "  --force            push: override the server-drift refusal · pull: overwrite locally-modified files",
    "  --skip-validation  push: push even if the offline code check finds errors (not recommended)",
    "  --keep-lock        push/test/sync-datasets: keep holding the pal lock afterwards (default releases it)",
    "  --workflow         test: which engine to test (default: auto-detected from the pal)",
    "  --preview          test: open a live browser preview for human review (default: validate only)",
    "  --open             preview: open console/transaction preview in a browser (default)",
    "  --no-open          preview: do not open a browser",
    "  --viewport         screenshot: desktop (default 1280x800) | mobile (~390x844)",
    "  --full-page        screenshot: capture the whole scroll height, not just the viewport",
    "  --expect <str>     fetch/preview: assert the served page contains <str> (repeatable); prints found/missing per string, NOT the HTML",
    "  --selector <css>   fetch/preview: return only that region's markup (simple tag/.class/#id selector)",
    "  --max-chars <n>    fetch/preview: cap the returned markup to n characters",
    "  --datasets         sync-datasets: comma-separated dataset names (default: all defined in pal.json)",
    "  --recreate         sync-datasets: DROP + REBUILD tables (DELETES ALL DATA) — asks for a typed YES",
    "  --dir <ws>         workspace directory (default: current directory)",
    "",
    "validate and doctor need only the local machine (no .palsync.json, no login). The other commands",
    "need a workspace set up once by `palsync` (.palsync.json + keychain login)."
].join("\n");

function parseFlags(argv) {
    const flags = { force: false, keepLock: false, dir: undefined, help: false, workflow: undefined, preview: false, open: undefined, skipValidation: false, datasets: undefined, recreate: false, viewport: undefined, fullPage: false, expect: undefined, selector: undefined, maxChars: undefined };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--force" || a === "-f") flags.force = true;
        else if (a === "--keep-lock") flags.keepLock = true;
        else if (a === "--preview") flags.preview = true;
        else if (a === "--no-preview") flags.preview = false;
        else if (a === "--open") flags.open = true;
        else if (a === "--no-open") flags.open = false;
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
        else if (["--model", "--provider", "--in", "--cached", "--out", "--cost", "--currency", "--phase"].includes(a)) {
            const key = { "--model": "model", "--provider": "provider", "--in": "tokensIn", "--cached": "tokensCached", "--out": "tokensOut", "--cost": "cost", "--currency": "currency", "--phase": "phase" }[a];
            flags[key] = argv[++i];
            if (flags[key] === undefined) throw new Error(a + " requires a value");
        }
        else if (["--model=", "--provider=", "--in=", "--cached=", "--out=", "--cost=", "--currency=", "--phase="].some(prefix => a.startsWith(prefix))) {
            const prefix = a.slice(0, a.indexOf("=") + 1);
            const key = { "--model=": "model", "--provider=": "provider", "--in=": "tokensIn", "--cached=": "tokensCached", "--out=": "tokensOut", "--cost=": "cost", "--currency=": "currency", "--phase=": "phase" }[prefix];
            flags[key] = a.slice(prefix.length);
        }
        else if (a === "--dir") { flags.dir = argv[++i]; if (!flags.dir) throw new Error("--dir requires a value"); }
        else if (a.startsWith("--dir=")) flags.dir = a.slice("--dir=".length);
        else if (a.charAt(0) !== "-" && flags._positional === undefined) flags._positional = a;
        else throw new Error("Unknown flag for this subcommand: " + a + "\n\n" + USAGE);
    }
    return flags;
}

function toolByName(name) { return TOOLS.find(t => t.name === name); }

function defaultPreviewOpen() {
    return true;
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
    let dir = process.cwd(); const pos = []; let ready = false; let reason; let tried;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dir") dir = argv[++i];
        else if (a.startsWith("--dir=")) dir = a.slice("--dir=".length);
        else if (a === "--ready") ready = true;
        else if (a === "--reason") { reason = argv[++i]; if (reason === undefined) { console.error("--reason requires a value"); return 1; } }
        else if (a.startsWith("--reason=")) reason = a.slice("--reason=".length);
        else if (a === "--tried") { tried = argv[++i]; if (tried === undefined) { console.error("--tried requires a value"); return 1; } }
        else if (a.startsWith("--tried=")) tried = a.slice("--tried=".length);
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
        const r = ts.setStatusWithReason(text, pos[0], pos[1], reason, tried);
        if (!r.ok) { console.error("task update failed: " + r.error + " (nothing changed)"); return 1; }
        if (r.unchanged) { console.log(r.id + " already " + pos[1] + " — no change."); return 0; }
        ts.writeExecution(file, r.text);
        console.log(r.id + ": " + r.from + " -> " + r.to);
        return 0;
    }
    console.error("Usage: palsync task list [--ready] | palsync task <id> <status> [--reason \"<why>\"] [--tried \"<workaround>\"] | palsync checkpoint \"<line>\"");
    return 1;
}

function readStdin() {
    return new Promise((resolve, reject) => {
        let input = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", chunk => { input += chunk; });
        process.stdin.on("end", () => resolve(input));
        process.stdin.on("error", reject);
    });
}

async function runHookCommand(argv, inputText) {
    try {
        const adapter = argv[0];
        const ADAPTERS = {
            completion: "../core/completionHook",
            guard: "../core/guardHook",
            "post-write": "../core/postWriteHook",
        };
        if (!Object.prototype.hasOwnProperty.call(ADAPTERS, adapter)) throw new Error("unknown hook adapter");
        let mode = "json", dir, eventArg;
        for (let i = 1; i < argv.length; i++) {
            if (argv[i] === "--mode") mode = argv[++i];
            else if (argv[i].startsWith("--mode=")) mode = argv[i].slice(7);
            else if (argv[i] === "--dir") dir = argv[++i];
            else if (argv[i].startsWith("--dir=")) dir = argv[i].slice(6);
            else if (argv[i] === "--event") eventArg = argv[++i];
            else if (argv[i].startsWith("--event=")) eventArg = argv[i].slice(8);
            else throw new Error("unknown hook flag " + argv[i]);
        }
        if (mode !== "claude" && mode !== "json") throw new Error("unsupported hook mode " + mode);
        // Claude delivers the event on stdin. Pi's `pi.exec` has no stdin channel (ExecOptions is
        // signal/timeout/cwd only), so `--event` carries it as an argument; it wins if both appear.
        let event = null;
        if (eventArg !== undefined) event = JSON.parse(eventArg);
        else if (mode === "claude") event = JSON.parse(inputText === undefined ? await readStdin() : inputText);
        const evaluated = require(ADAPTERS[adapter]).evaluate({ mode, cwd: dir, event });
        if (evaluated.output) console.log(JSON.stringify(evaluated.output));
        return 0;
    } catch (e) {
        // Fail open, as the completion hook does: a hook that errors must never wedge a session. The
        // cost of failing open here is that a malformed event lets a .palsync.json edit through, which
        // is the status quo before this guard existed -- strictly better than blocking all work.
        console.error("palsync " + (argv[0] || "") + " hook skipped (fail open): " +
            (e && e.message ? e.message : e));
        return 0;
    }
}

// Returns the process exit code (0 ok, 1 refused/failed). `opts` is passed through to the hooks
// command (test seam for the user-level settings file location); other commands ignore it.
async function run(cmd, argv, opts) {
    if (cmd === "task" || cmd === "checkpoint") return runTaskCommand(cmd, argv);
    if (cmd === "hook") return runHookCommand(argv);
    // `palsync hooks check|repair` — OFFLINE recovery surface for stale Claude Code hook
    // settings (no .palsync.json, no login), dispatched before parseFlags/buildCliContext like
    // task/checkpoint. `opts` is the test seam for the user-level settings file location.
    if (cmd === "hooks") return require("./hooksCommand").run(argv, opts || {});
    const flags = parseFlags(argv);
    if (flags.help) { console.log(USAGE); return 0; }
    const dir = path.resolve(flags.dir || process.cwd());

    if (cmd === "completion") {
        if (flags._positional !== "check") { console.error("Usage: palsync completion check [--dir <workspace>]"); return 1; }
        const gate = require("../core/completionGate").checkWorkspace(dir);
        console.log(require("../core/completionGate").formatCompletion(gate));
        return gate.allow ? 0 : 1;
    }

    if (cmd === "review") {
        const reviewCheck = require("../core/reviewCheck");
        if (flags._positional === "brief") {
            console.log(reviewCheck.formatReviewBrief(reviewCheck.buildReviewBrief(dir)));
            return 0;
        }
        if (flags._positional !== "check") { console.error("Usage: palsync review check|brief [--dir <workspace>]"); return 1; }
        const result = reviewCheck.checkWorkspace(dir);
        console.log(reviewCheck.formatReviewCheck(result));
        return result.ok ? 0 : 1;
    }

    // validate is fully OFFLINE: no .palsync.json, no keychain, no login, no lock. It only
    // reads the local files, so it works even in a half-set-up or disconnected workspace.
    if (cmd === "validate") {
        const { validateWorkspace, formatValidation: formatLint } = require("../core/validate");
        const lint = validateWorkspace(dir);
        console.log("palsync validate — " + dir + "\n");
        console.log(formatLint(lint, { context: "validate" }));
        return lint.errors > 0 ? 1 : 0;
    }

    // doctor is fully OFFLINE and workspace-independent: an informational environment health
    // report (no .palsync.json, no login, no session, no lock). ALWAYS exits 0 — it informs,
    // it never gates, whatever mix of ok/warn/fail statuses it finds.
    if (cmd === "doctor") {
        console.log(require("../core/doctor").runDoctor().text);
        return 0;
    }

    // cost is OFFLINE: reads the per-session usage tally (.palsync.usage.json, written live by the
    // MCP server) and measures the injected context block from the workspace files. No login/lock.
    if (cmd === "cost") {
        const usage = require("../core/usage");
        if (flags._positional === "record") {
            const result = usage.recordSessionCost(dir, flags);
            if (!result.ok) { console.error("cost record failed: " + result.error); return 1; }
            console.log("Recorded session cost for " + result.entry.model + " (" + result.entry.provider + ").");
            return 0;
        }
        console.log(usage.formatCost(dir, TOOLS));
        return 0;
    }

    if (cmd === "ctx") {
        const manifest = require("../core/contextManifest");
        if (flags._positional === "inspect") {
            console.log(manifest.formatInspect(manifest.readManifest(dir)));
            return manifest.readManifest(dir) ? 0 : 1;
        }
        if (flags._positional === "diff") {
            const current = manifest.readManifest(dir);
            console.log(manifest.formatDiff(manifest.readManifest(dir, true), current));
            return current ? 0 : 1;
        }
        console.error("Usage: palsync ctx inspect|diff [--dir <workspace>]");
        return 1;
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

    if (cmd === "open") {
        const res = await runPreview(ctx.session, ctx.record.palGuid, ctx.record, ctx.workspaceDir, { workflow: flags.workflow });
        const dirtyNote = res.dirty
            ? "\n⚠ Un-pushed local changes detected (" + (res.dirtyFiles || []).join(", ") + "). The browser shows the last pushed version."
            : "";
        if (!res.previewed) {
            const prefix = res.validated === false
                ? "Cannot open — the pal did not validate on the server."
                : "Cannot open preview.";
            console.log(prefix + " " + (res.reason || "The preview could not be started.") + dirtyNote);
            if (!flags.keepLock && ctx.session.lockInfo) await releaseLock(ctx);
            return 1;
        }
        const url = res.url || res._previewUrl;
        if (!url) {
            console.log("Cannot open preview: the preview did not return a browser URL." + dirtyNote);
            if (!flags.keepLock && ctx.session.lockInfo) await releaseLock(ctx);
            return 1;
        }
        const opened = await openUrl(url);
        console.log(opened.opened
            ? "Opened the " + (res.kind || flags.workflow || "pal") + " preview in your browser." + dirtyNote
            : "Couldn't open the preview in your browser (" + (opened.reason || "unknown error") + ")." + dirtyNote);
        if (!flags.keepLock && ctx.session.lockInfo) await releaseLock(ctx);
        return opened.opened ? 0 : 1;
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

module.exports = { run, runHookCommand, parseFlags, defaultPreviewOpen, USAGE };
