"use strict";
// Lock model (verified against the live server — see investigation notes):
//   * Team/PalBuilder lock ("check out", lockType "teamMember") is visible read-only in getPal().teamInfo
//     with the real owner profile (email/name). It BLOCKS LockPal.do (which then returns a null
//     owner, so LockPal alone can't identify the holder).
//   * Webstart lock (LockPal.do, what palsync uses) is NOT in teamInfo and is re-granted to the
//     same user. lockGranted === true is the authoritative "you got it" signal.
// So: read the owner from teamInfo (no lock needed); use lockGranted to know if we acquired.
const { CloudPistonAPIManager } = require("../../lib/apiManager");
const { resolveServerPalByGuid } = require("./resolve");

// Default force-override gate for the CLI/MCP/agent typed-OVERRIDE path: Lock-Force against a
// team/PalBuilder lock is NOT yet trusted there — whether it actually breaks a teamMember lock is
// unverified for an *agent-initiated* override, and breaking a live PalBuilder checkout could
// destroy another user's unsaved work with no human in the loop to judge that risk. Stays false
// until verified. This is only the DEFAULT for acquireByGuid's `allowOverride` option — the GUI's
// own human-confirmed "Force Lock" checkbox (src/launcher/workspace.js's setup()) passes
// allowOverride: true explicitly for that one call, per David (2026-09-10): Lock-Force already
// exists in PalBuilder Java and a human should be able to use it after being alerted (e.g. a
// crashed PalBuilder session nobody's around to unlock), just never automatically or agent-driven.
const OVERRIDE_ENABLED = false;

function sameUser(email, username) {
    return !!(email && username && String(email).toLowerCase() === String(username).toLowerCase());
}

// Parse the team/PalBuilder lock out of a getPal response. teamInfo is present only when a
// team lock is held. Returns { lockType, since, ownerEmail, ownerName } or null.
function teamLockFrom(gp) {
    const ti = gp && gp.teamInfo && gp.teamInfo["com.contractpal.pal.TeamInfo"];
    if (!ti) return null;
    const p = ti.profile || {};
    return {
        lockType: ti.lockType,
        since: ti.lockDate && (ti.lockDate._text || ti.lockDate) || null,
        ownerEmail: p.email || null,
        ownerName: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.profileName || null
    };
}

// Read the real lock owner WITHOUT acquiring anything. getPal is read-only.
async function readTeamLock(session, palId) {
    return teamLockFrom(await CloudPistonAPIManager.getPal(session, palId));
}

function holderLabel(team) {
    return (team.ownerName ? team.ownerName : "(unknown)") + (team.ownerEmail ? " (" + team.ownerEmail + ")" : "");
}

// Acquire the Webstart lock for a pal by GUID. Detects a blocking team/PalBuilder lock first (read-only)
// and reports the real owner. force only ever attempts Lock-Force when OVERRIDE_ENABLED is true.
// opts.resolved skips the account walk when the caller already resolved the guid. The result
// carries `resolved` and the raw `getPalResp` so callers reuse them instead of re-fetching.
//
// Per David (2026-09-10): the intended session model is lock ONCE when a pal is opened, unlock
// ONCE when it's closed — no other lock/unlock requests during the session. So if this session
// already holds the Webstart lock (session.lockInfo.lockGranted), step 2 below skips LockPal.do
// (and its best-effort GetPlatformInfo.do follow-up) entirely and just confirms with the fresh
// GetPal.do read from step 1 — which still runs every call (it's a read, not a lock action, and
// callers like push() rely on its freshness for guard logic / drift detection).
// allowOverride defaults to the module-wide OVERRIDE_ENABLED gate (false — every existing caller,
// CLI/MCP/launcher, never passes this and is completely unaffected). The GUI's own force-checkout
// flow (a human explicitly confirming a "Force Lock" checkbox after seeing who holds it — see
// src/launcher/workspace.js's setup()) passes allowOverride: true to bypass the gate for just that
// one call, without touching whether the MCP/agent typed-OVERRIDE path (still unverified, per the
// comment above) can do the same. Scoped narrowly per David (2026-09-10): a human-initiated escape
// hatch for a stuck lock (e.g. PalBuilder crashed and the person who had it open is unreachable),
// never automatic, never agent-initiated.
async function acquireByGuid(session, guid, { force = false, resolved: pre = null, allowOverride = OVERRIDE_ENABLED } = {}) {
    let resolved = pre || await resolveServerPalByGuid(session, guid);
    if (!resolved) throw new Error("GUID " + guid + " not found on " + session.environment.url);
    const alreadyHeld = !force && !!(session.lockInfo && session.lockInfo.lockGranted === true);

    // 1) Team/PalBuilder lock? (read-only) — that blocks LockPal; we can name the real owner.
    let getPalResp = await CloudPistonAPIManager.getPal(session, resolved.id);
    // Self-healing: a caller-supplied `resolved` (e.g. a transient id persisted in .palsync.json
    // across sessions — per David, it's not time-stamped, so this is safe to do) can, in rare
    // cases, go stale. Detect that from THIS call's own response rather than trusting it blindly:
    // re-resolve for real and retry once before proceeding. A resolve this function did itself
    // (no `pre`) is never re-validated here — only a caller-supplied one gets this check.
    if (pre && !(getPalResp && getPalResp.success && getPalResp.pal)) {
        resolved = await resolveServerPalByGuid(session, guid);
        if (!resolved) throw new Error("GUID " + guid + " not found on " + session.environment.url);
        getPalResp = await CloudPistonAPIManager.getPal(session, resolved.id);
    }
    const team = teamLockFrom(getPalResp);
    if (team) {
        const mine = sameUser(team.ownerEmail, session.username);
        if (!force) {
            return { acquired: false, blocked: mine ? "gui-lock-self" : "gui-lock-other",
                     holder: holderLabel(team), holderEmail: team.ownerEmail, since: team.since, resolved };
        }
        if (!allowOverride) {
            // Override requested but not allowed for this caller. Refuse rather than silently
            // no-op or risk destroying PalBuilder work.
            return { acquired: false, blocked: "override-disabled",
                     holder: holderLabel(team), holderEmail: team.ownerEmail, since: team.since, resolved };
        }
        // force && allowOverride → fall through to Lock-Force
    }

    // 2) Webstart lock. Already holding it for this session → done, no re-grant request.
    if (alreadyHeld) {
        return { acquired: true, reclaimed: false, resolved, getPalResp };
    }
    // lockGranted (now parsed correctly) is the authoritative proceed signal.
    await CloudPistonAPIManager.lockPal(session, resolved.id, force);
    const granted = !!(session.lockInfo && session.lockInfo.lockGranted === true);
    if (granted) {
        try { await CloudPistonAPIManager.getPlatformInfo(session, resolved.id); } catch (e) { /* best-effort */ }
        return { acquired: true, reclaimed: force, resolved, getPalResp };
    }
    // Denied with no team lock + null owner → genuinely unknown holder.
    session.lockInfo = undefined;
    return { acquired: false, blocked: "unknown-holder", resolved };
}

// Release the lock we hold. Idempotent; never unlocks a lock we don't hold.
// opts.resolved (optional): skips the account walk when the caller already has a current
// resolve (e.g. lockLife.js reusing/refreshing the one from its last acquire).
async function releaseByGuid(session, guid, { resolved: pre = null } = {}) {
    if (!session.lockInfo) return { released: false, reason: "no lock held" };
    const resolved = pre || await resolveServerPalByGuid(session, guid);
    if (!resolved) throw new Error("GUID " + guid + " not found on " + session.environment.url);
    const resp = await CloudPistonAPIManager.unlockPal(session, resolved.id);
    session.lockInfo = undefined;
    return { released: true, serverSuccess: resp ? !!resp.success : undefined };
}

// Read-only status: who holds it, from teamInfo (no lock attempt). Falls back to our own
// in-session Webstart lock if we hold one. opts.resolved skips the account walk when the
// caller already resolved the guid.
async function statusByGuid(session, guid, { resolved: pre = null } = {}) {
    const resolved = pre || await resolveServerPalByGuid(session, guid);
    if (!resolved) throw new Error("GUID " + guid + " not found on " + session.environment.url);
    const team = await readTeamLock(session, resolved.id);
    if (team) {
        return { locked: true, kind: "gui", byUs: sameUser(team.ownerEmail, session.username),
                 holder: holderLabel(team), holderEmail: team.ownerEmail, since: team.since };
    }
    if (session.lockInfo && session.lockInfo.lockGranted === true) {
        return { locked: true, kind: "palsync", byUs: true, holder: "you (this palsync session)" };
    }
    return { locked: false };
}

module.exports = { acquireByGuid, releaseByGuid, statusByGuid, readTeamLock, teamLockFrom, sameUser, OVERRIDE_ENABLED };
