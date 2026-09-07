"use strict";
// Tiny persisted app-level state — currently just "has the dependency checklist been shown
// once already" (first-launch trigger). Deliberately not folded into workspaceStore.js's
// files since this is app-wide state, not per-workspace.
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");

function statePath(userDataDir) {
    return path.join(userDataDir, "app-state.json");
}

function readSync(userDataDir) {
    try { return JSON.parse(fsSync.readFileSync(statePath(userDataDir), "utf8")); }
    catch (e) { return {}; }
}

async function write(userDataDir, state) {
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(statePath(userDataDir), JSON.stringify(state, null, 2), "utf8");
}

function hasShownDependencyCheck(userDataDir) {
    return !!readSync(userDataDir).hasShownDependencyCheck;
}

async function markDependencyCheckShown(userDataDir) {
    const state = readSync(userDataDir);
    state.hasShownDependencyCheck = true;
    await write(userDataDir, state);
}

module.exports = { hasShownDependencyCheck, markDependencyCheckShown };
