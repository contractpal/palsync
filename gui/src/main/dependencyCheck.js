"use strict";
// Backs the "Check Dependencies" screen (Help menu + shown once on first launch). Two real
// checks exist today: an agent CLI on PATH (informational only — palsync never bundles or
// auto-installs any vendor, so this is a link, not a button) and Chromium for the browser-audit
// feature (a real "Install" button, since palsync's own installer can do that standalone).
const fs = require("fs");
const { spawn } = require("child_process");
const { playwrightCliPath, resolvePlaywright } = require("palsync/src/install/playwrightChromium");
const { commandOnPath } = require("palsync/src/platform/commandOnPath");

// Matches agentLaunch.js's detectAgents() (REGISTRARS plus Pi's own global-extension special
// case) — the agents Chip can actually register MCP for today. Claude Code is the recommended
// default; list stays in sync with what Chip really supports.
// Claude Code, OpenCode, Pi, and Codex are the agents David has confirmed/asked to treat as
// real today (2026-09-14) — Gemini CLI, Cursor, GitHub Copilot CLI, and Kiro CLI were removed
// from the checklist at his request until their support actually ships.
const SUPPORTED_AGENTS = [
    { id: "claude-code", command: "claude", label: "Claude Code", docsUrl: "https://docs.claude.com/en/docs/claude-code", recommended: true },
    { id: "opencode", command: "opencode", label: "OpenCode", docsUrl: "https://opencode.ai/docs/" },
    { id: "pi", command: "pi", label: "Pi", docsUrl: "https://pi.dev/" },
    { id: "codex", command: "codex", label: "Codex", docsUrl: "https://developers.openai.com/codex/cli/" }
];

function checkAgents() {
    return SUPPORTED_AGENTS.map(a => Object.assign({}, a, { found: commandOnPath(a.command) }));
}

function isChromiumInstalled() {
    try {
        // Must resolve the exact same playwright package instance playwrightCliPath() (used to
        // actually run the install) resolves - see resolvePlaywright()'s own comment for the bug
        // this fixes: a bare require("playwright") here resolved to a copy that was never bundled
        // into the packaged app at all, so this always reported "not installed" on every real
        // install, even right after a genuinely successful one.
        const { chromium } = resolvePlaywright();
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

// Bound how much of the child's own output gets kept for a failure message — enough to show the
// actual reason (a download/network error, a permissions error, an antivirus-interference
// symptom, etc.) without accumulating an unbounded buffer for a run that prints a lot.
const OUTPUT_TAIL_CAP = 4000;

// Async (not palsync's own spawnSync-based run()) — spawnSync would freeze Electron's whole
// main process, and every renderer, for the entire ~150MB download.
function installChromium(onOutput) {
    return new Promise(resolve => {
        let cli;
        try { cli = playwrightCliPath(); }
        catch (e) { resolve({ ok: false, error: e.message }); return; }

        // Previously a non-zero exit resolved as { ok: false } with no error text at all - every
        // line the installer actually printed (the real reason it failed: a network error, a
        // permissions error, antivirus/EDR interfering with the download's extraction, etc.) only
        // ever reached the live onOutput callback, discarded once the promise resolved. Confirmed
        // live 2026-09-15: exactly this made a real install failure indistinguishable from a
        // silent hang - the UI had no way to show a reason because none was ever captured.
        let tail = "";
        const capture = (d) => {
            const s = d.toString();
            onOutput(s);
            tail = (tail + s).slice(-OUTPUT_TAIL_CAP);
        };

        const child = spawn(process.execPath, [cli, "install", "chromium"], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
        });
        child.stdout.on("data", capture);
        child.stderr.on("data", capture);
        child.on("exit", code => resolve({ ok: code === 0, error: code === 0 ? undefined : (tail.trim() || "exit code " + code) }));
        child.on("error", err => resolve({ ok: false, error: err.message + (tail.trim() ? "\n" + tail.trim() : "") }));
    });
}

module.exports = { checkAll, installChromium };
