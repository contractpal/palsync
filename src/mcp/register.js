"use strict";
// Register palsync-mcp with Claude Code by writing a project-scoped .mcp.json into the
// workspace. Claude Code auto-discovers this file and launches the server (node + the bin
// script) with PALSYNC_WORKSPACE pointing at the pal. Cross-platform: uses the running node
// binary and an absolute script path; no shell, no OS-specific launcher.
const fs = require("fs/promises");
const path = require("path");
const { writeIfChanged } = require("../core/atomicWrite");

const MCP_BIN = path.resolve(__dirname, "..", "..", "bin", "palsync-mcp.js");

function buildMcpConfig(workspaceDir, { nodePath = process.execPath } = {}) {
    return {
        mcpServers: {
            palsync: {
                command: nodePath,
                args: [MCP_BIN],
                env: { PALSYNC_WORKSPACE: workspaceDir }
            }
        }
    };
}

// Read <filePath> as JSON (missing/unparsable -> {}), merge `cfg` over it with the servers
// object under `serversKey` merged one level deep (preserves other servers the user already
// configured), write it back. Shared by the Claude (.mcp.json) and OpenCode (opencode.json)
// registrations — the config schemas differ, only the file-merge mechanics are shared.
async function mergeJsonConfig(filePath, cfg, serversKey) {
    let existing = {};
    try { existing = JSON.parse(await fs.readFile(filePath, "utf8")); } catch (e) { /* none */ }
    const merged = Object.assign({}, existing, cfg, { [serversKey]: Object.assign({}, existing[serversKey], cfg[serversKey]) });
    const content = JSON.stringify(merged, null, 2);
    await writeIfChanged(filePath, content);
    return merged;
}

// Write/merge .mcp.json. Preserves any other mcpServers the user already configured.
async function register(workspaceDir, opts = {}) {
    const filePath = path.join(workspaceDir, ".mcp.json");
    const merged = await mergeJsonConfig(filePath, buildMcpConfig(workspaceDir, opts), "mcpServers");
    return { filePath, config: merged };
}

module.exports = { register, buildMcpConfig, mergeJsonConfig, MCP_BIN };
