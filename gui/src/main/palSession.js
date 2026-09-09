"use strict";
// Shared CloudPiston session bootstrap for a pal folder — used by every Chip feature that talks
// to the server on behalf of a specific pal tab (test-workflow ribbon, tunnel panel, debug
// fetch). Extracted out of testWorkflow.js once a second consumer needed it.
const palsyncfile = require("palsync/src/core/palsyncfile");
const { resolvePassword, credentialError } = require("palsync/src/auth/credentialStore");
const { authenticate } = require("palsync/src/core/session");

// One authenticated session per pal folder, reused for the life of this Electron process —
// NOT re-authenticated (Ping.do) on every ribbon click. This matters a lot for Debug's
// Auto-Refresh: at a 5s interval, re-authenticating every tick was a fresh login on top of the
// debug fetch's own Ping.do, every few seconds. A fresh one-off SESSION was never the point of
// the original design here (see the lock note below, which is still true) — only the LOCK
// itself was meant to stay hands-off from the agent's own session.
const sessionCache = new Map();

// Re-authenticating still happens automatically the next call after a real auth failure: the
// shared apiManager.js clears session.password/userId on a 401, so a subsequent call using this
// same session object would fail fast — check for that and refresh rather than trusting a
// dead session forever.
function looksUsable(session) {
    return !!(session && session.password && session.userId);
}

// The Webstart lock (unlike the team/PalBuilder lock) is re-granted to whoever asks last for the
// same user, so reusing a session here doesn't fight the pal's already-running agent/MCP session
// for it — see palsync's src/core/lock.js header comment. Callers that need the lock (runTest)
// acquire it themselves; callers that don't (tunnel, debug) never touch it.
// chipSessionId (optional): this pal tab's persistent id (see palFolder.js's tabFromRecord) —
// set on the session so it rides along as a Chip-Session-ID header on every request this call
// makes (lib/apiManager.js), same identity the agent's own MCP child process sends.
async function sessionForFolder(workspaceDir, chipSessionId) {
    const record = await palsyncfile.read(workspaceDir);
    let session = sessionCache.get(workspaceDir);
    if (!looksUsable(session)) {
        const { password } = resolvePassword(record.cloudUrl, record.username);
        if (!password) throw credentialError(record.cloudUrl, record.username);
        session = await authenticate(record.cloudUrl, record.username, password);
        sessionCache.set(workspaceDir, session);
    }
    session.chipSessionId = chipSessionId || null;
    return { session, record };
}

module.exports = { sessionForFolder };
