"use strict";
// Register palsync-mcp with Gemini CLI by writing a project-scoped .gemini/settings.json into
// the workspace (project config overrides ~/.gemini/settings.json global config — same
// discovery model as Claude Code's .mcp.json). Same JSON shape as Claude's mcpServers block, just
// a different file path — see register.js's registerToMcpServersFile.
//
// Gemini CLI reads only GEMINI.md by default. PalSync's context doc for this agent is AGENTS.md
// (shared with Codex/Cursor/Copilot/Antigravity), so we also add AGENTS.md to `context.fileName`
// in the same settings file. Any names the user already listed are kept.
const fs = require("fs/promises");
const path = require("path");
const { registerToMcpServersFile } = require("./register");
const { writeIfChanged } = require("../core/atomicWrite");

async function ensureAgentsMdContext(filePath) {
    let json;
    try { json = JSON.parse(await fs.readFile(filePath, "utf8")); }
    catch (e) { return; }
    const ctx = (json.context && typeof json.context === "object") ? json.context : {};
    let names = ctx.fileName;
    if (names == null) names = ["GEMINI.md"];
    else if (typeof names === "string") names = [names];
    else if (!Array.isArray(names)) return; // unrecognised shape — leave the user's value alone
    if (names.includes("AGENTS.md")) return;
    json.context = Object.assign({}, ctx, { fileName: names.concat("AGENTS.md") });
    await writeIfChanged(filePath, JSON.stringify(json, null, 2));
}

async function registerGemini(workspaceDir, opts = {}) {
    const filePath = path.join(workspaceDir, ".gemini", "settings.json");
    let config = await registerToMcpServersFile(workspaceDir, filePath, opts);
    await ensureAgentsMdContext(filePath);
    try { config = JSON.parse(await fs.readFile(filePath, "utf8")); } catch (e) { /* keep merged */ }
    return { filePath, config };
}

module.exports = { registerGemini };
