"use strict";
// CLI flag parsing for human-vs-agent preview behavior. The MCP pal_preview tool remains
// no-open by default; the standalone CLI opens unless the caller explicitly opts out.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { parseFlags, defaultPreviewOpen, USAGE, run } = require("../src/cli/syncCommands");
const contextInject = require("../src/launcher/contextInject");
const claudeHooks = require("../src/launcher/claudeHooks");
const { tmpWorkspace } = require("./helpers");

test("parseFlags: preview open is tri-state", () => {
    assert.equal(parseFlags([]).open, undefined);
    assert.equal(parseFlags(["--open"]).open, true);
    assert.equal(parseFlags(["--no-open"]).open, false);
});

test("defaultPreviewOpen: true even when launched from a non-TTY runner", () => {
    const oldIn = process.stdin.isTTY;
    const oldOut = process.stdout.isTTY;
    try {
        process.stdin.isTTY = true;
        process.stdout.isTTY = true;
        assert.equal(defaultPreviewOpen(), true);
        process.stdout.isTTY = false;
        assert.equal(defaultPreviewOpen(), true);
        process.stdin.isTTY = false;
        process.stdout.isTTY = true;
        assert.equal(defaultPreviewOpen(), true);
    } finally {
        process.stdin.isTTY = oldIn;
        process.stdout.isTTY = oldOut;
    }
});

test("doctor dispatches offline (no workspace context) and exits 0 with mixed statuses", async () => {
    const syncPath = require.resolve("../src/cli/syncCommands");
    const doctorPath = require.resolve("../src/core/doctor");
    const oldDoctor = require.cache[doctorPath];
    const oldSync = require.cache[syncPath];
    // Stub the probe-backed doctor so the dispatch test never touches keychain/git/gh, and
    // return a MIXED-status result to pin "always exit 0".
    require.cache[doctorPath] = { id: doctorPath, filename: doctorPath, loaded: true, exports: {
        runDoctor: () => ({ exitCode: 0, text: "palsync doctor — stub\n✖ node fail\n⚠ gh warn", checks: [
            { name: "node", status: "fail", detail: "", remedy: "" },
            { name: "gh", status: "warn", detail: "", remedy: "" }
        ] })
    } };
    delete require.cache[syncPath];
    const originalLog = console.log;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));
    try {
        const syncCommands = require("../src/cli/syncCommands");
        // No --dir, no .palsync.json anywhere near: doctor must not build a workspace context.
        assert.equal(await syncCommands.run("doctor", []), 0);
        assert.match(output.join("\n"), /palsync doctor — stub/);
    } finally {
        console.log = originalLog;
        delete require.cache[syncPath];
        if (oldDoctor) require.cache[doctorPath] = oldDoctor; else delete require.cache[doctorPath];
        if (oldSync) require.cache[syncPath] = oldSync;
    }
});

test("doctor is listed in USAGE and in the bin dispatcher's SUBCOMMANDS", () => {
    assert.match(USAGE, /palsync doctor/);
    assert.match(USAGE, /always exits 0/);
    const bin = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "bin", "palsync.js"), "utf8");
    assert.match(bin, /"validate", "doctor", "sync-datasets"/);
});

test("USAGE documents browser-open preview default and no-open escape hatch", () => {
    assert.match(USAGE, /--open\|--no-open/);
    assert.match(USAGE, /browser by default/);
    assert.match(USAGE, /--no-open/);
    assert.match(USAGE, /palsync open/);
    assert.doesNotMatch(USAGE, /palsync scaffold/);
    assert.match(USAGE, /palsync ctx inspect\|diff/);
    assert.doesNotMatch(USAGE, /palsync context inspect/);
    assert.match(USAGE, /palsync cost record --model X --provider Y/);
    assert.match(USAGE, /--tried .*automated workaround/);
});

test("task CLI requires blocker reasons and writes status plus checkpoint once", async () => {
    const ws = tmpWorkspace({ "EXECUTION.md": `## Tasks
| id | task | status |
| T1 | Build | todo |

## Checkpoints
- existing
` });
    const oldLog = console.log, oldError = console.error; const logs = [];
    console.log = (...args) => logs.push(args.join(" ")); console.error = () => {};
    try {
        assert.equal(await run("task", ["T1", "blocked", "--dir", ws]), 1);
        // Track C: a reason alone is not enough for blocked — --tried evidence is required too.
        assert.equal(await run("task", ["T1", "blocked", "--reason", "Waiting", "--dir", ws]), 1);
        const before = fs.readFileSync(require("node:path").join(ws, "EXECUTION.md"), "utf8");
        assert.match(before, /\| T1 \| Build \| todo \|/);
        assert.equal(await run("task", ["T1", "blocked", "--reason", "Waiting\nfor owner", "--tried", "pal_push\ntwice: 500", "--dir", ws]), 0);
        assert.equal(await run("task", ["T1", "blocked", "--reason", "Waiting\nfor owner", "--tried=pal_push twice: 500", "--dir", ws]), 0);
        assert.equal(await run("task", ["T1", "blocked", "--reason=Still waiting", "--tried=pal_validate: 0 errors", "--dir", ws]), 0);
        const after = fs.readFileSync(require("node:path").join(ws, "EXECUTION.md"), "utf8");
        assert.match(after, /\| T1 \| Build \| blocked \|/);
        assert.equal((after.match(/BLOCKED T1 \[blocked\]: Waiting for owner \|\| tried: pal_push twice: 500/g) || []).length, 1);
        assert.equal((after.match(/BLOCKED T1 \[blocked\]: Still waiting \|\| tried: pal_validate: 0 errors/g) || []).length, 1);
        assert.match(logs.at(-1), /T1: blocked -> blocked/);
        assert.doesNotMatch(logs.join("\n"), /undefined/);
    } finally {
        console.log = oldLog; console.error = oldError;
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("parseFlags parses cost record fields", () => {
    assert.deepEqual(
        (({ _positional, model, provider, tokensIn, tokensCached, tokensOut, cost, currency, phase }) =>
            ({ _positional, model, provider, tokensIn, tokensCached, tokensOut, cost, currency, phase }))(
            parseFlags(["record", "--model", "m", "--provider=p", "--in", "1", "--cached=2", "--out", "3", "--cost=0.1", "--currency", "USD", "--phase=review"])
        ),
        { _positional: "record", model: "m", provider: "p", tokensIn: "1", tokensCached: "2", tokensOut: "3", cost: "0.1", currency: "USD", phase: "review" }
    );
});

test("cost record writes the sidecar and reports validation errors", async () => {
    const ws = tmpWorkspace();
    const originalLog = console.log;
    const originalError = console.error;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));
    console.error = (...args) => output.push(args.join(" "));
    try {
        const syncCommands = require("../src/cli/syncCommands");
        assert.equal(await syncCommands.run("cost", ["record", "--model", "m", "--provider", "p", "--in", "1", "--cached", "0", "--out", "2", "--dir", ws]), 0);
        assert.equal(await syncCommands.run("cost", ["record", "--provider", "p", "--dir", ws]), 1);
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
    assert.match(output[0], /Recorded session cost for m \(p\)/);
    assert.match(output[1], /cost record failed: model is required/);
    assert.equal(require("../src/core/usage").readSessionCost(ws).entries.length, 1);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("ctx inspect and diff run fully offline", async () => {
    const ws = tmpWorkspace();
    await contextInject.inject(ws, { palName: "Alpha", agent: "codex" });
    await contextInject.inject(ws, { palName: "Beta", agent: "codex" });
    const originalLog = console.log;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));
    try {
        const syncCommands = require("../src/cli/syncCommands");
        assert.equal(await syncCommands.run("ctx", ["inspect", "--dir", ws]), 0);
        assert.equal(await syncCommands.run("ctx", ["diff", "--dir", ws]), 0);
    } finally {
        console.log = originalLog;
        fs.rmSync(ws, { recursive: true, force: true });
    }
    assert.match(output.join("\n"), /Locally stable prefix/);
    assert.match(output.join("\n"), /First divergent section: sync-section/);
});

test("open runs the core preview and opens the web raw token without printing it", async () => {
    const calls = { opened: [], released: [] };
    const syncPath = require.resolve("../src/cli/syncCommands");
    const stubs = new Map([
        [require.resolve("../src/mcp/context"), { buildContext: async () => ({
            session: { lockInfo: { held: true } },
            record: { palGuid: "GUID-1", palName: "Demo", cloudUrl: "https://cloud.example" },
            workspaceDir: "/tmp/demo"
        }) }],
        [require.resolve("../src/mcp/tools"), { TOOLS: [] }],
        [require.resolve("../src/core/lock"), { releaseByGuid: async (session, guid) => { calls.released.push({ session, guid }); } }],
        [require.resolve("../src/core/preview"), { runPreview: async () => ({
            previewed: true, kind: "web", url: "https://webpals.example/raw-token"
        }) }],
        [require.resolve("../src/platform/openUrl"), { openUrl: async (url) => { calls.opened.push(url); return { opened: true }; } }]
    ]);
    const old = new Map();
    for (const [file, value] of stubs) {
        old.set(file, require.cache[file]);
        require.cache[file] = { id: file, filename: file, loaded: true, exports: value };
    }
    delete require.cache[syncPath];
    const originalLog = console.log;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));
    try {
        const syncCommands = require("../src/cli/syncCommands");
        assert.equal(await syncCommands.run("open", ["--dir", "/tmp/demo", "--workflow", "web"]), 0);
    } finally {
        console.log = originalLog;
        delete require.cache[syncPath];
        for (const [file, value] of old) {
            if (value) require.cache[file] = value;
            else delete require.cache[file];
        }
    }
    assert.deepEqual(calls.opened, ["https://webpals.example/raw-token"]);
    assert.equal(calls.released.length, 1);
    assert.match(output.join("\n"), /Opened the web preview in your browser/);
    assert.doesNotMatch(output.join("\n"), /raw-token/);
});

// --- `palsync hooks check|repair` (recovery surface for stale Claude Code hook settings) ---

test("hooks check and repair run offline and migrate legacy entries without relaunching", async () => {
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: {
        Stop: [{ hooks: [{ type: "command", command: "palsync hook completion --mode claude" }] }],
        PreToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: "palsync hook guard --mode claude" }] }],
    } }, null, 2) + "\n" });
    // A nonexistent fake home keeps the user-level scan hermetic (no real ~/.claude on the runner).
    const fakeHome = ws + "/fake-home";
    const originalLog = console.log;
    const originalError = console.error;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));
    console.error = (...args) => output.push(args.join(" "));
    try {
        // No .palsync.json anywhere: hooks must dispatch fully offline.
        assert.equal(await run("hooks", ["check", "--dir", ws], { homeDir: fakeHome }), 1);
        assert.match(output.join("\n"), /stale/);
        assert.match(output.join("\n"), /legacy form 'palsync hook guard --mode claude'/);
        assert.match(output.join("\n"), /missing/);

        assert.equal(await run("hooks", ["repair", "--dir", ws], { homeDir: fakeHome }), 0);
        const value = JSON.parse(fs.readFileSync(require("node:path").join(ws, ".claude", "settings.json"), "utf8"));
        assert.equal(value.hooks.Stop[0].hooks[0].command, claudeHooks.COMPLETION_COMMAND);
        assert.equal(value.hooks.PreToolUse[0].hooks[0].command, claudeHooks.GUARD_COMMAND);
        assert.equal(value.hooks.PostToolUse[0].hooks[0].command, claudeHooks.POST_WRITE_COMMAND, "missing hook installed by repair");

        const after = [];
        console.log = (...args) => after.push(args.join(" "));
        assert.equal(await run("hooks", ["check", "--dir", ws], { homeDir: fakeHome }), 0);
        assert.match(after.join("\n"), /ok/);
        assert.doesNotMatch(after.join("\n"), /stale/);
    } finally {
        console.log = originalLog;
        console.error = originalError;
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("hooks check and repair detect legacy entries in files PalSync never writes", async () => {
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: {
        Stop: [{ hooks: [{ type: "command", command: claudeHooks.COMPLETION_COMMAND }] }],
        PreToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: claudeHooks.GUARD_COMMAND }] }],
        PostToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: claudeHooks.POST_WRITE_COMMAND }] }],
    } }, null, 2) + "\n" });
    // User-level file with the failing bare form; project-local file with the pinned command
    // (works, but unmanaged). Neither may ever be touched.
    const home = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: {
        Stop: [{ hooks: [{ type: "command", command: "palsync hook completion --mode claude" }] }],
    } }) + "\n" });
    const local = require("node:path").join(ws, ".claude", "settings.local.json");
    const localRaw = JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: claudeHooks.GUARD_COMMAND }] }] } }) + "\n";
    fs.writeFileSync(local, localRaw);
    const originalLog = console.log;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));
    try {
        // Workspace is healthy, but the user-level legacy entry keeps failing the hooks → exit 1.
        assert.equal(await run("hooks", ["check", "--dir", ws], { homeDir: home }), 1);
        assert.match(output.join("\n"), /~\/\.claude\/settings\.json/);
        assert.match(output.join("\n"), /legacy form 'palsync hook completion --mode claude'/);
        assert.match(output.join("\n"), /\.claude\/settings\.local\.json/);
        assert.match(output.join("\n"), /pinned command \(works, but PalSync will not update it here\)/);

        // Repair fixes the workspace file but cannot migrate the user-level entry → exit 1 + manual step.
        output.length = 0;
        assert.equal(await run("hooks", ["repair", "--dir", ws], { homeDir: home }), 1);
        assert.match(output.join("\n"), /already healthy/);
        assert.match(output.join("\n"), /Remove these entries manually/);
        // Neither never-written file was modified.
        assert.equal(fs.readFileSync(require("node:path").join(home, ".claude", "settings.json"), "utf8"),
            JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "palsync hook completion --mode claude" }] }] } }) + "\n");
        assert.equal(fs.readFileSync(local, "utf8"), localRaw);
    } finally {
        console.log = originalLog;
        fs.rmSync(ws, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test("hooks check and repair refuse to touch a malformed workspace settings file", async () => {
    const ws = tmpWorkspace({ ".claude/settings.json": "{broken\n" });
    const fakeHome = ws + "/fake-home";
    const originalLog = console.log;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));
    try {
        assert.equal(await run("hooks", ["check", "--dir", ws], { homeDir: fakeHome }), 1);
        assert.match(output.join("\n"), /malformed JSON/);
        assert.match(output.join("\n"), /Add these hooks manually/);
        assert.equal(await run("hooks", ["repair", "--dir", ws], { homeDir: fakeHome }), 1);
        assert.match(output.join("\n"), /cannot repair automatically/);
        assert.equal(fs.readFileSync(require("node:path").join(ws, ".claude", "settings.json"), "utf8"), "{broken\n");
    } finally {
        console.log = originalLog;
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("hooks check and repair are skipped for non-Claude workspaces", async () => {
    const ws = tmpWorkspace({
        ".palsync/context-manifest.json": JSON.stringify({ version: 1, agent: "pi", palName: "Demo" }) + "\n",
    });
    const output = [];
    const originalLog = console.log;
    console.log = (...args) => output.push(args.join(" "));
    try {
        // check: reports the agent, exit 0 — nothing to check.
        assert.equal(await run("hooks", ["check", "--dir", ws], { homeDir: "/nonexistent" }), 0);
        assert.match(output.join("\n"), /workspace agent is pi; Claude hooks not applicable/);
        output.length = 0;
        // repair: refuses without touching anything — no .claude/settings.json may appear.
        assert.equal(await run("hooks", ["repair", "--dir", ws], { homeDir: "/nonexistent" }), 0);
        assert.match(output.join("\n"), /workspace agent is pi; Claude hooks not applicable/);
        assert.equal(fs.existsSync(require("node:path").join(ws, ".claude", "settings.json")), false);
    } finally {
        console.log = originalLog;
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("hooks requires check or repair and is registered in USAGE and SUBCOMMANDS", async () => {
    assert.match(USAGE, /palsync hooks check\|repair/);
    const bin = fs.readFileSync(require("node:path").join(__dirname, "..", "bin", "palsync.js"), "utf8");
    assert.match(bin, /"hook", "hooks"/);
    const originalError = console.error;
    const errs = [];
    console.error = (...args) => errs.push(args.join(" "));
    try {
        assert.equal(await run("hooks", [], { homeDir: "/nonexistent" }), 1);
        assert.equal(await run("hooks", ["--force"], { homeDir: "/nonexistent" }), 1);
        assert.equal(await run("hooks", ["check", "--dir"], { homeDir: "/nonexistent" }), 1);
    } finally {
        console.error = originalError;
    }
    assert.match(errs.join("\n"), /Usage: palsync hooks check\|repair/);
    assert.match(errs.join("\n"), /--dir requires a value/);
});
