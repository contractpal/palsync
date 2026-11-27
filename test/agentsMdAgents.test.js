"use strict";
// Gemini CLI / Cursor / Copilot / Antigravity read AGENTS.md + .agents/skills like Codex does,
// and Antigravity + Gemini register MCP at their own project-scoped paths.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const contextInject = require("../src/launcher/contextInject");
const { registerAntigravity } = require("../src/mcp/registerAntigravity");
const { registerGemini } = require("../src/mcp/registerGemini");
const agents = require("../src/launcher/agents");

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "palsync-agentsmd-test-"));
}

for (const agent of ["gemini", "cursor", "copilot", "antigravity"]) {
    test("inject(" + agent + ") writes AGENTS.md + .agents/skills, not CLAUDE.md", async () => {
        const dir = tmpDir();
        const res = await contextInject.inject(dir, { palName: "Demo", agent });
        assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")), "AGENTS.md written");
        assert.ok(fs.existsSync(path.join(dir, ".agents", "skills")), ".agents/skills written");
        assert.ok(!fs.existsSync(path.join(dir, "CLAUDE.md")), "no CLAUDE.md");
        assert.ok(!fs.existsSync(path.join(dir, "CLAUDE.palsync.md")), "no CLAUDE.palsync.md");
        assert.equal(res.agent, agent);
    });
}

test("antigravity is in the agent registry and resolves by flag", () => {
    const a = agents.resolve("antigravity");
    assert.ok(a);
    assert.equal(a.command, "agy");
});

test("registerAntigravity writes .agents/mcp_config.json and keeps other servers", async () => {
    const dir = tmpDir();
    const file = path.join(dir, ".agents", "mcp_config.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    const res = await registerAntigravity(dir);
    assert.equal(res.filePath, file);
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(json.mcpServers.palsync);
    assert.ok(json.mcpServers.other);
});

test("registerGemini adds AGENTS.md to context.fileName, preserving user names", async () => {
    const dir = tmpDir();
    const file = path.join(dir, ".gemini", "settings.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ context: { fileName: ["MY.md"] } }));
    await registerGemini(dir);
    await registerGemini(dir); // idempotent
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepStrictEqual(json.context.fileName, ["MY.md", "AGENTS.md"]);
    assert.ok(json.mcpServers.palsync);
});

test("registerGemini on a fresh workspace keeps GEMINI.md and adds AGENTS.md", async () => {
    const dir = tmpDir();
    await registerGemini(dir);
    const json = JSON.parse(fs.readFileSync(path.join(dir, ".gemini", "settings.json"), "utf8"));
    assert.deepStrictEqual(json.context.fileName, ["GEMINI.md", "AGENTS.md"]);
});
