"use strict";
// Resolve a pal's CURRENT server lock id + drift marker from its stable GUID, by
// enumerating getProfileList -> getGroupList -> getPalList. The 64-hex id rotates per
// enumeration (never cache it); the guid is stable. lastModifiedDate (PalInfoEx) is the
// confirmed drift marker — it advances only on a real server save. Factored out of the
// proven palpush --guid resolver; reuses the unchanged apiManager.
const { CloudPistonAPIManager } = require("../../lib/apiManager");

// CloudPiston sql-timestamp nodes parse as { _text, _class }. Pull the text out.
function timestampText(node) {
    if (node == null) return null;
    if (typeof node === "string") return node;
    if (typeof node === "object" && node._text !== undefined) return String(node._text);
    return String(node);
}

// Normalize a PalInfoEx + its profile/group context into palsync's pal shape.
function shapePal(p, profile, group) {
    return {
        id: p.id,                                  // transient — used now for getPal/lock, never persisted
        guid: p.guid,                              // stable — persisted in .palsync.json
        name: p.name,
        description: p.description,
        branch: p.branchName || "",
        lastModifiedDate: timestampText(p.lastModifiedDate),  // drift marker
        profileId: profile.profileId,
        profileName: profile.profileName,
        groupId: group.groupId,
        groupName: group.name
    };
}

// Enumerate EVERY server pal once (profile -> group -> pal), shaped. Optional name filters
// (case-insensitive substring) on profile/group narrow the walk — used to disambiguate a
// by-name lookup on a big account. The shared walk behind both resolvers.
async function enumerateServerPals(session, { profile: profileFilter, group: groupFilter } = {}) {
    const out = [];
    const profileResp = await CloudPistonAPIManager.getProfileList(session);
    const profiles = (profileResp && profileResp.profileList && profileResp.profileList["com.contractpal.pal.ProfileInfo"]) || [];
    for (const profile of profiles) {
        if (profileFilter && !new RegExp(profileFilter, "i").test(profile.profileName || "")) continue;
        const groupResp = await CloudPistonAPIManager.getGroupList(session, profile.profileId);
        const groups = (groupResp && groupResp.groupList && groupResp.groupList["com.contractpal.pal.GroupInfo"]) || [];
        for (const group of groups) {
            if (groupFilter && !new RegExp(groupFilter, "i").test(group.name || "")) continue;
            const palResp = await CloudPistonAPIManager.getPalList(session, profile.profileId, group.groupId, { includeTest: true, includeInstalled: true });
            const pals = (palResp && palResp.palInfoList && palResp.palInfoList.PalInfoEx) || [];
            for (const p of pals) out.push(shapePal(p, profile, group));
        }
    }
    return out;
}

async function resolveServerPalByGuid(session, guid) {
    const all = await enumerateServerPals(session);
    return all.find(p => p.guid === guid) || null;
}

// Cheap re-resolve from a previously-resolved pal: ONE getPalList scoped to its profile/group
// instead of the full account walk. Returns the freshly-shaped pal (new transient id + current
// lastModifiedDate) or null — e.g. if the pal moved groups — and the caller falls back to the
// full resolveServerPalByGuid.
async function refreshResolvedPal(session, resolved) {
    if (!resolved || resolved.profileId == null || resolved.groupId == null) return null;
    try {
        const palResp = await CloudPistonAPIManager.getPalList(session, resolved.profileId, resolved.groupId, { includeTest: true, includeInstalled: true });
        const pals = (palResp && palResp.palInfoList && palResp.palInfoList.PalInfoEx) || [];
        const p = pals.find(x => x.guid === resolved.guid);
        if (!p) return null;
        return shapePal(p, { profileId: resolved.profileId, profileName: resolved.profileName },
                           { groupId: resolved.groupId, name: resolved.groupName });
    } catch (e) { return null; }
}

// Resolve a pal BY NAME (the "don't hardcode GUIDs" path). Returns { resolved, candidates }:
//   - exactly one match  → resolved is it, candidates: [it]
//   - none               → resolved null, candidates [] (caller errors with suggestions)
//   - multiple           → resolved null, candidates lists them (caller errors: ambiguous)
// Exact (case-sensitive) name wins; if none, falls back to case-insensitive equality. Optional
// profile/group filters disambiguate. Never throws — the CLI shapes the message.
async function resolveServerPalByName(session, name, { profile, group } = {}) {
    const all = await enumerateServerPals(session, { profile, group });
    let matches = all.filter(p => p.name === name);
    if (!matches.length) matches = all.filter(p => String(p.name).toLowerCase() === String(name).toLowerCase());
    return { resolved: matches.length === 1 ? matches[0] : null, candidates: matches, all };
}

module.exports = { resolveServerPalByGuid, resolveServerPalByName, refreshResolvedPal, enumerateServerPals, timestampText, shapePal };
