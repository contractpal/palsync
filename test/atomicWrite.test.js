"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");
const { writeIfChanged } = require("../src/core/atomicWrite");
const { register } = require("../src/mcp/register");

test("writeIfChanged follows symlinks and preserves target mode", async () => {
    const ws = tmpWorkspace({ "target.md": "old\n" });
    const target = path.join(ws, "target.md");
    const link = path.join(ws, "AGENTS.md");
    fs.chmodSync(target, 0o640);
    fs.symlinkSync("target.md", link);
    assert.equal(await writeIfChanged(link, "new\n"), true);
    assert.equal(fs.readFileSync(target, "utf8"), "new\n");
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.statSync(target).mode & 0o777, 0o640);
    assert.equal(await writeIfChanged(link, "new\n"), false);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("MCP registration leaves an identical config mtime unchanged", async () => {
    const ws = tmpWorkspace();
    const opts = { nodePath: "/test/node" };
    await register(ws, opts);
    const file = path.join(ws, ".mcp.json");
    const first = fs.statSync(file).mtimeMs;
    await new Promise(resolve => setTimeout(resolve, 20));
    await register(ws, opts);
    assert.equal(fs.statSync(file).mtimeMs, first);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("writeIfChanged refuses to replace a changed read-only target", async () => {
    const ws = tmpWorkspace({ "AGENTS.md": "old\n" });
    const file = path.join(ws, "AGENTS.md");
    fs.chmodSync(file, 0o444);
    await assert.rejects(() => writeIfChanged(file, "new\n"), error => error && error.code === "EACCES");
    assert.equal(fs.readFileSync(file, "utf8"), "old\n");
    fs.chmodSync(file, 0o644);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("writeIfChanged rejects cyclic symlinks with ELOOP", async () => {
    const ws = tmpWorkspace();
    fs.symlinkSync("b", path.join(ws, "a"));
    fs.symlinkSync("a", path.join(ws, "b"));
    await assert.rejects(() => writeIfChanged(path.join(ws, "a"), "new\n"), error => error && error.code === "ELOOP");
    fs.rmSync(ws, { recursive: true, force: true });
});
