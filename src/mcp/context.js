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
    // Set by Chip's MCP registration (PALSYNC_CHIP_SESSION_ID env var — see
    // src/mcp/register.js/registerOpencode.js) so every request this agent process makes for
    // this pal carries a Chip-Session-ID header (lib/apiManager.js). Absent under the plain CLI.
    session.chipSessionId = process.env.PALSYNC_CHIP_SESSION_ID || null;

    // exitOnIdle:false (also the constructor default) — the MCP server's lifetime belongs to
    // its client; idle releases only the lock, and the next tool call re-acquires it.
    const lifecycle = new LockLifecycle(session, record.palGuid,
        idleMs !== undefined ? { idleMs, log, exitOnIdle: false } : { log, exitOnIdle: false });

    // Seed the lock lifecycle with the pal's persisted transient id (record.palId — see
    // palsyncfile.js's header comment on why this is safe to reuse across sessions), so THIS
    // session's very first acquire can skip the expensive profile->group->pal account walk
    // entirely and go straight to GetPal.do with a known-good id. lifecycle.acquire() already
    // reads this.lockState.resolved as its source (see lockLife.js) — this just pre-populates
    // it before that first call. core/lock.js's acquireByGuid self-heals (falls back to a real
    // resolve) if this ever turns out to be stale.
    if (record.palId) {
        lifecycle.lockState = {
            resolved: { id: record.palId, guid: record.palGuid, profileId: record.profileId }
        };
    }

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
        // Persist whatever id this session actually ended up resolving/using (new — no id was
        // stored yet — or different — the stored one was stale and lock.js's acquireByGuid
        // self-healed it), so the NEXT session skips the walk too, not just this one.
        const resolved = lifecycle.lockState && lifecycle.lockState.resolved;
        if (resolved && (resolved.id !== record.palId || resolved.profileId !== record.profileId)) {
            record.palId = resolved.id;
            if (resolved.profileId) record.profileId = resolved.profileId;
            try { await palsyncfile.write(workspaceDir, record); } catch (e) { /* best-effort */ }
        }
    }
    return ctx;
}

module.exports = { buildContext };
