"use strict";
// One real pty per active pal tab (node-pty, not piped stdio) — the agent CLI needs a genuine
// terminal so it renders ANSI color (diffs, test output) the same way it does in a real shell,
// and so a developer dropping into the tab has full, unrestricted shell control.
const pty = require("node-pty");

// palId -> node-pty process
const sessions = new Map();

function isRunning(palId) {
    return sessions.has(palId);
}

function anyRunning() {
    return sessions.size > 0;
}

// Throws on a spawn failure (e.g. `command` not actually resolvable on PATH at exec time, even
// if it was found moments earlier by the picker's own PATH check) — callers must catch this and
// surface it, rather than leaving a silently-blank terminal with no explanation.
function start(palId, { command, args = [], cwd, cols = 80, rows = 24, env }, onData, onExit) {
    if (sessions.has(palId)) return sessions.get(palId);
    // Windows agent CLIs are typically .cmd shims (claude.cmd) — route through cmd.exe /c so
    // ConPTY resolves them the same way a real terminal would.
    const spawnCommand = process.platform === "win32" ? "cmd.exe" : command;
    const spawnArgs = process.platform === "win32" ? ["/c", command].concat(args) : args;
    const child = pty.spawn(spawnCommand, spawnArgs, {
        name: "xterm-256color",
        cols, rows, cwd,
        env: env ? Object.assign({}, process.env, env) : process.env,
        useConpty: process.platform === "win32"
    });
    sessions.set(palId, child);
    child.onData(data => onData(data));
    child.onExit(({ exitCode }) => {
        sessions.delete(palId);
        onExit(exitCode);
    });
    return child;
}

function write(palId, data) {
    const child = sessions.get(palId);
    if (child) child.write(data);
}

function resize(palId, cols, rows) {
    const child = sessions.get(palId);
    if (child) child.resize(cols, rows);
}

function kill(palId) {
    const child = sessions.get(palId);
    if (child) { child.kill(); sessions.delete(palId); }
}

function killAll() {
    for (const palId of Array.from(sessions.keys())) kill(palId);
}

module.exports = { isRunning, anyRunning, start, write, resize, kill, killAll };
