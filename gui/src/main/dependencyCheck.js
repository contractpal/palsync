"use strict";
// Backs the "Check Dependencies" screen (Help menu + shown once on first launch). Two real
// checks exist today: an agent CLI on PATH (informational only — palsync never bundles or
// auto-installs any vendor, so this is a link, not a button) and Chromium for the browser-audit
// feature (a real "Install" button, since palsync's own installer can do that standalone).
const fs = require("fs");
const { spawn } = require("child_process");
const { playwrightCliPath } = require("palsync/src/install/playwrightChromium");
const { commandOnPath } = require("palsync/src/platform/commandOnPath");

// Matches agentLaunch.js's detectAgents() (REGISTRARS plus Pi's own global-extension special
// case) — the agents Chip can actually register MCP for today. Claude Code is the recommended
// default; list stays in sync with what Chip really supports.
// `comingSoon: true` marks an agent David hasn't confirmed working end-to-end yet (2026-09-11):
// Gemini/Cursor/Copilot have registration code wired (registerGemini.js/registerCursor.js/
// registerCopilot.js + agentLaunch.js's REGISTRARS) but haven't been live-tested against a real
// install; Kiro CLI has no code at all yet (see gui/BACKLOG.md's Kiro research) — listed here
// purely so it shows up on the checklist ahead of that work. Claude Code, OpenCode, and Pi are
// the three David has confirmed/asked to treat as real today.
const SUPPORTED_AGENTS = [
    { id: "claude-code", command: "claude", label: "Claude Code", docsUrl: "https://docs.claude.com/en/docs/claude-code", recommended: true },
    { id: "opencode", command: "opencode", label: "OpenCode", docsUrl: "https://opencode.ai/docs/" },
    { id: "pi", command: "pi", label: "Pi", docsUrl: "https://pi.dev/" },
    { id: "gemini", command: "gemini", label: "Gemini CLI", docsUrl: "https://google-gemini.github.io/gemini-cli/", comingSoon: true },
    { id: "cursor", command: "cursor-agent", label: "Cursor", docsUrl: "https://cursor.com/docs/cli", comingSoon: true },
    { id: "copilot", command: "copilot", label: "GitHub Copilot CLI", docsUrl: "https://docs.github.com/en/copilot/how-tos/copilot-cli", comingSoon: true },
    { id: "kiro", command: "kiro-cli", label: "Kiro CLI", docsUrl: "https://kiro.dev/docs/cli/", comingSoon: true }
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

        const child = spawn(process.execPath, [cli, "install", "chromium"], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
        });
        child.stdout.on("data", d => onOutput(d.toString()));
        child.stderr.on("data", d => onOutput(d.toString()));
        child.on("exit", code => resolve({ ok: code === 0 }));
        child.on("error", err => resolve({ ok: false, error: err.message }));
    });
}

module.exports = { checkAll, installChromium };
