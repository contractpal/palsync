"use strict";
// Validates a user-picked folder is a pal project palsync already manages, and builds a
// workspace tab entry from its .palsync.json record — no re-entering metadata by hand.
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const palsyncfile = require("palsync/src/core/palsyncfile");

async function exists(filePath) {
    try { await fs.access(filePath); return true; }
    catch (e) { return false; }
}

// { ok: true, record } | { ok: false, reason }
async function validatePalFolder(folderPath) {
    const hasPalJson = await exists(path.join(folderPath, "pal.json"));
    if (!hasPalJson) {
        return { ok: false, reason: "This folder doesn't look like a pal project — no pal.json found." };
    }
    try {
        const record = await palsyncfile.read(folderPath);
        return { ok: true, record };
    } catch (e) {
        return {
            ok: false,
            reason: "This folder has a pal.json but hasn't been set up with palsync yet " +
                "(no .palsync.json). Run `palsync` once from a terminal in this folder to log in and set it up."
        };
    }
}

function tabFromRecord(folderPath, record) {
    return {
        cloudPalId: record.palGuid,
        path: folderPath,
        name: record.palName,
        cloudEndpoint: record.cloudUrl,
        agentId: null,
        // Persistent per-tab identity, unique to this local checkout ("this agent+pal window") —
        // sent as the Chip-Session-ID header on every server request Chip makes for it (directly,
        // and via the agent's MCP child process — see agentLaunch.js's ensureMcpRegistered).
        // David is building server-side support that needs this to tell concurrent Chip sessions
        // on the same pal apart, 2026-09-10.
        sessionId: crypto.randomUUID(),
        lastActive: new Date().toISOString()
    };
}

module.exports = { validatePalFolder, tabFromRecord };
