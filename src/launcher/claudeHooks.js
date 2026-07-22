"use strict";
const fs = require("fs/promises");
const path = require("path");
const { writeIfChanged } = require("../core/atomicWrite");

const COMPLETION_COMMAND = "palsync hook completion --mode claude";
const COMPLETION_HOOK = { type: "command", command: COMPLETION_COMMAND, timeout: 10 };
const MANUAL_REMEDIATION = "Add this Stop command manually to .claude/settings.json: " + COMPLETION_COMMAND;

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function owned(hook) { return isObject(hook) && hook.type === "command" && hook.command === COMPLETION_COMMAND; }

function mergeSettings(settings, install) {
    if (!isObject(settings)) return { ok: false, error: "settings root must be a JSON object" };
    if (settings.hooks !== undefined && !isObject(settings.hooks)) return { ok: false, error: "settings.hooks must be an object" };
    if (settings.hooks && settings.hooks.Stop !== undefined && !Array.isArray(settings.hooks.Stop)) {
        return { ok: false, error: "settings.hooks.Stop must be an array" };
    }
    const next = JSON.parse(JSON.stringify(settings));
    next.hooks = next.hooks || {};
    const groups = next.hooks.Stop || [];
    if (install) {
        const exists = groups.some(group => isObject(group) && Array.isArray(group.hooks) && group.hooks.some(owned));
        if (!exists) groups.push({ hooks: [COMPLETION_HOOK] });
    } else {
        for (let i = groups.length - 1; i >= 0; i--) {
            const group = groups[i];
            if (!isObject(group) || !Array.isArray(group.hooks)) continue;
            group.hooks = group.hooks.filter(hook => !owned(hook));
            if (!group.hooks.length && Object.keys(group).every(key => key === "hooks")) groups.splice(i, 1);
        }
    }
    if (groups.length) next.hooks.Stop = groups;
    else delete next.hooks.Stop;
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

module.exports = { configure, mergeSettings, COMPLETION_COMMAND, COMPLETION_HOOK, MANUAL_REMEDIATION };
