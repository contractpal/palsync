"use strict";
// Agent registry + launch. The picker lists the agents actually INSTALLED on this machine
// (command found on PATH); whichever one you pick is launched in the workspace with the right
// context injected. Launch spawns the agent CLI inheriting the terminal (portable handoff); on
// Windows we go through the shell so `claude.cmd` resolves.
const { spawn, spawnSync } = require("child_process");

// `mcp` = how palsync registers its sync server for this agent: "claude" (.mcp.json),
// "codex" (`codex mcp add`), "opencode" (opencode.json), or false (no MCP — the agent drives
// palsync via its shell CLI). `key` is the --agent flag value.
const AGENTS = [
    { id: "claude-code", key: "claude", label: "Claude Code", command: "claude", args: [], mcp: "claude" },
    { id: "codex", key: "codex", label: "Codex", command: "codex", args: [], mcp: "codex" },
    { id: "pi", key: "pi", label: "Pi", command: "pi", args: [], mcp: false },
    { id: "opencode", key: "opencode", label: "OpenCode", command: "opencode", args: [], mcp: "opencode" }
    // future: { id: "cline", ... }, { id: "cursor", ... }
];

// Is a command resolvable on PATH? (`which` on POSIX, `where` on Windows.)
function commandOnPath(cmd) {
    const probe = process.platform === "win32" ? "where" : "which";
    try {
        const r = spawnSync(probe, [cmd], { stdio: "ignore" });
        return r.status === 0;
    } catch (e) { return false; }
}

// Agents installed on this machine. If none are detected (unexpected — palsync was launched
// somehow), fall back to the full registry so the picker is never empty; launch() then surfaces
// a clear "not on PATH" message.
function available() {
    const installed = AGENTS.filter(a => commandOnPath(a.command));
    return installed.length ? installed : AGENTS.slice();
}

// Resolve an explicit --agent value ("claude" | "codex" | an id) to a descriptor, or null.
// Works regardless of `available` so opt-in agents are reachable by flag before they're menu-listed.
function resolve(key) {
    if (!key) return null;
    const k = String(key).toLowerCase();
    return AGENTS.find(a => a.key === k || a.id === k) || null;
}

// Default interactive pick (single live option in v1). Returns an agent descriptor.
async function pick(prompt) {
    const opts = available();
    if (prompt) return prompt(opts);
    const { loadClack } = require("../platform/uiPrompts");
    const clack = await loadClack();
    const choice = await clack.select({
        message: "Open with which agent?",
        options: opts.map(a => ({ value: a.id, label: a.label }))
    });
    if (clack.isCancel(choice)) return null;
    return opts.find(a => a.id === choice);
}

// Spawn the agent in the workspace, handing over the terminal. Returns the child process.
function launch(agent, { cwd, stdio = "inherit" } = {}) {
    const useShell = process.platform === "win32"; // resolve .cmd shims on Windows
    const child = spawn(agent.command, agent.args, { cwd, stdio, shell: useShell });
    child.on("error", (err) => {
        if (err && err.code === "ENOENT") {
            process.stderr.write(
                "\nCould not launch '" + agent.command + "'. Make sure " + agent.label + " is installed and on PATH.\n" +
                "Your workspace is ready — open it manually:  cd " + cwd + " && " + agent.command + "\n"
            );
        } else {
            process.stderr.write("\nFailed to launch agent: " + (err && err.message ? err.message : err) + "\n");
        }
    });
    return child;
}

module.exports = { AGENTS, available, pick, launch, resolve };
