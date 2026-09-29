"use strict";
// Register palsync-mcp with Codex by shelling out to its CLI (`codex mcp add`), so Codex owns its
// config format (~/.codex/config.toml) — palsync never hand-writes TOML. The server launch mirrors
// the Claude .mcp.json integration exactly: the running node binary + bin/palsync-mcp.js, with
// PALSYNC_WORKSPACE pointing at the pal.
//
// Idempotent: an existing `palsync` entry is removed first, then re-added, so re-runs never
// duplicate and the workspace path is refreshed. Graceful: if the `codex` binary is absent or the
// add fails, we return a result with the exact manual command — we never throw and never silently
// fail (the caller surfaces the warning).
//
// NOTE: `codex mcp add` writes to the GLOBAL ~/.codex/config.toml (Codex has no project-scoped MCP
// flag today), so there is one shared `palsync` entry whose PALSYNC_WORKSPACE is the most recently
// registered workspace. The remove+add refresh keeps it correct for the active session.
const { spawnSync } = require("child_process");
const { commandOnPath } = require("../platform/commandOnPath");
const { MCP_BIN } = require("./register");

const SERVER_NAME = "palsync";

function codex(args, cwd) {
    const useShell = process.platform === "win32"; // resolve codex.cmd on Windows
    return spawnSync("codex", args, { cwd, encoding: "utf8", shell: useShell });
}

// The `codex mcp add` argv that registers the palsync server (mirrors the Claude server launch).
function addArgs(workspaceDir, nodePath) {
    return ["mcp", "add", SERVER_NAME,
        "--env", "PALSYNC_WORKSPACE=" + workspaceDir,
        "--", nodePath, MCP_BIN];
}

// Human-runnable form of the add command (shown to the user when auto-registration can't run).
function manualCommand(workspaceDir, nodePath) {
    return "codex " + addArgs(workspaceDir, nodePath)
        .map(a => (a.includes(" ") ? "\"" + a + "\"" : a)).join(" ");
}

// Does Codex already have a `palsync` server configured? Best-effort via `codex mcp list --json`;
// returns false if the probe can't be parsed (caller then just attempts a clean add).
function alreadyConfigured(cwd) {
    const r = codex(["mcp", "list", "--json"], cwd);
    if (r.status !== 0 || !r.stdout) return false;
    try {
        const parsed = JSON.parse(r.stdout);
        if (Array.isArray(parsed)) return parsed.some(s => s && (s.name === SERVER_NAME || s === SERVER_NAME));
        if (parsed && typeof parsed === "object") return Object.prototype.hasOwnProperty.call(parsed, SERVER_NAME)
            || Object.keys(parsed).some(k => k === SERVER_NAME);
    } catch (e) { /* fall through */ }
    return String(r.stdout).includes(SERVER_NAME);
}

// Register (or refresh) the palsync MCP server with Codex. Never throws.
// Returns: { ok, registered?, refreshed?, reason?, command, stderr? }.
async function registerCodex(workspaceDir, { nodePath = process.execPath } = {}) {
    const command = manualCommand(workspaceDir, nodePath);
    if (!commandOnPath("codex")) {
        return { ok: false, reason: "codex-not-found", command };
    }
    // Idempotency: drop any existing entry first so we don't duplicate and so PALSYNC_WORKSPACE is
    // refreshed to this workspace. Best-effort — ignore the remove result.
    const refreshed = alreadyConfigured(workspaceDir);
    if (refreshed) codex(["mcp", "remove", SERVER_NAME], workspaceDir);

    const res = codex(addArgs(workspaceDir, nodePath), workspaceDir);
    if (res.status === 0) {
        return { ok: true, registered: true, refreshed, command };
    }
    return { ok: false, reason: "add-failed", stderr: (res.stderr || res.stdout || "").toString().trim(), command };
}

module.exports = { registerCodex, addArgs, manualCommand, commandOnPath, MCP_BIN, SERVER_NAME };
