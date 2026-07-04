"use strict";
// Startup preflight for the palsync launcher. Two onboarding checks, intentionally asymmetric:
//   * Claude Code is an npm package palsync can safely install into the user's GLOBAL packages,
//     so on consent we auto-install it (npm install -g @anthropic-ai/claude-code).
//   * Node is the system runtime palsync itself runs on. Auto-upgrading it needs elevated perms,
//     can break the user's other projects, and could swap the runtime out mid-run — so we only
//     GUIDE (detect how Node was installed, show the exact command), never auto-run it.
// Cross-platform: which/where for PATH, shell:true for npm on Windows, no OS-specific assumptions.
const { spawnSync } = require("child_process");
const readline = require("readline");
const { commandOnPath } = require("./platform/commandOnPath");

const MIN_NODE_MAJOR = 18;
const REC_NODE = "20"; // recommended LTS major to upgrade to

function nodeMajor() {
    return parseInt(process.versions.node.split(".")[0], 10);
}

// ---- Node (guide only) ---------------------------------------------------------------------

// Best-effort detection of how Node was installed, from env + the running binary's path.
function detectNodeInstallMethod(opts = {}) {
    const env = opts.env || process.env;
    const p = (opts.execPath || process.execPath).replace(/\\/g, "/").toLowerCase();
    if (env.VOLTA_HOME || p.includes("/.volta/")) return "volta";
    if (env.FNM_DIR || p.includes("/.fnm/") || p.includes("fnm_multishells")) return "fnm";
    if (env.NVM_DIR || p.includes("/.nvm/")) return "nvm";
    if (p.includes("/homebrew/") || p.includes("/cellar/") || p.includes("/.linuxbrew/")) return "homebrew";
    return "system";
}

function nodeUpgradeCommand(method) {
    switch (method) {
        case "nvm": return "nvm install " + REC_NODE + " && nvm alias default " + REC_NODE;
        case "fnm": return "fnm install " + REC_NODE + " && fnm default " + REC_NODE;
        case "volta": return "volta install node@" + REC_NODE;
        case "homebrew": return "brew install node@" + REC_NODE + " && brew link --overwrite node@" + REC_NODE;
        default: return null; // system / unknown -> nodejs.org only
    }
}

function nodeMessage(method) {
    const cmd = nodeUpgradeCommand(method);
    const lines = [
        "✖ palsync needs Node.js " + MIN_NODE_MAJOR + " or newer (you have " + process.version + ").",
        "  Detected Node install: " + method
    ];
    if (cmd) lines.push("  Upgrade with:  " + cmd);
    lines.push("  Or download the latest LTS from https://nodejs.org/");
    lines.push("  palsync will NOT change your Node version automatically — it can break other projects");
    lines.push("  and needs your permission. Run the command above yourself, then re-run palsync.");
    return lines.join("\n");
}

// ---- Claude Code (auto-install on consent) -------------------------------------------------

function askYesNo(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (ans) => { rl.close(); resolve(/^y(es)?$/i.test(String(ans).trim())); });
    });
}

function installClaudeCode() {
    process.stdout.write("\nInstalling Claude Code:  npm install -g @anthropic-ai/claude-code\n\n");
    const useShell = process.platform === "win32"; // resolve npm.cmd on Windows
    const r = spawnSync("npm", ["install", "-g", "@anthropic-ai/claude-code"], { stdio: "inherit", shell: useShell });
    return { ok: r.status === 0, status: r.status, error: r.error };
}

function manualClaudeInstructions() {
    return [
        "Install Claude Code, then re-run palsync:",
        "  npm install -g @anthropic-ai/claude-code",
        "  Docs: https://docs.claude.com/en/docs/claude-code"
    ].join("\n");
}

function pathFixGuidance() {
    const binHint = process.platform === "win32"
        ? "Add your npm global folder (run `npm prefix -g`) to PATH via System Environment Variables."
        : "Add it to PATH in your shell profile (~/.zshrc or ~/.bashrc):\n    export PATH=\"$(npm prefix -g)/bin:$PATH\"";
    return [
        "Claude Code was installed, but the `claude` command isn't on your PATH.",
        "Find your npm global bin:  npm prefix -g",
        binHint,
        "Then open a new terminal and re-run palsync."
    ].join("\n");
}

// ---- Codex / Pi / OpenCode (detect + instruct; non-fatal) ----------------------------------
// Asymmetric with Claude on purpose: we auto-install Claude Code because we've verified that npm
// package. We do NOT auto-run an install for any other agent — instead we warn + instruct, and let
// the workspace still get prepared (the MCP registration and launch steps degrade gracefully if the
// agent's binary is absent).

function manualCodexInstructions() {
    return [
        "Install the Codex CLI, then re-run palsync (or register the MCP server + launch Codex manually):",
        "  npm install -g @openai/codex",
        "  Docs: https://developers.openai.com/codex"
    ].join("\n");
}

function manualOpencodeInstructions() {
    return [
        "Install OpenCode, then re-run palsync (or register the MCP server + launch OpenCode manually):",
        "  npm install -g opencode-ai   (or: brew install anomalyco/tap/opencode)",
        "  Docs: https://opencode.ai/docs/"
    ].join("\n");
}

function manualPiInstructions() {
    return "Install Pi, then re-run palsync (or launch `pi` manually in the prepared workspace).";
}

// Non-fatal PATH check shared by every non-Claude agent: warn + print install guidance if the
// agent's binary is missing, but never block workspace prep. Returns { ok, reason }.
function ensureAgentOnPath(binName, label, instructions, { onPath = commandOnPath } = {}) {
    if (onPath(binName)) return { ok: true, reason: "present" };
    process.stderr.write(
        "\n⚠ " + label + " CLI ('" + binName + "') was not found on PATH. palsync will still pull, lock, and\n" +
        "inject the workspace, but it can't auto-register the MCP server or launch " + label + " for you.\n" +
        instructions + "\n"
    );
    return { ok: false, reason: "not-found" };
}

function ensureCodex(opts) { return ensureAgentOnPath("codex", "Codex", manualCodexInstructions(), opts); }
function ensureOpencode(opts) { return ensureAgentOnPath("opencode", "OpenCode", manualOpencodeInstructions(), opts); }
function ensurePi(opts) { return ensureAgentOnPath("pi", "Pi", manualPiInstructions(), opts); }

// Ensure `claude` is available; auto-install on consent. Injectable bits make it testable.
// Returns { ok, reason }.
async function ensureClaudeCode({ prompt = askYesNo, installer = installClaudeCode, onPath = commandOnPath } = {}) {
    if (onPath("claude")) return { ok: true, reason: "present" };

    const yes = await prompt("Claude Code is required but not installed. Install it now? (y/n) ");
    if (!yes) {
        process.stderr.write("\n" + manualClaudeInstructions() + "\n");
        return { ok: false, reason: "declined" };
    }

    const res = installer();
    if (!res.ok) {
        process.stderr.write("\nThe install didn't complete (e.g. permissions). " + manualClaudeInstructions() + "\n");
        return { ok: false, reason: "install-failed" };
    }
    if (onPath("claude")) return { ok: true, reason: "installed" };

    process.stderr.write("\n" + pathFixGuidance() + "\n");
    return { ok: false, reason: "not-on-path" };
}

// ---- Entry ---------------------------------------------------------------------------------

async function run({ agent = "claude" } = {}) {
    // 1) Node: guide only, never auto-run. (Node entirely missing is handled by the shell/npm
    //    before palsync can start — the README states the Node 18+ prerequisite.)
    if (nodeMajor() < MIN_NODE_MAJOR) {
        process.stderr.write("\n" + nodeMessage(detectNodeInstallMethod()) + "\n\n");
        process.exit(1);
    }
    // 2) Agent check.
    //    - codex/pi/opencode: non-fatal — warn + instruct, then continue (workspace prep + manual
    //      fallback work). None of these need Claude Code installed.
    //    - claude (default): auto-install on consent; fatal if it can't be made available.
    if (agent === "codex") { ensureCodex(); return; }
    if (agent === "pi") { ensurePi(); return; }
    if (agent === "opencode") { ensureOpencode(); return; }
    const claude = await ensureClaudeCode();
    if (!claude.ok) process.exit(1);
}

module.exports = {
    run, ensureClaudeCode, ensureCodex, ensureOpencode, ensurePi, manualCodexInstructions,
    manualOpencodeInstructions, manualPiInstructions, detectNodeInstallMethod,
    nodeUpgradeCommand, nodeMessage, manualClaudeInstructions, pathFixGuidance, commandOnPath, MIN_NODE_MAJOR
};
