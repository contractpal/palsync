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

// Force-override (Lock-Force against a team/PalBuilder lock) is NOT yet trusted: whether Lock-Force
// actually breaks a teamMember lock is unverified, and breaking a live PalBuilder checkout could destroy
// another user's unsaved work. Stays false until verified on a throwaway PalBuilder-locked pal.
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
async function acquireByGuid(session, guid, { force = false, resolved: pre = null } = {}) {
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
        if (!OVERRIDE_ENABLED) {
            // Override requested (typed-OVERRIDE confirmed upstream) but the force path is not yet
            // verified/enabled. Refuse rather than silently no-op or risk destroying PalBuilder work.
            return { acquired: false, blocked: "override-disabled",
                     holder: holderLabel(team), holderEmail: team.ownerEmail, since: team.since, resolved };
        }
        // force && OVERRIDE_ENABLED → fall through to Lock-Force (post-verification only)
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
