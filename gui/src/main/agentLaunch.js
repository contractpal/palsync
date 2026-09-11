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
const { registerGemini } = require("palsync/src/mcp/registerGemini");
const { registerCursor } = require("palsync/src/mcp/registerCursor");
const { registerCopilot } = require("palsync/src/mcp/registerCopilot");
const registerPi = require("palsync/src/mcp/registerPi");
const { MCP_BIN } = require("palsync/src/mcp/register");

// MVP: project-scoped registrations only. Codex's registration is a global
// ~/.codex/config.toml singleton (a pre-existing CLI limitation) — not supported here yet.
// Copilot shares Claude's own .mcp.json (both read the same project-scoped file/shape).
const REGISTRARS = {
    "claude-code": { configFile: ".mcp.json", register: registerClaude },
    "opencode": { configFile: "opencode.json", register: registerOpencode },
    "gemini": { configFile: path.join(".gemini", "settings.json"), register: registerGemini },
    "cursor": { configFile: path.join(".cursor", "mcp.json"), register: registerCursor },
    "copilot": { configFile: ".mcp.json", register: registerCopilot }
};

// Pi doesn't fit the per-pal-configFile model above: its registration is a ONE-TIME GLOBAL
// native-extension install (~/.pi/agent/extensions/palsync), the same file content regardless of
// which pal/workspace you're opening — not a project-scoped config file. The extension itself
// resolves the workspace per-session from ctx.cwd (see pi-extension/index.ts's session_start
// handler), so there's nothing pal-specific to write here; ensureMcpRegistered below special-
// cases it instead of forcing it through the REGISTRARS shape.
function detectAgents() {
    return available().filter(a => REGISTRARS[a.id] || a.id === "pi");
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

// Claude Code's hook commands hit the same electron.exe-as-node problem as the MCP config
// (see ensureElectronRunAsNode above), but .claude/settings.json hook entries are a plain
// command string with no `env` field to carry the fix — so instead the env var is prefixed
// onto the command itself and left for the shell Claude Code already runs it through to
// interpret ("set VAR=1 && cmd" on Windows, "VAR=1 cmd" elsewhere). Self-healing: re-run on
// every console launch so a config written before this fix existed gets corrected too.
//
// This does NOT correct the absolute app/script paths baked into an existing hook command
// (e.g. after macOS AppTranslocation gives a relaunch a new temp path) — only whether the
// env-var prefix is present. A prefix-and-replace-in-place attempt was tried and reverted:
// claudeHooks.js's own ownership detection (isOwnedCommand/parseGeneratedCommand) requires the
// command's executable basename to be a plain "node" binary, which is never true for a hook
// written from inside Electron's main process (the executable is the Electron/app binary
// itself) — so calling its configure(install:true) here doesn't recognize the existing GUI-
// written entry as owned and appends a second, duplicate hook instead of replacing it, growing
// unbounded on every relaunch. Fixing this properly needs `claudeHooks.js`'s recognition taught
// about the Electron-wrapped form, not worked around from here. Tracked as a known gap.
async function ensureElectronRunAsNodeForHooks(workspaceDir) {
    const filePath = path.join(workspaceDir, ".claude", "settings.json");
    let settings;
    try { settings = JSON.parse(await fs.readFile(filePath, "utf8")); }
    catch (e) { return; }
    if (!settings || typeof settings.hooks !== "object" || !settings.hooks) return;
    const prefix = process.platform === "win32" ? "set ELECTRON_RUN_AS_NODE=1 && " : "ELECTRON_RUN_AS_NODE=1 ";
    let changed = false;
    for (const groups of Object.values(settings.hooks)) {
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
            if (!group || !Array.isArray(group.hooks)) continue;
            for (const hook of group.hooks) {
                if (!hook || hook.type !== "command" || typeof hook.command !== "string") continue;
                if (hook.command.indexOf("ELECTRON_RUN_AS_NODE") !== -1) continue; // already patched
                if (hook.command.toLowerCase().indexOf("palsync.js") === -1) continue; // not our hook
                hook.command = prefix + hook.command;
                changed = true;
            }
        }
    }
    if (changed) await fs.writeFile(filePath, JSON.stringify(settings, null, 2), "utf8");
}

// Self-healing, same pattern as ensureElectronRunAsNode: a config written before Chip started
// assigning per-pal session ids (or before this pal had one yet) gets patched in place rather
// than left stale, and it's re-checked on every console launch so it can never drift.
async function ensureChipSessionId(filePath, configFile, chipSessionId) {
    if (!chipSessionId) return;
    let json;
    try { json = JSON.parse(await fs.readFile(filePath, "utf8")); }
    catch (e) { return; }
    const entry = configFile === "opencode.json" ? (json.mcp && json.mcp.palsync) : (json.mcpServers && json.mcpServers.palsync);
    if (!entry) return;
    const envKey = configFile === "opencode.json" ? "environment" : "env";
    entry[envKey] = entry[envKey] || {};
    if (entry[envKey].PALSYNC_CHIP_SESSION_ID === chipSessionId) return; // already up to date
    entry[envKey].PALSYNC_CHIP_SESSION_ID = chipSessionId;
    await fs.writeFile(filePath, JSON.stringify(json, null, 2), "utf8");
}

// Re-registers (self-heals command/args) every time rather than only once, then re-applies the
// Electron-as-Node patch and the Chip session id on top — register()'s own merge replaces the
// palsync entry wholesale, dropping both. This also self-heals macOS AppTranslocation path
// drift: a quarantined, unmoved .app gets a *different* randomized temp path from Gatekeeper on
// every launch, and register()'s command/args are built from this run's process.execPath/
// __dirname — so a pal's MCP tools no longer silently break after quitting and relaunching
// (previously: register() only ran once, the first time, so this pal's `command`/args stayed
// pinned to whatever launch first wrote the file — permanently ENOENT the moment that temp
// directory was gone). chipSessionId is this pal tab's persistent id (see index.js) — every
// request the agent's MCP child process makes for this pal then carries it as a Chip-Session-ID
// header.
async function ensureMcpRegistered(agentId, workspaceDir, chipSessionId) {
    // Pi: no per-pal file to write/self-heal — just make sure the global native extension is
    // installed (registerPi.install() itself only actually writes when the bundled source differs
    // from what's already there, so this is cheap to call on every console launch). The Chip-
    // Session-ID and the absolute palsync-mcp path are threaded separately, via the environment of
    // the `pi` process itself (see piSpawnEnv below) — pi-extension/index.ts's own `...process.env`
    // spread carries both down into the MCP child it spawns.
    if (agentId === "pi") {
        const result = await registerPi.register({ installExtension: true });
        return { alreadyRegistered: !result.written, filePath: result.filePath, config: null };
    }
    const reg = REGISTRARS[agentId];
    if (!reg) throw new Error("No MCP registration known for agent '" + agentId + "'.");
    const filePath = path.join(workspaceDir, reg.configFile);
    const alreadyRegistered = await exists(filePath);
    const result = await reg.register(workspaceDir, { chipSessionId });
    await ensureElectronRunAsNode(filePath, reg.configFile);
    await ensureChipSessionId(filePath, reg.configFile, chipSessionId);
    await ensureElectronRunAsNodeForHooks(workspaceDir);
    return Object.assign({ alreadyRegistered }, result);
}

// Env to layer onto the spawned `pi` process itself (see ptyManager.start's `env` option) so its
// native extension — which spawns palsync-mcp by bare command name, unlike every other agent's
// config-file-based absolute path — can find Chip's own bundled copy without requiring a separate
// global `npm install -g palsync` on the user's machine, and so its MCP child still carries the
// Chip-Session-ID header like every other agent's does.
function piSpawnEnv(chipSessionId) {
    const env = { PALSYNC_MCP_BIN: MCP_BIN };
    if (chipSessionId) env.PALSYNC_CHIP_SESSION_ID = chipSessionId;
    return env;
}

module.exports = {
    detectAgents, resolveAgent: resolve, ensureMcpRegistered, piSpawnEnv,
    ensureElectronRunAsNode, ensureElectronRunAsNodeForHooks, ensureChipSessionId
};
