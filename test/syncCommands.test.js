"use strict";
// CLI flag parsing for human-vs-agent preview behavior. The MCP pal_preview tool remains
// no-open by default; the standalone CLI opens unless the caller explicitly opts out.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { parseFlags, defaultPreviewOpen, USAGE } = require("../src/cli/syncCommands");
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

test("USAGE documents browser-open preview default and no-open escape hatch", () => {
    assert.match(USAGE, /--open\|--no-open/);
    assert.match(USAGE, /browser by default/);
    assert.match(USAGE, /--no-open/);
    assert.match(USAGE, /palsync open/);
    assert.doesNotMatch(USAGE, /palsync scaffold/);
    assert.match(USAGE, /palsync context inspect\|diff/);
});

test("context inspect and diff run fully offline", async () => {
    const ws = tmpWorkspace();
    await contextInject.inject(ws, { palName: "Alpha", agent: "codex" });
    await contextInject.inject(ws, { palName: "Beta", agent: "codex" });
    const originalLog = console.log;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));
    try {
        const syncCommands = require("../src/cli/syncCommands");
        assert.equal(await syncCommands.run("context", ["inspect", "--dir", ws]), 0);
        assert.equal(await syncCommands.run("context", ["diff", "--dir", ws]), 0);
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
