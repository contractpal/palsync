"use strict";
// Register palsync-mcp with Gemini CLI by writing a project-scoped .gemini/settings.json into
// the workspace (project config overrides ~/.gemini/settings.json global config — same
// discovery model as Claude Code's .mcp.json). Same JSON shape as Claude's mcpServers block, just
// a different file path — see register.js's registerToMcpServersFile.
const path = require("path");
const { registerToMcpServersFile } = require("./register");

async function registerGemini(workspaceDir, opts = {}) {
    const filePath = path.join(workspaceDir, ".gemini", "settings.json");
    const config = await registerToMcpServersFile(workspaceDir, filePath, Object.assign({ toolProfile: "gemini" }, opts));
    return { filePath, config };
}

module.exports = { registerGemini };
