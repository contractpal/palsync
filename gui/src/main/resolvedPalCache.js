"use strict";
// In-memory cache of each pal tab's last-resolved server identity (profileId/groupId/transient
// id), keyed by workspace folder. Session-lifetime only — cleared when Chip quits, never
// persisted (the transient id rotates/expires anyway, same reason palsync's own resolve.js
// never persists it).
//
// Exists because palsync's core resolveServerPalByGuid() enumerates the WHOLE account
// (GetProfileList -> GetGroupList x every profile -> GetPalList x every group) to find one pal
// by guid — fine once, very much not fine on every single Chip action against a pal (a debug
// fetch, a test-workflow click, a tunnel run), and actively bad once Auto-Refresh is fetching
// debug every 5-15s. A cached identity refreshes with ONE cheap GetPalList call
// (resolve.js's refreshResolvedPal) instead of the full walk — see resolveCached.js.
const cache = new Map();

function get(workspaceDir) { return cache.get(workspaceDir) || null; }
function set(workspaceDir, resolved) { if (resolved) cache.set(workspaceDir, resolved); }
function clear(workspaceDir) { cache.delete(workspaceDir); }

module.exports = { get, set, clear };
