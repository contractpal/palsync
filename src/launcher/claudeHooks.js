"use strict";
const fs = require("fs/promises");
const path = require("path");
const { writeIfChanged } = require("../core/atomicWrite");

// Deterministic hook commands: Claude Code executes hook commands through a shell, so a bare
// `palsync hook ...` resolves through PATH and can execute the wrong binary. Instead the adapter
// runs through the exact Node binary that is running this code plus the absolute script path, both
// shell-quoted for the current platform so paths with spaces survive. The adapter tokens after the
// script are static and unquoted.
const NODE_EXECUTABLE = path.resolve(process.execPath);
const HOOK_SCRIPT = path.resolve(__dirname, "..", "..", "bin", "palsync.js");
function shq(value, platform = process.platform) {
    return platform === "win32"
        ? '"' + String(value) + '"'
        : "'" + String(value).replace(/'/g, "'\\''") + "'";
}
function generateCommand(adapter, nodePath = NODE_EXECUTABLE, script = HOOK_SCRIPT, platform = process.platform) {
    return shq(nodePath, platform) + " " + shq(script, platform) + " hook " + adapter + " --mode claude";
}

const COMPLETION_COMMAND = generateCommand("completion");
const COMPLETION_HOOK = { type: "command", command: COMPLETION_COMMAND, timeout: 10 };
const GUARD_COMMAND = generateCommand("guard");
const GUARD_HOOK = { type: "command", command: GUARD_COMMAND, timeout: 10 };
// Only the tools that write a file at a caller-supplied path; the guard matches by resolved path and
// deliberately does not inspect Bash commands (see src/core/guardHook.js).
const GUARD_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";
// Post-write feedback (C3). Same matcher as the guard: the tools that write a caller-supplied path.
// Advisory only -- src/core/postWriteHook.js never blocks, so this entry cannot wedge a session.
const POST_WRITE_COMMAND = generateCommand("post-write");
const POST_WRITE_HOOK = { type: "command", command: POST_WRITE_COMMAND, timeout: 10 };
const POST_WRITE_MATCHER = GUARD_MATCHER;
const MANUAL_REMEDIATION = "Add these hooks manually to .claude/settings.json: Stop -> " +
    COMPLETION_COMMAND + ", PreToolUse (matcher " + GUARD_MATCHER + ") -> " +
    GUARD_COMMAND + ", PostToolUse (matcher " + POST_WRITE_MATCHER + ") -> " +
    POST_WRITE_COMMAND;

// One entry per PalSync-owned hook. `event` is the settings.hooks key it installs under; `matcher` is
// omitted for events that take none (Stop). Adding a hook means adding a row here -- the merge,
// removal, and empty-key cleanup below are generic over this table.
const OWNED_HOOKS = [
    { event: "Stop", adapter: "completion", command: COMPLETION_COMMAND, hook: COMPLETION_HOOK, matcher: null },
    { event: "PreToolUse", adapter: "guard", command: GUARD_COMMAND, hook: GUARD_HOOK, matcher: GUARD_MATCHER },
    { event: "PostToolUse", adapter: "post-write", command: POST_WRITE_COMMAND, hook: POST_WRITE_HOOK, matcher: POST_WRITE_MATCHER },
];

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }

// Split a hook command into shell tokens honoring single and double quotes (the two quote styles a
// settings.json command can use), so a quoted path containing spaces stays one token. Concatenation
// like 'a'"b" is supported; backslash escapes are not (paths containing a backslash-quote are not a
// realistic settings form, and our own generated form uses platform-appropriate quotes).
function tokenizeCommand(command) {
    const tokens = [];
    const s = String(command);
    let i = 0;
    while (i < s.length) {
        while (i < s.length && /\s/.test(s[i])) i += 1;
        if (i >= s.length) break;
        let token = "";
        while (i < s.length && !/\s/.test(s[i])) {
            const ch = s[i];
            if (ch === "'" || ch === '"') {
                const quote = ch;
                i += 1;
                while (i < s.length && s[i] !== quote) { token += s[i]; i += 1; }
                if (i < s.length) i += 1;
            } else { token += ch; i += 1; }
        }
        tokens.push(token);
    }
    return tokens;
}

// Recognize the prior generated form "<node> <script> hook <adapter> --mode claude" (the previous
// deterministic variant, seen in the wild before the bare `palsync` command). Anchored at exactly
// six tokens and the trailing "--mode claude", so shell prefixes (`cd … &&`, `exec`), wrappers
// (`env`, one-token absolute launchers) and suffixes like `--custom` never match; the executable must
// be Node, the script token must end in `palsync.js` under either separator, and the adapter must be
// one of PalSync's generated adapters. Returns the adapter token, or null.
function parseGeneratedCommand(command) {
    const tokens = tokenizeCommand(command);
    if (tokens.length !== 6 || tokens[2] !== "hook" || tokens[4] !== "--mode" || tokens[5] !== "claude") return null;
    const executable = String(tokens[0]).split(/[\\/]/).pop().toLowerCase();
    if (!new Set(["node", "node.exe", "nodejs", "nodejs.exe"]).has(executable)) return null;
    if (String(tokens[1]).split(/[\\/]/).pop() !== "palsync.js") return null;
    if (!["completion", "guard", "post-write"].includes(tokens[3])) return null;
    return tokens[3];
}

// Ownership covers every form PalSync has ever written: the current generated command, the exact
// legacy bare command, and the anchored prior node+script form. `adapter` scopes ownership so a
// guard command sitting under Stop (a user misconfiguration) is never mistaken for ours.
function isOwnedCommand(command, adapter) {
    return command === generateCommand(adapter, process.execPath, HOOK_SCRIPT)
        || command === "palsync hook " + adapter + " --mode claude"
        || parseGeneratedCommand(command) === adapter;
}
function ownedBy(adapter) {
    return hook => isObject(hook) && hook.type === "command" && isOwnedCommand(hook.command, adapter);
}
function owned(hook) { return OWNED_HOOKS.some(entry => ownedBy(entry.adapter)(hook)); }

// --- Detection for `palsync hooks check|repair` (the recovery surface) ---

// Every PalSync-owned hook command in a parsed settings object as { event, adapter, command },
// deduped per (adapter, command). `palsync hooks check|repair` use this to report owned entries
// that live in files configure() never writes (~/.claude/settings.json, .claude/settings.local.json)
// and therefore cannot migrate. User hooks, wrappers, and `--custom`-suffixed copies are not owned
// and never appear.
function findOwnedIn(settings) {
    if (!isObject(settings) || !isObject(settings.hooks)) return [];
    const found = [];
    const seen = new Set();
    for (const entry of OWNED_HOOKS) {
        const groups = settings.hooks[entry.event];
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
            if (!isObject(group) || !Array.isArray(group.hooks)) continue;
            for (const hook of group.hooks) {
                if (!ownedBy(entry.adapter)(hook)) continue;
                const key = entry.adapter + "\u0000" + hook.command;
                if (seen.has(key)) continue;
                seen.add(key);
                found.push({ event: entry.event, adapter: entry.adapter, command: hook.command });
            }
        }
    }
    return found;
}

// State of the owned hooks in a parsed settings object, one row per OWNED_HOOKS entry:
//   ok      — the canonical command is installed in a group carrying the canonical matcher
//   stale   — owned command(s) present but not canonical (legacy forms, or the canonical command
//             parked under a foreign matcher); configure(install:true) repairs these in place
//   missing — no owned form present; configure(install:true) installs the canonical entry
// `ownedCommands` lists every owned command found (deduped) so the CLI can show the offending
// forms. Classification mirrors mergeSettings(install:true): canonical means the exact pinned
// command inside a group with the canonical matcher (Stop takes no matcher, so any group counts).
function inspectOwnedHooks(settings) {
    const found = findOwnedIn(settings);
    return OWNED_HOOKS.map((entry) => {
        const ownedCommands = found.filter(f => f.adapter === entry.adapter).map(f => f.command);
        let canonical = false;
        const groups = isObject(settings) && isObject(settings.hooks) ? settings.hooks[entry.event] : undefined;
        if (Array.isArray(groups)) {
            for (const group of groups) {
                if (!isObject(group) || !Array.isArray(group.hooks)) continue;
                const canonicalGroup = entry.matcher === null || group.matcher === entry.matcher;
                if (canonicalGroup && group.hooks.some(h => isObject(h) && h.type === "command" && h.command === entry.command)) {
                    canonical = true;
                }
            }
        }
        return {
            event: entry.event,
            adapter: entry.adapter,
            matcher: entry.matcher,
            status: canonical ? "ok" : (ownedCommands.length ? "stale" : "missing"),
            ownedCommands,
        };
    });
}

function mergeSettings(settings, install) {
    if (!isObject(settings)) return { ok: false, error: "settings root must be a JSON object" };
    if (settings.hooks !== undefined && !isObject(settings.hooks)) return { ok: false, error: "settings.hooks must be an object" };
    for (const { event } of OWNED_HOOKS) {
        if (settings.hooks && settings.hooks[event] !== undefined && !Array.isArray(settings.hooks[event])) {
            return { ok: false, error: "settings.hooks." + event + " must be an array" };
        }
    }
    const next = JSON.parse(JSON.stringify(settings));
    next.hooks = next.hooks || {};
    for (const entry of OWNED_HOOKS) {
        const groups = next.hooks[entry.event] || [];
        if (install) {
            // Migrate before existence detection: every owned form of the entry becomes the canonical
            // command in place. The FIRST owned hook object survives (all its fields except command),
            // later owned copies are dropped, and for matcher-bearing events an owned hook under a
            // foreign matcher is stale and removed -- the guard/post-write may only live in a group
            // carrying the canonical matcher. Stop needs no matcher, so it can remain in its group.
            let surviving = false;
            for (const group of groups) {
                if (!isObject(group) || !Array.isArray(group.hooks)) continue;
                const canonicalGroup = entry.matcher === null || group.matcher === entry.matcher;
                const migrated = [];
                for (const hook of group.hooks) {
                    if (ownedBy(entry.adapter)(hook)) {
                        if (canonicalGroup && !surviving) {
                            migrated.push(Object.assign({}, hook, { command: entry.command }));
                            surviving = true;
                        }
                    } else {
                        migrated.push(hook);
                    }
                }
                group.hooks = migrated;
            }
            // Current empty-group cleanup: drop a group only when nothing but our own key set is
            // left, so a user's matcher or other bookkeeping on a shared group is never discarded.
            for (let i = groups.length - 1; i >= 0; i--) {
                const group = groups[i];
                if (!isObject(group) || !Array.isArray(group.hooks)) continue;
                const onlyOurKeys = Object.keys(group).every(key => key === "hooks" || key === "matcher");
                if (!group.hooks.length && onlyOurKeys) groups.splice(i, 1);
            }
            // Nothing survived (fresh install, or stale entries were removed): reuse an existing
            // canonical-matcher group for the matcher-bearing events, else create one.
            if (!surviving) {
                if (entry.matcher === null) {
                    groups.push({ hooks: [entry.hook] });
                } else {
                    const canonical = groups.find(group =>
                        isObject(group) && Array.isArray(group.hooks) && group.matcher === entry.matcher);
                    if (canonical) canonical.hooks.push(entry.hook);
                    else groups.push({ matcher: entry.matcher, hooks: [entry.hook] });
                }
            }
        } else {
            for (let i = groups.length - 1; i >= 0; i--) {
                const group = groups[i];
                if (!isObject(group) || !Array.isArray(group.hooks)) continue;
                group.hooks = group.hooks.filter(hook => !ownedBy(entry.adapter)(hook));
                // Drop a group only when nothing but our own key set is left, so a user's matcher or
                // other bookkeeping on a shared group is never discarded.
                const onlyOurKeys = Object.keys(group).every(key => key === "hooks" || key === "matcher");
                if (!group.hooks.length && onlyOurKeys) groups.splice(i, 1);
            }
        }
        if (groups.length) next.hooks[entry.event] = groups;
        else delete next.hooks[entry.event];
    }
    if (!Object.keys(next.hooks).length) delete next.hooks;
    return { ok: true, settings: next };
}

async function configure(workspaceDir, { install }) {
    const file = path.join(workspaceDir, ".claude", "settings.json");
    let raw = null, settings = {};
    try { raw = await fs.readFile(file, "utf8"); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    if (raw !== null) {
        try { settings = JSON.parse(raw); }
        catch (e) { return { ok: false, skipped: true, file, error: "malformed JSON", manualRemediation: MANUAL_REMEDIATION }; }
    }
    const merged = mergeSettings(settings, install);
    if (!merged.ok) return { ok: false, skipped: true, file, error: merged.error, manualRemediation: MANUAL_REMEDIATION };
    const semanticallyChanged = JSON.stringify(settings) !== JSON.stringify(merged.settings);
    if (!semanticallyChanged) return { ok: true, file, changed: false, installed: install };
    if (!install && Object.keys(merged.settings).length === 0) {
        await fs.rm(file, { force: true });
        return { ok: true, file, changed: true, installed: false };
    }
    const content = JSON.stringify(merged.settings, null, 2) + "\n";
    const changed = await writeIfChanged(file, content);
    return { ok: true, file, changed, installed: install };
}

module.exports = {
    configure, mergeSettings, owned, OWNED_HOOKS, generateCommand, findOwnedIn, inspectOwnedHooks,
    COMPLETION_COMMAND, COMPLETION_HOOK,
    GUARD_COMMAND, GUARD_HOOK, GUARD_MATCHER,
    POST_WRITE_COMMAND, POST_WRITE_HOOK, POST_WRITE_MATCHER,
    MANUAL_REMEDIATION,
};
