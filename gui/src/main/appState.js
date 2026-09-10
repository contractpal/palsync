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

// Default save location for new Chip workspace files (the .json file itself) — File menu
// setting. null/unset means "let the OS save dialog remember wherever it last was" (today's
// behavior, unchanged unless the user sets this).
function getDefaultWorkspaceSaveDir(userDataDir) {
    return readSync(userDataDir).defaultWorkspaceSaveDir || null;
}

async function setDefaultWorkspaceSaveDir(userDataDir, dir) {
    const state = readSync(userDataDir);
    state.defaultWorkspaceSaveDir = dir || null;
    await write(userDataDir, state);
}

// Override for where a pal project folder gets pulled to disk (default is `~/PalBuilder`,
// see src/launcher/workspace.js's defaultWorkspaceDir) — File menu setting, separate from the
// workspace-file location above.
function getDefaultPalFolderDir(userDataDir) {
    return readSync(userDataDir).defaultPalFolderDir || null;
}

async function setDefaultPalFolderDir(userDataDir, dir) {
    const state = readSync(userDataDir);
    state.defaultPalFolderDir = dir || null;
    await write(userDataDir, state);
}

module.exports = {
    hasShownDependencyCheck, markDependencyCheckShown,
    getDefaultWorkspaceSaveDir, setDefaultWorkspaceSaveDir,
    getDefaultPalFolderDir, setDefaultPalFolderDir
};
