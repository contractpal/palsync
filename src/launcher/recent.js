"use strict";
// The startup menu for returning users: pick one of the pals you actually work on, or step into
// the full cloud → account → profile → group → pal wizard. Rendered from local history only —
// nothing here talks to a server (the menu must appear instantly, before any login).
const { loadClack } = require("../platform/uiPrompts");
const { shortenHome } = require("./workspacePath");

const OTHER = "__other__";
const CHANGE_DIR = "__changedir__";

function label(entry) {
    return (entry.palName || "(unnamed pal)") + (entry.branch ? "  (" + entry.branch + ")" : "");
}

// Default prompt: a clack select over at most five recent/frequent pals plus the two actions.
async function defaultPickRecent(entries) {
    const clack = await loadClack();
    const choice = await clack.select({
        message: "Select a Pal",
        options: [
            ...entries.map(e => ({ value: e, label: label(e), hint: shortenHome(e.workspaceDir || "") })),
            { value: OTHER, label: "Open another Pal…" },
            { value: CHANGE_DIR, label: "Change workspace directory…" }
        ]
    });
    if (clack.isCancel(choice)) return null;
    if (choice === OTHER) return { kind: "other" };
    if (choice === CHANGE_DIR) return { kind: "change-dir" };
    return { kind: "pal", entry: choice };
}

// Returns { kind: "pal", entry } | { kind: "other" } | { kind: "change-dir" } | null (cancel).
// "other" means: run the ORIGINAL full wizard — this module never reimplements selection.
async function pickRecent(entries, { prompt = defaultPickRecent } = {}) {
    if (!entries || !entries.length) return null;
    return await prompt(entries);
}

async function defaultPickRecentPal(entries, message) {
    const clack = await loadClack();
    const choice = await clack.select({
        message,
        options: entries.map(e => ({ value: e, label: label(e), hint: shortenHome(e.workspaceDir || "") }))
    });
    return clack.isCancel(choice) ? null : choice;
}

// "Change workspace directory…" asks which pal first (only one row per pal exists, but the user
// may work on several).
async function pickRecentPal(entries, { message = "Which Pal's workspace?", prompt } = {}) {
    if (!entries || !entries.length) return null;
    const choose = prompt || ((list) => defaultPickRecentPal(list, message));
    return await choose(entries, message);
}

const RECOVERY_CHOOSE_DIR = "__choose_dir__";
const RECOVERY_OTHER = "__other__";

async function defaultPickRecovery(message, { defaultDir, allowDir = true }) {
    const clack = await loadClack();
    const choice = await clack.select({
        message,
        options: [
            ...(allowDir ? [{ value: RECOVERY_CHOOSE_DIR, label: "Choose a different folder…", hint: shortenHome(defaultDir || "") }] : []),
            { value: RECOVERY_OTHER, label: "Open another Pal…" },
            { value: "__quit__", label: "Quit palsync" }
        ]
    });
    if (clack.isCancel(choice)) return null;
    if (choice === RECOVERY_CHOOSE_DIR) return { kind: "choose-dir" };
    if (choice === RECOVERY_OTHER) return { kind: "other" };
    return null;
}

// The recovery menu for "the remembered workspace cannot be used". Returns
// { kind: "choose-dir" } | { kind: "other" } | null (quit). allowDir=false drops the
// folder action (nothing would be opened in it anyway — the pal itself is unreachable).
async function pickRecovery(message, { defaultDir, allowDir = true, prompt } = {}) {
    const choose = prompt || ((msg) => defaultPickRecovery(msg, { defaultDir, allowDir }));
    return await choose(message, { defaultDir, allowDir });
}

module.exports = { pickRecent, pickRecentPal, pickRecovery, label, OTHER, CHANGE_DIR };
