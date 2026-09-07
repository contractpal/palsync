"use strict";
// Workspace persistence: a small registry of known workspaces (for the Launcher's "recent"
// list) plus one JSON file per workspace holding its tabs. Deliberately plain JSON, not
// SQLite — this is small, human-scannable state, and save is explicit (not autosave).
const fs = require("fs/promises");
const path = require("path");

function registryPath(userDataDir) {
    return path.join(userDataDir, "workspaces.json");
}

async function readJsonSafe(filePath, fallback) {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (e) {
        return fallback;
    }
}

async function listRecent(userDataDir) {
    const reg = await readJsonSafe(registryPath(userDataDir), { workspaces: [] });
    return (reg.workspaces || []).slice().sort((a, b) => (b.lastOpened || "").localeCompare(a.lastOpened || ""));
}

async function rememberWorkspace(userDataDir, { name, filePath }) {
    const reg = await readJsonSafe(registryPath(userDataDir), { workspaces: [] });
    const list = (reg.workspaces || []).filter(w => w.filePath !== filePath);
    list.unshift({ name, filePath, lastOpened: new Date().toISOString() });
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(registryPath(userDataDir), JSON.stringify({ workspaces: list }, null, 2), "utf8");
    return list;
}

function emptyWorkspace(name) {
    return { name, pals: [], activeTabIndex: 0 };
}

async function loadWorkspace(filePath) {
    return readJsonSafe(filePath, null);
}

async function saveWorkspace(filePath, workspace) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(workspace, null, 2), "utf8");
    return workspace;
}

module.exports = { listRecent, rememberWorkspace, emptyWorkspace, loadWorkspace, saveWorkspace, registryPath };
