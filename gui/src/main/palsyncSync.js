"use strict";
// Detects whether a pal folder's own resolvable `palsync` (the one its Claude Code hooks would
// actually invoke — global install or a locally-pinned dependency) is behind the version bundled
// with this running Chip Pal Builder, and (on user confirmation) runs the upgrade. Extends
// palFolder.js's validation with a version check, same spirit as versionCheck.js's own
// "new GUI version available" check but scoped per-pal-folder instead of per-app.
const fs = require("fs/promises");
const path = require("path");
const { exec, spawn } = require("child_process");
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
// claudeHooks.js's OWNED_HOOKS) — its own generated form is
// `"<node>" "<script>" hook completion --mode claude` (or the legacy bare `palsync hook
// completion --mode claude`). Swap the trailing hook-invocation args for `--version`, which
// bin/palsync.js answers immediately regardless of Node/Claude prereqs (see its own --version
// handling) — so this reuses the exact command Claude Code would run for this folder, just
// asking it a different question.
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

// { outdated, current, latest, command } | null (couldn't determine — never blocks anything).
async function checkPalFolderVersion(workspaceDir) {
    const settings = await readSettings(workspaceDir);
    if (!settings) return null;
    const owned = claudeHooks.findOwnedIn(settings).find(o => o.event === "Stop" && o.adapter === "completion");
    if (!owned) return null;
    const command = versionCommandFor(owned.command);
    if (!command) return null;

    const current = await execVersion(command, workspaceDir);
    if (!current) return null;
    if (compareVersions(BUNDLED_VERSION, current) <= 0) return { outdated: false, current, latest: BUNDLED_VERSION };
    const check = { outdated: true, current, latest: BUNDLED_VERSION, command };
    check.upgrade = upgradeCommand(check, workspaceDir);
    return check;
}

// Whether the resolved palsync command points inside this folder's own node_modules (a locally
// pinned project dependency) rather than a global install — decides which upgrade command to run.
function isLocalDependency(command, workspaceDir) {
    return command.toLowerCase().includes(path.join(workspaceDir, "node_modules").toLowerCase());
}

function upgradeCommand(check, workspaceDir) {
    if (isLocalDependency(check.command, workspaceDir)) {
        return { command: "npm install palsync@latest", cwd: workspaceDir, description: "npm install palsync@latest (updates this project's own pinned dependency)" };
    }
    return { command: "npm install -g palsync@latest", cwd: workspaceDir, description: "npm install -g palsync@latest (global install)" };
}

// Runs the upgrade, streaming combined stdout/stderr to onOutput. Never throws — resolves
// { ok, code } either way, same shape as dependencyCheck.js's installChromium.
function runSync(workspaceDir, check, onOutput) {
    const { command, cwd } = upgradeCommand(check, workspaceDir);
    return new Promise(resolve => {
        const child = spawn(command, { cwd, shell: true, windowsHide: true });
        child.stdout.on("data", d => onOutput(d.toString()));
        child.stderr.on("data", d => onOutput(d.toString()));
        child.on("exit", code => resolve({ ok: code === 0, code }));
        child.on("error", err => resolve({ ok: false, error: err.message }));
    });
}

module.exports = { checkPalFolderVersion, runSync, upgradeCommand, BUNDLED_VERSION };
