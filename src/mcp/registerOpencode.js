"use strict";
// Register palsync-mcp with OpenCode by writing a project-scoped opencode.json into the
// workspace (OpenCode reads project-root opencode.json for MCP servers, same discovery model as
// Claude Code's .mcp.json — verified against a live `opencode mcp list`). Cross-platform: uses the
// running node binary and an absolute script path; no shell, no OS-specific launcher.
const path = require("path");
const { mergeJsonConfig, MCP_BIN } = require("./register");

function buildOpencodeConfig(workspaceDir, { nodePath = process.execPath } = {}) {
    return {
        $schema: "https://opencode.ai/config.json",
        mcp: {
            palsync: {
                type: "local",
                command: [nodePath, MCP_BIN],
                enabled: true,
                environment: { PALSYNC_WORKSPACE: workspaceDir }
            }
        }
    };
}

// Write/merge opencode.json. Preserves any other top-level keys and other mcp servers the user
// already configured.
async function registerOpencode(workspaceDir, opts = {}) {
    const filePath = path.join(workspaceDir, "opencode.json");
    const merged = await mergeJsonConfig(filePath, buildOpencodeConfig(workspaceDir, opts), "mcp");
    return { ok: true, filePath, config: merged };
}

module.exports = { registerOpencode, buildOpencodeConfig, MCP_BIN };
