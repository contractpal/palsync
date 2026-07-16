#!/usr/bin/env node
"use strict";
// palsync — the terminal launcher. Logs in, selects a pal, pulls + locks + injects context +
// registers the MCP server, then opens Claude Code in the workspace. No vscode, no env vars
// (credentials live in the OS keychain).
const preflight = require("../src/preflight");
const { loadClack } = require("../src/platform/uiPrompts");
const { run } = require("../src/launcher/index");
const agents = require("../src/launcher/agents");
const pkg = require("../package.json");

// --version / -v: print the build and exit (works regardless of Node/Claude prereqs, so QA and
// the team can report exactly which build they're on). Handled before anything else.
const argv = process.argv.slice(2);
if (argv.includes("--version") || argv.includes("-v")) {
    const { installedSha } = require("../src/cli/upgradeCommand");
    const sha = installedSha();
    process.stdout.write("palsync " + pkg.version + (sha ? " (" + sha.slice(0, 7) + ")" : "") + "\n");
    process.exit(0);
}

// Subcommands: `palsync push|pull|status` — headless sync that needs NO MCP server and NO agent
// (the recovery path when a session ends before a push, and a plain terminal workflow). They
// skip the launcher preflight entirely: no Claude/Codex required, just .palsync.json + keychain.
const SUBCOMMANDS = ["push", "pull", "merge", "status", "test", "preview", "open", "fetch", "screenshot", "validate", "sync-datasets", "seo-audit", "exercise", "cost", "context", "review", "regression", "spec-lint", "task", "checkpoint"];
// Normalize underscores so `palsync sync_datasets` runs sync-datasets instead of falling through.
// In the test-07 run that fall-through opened the interactive launcher inside an agent's shell,
// which hung on a prompt — and the agent's `pkill -f palsync` to unstick it killed the session's
// own MCP server.
const subcmd = argv[0] && !argv[0].startsWith("-") ? argv[0].replace(/_/g, "-") : undefined;
if (SUBCOMMANDS.includes(subcmd)) {
    require("../src/cli/syncCommands").run(subcmd, argv.slice(1))
        .then(code => process.exit(code))
        .catch(err => {
            process.stderr.write("palsync " + argv[0] + " failed: " + (err && err.message ? err.message : err) + "\n");
            process.exit(1);
        });
    return; // launcher flow below never runs for subcommands
}

// `palsync setup` — NON-INTERACTIVE workspace creation (headless / autonomous boxes). Has its
// own module + flags (incl. --agent), so it's dispatched before the interactive launcher's
// flag parsing. No preflight (no agent binary required just to prepare a workspace).
if (argv[0] === "setup") {
    require("../src/cli/setupCommand").run(argv.slice(1))
        .then(code => process.exit(code))
        .catch(err => {
            process.stderr.write("palsync setup failed: " + (err && err.message ? err.message : err) + "\n");
            process.exit(1);
        });
    return;
}
// `palsync upgrade` — self-update to the latest commit on the default branch. No workspace/agent needed.
if (argv[0] === "upgrade") {
    require("../src/cli/upgradeCommand").run(argv.slice(1))
        .then(code => process.exit(code))
        .catch(err => {
            process.stderr.write("palsync upgrade failed: " + (err && err.message ? err.message : err) + "\n");
            process.exit(1);
        });
    return;
}
if (argv[0] === "help" || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
        "palsync — PalBuilder + AI agents\n\n" +
        "  palsync                 launch: login → pick pal → pull+lock → inject skills → open agent\n" +
        "  palsync setup --pal \"<name>\"   headless workspace creation (no prompts; for autonomous/agent boxes)\n" +
        "  palsync push|pull|status|test|preview|open|validate|sync-datasets   headless ops for a workspace (no MCP/agent needed)\n" +
        "  palsync upgrade [--check]   self-update to the latest commit on the default branch\n" +
        "  palsync --agent codex|pi|opencode   use Codex, Pi, or OpenCode instead of Claude Code (default: claude)\n" +
        "  palsync --eval [spec]   benchmark-harness mode: pick a spec, force create-pal, inject SPEC.md\n" +
        "  palsync --version       print the build\n\n" +
        require("../src/cli/syncCommands").USAGE + "\n"
    );
    process.exit(0);
}

// Any other positional word is an unknown subcommand — refuse it. The launcher takes flags only,
// so falling through here used to open the interactive UI on a typo (`palsync sync_datasets`),
// which hangs a non-interactive caller on a prompt.
if (subcmd && subcmd !== "setup" && subcmd !== "upgrade") {
    process.stderr.write("palsync: unknown subcommand '" + argv[0] + "'. Valid: " +
        SUBCOMMANDS.join(", ") + ", setup, upgrade, help.\n");
    process.exit(1);
}

// The interactive launcher needs a real terminal — refuse cleanly when run from a pipe or an
// agent's shell tool instead of hanging forever on an invisible prompt.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("palsync: the interactive launcher needs a terminal (stdin/stdout is not a TTY).\n" +
        "Headless use: `palsync setup --pal \"<name>\"` to create a workspace, or the subcommands (" +
        SUBCOMMANDS.slice(0, 6).join(", ") + ", ...). If you are an agent inside a palsync session, use the pal_* MCP tools instead.\n");
    process.exit(1);
}

// --agent <claude|codex|pi>: choose the coding agent. Default Claude Code (and, when the flag is
// absent, the interactive picker still runs — agentFlag stays undefined). Threaded through
// preflight (which agent's binary to check) and run() → setup() (injection + MCP destinations).
// Validated against the agents registry (single source of truth) so new agents need no change here.
function parseAgentFlag(args) {
    let val;
    const i = args.indexOf("--agent");
    if (i !== -1) val = args[i + 1];
    else { const eq = args.find(a => a.startsWith("--agent=")); if (eq) val = eq.slice("--agent=".length); }
    if (val === undefined) return undefined; // no flag → default flow (interactive picker)
    val = String(val).toLowerCase();
    const agent = agents.resolve(val);
    if (!agent) {
        const keys = agents.AGENTS.map(a => a.key).join(", ");
        process.stderr.write("Unknown --agent '" + val + "'. Use one of: " + keys + " (default: claude).\n");
        process.exit(1);
    }
    return agent.key;
}
const agentFlag = parseAgentFlag(argv);

// --eval [name]: benchmark-harness mode. Adds a "pick a spec" step before login, forces
// create-mode, prefills the new-pal name from the spec, and injects SPEC.md/EXECUTION.md/
// DESIGN_SYSTEM.md/COMPONENTS.md into the workspace after setup. Boolean form (`--eval`)
// shows the interactive spec picker; `--eval <key>` / `--eval=<key>` resolves it directly.
function parseEvalFlag(args) {
    if (!args.includes("--eval") && !args.some(a => a.startsWith("--eval="))) return undefined;
    let val;
    const i = args.indexOf("--eval");
    if (i !== -1) val = args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
    else { const eq = args.find(a => a.startsWith("--eval=")); if (eq) val = eq.slice("--eval=".length); }
    return val; // true (interactive picker) | string key
}
const evalFlag = parseEvalFlag(argv);

(async () => {
    await preflight.run({ agent: agentFlag || "claude" }); // Node >= 18 + the chosen agent's CLI
    const clack = await loadClack(); // @clack/prompts is ESM-only; dynamic import works on Node 18+
    clack.intro("palsync — PalBuilder + Claude Code");
    const result = await run({ agent: agentFlag, evalSpec: evalFlag, log: (m) => clack.log.step(m) });
    if (!result) { clack.cancel("Cancelled."); process.exit(1); }
    clack.log.info(
        "Creatable here: pages, fragments, scripts, workflows, emails, images, styles, attachments.\n" +
        "Documents, fonts, and dataviews/data/datalists are PalBuilder-only (palsync edits them; datasets via sync-datasets). See README."
    );
    clack.outro("Workspace ready at " + result.workspaceDir + " — handing off to " + result.agent.label + ".");
    // If we launched the agent, keep the process alive until it exits so the terminal is handed over.
    if (result.child) {
        result.child.on("exit", (code) => process.exit(code || 0));
    } else {
        process.exit(0);
    }
})().catch(err => {
    process.stderr.write("palsync failed: " + (err && err.stack ? err.stack : err) + "\n");
    process.exit(1);
});
