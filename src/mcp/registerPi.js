"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const SOURCE_DIR = path.join(__dirname, "..", "..", "pi-extension");
// Replace dependencies before the entrypoint so an interrupted setup leaves the old index with
// compatible helpers instead of loading a new index against stale helper exports.
const FILES = ["helpers.js", "tools.json", "index.ts"];
const SHARED_SOURCES = {
    "helpers.js": path.join(__dirname, "..", "core", "piHelpers.js"),
    "tools.json": path.join(__dirname, "pi-tools.json")
};
const installCommand = "rerun palsync setup with --agent pi to install ~/.pi/agent/extensions/palsync";

async function sameFile(left, right) {
    try {
        const [a, b] = await Promise.all([fs.readFile(left), fs.readFile(right)]);
        return a.equals(b);
    } catch (e) { return false; }
}

async function install({ homeDir = os.homedir(), sourceDir = SOURCE_DIR } = {}) {
    const dir = path.join(homeDir, ".pi", "agent", "extensions", "palsync");
    await fs.mkdir(dir, { recursive: true });
    let written = false;
    for (const file of FILES) {
        const source = sourceDir === SOURCE_DIR && SHARED_SOURCES[file]
            ? SHARED_SOURCES[file]
            : path.join(sourceDir, file);
        const target = path.join(dir, file);
        if (await sameFile(source, target)) continue;
        await fs.copyFile(source, target);
        written = true;
    }
    return { filePath: path.join(dir, "index.ts"), dir, written, installed: true };
}

async function register({ installExtension = false, homeDir = os.homedir(), sourceDir = SOURCE_DIR } = {}) {
    const nativePath = path.join(homeDir, ".pi", "agent", "extensions", "palsync", "index.ts");
    const thirdPartyPath = path.join(homeDir, ".pi", "agent", "extensions", "mcp", "index.ts");
    let thirdPartyInstalled = false;
    try { thirdPartyInstalled = (await fs.stat(thirdPartyPath)).isFile(); } catch (e) { /* absent */ }
    if (installExtension) {
        const result = await install({ homeDir, sourceDir });
        return Object.assign(result, { thirdPartyInstalled, collisionGuidance: thirdPartyInstalled
            ? "Configure pi-mcp's explicit palsync server with lifecycle:\"lazy\", or disable one integration."
            : null, installCommand });
    }
    let installed = false;
    try { installed = (await fs.stat(nativePath)).isFile(); } catch (e) { /* absent */ }
    return { filePath: installed ? nativePath : null, written: false, installed, thirdPartyInstalled,
        collisionGuidance: thirdPartyInstalled
            ? "Configure pi-mcp's explicit palsync server with lifecycle:\"lazy\", or disable one integration."
            : null, installCommand };
}

module.exports = { register, install, installCommand, SOURCE_DIR, FILES, SHARED_SOURCES };
