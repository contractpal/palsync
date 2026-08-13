"use strict";
// `palsync hooks check|repair` — OFFLINE recovery surface for stale Claude Code hook settings
// (no .palsync.json, no login, no lock).
//
// Live bug: Stop/PreToolUse/PostToolUse hooks fail with `palsync: unknown subcommand 'hook'`
// when the settings carry a legacy form — the bare `palsync hook <adapter> --mode claude`
// (resolves whatever `palsync` is first on PATH, possibly a stale binary that predates the hook
// subcommand) or the prior node+script form. The launcher already migrates both at every launch
// (configure(install:true)); these commands are the same migration WITHOUT relaunching:
//
//   check   — report the state of the three owned hooks in <ws>/.claude/settings.json, plus any
//             owned entries found in the two settings files PalSync never writes
//   repair  — migrate legacy forms / install missing hooks in <ws>/.claude/settings.json
//             (preserving user hooks), then report what remains unmigratable
//
// PalSync writes ONLY <ws>/.claude/settings.json. Claude Code merges hooks from
// ~/.claude/settings.json (user) and <ws>/.claude/settings.local.json (project-local) as well,
// so a legacy entry there keeps executing — and failing — after the workspace file is repaired.
// PalSync never writes those two files, so it can only DETECT and report such entries, never
// migrate them; the report ends with the manual remediation.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const hooks = require("../launcher/claudeHooks");
const pkg = require("../../package.json");
const { installedSha } = require("./upgradeCommand");

const USAGE = "Usage: palsync hooks check|repair [--dir <workspace>]\n" +
    "  check   Claude Code hook-settings health: the owned hooks in .claude/settings.json, plus\n" +
    "          legacy PalSync entries in ~/.claude/settings.json and .claude/settings.local.json\n" +
    "  repair  migrate legacy forms and install missing hooks in .claude/settings.json\n" +
    "          (your own hooks are preserved); reports entries it cannot migrate";

const WORKSPACE_FILE = ".claude/settings.json";
const LOCAL_FILE = ".claude/settings.local.json";
const USER_FILE = ".claude/settings.json"; // under the user's home dir

function userSettingsFile(homeDir = os.homedir()) { return path.join(homeDir, USER_FILE); }

// The agent that owns this workspace, from .palsync/context-manifest.json, or null when the
// manifest is absent/unreadable (legacy workspace). Non-Claude injection REMOVES Claude hooks
// (contextInject configure(install:false) + cleanClaudeArtifacts), so check/repair must treat a
// non-Claude workspace as out of scope rather than installing hooks into it.
function workspaceAgent(dir) {
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, ".palsync", "context-manifest.json"), "utf8"));
        return parsed && typeof parsed.agent === "string" ? parsed.agent : null;
    } catch (e) { return null; }
}

// First `palsync` executable a shell would resolve on PATH, plus its --version output. This is
// the BUG-1 diagnostic: Claude Code's hooks run through a shell, so a stale binary earlier on
// PATH than the upgraded one is exactly what makes `palsync: unknown subcommand 'hook'` persist
// after the workspace settings look healthy. Informational only (never affects the exit code).
function pathProbe() {
    const names = process.platform === "win32"
        ? ["palsync.exe", "palsync.cmd", "palsync"]
        : ["palsync"];
    const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
    for (const d of dirs) {
        for (const name of names) {
            const candidate = path.join(d, name);
            if (!fs.existsSync(candidate)) continue;
            const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000 });
            const version = probe.status === 0 ? String(probe.stdout || "").trim() : "unreadable";
            return candidate + " (" + version + ")";
        }
    }
    return null;
}
function localSettingsFile(workspaceDir) { return path.join(workspaceDir, LOCAL_FILE); }
function workspaceSettingsFile(workspaceDir) { return path.join(workspaceDir, WORKSPACE_FILE); }

// Read a settings file. A missing file is { present:false } with no error; a read or JSON parse
// failure is surfaced as `error` (the CLI reports, never guesses).
function readSettings(file) {
    let raw;
    try { raw = fs.readFileSync(file, "utf8"); }
    catch (e) {
        if (e.code === "ENOENT") return { present: false, settings: null, error: null };
        return { present: true, settings: null, error: (e && e.message) || String(e) };
    }
    try { return { present: true, settings: JSON.parse(raw), error: null }; }
    catch (e) { return { present: true, settings: null, error: "malformed JSON" }; }
}

function canonicalCommand(adapter) {
    return hooks.OWNED_HOOKS.find(e => e.adapter === adapter).command;
}

// Owned commands in a settings file PalSync never writes, tagged with whether the form is legacy
// (fails: resolves via PATH or points at an old script) or the pinned command (works, but PalSync
// will not keep it updated here). null when the file is absent; { error, entries } otherwise.
function foreignEntries(state) {
    if (!state.present) return null;
    if (state.error) return { error: state.error, entries: [] };
    return { error: null, entries: hooks.findOwnedIn(state.settings).map(f => ({
        event: f.event,
        adapter: f.adapter,
        command: f.command,
        legacy: f.command !== canonicalCommand(f.adapter),
    })) };
}

function entryRow(entry, relFile) {
    const label = entry.event + " (" + entry.adapter + ")";
    if (entry.status === "ok") {
        return "  " + label.padEnd(30) + "ok       installed in " + relFile;
    }
    if (entry.status === "missing") {
        return "  " + label.padEnd(30) + "missing  not in " + relFile + " (run `palsync hooks repair`)";
    }
    const reasons = entry.ownedCommands.map(cmd =>
        cmd === canonicalCommand(entry.adapter)
            ? "the pinned command sits under a foreign matcher"
            : "legacy form '" + cmd + "'");
    return "  " + label.padEnd(30) + "stale    " + relFile + " — " + reasons.join("; ") +
        " (run `palsync hooks repair`)";
}

function foreignBlock(label, info) {
    const lines = ["⚠ " + label + " defines PalSync hooks in a file PalSync never writes — it cannot migrate them:"];
    for (const e of info.entries) {
        const entryLabel = e.event + " (" + e.adapter + "):";
        lines.push("    " + entryLabel.padEnd(24) +
            (e.legacy ? "legacy form '" + e.command + "' (will fail)" : "pinned command (works, but PalSync will not update it here)"));
    }
    lines.push("  Remove these entries manually, or move them into " + WORKSPACE_FILE + " and re-run `palsync hooks repair`.");
    return lines;
}

// Scan the two never-written files and return { lines, legacyCount }. Unreadable files are
// reported and count as problems (they could hide a legacy entry).
function scanForeign(dir, homeDir) {
    const lines = [];
    let legacyCount = 0;
    for (const [label, state] of [
        ["~/.claude/settings.json", readSettings(userSettingsFile(homeDir))],
        [".claude/settings.local.json", readSettings(localSettingsFile(dir))],
    ]) {
        const info = foreignEntries(state);
        if (!info) continue;
        if (info.error) {
            lines.push("⚠ " + label + " is unreadable: " + info.error);
            legacyCount += 1;
        } else if (info.entries.length) {
            legacyCount += info.entries.filter(e => e.legacy).length;
            lines.push(...foreignBlock(label, info));
        }
    }
    return { lines, legacyCount };
}

async function runCheck(dir, homeDir) {
    const agent = workspaceAgent(dir);
    if (agent && agent !== "claude") {
        return {
            text: "palsync hooks check — " + dir + "\n" +
                "workspace agent is " + agent + "; Claude hooks not applicable.",
            code: 0,
        };
    }
    const stamp = installedSha();
    const installed = "palsync " + pkg.version + (stamp ? " (" + stamp.slice(0, 7) + ")" : "");
    const onPath = pathProbe();
    const lines = [
        installed + " — hooks check for " + dir,
        "palsync on PATH: " + (onPath || "not found"),
        "",
    ];
    let problems = 0;
    const state = readSettings(workspaceSettingsFile(dir));
    if (!state.present) {
        // No settings file at all: nothing is installed, repair will create the whole set.
        for (const entry of hooks.inspectOwnedHooks({})) lines.push(entryRow(entry, WORKSPACE_FILE));
        lines.push("");
        lines.push("No " + WORKSPACE_FILE + " — none of the PalSync hooks are installed. Run `palsync hooks repair`.");
        problems += 1;
    } else if (state.error) {
        lines.push("✖ " + workspaceSettingsFile(dir) + " is " + state.error + " — cannot inspect.");
        lines.push("  " + hooks.MANUAL_REMEDIATION);
        problems += 1;
    } else {
        const probe = hooks.mergeSettings(state.settings, false);
        if (!probe.ok) {
            lines.push("✖ " + workspaceSettingsFile(dir) + ": " + probe.error + " — cannot inspect.");
            lines.push("  " + hooks.MANUAL_REMEDIATION);
            problems += 1;
        } else {
            for (const entry of hooks.inspectOwnedHooks(state.settings)) {
                lines.push(entryRow(entry, WORKSPACE_FILE));
                if (entry.status !== "ok") problems += 1;
            }
        }
    }
    const foreign = scanForeign(dir, homeDir);
    if (foreign.lines.length) {
        lines.push("");
        lines.push(...foreign.lines);
    }
    problems += foreign.legacyCount;
    return { text: lines.join("\n"), code: problems ? 1 : 0 };
}

async function runRepair(dir, homeDir) {
    const lines = ["palsync hooks repair — " + dir, ""];
    let problems = 0;
    if (!fs.existsSync(dir)) {
        lines.push("✖ workspace directory does not exist: " + dir);
        return { text: lines.join("\n"), code: 1 };
    }
    const agent = workspaceAgent(dir);
    if (agent && agent !== "claude") {
        lines.push("workspace agent is " + agent + "; Claude hooks not applicable — nothing changed.");
        return { text: lines.join("\n"), code: 0 };
    }
    const result = await hooks.configure(dir, { install: true });
    if (!result.ok) {
        // skipped: malformed JSON or structurally incompatible settings — refuse to touch it.
        lines.push("✖ " + workspaceSettingsFile(dir) + ": " + result.error + " — cannot repair automatically.");
        lines.push("  " + hooks.MANUAL_REMEDIATION);
        problems += 1;
    } else {
        const state = readSettings(workspaceSettingsFile(dir));
        if (result.changed) {
            lines.push("Repaired " + WORKSPACE_FILE + " — migrated legacy forms and installed missing hooks" +
                " (your own hooks were preserved).");
        } else {
            lines.push(WORKSPACE_FILE + " was already healthy — nothing to change.");
        }
        for (const entry of hooks.inspectOwnedHooks(state.settings)) {
            lines.push(entryRow(entry, WORKSPACE_FILE));
            if (entry.status !== "ok") problems += 1;
        }
    }
    const foreign = scanForeign(dir, homeDir);
    if (foreign.lines.length) {
        lines.push("");
        lines.push(...foreign.lines);
    }
    problems += foreign.legacyCount;
    return { text: lines.join("\n"), code: problems ? 1 : 0 };
}

// argv: `check|repair [--dir <ws>]`. `options.homeDir` is a test seam so the user-level settings
// scan never depends on the machine that runs the test. Returns the process exit code.
async function run(argv, options = {}) {
    let dir = process.cwd();
    const pos = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dir") {
            dir = argv[++i];
            if (dir === undefined) { console.error("--dir requires a value"); return 1; }
        } else if (a.startsWith("--dir=")) {
            dir = a.slice("--dir=".length);
        } else if (a === "--help" || a === "-h") {
            console.log(USAGE);
            return 0;
        } else {
            pos.push(a);
        }
    }
    if (pos.length !== 1 || (pos[0] !== "check" && pos[0] !== "repair")) {
        console.error(USAGE);
        return 1;
    }
    const homeDir = options.homeDir === undefined ? os.homedir() : options.homeDir;
    const res = pos[0] === "check"
        ? await runCheck(path.resolve(dir), homeDir)
        : await runRepair(path.resolve(dir), homeDir);
    console.log(res.text);
    return res.code;
}

module.exports = { run, USAGE, userSettingsFile, localSettingsFile, workspaceSettingsFile, readSettings, foreignEntries };
