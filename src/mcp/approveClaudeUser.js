"use strict";
// Pre-approve the palsync project MCP server in Claude Code's USER settings
// (~/.claude/settings.json -> enabledMcpjsonServers).
//
// Why: Claude Code gates project-level approvals (.claude/settings.local.json) until the
// workspace's trust dialog has been accepted, and newer versions don't reliably persist that
// trust for new workspaces — so every session re-prompts "New MCP server found: palsync".
// User-level approvals are NOT gated by trust (Claude Code docs, MCP "Project server approvals"),
// so a single user-level entry stops the prompt in every workspace.
//
// Merges only: preserves every other key, converts a lone string value to an array (Claude Code
// accepts both), writes nothing when already approved, and never overwrites a file it could not
// parse as a JSON object.
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { writeIfChanged } = require("../core/atomicWrite");

const SERVER_NAME = "palsync";

function defaultSettingsPath() {
    const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
    return path.join(dir, "settings.json");
}

// -> { filePath, changed, skipped?: "unparsable" }
async function approvePalsyncForClaudeUser({ settingsPath = defaultSettingsPath() } = {}) {
    let settings = {};
    let raw = null;
    try { raw = await fs.readFile(settingsPath, "utf8"); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    if (raw !== null && raw.trim() !== "") {
        try { settings = JSON.parse(raw); }
        catch (e) { return { filePath: settingsPath, changed: false, skipped: "unparsable" }; }
        if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
            return { filePath: settingsPath, changed: false, skipped: "unparsable" };
        }
    }
    const current = settings.enabledMcpjsonServers;
    const list = Array.isArray(current) ? current.slice() : (typeof current === "string" ? [current] : []);
    if (Array.isArray(current) && list.includes(SERVER_NAME)) return { filePath: settingsPath, changed: false };
    if (!list.includes(SERVER_NAME)) list.push(SERVER_NAME);
    settings.enabledMcpjsonServers = list;
    const changed = await writeIfChanged(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return { filePath: settingsPath, changed };
}

module.exports = { approvePalsyncForClaudeUser };
