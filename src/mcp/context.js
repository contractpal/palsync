"use strict";
// Build the MCP session context from a workspace: read .palsync.json, resolve the password
// (env-var first, then OS keychain — so this runs headless on an autonomous-agent box with no
// keychain), authenticate, and acquire the session lock with the guaranteed-release lifecycle.
// Returns ctx used by every tool. The password is never written to disk or returned to the agent.
const palsyncfile = require("../core/palsyncfile");
const { resolvePassword, credentialError } = require("../auth/credentialStore");
const { authenticate } = require("../core/session");
const { LockLifecycle } = require("../lifecycle/lockLife");

async function buildContext(workspaceDir, { idleMs, log = () => {}, acquireLock = true } = {}) {
    const record = await palsyncfile.read(workspaceDir);
    const { password } = resolvePassword(record.cloudUrl, record.username);
    if (!password) throw credentialError(record.cloudUrl, record.username);
    const session = await authenticate(record.cloudUrl, record.username, password);

    // exitOnIdle:false (also the constructor default) — the MCP server's lifetime belongs to
    // its client; idle releases only the lock, and the next tool call re-acquires it.
    const lifecycle = new LockLifecycle(session, record.palGuid,
        idleMs !== undefined ? { idleMs, log, exitOnIdle: false } : { log, exitOnIdle: false });

    const ctx = {
        session,
        record,
        workspaceDir,
        lifecycle,
        persist: () => palsyncfile.write(workspaceDir, record),
        // Session-only user control for automated/runtime verification. This intentionally
        // resets with the MCP process so a one-off "stop testing" request never becomes a
        // surprising permanent workspace setting.
        testingEnabled: true,
        // Session-lifetime render-verification flag — see renderNotVerifiedReminder in mcp/tools.js.
        // false until a pal_screenshot (or pal_fetch/pal_preview+expect for web) actually shows a
        // clean render since the last push; "unavailable" once the check tool is confirmed absent.
        renderVerified: false
    };

    if (acquireLock) {
        await lifecycle.acquire();          // auto-locks (own-stale reclaim handled inside)
        lifecycle.installSignalHandlers();  // guaranteed release on exit signals
    }
    return ctx;
}

module.exports = { buildContext };
