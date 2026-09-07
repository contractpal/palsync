"use strict";
// Validates a user-picked folder is a pal project palsync already manages, and builds a
// workspace tab entry from its .palsync.json record — no re-entering metadata by hand.
const fs = require("fs/promises");
const path = require("path");
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
        lastActive: new Date().toISOString()
    };
}

module.exports = { validatePalFolder, tabFromRecord };
