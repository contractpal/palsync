"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { buildMcpConfig, mergeJsonConfig } = require("./register");

const SOURCE_DIR = path.join(__dirname, "..", "..", "pi-extension");
// Pi 1.6 reads project MCP servers from <workspace>/.pi/mcp.json (the same "mcpServers" shape as
// Claude's .mcp.json). Playwright rides along so a Pi session can drive a browser without a
// separate extension; --headless keeps remote/CI boxes working.
const PLAYWRIGHT_SERVER = { command: "npx", args: ["-y", "@playwright/mcp@latest", "--headless"] };
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

// Project-scoped Pi registration (the CLI path): merge palsync + Playwright into
// <workspaceDir>/.pi/mcp.json, preserving any servers the user already configured. Pi requires
// the project to be trusted; it asks the user on first open, so nothing is pre-approved here.
async function registerProject(workspaceDir, opts = {}) {
    const filePath = path.join(workspaceDir, ".pi", "mcp.json");
    const palsync = buildMcpConfig(workspaceDir, opts).mcpServers.palsync;
    const cfg = { mcpServers: Object.assign({}, { palsync }, { playwright: PLAYWRIGHT_SERVER }) };
    const config = await mergeJsonConfig(filePath, cfg, "mcpServers");
    return { filePath, config };
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

module.exports = { register, registerProject, install, installCommand, SOURCE_DIR, FILES, SHARED_SOURCES };
