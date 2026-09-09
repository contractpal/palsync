"use strict";
// Global (not per-workspace/per-pal) registry of browser executables, mirroring the Java
// PalBuilder IDE's BrowserConfiguration/LocalConfiguration "Browsers" tab. Plain JSON, same
// pattern as workspaceStore.js — small, human-scannable state, no SQLite needed.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

function registryPath(userDataDir) {
    return path.join(userDataDir, "browsers.json");
}

async function readJsonSafe(filePath, fallback) {
    try { return JSON.parse(await fsp.readFile(filePath, "utf8")); }
    catch (e) { return fallback; }
}

// Best-effort single-guess-per-browser auto-detect for common installs, same spirit as the Java
// IDE's IE/Firefox/Safari default factories — never invented for browsers with too many possible
// install locations (Linux distros in particular; user adds those by hand).
function candidateBrowsers() {
    if (process.platform === "win32") {
        return [
            { description: "Microsoft Edge", paths: [
                "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
                "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
            ] },
            { description: "Google Chrome", paths: [
                "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
            ] }
        ];
    }
    if (process.platform === "darwin") {
        return [
            { description: "Safari", paths: ["/Applications/Safari.app"] },
            { description: "Google Chrome", paths: ["/Applications/Google Chrome.app"] }
        ];
    }
    // Linux install locations vary too much by distro/package manager to guess reliably —
    // left empty; the user adds their browser(s) by hand via the Browsers settings panel.
    return [];
}

function seedDefaults() {
    const browsers = [];
    for (const candidate of candidateBrowsers()) {
        const found = candidate.paths.find(p => fs.existsSync(p));
        if (found) browsers.push({ id: crypto.randomUUID(), description: candidate.description, execPath: found, argsTemplate: "${URL}" });
    }
    return browsers;
}

async function save(userDataDir, reg) {
    await fsp.mkdir(userDataDir, { recursive: true });
    await fsp.writeFile(registryPath(userDataDir), JSON.stringify(reg, null, 2), "utf8");
    return reg;
}

async function load(userDataDir) {
    const existing = await readJsonSafe(registryPath(userDataDir), null);
    if (existing) return existing;
    const browsers = seedDefaults();
    const reg = { browsers, defaultId: browsers[0] ? browsers[0].id : null };
    await save(userDataDir, reg);
    return reg;
}

async function add(userDataDir, { description, execPath, argsTemplate }) {
    const reg = await load(userDataDir);
    const entry = { id: crypto.randomUUID(), description, execPath, argsTemplate: (argsTemplate && argsTemplate.trim()) || "${URL}" };
    reg.browsers.push(entry);
    if (!reg.defaultId) reg.defaultId = entry.id;
    await save(userDataDir, reg);
    return reg;
}

async function update(userDataDir, id, fields) {
    const reg = await load(userDataDir);
    const entry = reg.browsers.find(b => b.id === id);
    if (!entry) throw new Error("Unknown browser: " + id);
    Object.assign(entry, fields);
    await save(userDataDir, reg);
    return reg;
}

async function remove(userDataDir, id) {
    const reg = await load(userDataDir);
    reg.browsers = reg.browsers.filter(b => b.id !== id);
    if (reg.defaultId === id) reg.defaultId = reg.browsers[0] ? reg.browsers[0].id : null;
    await save(userDataDir, reg);
    return reg;
}

async function setDefault(userDataDir, id) {
    const reg = await load(userDataDir);
    if (!reg.browsers.some(b => b.id === id)) throw new Error("Unknown browser: " + id);
    reg.defaultId = id;
    await save(userDataDir, reg);
    return reg;
}

module.exports = { load, add, update, remove, setDefault };
