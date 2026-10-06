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

// Only Claude Code gets a health probe: its npm wrapper can be on PATH yet unusable (native
// binary never downloaded because of --ignore-scripts / --omit=optional), which exits non-zero
// on `--version` with an explanatory message. "On PATH" alone reported that as fine.
const HEALTH_PROBE_IDS = new Set(["claude-code"]);
const HEALTH_PROBE_TIMEOUT_MS = 8000;

function probeVersion(command) {
    return new Promise(resolve => {
        let out = "";
        let done = false;
        const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
        let child;
        try {
            // shell on Windows so npm's claude.cmd shim resolves.
            child = process.platform === "win32"
                ? spawn(command + " --version", { shell: true, windowsHide: true })
                : spawn(command, ["--version"]);
        } catch (e) { finish({ ok: false, error: e.message }); return; }
        const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* already gone */ } finish({ ok: false, error: "Timed out running `" + command + " --version`." }); }, HEALTH_PROBE_TIMEOUT_MS);
        const capture = d => { out = (out + d.toString()).slice(-OUTPUT_TAIL_CAP); };
        child.stdout.on("data", capture);
        child.stderr.on("data", capture);
        child.on("error", err => finish({ ok: false, error: err.message }));
        child.on("exit", code => finish(code === 0 ? { ok: true } : { ok: false, error: out.trim() || "exit code " + code }));
    });
}

async function checkAgents() {
    return Promise.all(SUPPORTED_AGENTS.map(async a => {
        const onPath = commandOnPath(a.command);
        const result = Object.assign({}, a, { found: onPath });
        if (onPath && HEALTH_PROBE_IDS.has(a.id)) {
            const probe = await probeVersion(a.command);
            if (!probe.ok) { result.found = false; result.broken = true; result.brokenReason = probe.error; }
        }
        return result;
    }));
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

async function checkAll() {
    const agents = await checkAgents();
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
