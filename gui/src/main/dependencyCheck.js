"use strict";
// Backs the "Check Dependencies" screen (Help menu + shown once on first launch). Two real
// checks exist today: an agent CLI on PATH (informational only — palsync never bundles or
// auto-installs any vendor, so this is a link, not a button) and Chromium for the browser-audit
// feature (a real "Install" button, since palsync's own installer can do that standalone).
const fs = require("fs");
const { spawn } = require("child_process");
const { playwrightCliPath } = require("palsync/src/install/playwrightChromium");
const { commandOnPath } = require("palsync/src/platform/commandOnPath");

// Matches agentLaunch.js's REGISTRARS — the agents Chip can actually register MCP for today.
// Claude Code is the recommended default; list stays in sync with what Chip really supports.
const SUPPORTED_AGENTS = [
    { id: "claude-code", command: "claude", label: "Claude Code", docsUrl: "https://docs.claude.com/en/docs/claude-code", recommended: true },
    { id: "opencode", command: "opencode", label: "OpenCode", docsUrl: "https://opencode.ai/docs/" }
];

function checkAgents() {
    return SUPPORTED_AGENTS.map(a => Object.assign({}, a, { found: commandOnPath(a.command) }));
}

function isChromiumInstalled() {
    try {
        const { chromium } = require("playwright");
        return fs.existsSync(chromium.executablePath());
    } catch (e) {
        return false;
    }
}

function checkAll() {
    const agents = checkAgents();
    return {
        agentDetected: agents.some(a => a.found),
        agents,
        chromiumInstalled: isChromiumInstalled()
    };
}

// Async (not palsync's own spawnSync-based run()) — spawnSync would freeze Electron's whole
// main process, and every renderer, for the entire ~150MB download.
function installChromium(onOutput) {
    return new Promise(resolve => {
        let cli;
        try { cli = playwrightCliPath(); }
        catch (e) { resolve({ ok: false, error: e.message }); return; }

        const child = spawn(process.execPath, [cli, "install", "chromium"]);
        child.stdout.on("data", d => onOutput(d.toString()));
        child.stderr.on("data", d => onOutput(d.toString()));
        child.on("exit", code => resolve({ ok: code === 0 }));
        child.on("error", err => resolve({ ok: false, error: err.message }));
    });
}

module.exports = { checkAll, installChromium };
