"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const installCommand = "install the pi-mcp extension at ~/.pi/agent/extensions/mcp (see its README)";

// Verify only: pi auto-detects the project .palsync.json. Writing another project config here
// would double-inject the palsync server, so setup only reports whether the global extension exists.
async function register() {
    const filePath = path.join(os.homedir(), ".pi", "agent", "extensions", "mcp", "index.ts");
    let installed = false;
    try { installed = (await fs.stat(filePath)).isFile(); } catch (e) { installed = false; }
    return { filePath: null, written: false, installed, installCommand };
}

module.exports = { register, installCommand };
