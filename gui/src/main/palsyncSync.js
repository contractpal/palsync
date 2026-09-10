"use strict";
// Detects whether a pal folder's own resolvable `palsync` (the one its Claude Code hooks would
// actually invoke) is behind the version bundled with this running Chip Pal Builder, and (on
// user confirmation) resyncs it. This is a LOCAL, OFFLINE operation — Chip already carries its
// own full palsync copy (it's what wrote these hooks in the first place, via claudeHooks.js's
// HOOK_SCRIPT resolved relative to wherever THIS app's own bundled palsync lives), so "sync"
// just means re-pointing the folder's hooks at that same bundled copy again. No npm, no
// registry, no network — there's nothing to download, and palsync isn't published on the public
// npm registry anyway (confirmed live: `npm install -g palsync@latest` 404s).
const fs = require("fs/promises");
const path = require("path");
const { exec } = require("child_process");
const claudeHooks = require("palsync/src/launcher/claudeHooks");
const { compareVersions } = require("./versionCheck");

const BUNDLED_VERSION = require("palsync/package.json").version;
const CHECK_TIMEOUT_MS = 5000;

async function readSettings(workspaceDir) {
    try {
        const text = await fs.readFile(path.join(workspaceDir, ".claude", "settings.json"), "utf8");
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

// The Stop-hook completion command is always present on a set-up pal folder (see
// claudeHooks.js's OWNED_HOOKS). Found live (2026-09-10): claudeHooks.js's OWN ownership
// detection (findOwnedIn/isOwnedCommand) does NOT recognize the GUI's Electron-wrapped form
// (`set ELECTRON_RUN_AS_NODE=1 && "<electron>" "<script>" hook completion --mode claude`) as
// owned at all - the same known gap documented in agentLaunch.js's
// ensureElectronRunAsNodeForHooks (its own ownership check requires a plain "node"/"node.exe"
// executable, never true once Electron-wrapped). So every REAL GUI-managed pal folder's Stop
// hook was silently undetectable here. Use the same loose "contains palsync.js" text match
// ensureElectronRunAsNodeForHooks and resyncHooks (below) already rely on, instead of going
// through claudeHooks.js's stricter (and, for this exact case, broken) ownership check.
function findStopHookCommand(settings) {
    if (!settings || typeof settings.hooks !== "object" || !settings.hooks) return null;
    const groups = settings.hooks.Stop;
    if (!Array.isArray(groups)) return null;
    for (const group of groups) {
        if (!group || !Array.isArray(group.hooks)) continue;
        for (const hook of group.hooks) {
            if (!hook || hook.type !== "command" || typeof hook.command !== "string") continue;
            if (hook.command.toLowerCase().indexOf("palsync.js") !== -1) return hook.command;
        }
    }
    return null;
}

// Swap the trailing hook-invocation args for `--version`, which bin/palsync.js answers
// immediately regardless of Node/Claude prereqs (see its own --version handling) - so this
// reuses the exact command Claude Code would run for this folder, just asking it a different
// question. Works whether or not the command carries the "set ELECTRON_RUN_AS_NODE=1 && " (or
// POSIX "ELECTRON_RUN_AS_NODE=1 ") prefix, since that's just leading text before this pattern.
function versionCommandFor(command) {
    const m = /^(.*?)\s+hook\s+\S+\s+--mode\s+claude\s*$/.exec(String(command).trim());
    return m ? m[1] + " --version" : null;
}

function execVersion(command, cwd) {
    return new Promise(resolve => {
        exec(command, { cwd, timeout: CHECK_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
            if (err) { resolve(null); return; }
            const m = /(\d+\.\d+\.\d+)/.exec(String(stdout));
            resolve(m ? m[1] : null);
        });
    });
}

// { outdated, current, latest } | null (couldn't determine — never blocks anything).
async function checkPalFolderVersion(workspaceDir) {
    const settings = await readSettings(workspaceDir);
    if (!settings) return null;
    const stopCommand = findStopHookCommand(settings);
    if (!stopCommand) return null;
    const command = versionCommandFor(stopCommand);
    if (!command) return null;

    const current = await execVersion(command, workspaceDir);
    if (!current) return null;
    if (compareVersions(BUNDLED_VERSION, current) <= 0) return { outdated: false, current, latest: BUNDLED_VERSION };
    return { outdated: true, current, latest: BUNDLED_VERSION };
}

// Which canonical command belongs under which hook event, per claudeHooks.js's OWNED_HOOKS.
const EVENT_CANONICAL_COMMAND = {
    Stop: () => claudeHooks.COMPLETION_COMMAND,
    PreToolUse: () => claudeHooks.GUARD_COMMAND,
    PostToolUse: () => claudeHooks.POST_WRITE_COMMAND
};

// Re-point every owned hook command in this folder's .claude/settings.json at the canonical
// current form (this app's own bundled palsync), then re-apply the Electron-as-Node prefix —
// same two-step self-heal agentLaunch.js's ensureMcpRegistered already does for the MCP config,
// applied here on demand instead of only at console launch. Deliberately does NOT go through
// claudeHooks.js's own configure(install:true): its ownership detection doesn't recognize the
// Electron-wrapped form this GUI writes, so it would append a duplicate hook instead of
// replacing the stale one (see agentLaunch.js's ensureElectronRunAsNodeForHooks comment — a
// known, separate gap). This uses the same loose "is this our hook" text match instead
// (contains "palsync.js"), which IS safe for a straight replace-in-place.
async function resyncHooks(workspaceDir) {
    const filePath = path.join(workspaceDir, ".claude", "settings.json");
    let settings;
    try { settings = JSON.parse(await fs.readFile(filePath, "utf8")); }
    catch (e) { return { ok: false, reason: "could not read .claude/settings.json: " + (e && e.message ? e.message : String(e)) }; }
    if (!settings || typeof settings.hooks !== "object" || !settings.hooks) {
        return { ok: false, reason: "no hooks in .claude/settings.json to resync" };
    }

    const prefix = process.platform === "win32" ? "set ELECTRON_RUN_AS_NODE=1 && " : "ELECTRON_RUN_AS_NODE=1 ";
    let changed = false;
    for (const [event, groups] of Object.entries(settings.hooks)) {
        const canonical = EVENT_CANONICAL_COMMAND[event];
        if (!canonical || !Array.isArray(groups)) continue;
        const nextCommand = prefix + canonical();
        for (const group of groups) {
            if (!group || !Array.isArray(group.hooks)) continue;
            for (const hook of group.hooks) {
                if (!hook || hook.type !== "command" || typeof hook.command !== "string") continue;
                if (hook.command.toLowerCase().indexOf("palsync.js") === -1) continue; // not our hook
                if (hook.command === nextCommand) continue; // already current
                hook.command = nextCommand;
                changed = true;
            }
        }
    }
    if (!changed) return { ok: true, changed: false };
    await fs.writeFile(filePath, JSON.stringify(settings, null, 2), "utf8");
    return { ok: true, changed: true };
}

// Runs the resync, reporting progress the same shape TestRibbon.jsx's confirm/run modal already
// expects from other GUI actions.
async function runSync(workspaceDir, onOutput) {
    onOutput("Re-pointing this folder's hooks at the palsync bundled with this app…\n");
    const result = await resyncHooks(workspaceDir);
    if (!result.ok) {
        onOutput("Failed: " + result.reason + "\n");
        return { ok: false, error: result.reason };
    }
    onOutput(result.changed ? "Done — hooks updated.\n" : "Already up to date — nothing to change.\n");
    return { ok: true };
}

module.exports = { checkPalFolderVersion, runSync, resyncHooks, BUNDLED_VERSION };
