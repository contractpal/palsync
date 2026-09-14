"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const TOML = require("@iarna/toml");
const { tmpWorkspace } = require("./helpers");
const { registerCodexProject, writeProjectConfig, ensureProjectTrusted } = require("../src/mcp/registerCodexProject");
const { MCP_BIN } = require("../src/mcp/register");

test("writeProjectConfig writes a project-scoped mcp_servers.palsync table", async () => {
    const ws = tmpWorkspace();
    const result = await writeProjectConfig(ws, { nodePath: "/test/node", chipSessionId: "sess-1" });
    assert.equal(result.filePath, path.join(ws, ".codex", "config.toml"));
    const written = TOML.parse(fs.readFileSync(result.filePath, "utf8"));
    assert.deepEqual(written.mcp_servers.palsync, {
        command: "/test/node",
        args: [MCP_BIN],
        env: { PALSYNC_WORKSPACE: ws, PALSYNC_TOOL_PROFILE: "codex", PALSYNC_CHIP_SESSION_ID: "sess-1" }
    });
    fs.rmSync(ws, { recursive: true, force: true });
});

test("writeProjectConfig preserves the user's own existing config content", async () => {
    const ws = tmpWorkspace({
        ".codex/config.toml": 'model = "gpt-5.1"\n\n[mcp_servers.other_server]\ncommand = "npx"\nargs = ["-y", "@some/other-mcp"]\n'
    });
    await writeProjectConfig(ws, { nodePath: "/test/node" });
    const written = TOML.parse(fs.readFileSync(path.join(ws, ".codex", "config.toml"), "utf8"));
    assert.equal(written.model, "gpt-5.1");
    assert.deepEqual(written.mcp_servers.other_server, { command: "npx", args: ["-y", "@some/other-mcp"] });
    assert.ok(written.mcp_servers.palsync, "palsync entry should be added alongside the existing server");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("writeProjectConfig re-registering the same workspace is idempotent (no unnecessary write)", async () => {
    const ws = tmpWorkspace();
    await writeProjectConfig(ws, { nodePath: "/test/node" });
    const second = await writeProjectConfig(ws, { nodePath: "/test/node" });
    assert.equal(second.changed, false);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("ensureProjectTrusted marks the exact workspace path trusted in a fake global config, preserving other projects", async () => {
    const ws = tmpWorkspace();
    const globalDir = tmpWorkspace({
        "config.toml": 'model = "gpt-5.1"\n\n[projects."/some/other/project"]\ntrust_level = "trusted"\n'
    });
    const globalConfigPath = path.join(globalDir, "config.toml");

    const result = await ensureProjectTrusted(ws, globalConfigPath);
    assert.equal(result.changed, true);
    const written = TOML.parse(fs.readFileSync(globalConfigPath, "utf8"));
    assert.equal(written.model, "gpt-5.1");
    assert.equal(written.projects["/some/other/project"].trust_level, "trusted");
    assert.equal(written.projects[path.resolve(ws)].trust_level, "trusted");

    // Re-running against an already-trusted project makes no write.
    const second = await ensureProjectTrusted(ws, globalConfigPath);
    assert.equal(second.changed, false);

    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(globalDir, { recursive: true, force: true });
});

test("registerCodexProject never touches the real home directory when globalConfigPath is overridden", async () => {
    const ws = tmpWorkspace();
    const globalDir = tmpWorkspace();
    const globalConfigPath = path.join(globalDir, "config.toml");

    const result = await registerCodexProject(ws, { nodePath: "/test/node", globalConfigPath });
    assert.equal(result.ok, true);
    assert.equal(result.trustedProject, true);
    assert.equal(result.filePath, path.join(ws, ".codex", "config.toml"));
    assert.equal(result.globalFilePath, globalConfigPath);
    assert.ok(fs.existsSync(result.filePath));
    assert.ok(fs.existsSync(globalConfigPath));

    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(globalDir, { recursive: true, force: true });
});
