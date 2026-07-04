"use strict";
// Register palsync-mcp with OpenCode by writing a project-scoped opencode.json into the
// workspace (OpenCode reads project-root opencode.json for MCP servers, same discovery model as
// Claude Code's .mcp.json — verified against a live `opencode mcp list`). Cross-platform: uses the
// running node binary and an absolute script path; no shell, no OS-specific launcher.
const fs = require("fs/promises");
const path = require("path");

const MCP_BIN = path.resolve(__dirname, "..", "..", "bin", "palsync-mcp.js");

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
    let existing = {};
    try { existing = JSON.parse(await fs.readFile(filePath, "utf8")); } catch (e) { /* none */ }
    const cfg = buildOpencodeConfig(workspaceDir, opts);
    const merged = Object.assign({}, existing, cfg, { mcp: Object.assign({}, existing.mcp, cfg.mcp) });
    await fs.writeFile(filePath, JSON.stringify(merged, null, 2), "utf8");
    return { ok: true, filePath, config: merged };
}

module.exports = { registerOpencode, buildOpencodeConfig, MCP_BIN };
