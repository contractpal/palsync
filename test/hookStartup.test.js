"use strict";
// Claude Code runs `palsync hook guard|post-write|completion` on every Edit/Write and every Stop, in
// every project. Outside a PalSync workspace these must not load the heavy CLI/MCP modules (~85 ms per
// call before this was pinned).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const BIN = path.join(__dirname, "..", "bin", "palsync.js");
const HEAVY = [
    "src/cli/syncCommands.js", "src/mcp/", "src/core/goal.js", "src/core/reviewCheck.js",
    "src/core/push.js", "src/core/preview.js", "src/core/datasets.js", "src/core/lock.js"
];

function loadedModules(adapter, cwd) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-hookload-"));
    const out = path.join(dir, "modules.json");
    const preload = path.join(dir, "preload.js");
    fs.writeFileSync(preload, "process.on('exit', () => require('fs').writeFileSync(" +
        JSON.stringify(out) + ", JSON.stringify(Object.keys(require.cache))));\n");
    const event = { cwd, tool_name: "Edit", tool_input: { file_path: path.join(cwd, "a.txt") } };
    const res = spawnSync(process.execPath, ["-r", preload, BIN, "hook", adapter, "--mode", "claude"],
        { cwd, input: JSON.stringify(event), encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, "");
    return JSON.parse(fs.readFileSync(out, "utf8")).map(file => file.split(path.sep).join("/"));
}

for (const adapter of ["guard", "post-write", "completion"]) {
    test("palsync hook " + adapter + " outside a workspace loads no heavy modules", () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-nows-"));
        const loaded = loadedModules(adapter, cwd);
        assert.ok(loaded.some(file => file.endsWith("src/cli/hookCommand.js")), "hook path not taken");
        const heavy = loaded.filter(file => HEAVY.some(name => file.includes("/" + name)));
        assert.deepStrictEqual(heavy, []);
    });
}
