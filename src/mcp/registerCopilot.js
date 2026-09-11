"use strict";
// Register palsync-mcp with GitHub Copilot CLI. As of Copilot CLI's June 2026 migration off
// .vscode/mcp.json, it reads project-scoped MCP servers from .mcp.json in the project root —
// the exact same file and "mcpServers" shape Claude Code already writes/reads (register.js).
// Deliberately reuses register() itself rather than a second .mcp.json writer: Claude and
// Copilot share one file, one mcpServers.palsync entry, distinguished only by
// PALSYNC_TOOL_PROFILE inside it.
const { register } = require("./register");

async function registerCopilot(workspaceDir, opts = {}) {
    return register(workspaceDir, Object.assign({ toolProfile: "copilot" }, opts));
}

module.exports = { registerCopilot };
