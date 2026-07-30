"use strict";
// CLI flag parsing for human-vs-agent preview behavior. The MCP pal_preview tool remains
// no-open by default; the standalone CLI opens unless the caller explicitly opts out.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { parseFlags, defaultPreviewOpen, USAGE, run } = require("../src/cli/syncCommands");
const contextInject = require("../src/launcher/contextInject");
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
