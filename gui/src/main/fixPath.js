"use strict";
// A Mac app launched via Finder/Dock/LaunchServices (double-click, `open`) does NOT run through
// a login shell, so it never picks up PATH additions from .zshrc/.zprofile/.bash_profile -
// Homebrew's /opt/homebrew/bin, nvm, etc. It gets whatever minimal PATH launchd itself has
// (typically just /usr/bin:/bin:/usr/sbin:/sbin). That breaks BOTH agent detection
// (commandOnPath's `which claude` can't find it) and the actual console spawn (node-pty's
// pty.spawn("claude", ...) can't resolve it either - it spawns, exits async with code 1, and
// writes nothing, since there's no shell in the loop to report "command not found"). Confirmed
// live: `npm run dev` (launched from a terminal, already has the full interactive-shell PATH)
// never hits this - only a real double-clicked/`open`-launched .app does.
//
// Fix: ask the user's own login shell for its real PATH once at startup, before anything else
// (agent detection, console spawning) reads process.env.PATH. Must run before any other module
// is required, since some do their own PATH-dependent work as a side effect of being loaded.
const { execFileSync } = require("child_process");

function fixPathSync() {
    if (process.platform === "win32") return; // Windows resolves PATH normally regardless of launch method
    const shell = process.env.SHELL || "/bin/zsh";
    const marker = "___PALSYNC_PATH___";
    try {
        // -i (interactive) so shell startup files that gate on it (many nvm/homebrew setups) still
        // run; -l (login) for .zprofile/.bash_profile. 5s timeout in case a shell rc hangs/prompts.
        const output = execFileSync(shell, ["-ilc", "echo " + marker + "\"$PATH\""], {
            timeout: 5000,
            encoding: "utf8",
        });
        const idx = output.lastIndexOf(marker);
        if (idx === -1) return;
        const shellPath = output.slice(idx + marker.length).split("\n")[0].trim();
        if (shellPath) process.env.PATH = shellPath;
    } catch (e) {
        // Best-effort: an unusual shell, a hanging rc script, etc. leaves LaunchServices' minimal
        // PATH in place - agent detection will just find fewer (or no) installed agents, same as
        // today, rather than blocking app startup on it.
    }
}

module.exports = { fixPathSync };
