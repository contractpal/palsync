"use strict";
const fs = require("fs/promises");
const path = require("path");
const { writeIfChanged } = require("../core/atomicWrite");

const COMPLETION_COMMAND = "palsync hook completion --mode claude";
const COMPLETION_HOOK = { type: "command", command: COMPLETION_COMMAND, timeout: 10 };
const GUARD_COMMAND = "palsync hook guard --mode claude";
const GUARD_HOOK = { type: "command", command: GUARD_COMMAND, timeout: 10 };
// Only the tools that write a file at a caller-supplied path; the guard matches by resolved path and
// deliberately does not inspect Bash commands (see src/core/guardHook.js).
const GUARD_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";
// Post-write feedback (C3). Same matcher as the guard: the tools that write a caller-supplied path.
// Advisory only -- src/core/postWriteHook.js never blocks, so this entry cannot wedge a session.
const POST_WRITE_COMMAND = "palsync hook post-write --mode claude";
const POST_WRITE_HOOK = { type: "command", command: POST_WRITE_COMMAND, timeout: 10 };
const POST_WRITE_MATCHER = GUARD_MATCHER;
const MANUAL_REMEDIATION = "Add these hooks manually to .claude/settings.json: Stop -> " +
    COMPLETION_COMMAND + ", PreToolUse (matcher " + GUARD_MATCHER + ") -> " + GUARD_COMMAND +
    ", PostToolUse (matcher " + POST_WRITE_MATCHER + ") -> " + POST_WRITE_COMMAND;

// One entry per PalSync-owned hook. `event` is the settings.hooks key it installs under; `matcher` is
// omitted for events that take none (Stop). Adding a hook means adding a row here -- the merge,
// removal, and empty-key cleanup below are generic over this table.
const OWNED_HOOKS = [
    { event: "Stop", command: COMPLETION_COMMAND, hook: COMPLETION_HOOK, matcher: null },
    { event: "PreToolUse", command: GUARD_COMMAND, hook: GUARD_HOOK, matcher: GUARD_MATCHER },
    { event: "PostToolUse", command: POST_WRITE_COMMAND, hook: POST_WRITE_HOOK, matcher: POST_WRITE_MATCHER },
];

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function ownedBy(command) {
    return hook => isObject(hook) && hook.type === "command" && hook.command === command;
}
function owned(hook) { return OWNED_HOOKS.some(entry => ownedBy(entry.command)(hook)); }

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
            const exists = groups.some(group => isObject(group) && Array.isArray(group.hooks) &&
                group.hooks.some(ownedBy(entry.command)));
            if (!exists) {
                // A matcher-bearing group must carry its matcher, or the hook would fire for every tool.
                groups.push(entry.matcher === null
                    ? { hooks: [entry.hook] }
                    : { matcher: entry.matcher, hooks: [entry.hook] });
            }
        } else {
            for (let i = groups.length - 1; i >= 0; i--) {
                const group = groups[i];
                if (!isObject(group) || !Array.isArray(group.hooks)) continue;
                group.hooks = group.hooks.filter(hook => !ownedBy(entry.command)(hook));
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
    configure, mergeSettings, owned, OWNED_HOOKS,
    COMPLETION_COMMAND, COMPLETION_HOOK,
    GUARD_COMMAND, GUARD_HOOK, GUARD_MATCHER,
    POST_WRITE_COMMAND, POST_WRITE_HOOK, POST_WRITE_MATCHER,
    MANUAL_REMEDIATION,
};
