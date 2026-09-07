"use strict";
// Agent detection (reuses palsync's vendor-neutral PATH scan — never bundles or assumes any
// agent CLI) and MCP registration-ensure: before first launching a pal's console, make sure
// the chosen agent's MCP config file exists in the pal folder, exactly like the CLI launcher
// does. The agent CLI itself spawns the MCP server as its own child process from there on.
const fs = require("fs/promises");
const path = require("path");
const { available, resolve } = require("palsync/src/launcher/agents");
const { register: registerClaude } = require("palsync/src/mcp/register");
const { registerOpencode } = require("palsync/src/mcp/registerOpencode");

// MVP: project-scoped registrations only. Codex's registration is a global
// ~/.codex/config.toml singleton (a pre-existing CLI limitation) — not supported here yet.
const REGISTRARS = {
    "claude-code": { configFile: ".mcp.json", register: registerClaude },
    "opencode": { configFile: "opencode.json", register: registerOpencode }
};

function detectAgents() {
    return available().filter(a => REGISTRARS[a.id]);
}

async function exists(filePath) {
    try { await fs.access(filePath); return true; }
    catch (e) { return false; }
}

// palsync's register()/registerOpencode() default the MCP server's launch command to
// `process.execPath` — correct under a plain Node CLI process, but INSIDE ELECTRON'S MAIN
// PROCESS that's the path to electron.exe itself, which won't run palsync-mcp.js as a plain
// script unless ELECTRON_RUN_AS_NODE=1 is set (Electron's own "act as plain Node" mode — the
// right fix here, not requiring a separately-installed system Node, which the whole point of
// this GUI is to avoid depending on). palsync's own env-building is internal to register(), so
// this patches the written file afterward rather than changing shared src/ code.
async function ensureElectronRunAsNode(filePath, configFile) {
    let json;
    try { json = JSON.parse(await fs.readFile(filePath, "utf8")); }
    catch (e) { return; }
    const entry = configFile === "opencode.json" ? (json.mcp && json.mcp.palsync) : (json.mcpServers && json.mcpServers.palsync);
    if (!entry) return;
    const envKey = configFile === "opencode.json" ? "environment" : "env";
    entry[envKey] = entry[envKey] || {};
    if (entry[envKey].ELECTRON_RUN_AS_NODE === "1") return; // already patched
    entry[envKey].ELECTRON_RUN_AS_NODE = "1";
    await fs.writeFile(filePath, JSON.stringify(json, null, 2), "utf8");
}

// Idempotent on the registration itself, but self-healing on the Electron-as-Node patch — an
// already-registered config from before this fix existed still gets corrected.
async function ensureMcpRegistered(agentId, workspaceDir) {
    const reg = REGISTRARS[agentId];
    if (!reg) throw new Error("No MCP registration known for agent '" + agentId + "'.");
    const filePath = path.join(workspaceDir, reg.configFile);
    const alreadyRegistered = await exists(filePath);
    let result = { filePath };
    if (!alreadyRegistered) result = await reg.register(workspaceDir);
    await ensureElectronRunAsNode(filePath, reg.configFile);
    return Object.assign({ alreadyRegistered }, result);
}

module.exports = { detectAgents, resolveAgent: resolve, ensureMcpRegistered, ensureElectronRunAsNode };
