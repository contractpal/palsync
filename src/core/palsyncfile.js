"use strict";
// .palsync.json — the per-workspace sync record the launcher writes and the MCP server reads.
// Holds only non-secret identifiers (cloud url, stable GUID, name, userId, username, the
// pulled lastModifiedDate drift marker, workspace dir). The password NEVER goes here — it
// stays in the OS keychain, looked up by cloudUrl+username.
//
// palId (added 2026-09-10, per David): the transient 64-hex pal id. Earlier comments here said
// this was deliberately never persisted because it "rotates per enumeration" — true in the sense
// that RE-LISTING the pal can hand back a different value, but per David it is NOT time-stamped
// or expiring, so a previously-seen value remains safe to reuse indefinitely. profileId comes
// from the same resolved server record and is required with palId for QUERY_DATASET. Persisting
// both lets every session after the first skip the expensive profile->group->pal account walk
// entirely (core/lock.js's acquireByGuid self-heals if a persisted value is ever rejected).
const fs = require("fs/promises");
const path = require("path");

const FILENAME = ".palsync.json";

// Build the record from a completed selection + session.
function buildRecord({ cloudUrl, userId, username, pal, workspaceDir, lastModifiedDate }) {
    return {
        version: 1,
        cloudUrl: cloudUrl,
        userId: userId,
        username: username,                       // not secret — keychain key, no password here
        palGuid: pal.guid,                        // stable identifier
        palName: pal.name,
        workspaceDir: workspaceDir || null,
        lastModifiedDate: lastModifiedDate !== undefined ? lastModifiedDate : pal.lastModifiedDate, // drift marker
        palId: pal.id || null,                    // transient id, persisted (see header comment)
        profileId: pal.profileId || null,         // QUERY_DATASET identity, from the same resolve
        pulledAt: null                            // set when pull writes files (M7)
    };
}

async function write(dir, record) {
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, FILENAME);
    await fs.writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
    return filePath;
}

async function read(dir) {
    const filePath = path.join(dir, FILENAME);
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
}

module.exports = { buildRecord, write, read, FILENAME };
