"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");
const { approvePalsyncForClaudeUser } = require("../src/mcp/approveClaudeUser");

function setup(content) {
    const dir = tmpWorkspace(content === undefined ? {} : { "settings.json": content });
    return { dir, file: path.join(dir, "settings.json") };
}
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));

test("creates the settings file when missing", async () => {
    const { dir, file } = setup();
    const r = await approvePalsyncForClaudeUser({ settingsPath: file });
    assert.equal(r.changed, true);
    assert.deepEqual(read(file), { enabledMcpjsonServers: ["palsync"] });
    fs.rmSync(dir, { recursive: true, force: true });
});

test("preserves other keys and other approved servers, and is idempotent", async () => {
    const { dir, file } = setup(JSON.stringify({ model: "sonnet", enabledMcpjsonServers: ["other"] }));
    assert.equal((await approvePalsyncForClaudeUser({ settingsPath: file })).changed, true);
    assert.deepEqual(read(file), { model: "sonnet", enabledMcpjsonServers: ["other", "palsync"] });
    const mtime = fs.statSync(file).mtimeMs;
    await new Promise(r => setTimeout(r, 20));
    assert.equal((await approvePalsyncForClaudeUser({ settingsPath: file })).changed, false);
    assert.equal(fs.statSync(file).mtimeMs, mtime);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("converts a lone string value to an array", async () => {
    const { dir, file } = setup(JSON.stringify({ enabledMcpjsonServers: "other" }));
    await approvePalsyncForClaudeUser({ settingsPath: file });
    assert.deepEqual(read(file).enabledMcpjsonServers, ["other", "palsync"]);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("leaves an unparsable file untouched", async () => {
    const { dir, file } = setup("{ not json");
    const r = await approvePalsyncForClaudeUser({ settingsPath: file });
    assert.equal(r.changed, false);
    assert.equal(r.skipped, "unparsable");
    assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
    fs.rmSync(dir, { recursive: true, force: true });
});
