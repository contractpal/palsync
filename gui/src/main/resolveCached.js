"use strict";
// Cache-aware pal resolve, shared by every Chip main-process action that needs one (test
// workflow, tunnel, debug, workflow list). See resolvedPalCache.js for why the in-memory half
// of this exists.
const { resolveServerPalByGuid } = require("palsync/src/core/resolve");
const palsyncfile = require("palsync/src/core/palsyncfile");
const resolvedPalCache = require("./resolvedPalCache");

// Resolve once, then just reuse it — no GetGroupList/GetPalList call at all on a cache hit, let
// alone the full GetProfileList->GetGroupList->GetPalList account walk. Per David: those are
// only actually needed when OPENING a pal or CREATING one, not on every action against a pal
// already in use, and the transient id itself is NOT time-stamped/expiring — safe to persist
// and reuse across process restarts too, not just within one.
//
// Two tiers, cheapest first:
//   1. This process's in-memory cache (resolvedPalCache) — free.
//   2. .palsync.json's persisted `palId` (record.palId) — same field the MCP agent session
//      (src/mcp/context.js) reads/writes, so whichever side (Chip's ribbon, or the agent) opens
//      this pal first saves the walk for the other too.
//   3. The full account walk — only on a genuine miss (never resolved anywhere before).
// A stale persisted id isn't specially validated here (unlike core/lock.js's acquireByGuid,
// which self-heals) — a bad id just makes the one call that uses it come back empty/failing,
// which is rare and self-corrects the next time something re-resolves for real.
async function resolvePal(session, workspaceDir, guid) {
    const cached = resolvedPalCache.get(workspaceDir);
    if (cached) return cached;

    let record = null;
    try { record = await palsyncfile.read(workspaceDir); } catch (e) { /* best-effort */ }
    if (record && record.palId) {
        const fromDisk = { id: record.palId, guid: record.palGuid };
        resolvedPalCache.set(workspaceDir, fromDisk);
        return fromDisk;
    }

    const resolved = await resolveServerPalByGuid(session, guid);
    if (resolved) {
        resolvedPalCache.set(workspaceDir, resolved);
        if (record && resolved.id !== record.palId) {
            record.palId = resolved.id;
            try { await palsyncfile.write(workspaceDir, record); } catch (e) { /* best-effort */ }
        }
    }
    return resolved;
}

module.exports = { resolvePal };
