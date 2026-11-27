"use strict";
// Register palsync-mcp with Google Antigravity (the `agy` CLI and the IDE share one config) by
// writing a project-scoped .agents/mcp_config.json into the workspace. Same "mcpServers: {
// palsync: { command, args, env } }" shape as Claude's .mcp.json, just at Antigravity's path —
// see register.js's registerToMcpServersFile. The global equivalent is ~/.gemini/config/mcp_config.json;
// the project file only applies to this workspace, which is what we want (never touch the global one).
// NOTE: Antigravity renames remote `url`/`httpUrl` entries to `serverUrl`; palsync is a local stdio
// command so that does not apply here.
const path = require("path");
const { registerToMcpServersFile } = require("./register");

async function registerAntigravity(workspaceDir, opts = {}) {
    const filePath = path.join(workspaceDir, ".agents", "mcp_config.json");
    const config = await registerToMcpServersFile(workspaceDir, filePath, opts);
    return { filePath, config };
}

module.exports = { registerAntigravity };
