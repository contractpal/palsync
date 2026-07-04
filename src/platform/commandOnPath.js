"use strict";
// Cross-platform "is this command on PATH?": `where` on Windows, `which` elsewhere. Shared by
// the launcher picker, preflight, and the Codex MCP registration.
const { spawnSync } = require("child_process");

function commandOnPath(name) {
    const probe = process.platform === "win32" ? "where" : "which";
    try { return spawnSync(probe, [name], { stdio: "ignore" }).status === 0; }
    catch (e) { return false; }
}

module.exports = { commandOnPath };
