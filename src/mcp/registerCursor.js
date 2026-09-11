"use strict";
// Register palsync-mcp with Cursor (cursor-agent CLI) by writing a project-scoped
// .cursor/mcp.json into the workspace (project config wins over ~/.cursor/mcp.json global config
// on a same-name conflict — same discovery model as Claude Code's .mcp.json). Same JSON shape as
// Claude's mcpServers block, just a different file path — see register.js's
// registerToMcpServersFile. Cursor reads env at process-spawn time only (no per-launch env
// override exists), so this file is the one place PALSYNC_CHIP_SESSION_ID can actually reach it.
const path = require("path");
const { registerToMcpServersFile } = require("./register");

async function registerCursor(workspaceDir, opts = {}) {
    const filePath = path.join(workspaceDir, ".cursor", "mcp.json");
    const config = await registerToMcpServersFile(workspaceDir, filePath, Object.assign({ toolProfile: "cursor" }, opts));
    return { filePath, config };
}

module.exports = { registerCursor };
