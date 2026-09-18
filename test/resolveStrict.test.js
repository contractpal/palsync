"use strict";
// src/core/resolve.js must tell three server outcomes apart, because the recent-Pal launcher
// deletes a history row on exactly one of them:
//   present  — the walk found the guid
//   absent   — a COMPLETE walk did not contain the guid
//   unknown  — HTTP/auth failure, network error, or an unreadable/partial answer
// The trap being pinned here: CloudPistonAPIManager.fetchAPI() returns `undefined` for an HTTP
// failure without throwing, so a 401/500 used to read as "the account has no pals".
const { test, afterEach } = require("node:test");
const assert = require("node:assert");

const API = require.resolve("../lib/apiManager");
const RESOLVE = require.resolve("../src/core/resolve");

const PROFILES = { profileList: { "com.contractpal.pal.ProfileInfo": [{ profileId: "P1", profileName: "Profile" }] } };
const GROUPS = { groupList: { "com.contractpal.pal.GroupInfo": [{ groupId: "GR1", name: "Group" }] } };
const pals = (...list) => ({ palInfoList: { PalInfoEx: list } });
const PAL = { id: "ID-1", guid: "GUID-1", name: "Audithelm-V1", branchName: "", lastModifiedDate: "2026-09-18 10:00:00.0" };

const saved = [];
afterEach(() => {
    while (saved.length) {
        const [file, cached] = saved.pop();
        if (cached) require.cache[file] = cached; else delete require.cache[file];
    }
});

// Load resolve.js against a fake API manager. `behavior` answers each endpoint; a function may
// throw (network error) or return undefined (what fetchAPI does on an HTTP failure), and may set
// session.lastTransport exactly as fetchAPI does.
function load(behavior) {
    saved.push([API, require.cache[API]]);
    saved.push([RESOLVE, require.cache[RESOLVE]]);
    const manager = {
        getProfileList: behavior.getProfileList || (async () => PROFILES),
        getGroupList: behavior.getGroupList || (async () => GROUPS),
        getPalList: behavior.getPalList || (async () => pals(PAL))
    };
    require.cache[API] = { id: API, filename: API, loaded: true, exports: { CloudPistonAPIManager: manager } };
    delete require.cache[RESOLVE];
    return require(RESOLVE);
}

// What fetchAPI does on a failed request: record the transport, return undefined, never throw.
function httpFailure(status) {
    return async (session) => {
        session.lastTransport = { endpoint: "GetPalList.do", status, ok: false, bytes: null };
        return undefined;
    };
}

function ok(session, endpoint, value) {
    session.lastTransport = { endpoint, status: 200, ok: true, bytes: 10 };
    return value;
}

function newSession() {
    return { username: "dev@example.com", userId: "U-1", environment: { url: "https://cloud.example" } };
}

for (const status of [401, 500]) {
    test("HTTP " + status + " returning undefined is UNKNOWN, never a missing pal", async () => {
        const resolve = load({ getProfileList: httpFailure(status), getPalList: httpFailure(status) });
        const session = newSession();
        await assert.rejects(() => resolve.resolveServerPalByGuid(session, "GUID-1", { strict: true }),
            e => e.lookupIncomplete === true && new RegExp("HTTP " + status).test(e.message));
        const scoped = newSession();
        await assert.rejects(() => resolve.refreshResolvedPal(scoped,
            { guid: "GUID-1", profileId: "P1", groupId: "GR1" }, { rethrow: true }),
            e => e.lookupIncomplete === true);
    });
}

test("a network exception still propagates under strict", async () => {
    const resolve = load({ getProfileList: async () => { throw new Error("getaddrinfo ENOTFOUND cloud.example"); } });
    await assert.rejects(() => resolve.resolveServerPalByGuid(newSession(), "GUID-1", { strict: true }),
        /ENOTFOUND/);
});

test("a malformed or empty 200 is UNKNOWN, not confirmed absence", async () => {
    // (a) a 200 whose body could not be parsed into a result object
    const unreadable = load({ getProfileList: async (s) => ok(s, "GetProfileList.do", "<html>maintenance</html>") });
    await assert.rejects(() => unreadable.resolveServerPalByGuid(newSession(), "GUID-1", { strict: true }),
        e => e.lookupIncomplete === true && /unreadable/.test(e.message));
    // (b) an empty 200 (fetchAPI maps a zero-length body to undefined too)
    const empty = load({ getProfileList: async (s) => ok(s, "GetProfileList.do", undefined) });
    await assert.rejects(() => empty.resolveServerPalByGuid(newSession(), "GUID-1", { strict: true }),
        e => e.lookupIncomplete === true && /no response/.test(e.message));
    // (c) a well-formed answer with no profiles at all: an authenticated account always has one,
    //     so this is a partial answer, not proof that the pal is gone
    const noProfiles = load({ getProfileList: async (s) => ok(s, "GetProfileList.do", { profileList: {} }) });
    await assert.rejects(() => noProfiles.resolveServerPalByGuid(newSession(), "GUID-1", { strict: true }),
        e => e.lookupIncomplete === true && /empty/.test(e.message));
    // (d) a group list that fails mid-walk does not turn into "not found" either
    const partial = load({ getGroupList: httpFailure(503) });
    await assert.rejects(() => partial.resolveServerPalByGuid(newSession(), "GUID-1", { strict: true }),
        e => e.lookupIncomplete === true && /HTTP 503/.test(e.message));
});

test("a successful response containing the guid resolves it", async () => {
    const resolve = load({});
    const found = await resolve.resolveServerPalByGuid(newSession(), "GUID-1", { strict: true });
    assert.equal(found.guid, "GUID-1");
    assert.equal(found.profileId, "P1");
    assert.equal(found.groupId, "GR1");
    const scoped = await resolve.refreshResolvedPal(newSession(),
        { guid: "GUID-1", profileId: "P1", groupId: "GR1" }, { rethrow: true });
    assert.equal(scoped.guid, "GUID-1");
});

test("a complete walk that does not contain the guid is CONFIRMED ABSENT (null)", async () => {
    const resolve = load({ getPalList: async (s) => ok(s, "GetPalList.do", pals({ ...PAL, guid: "OTHER" })) });
    assert.equal(await resolve.resolveServerPalByGuid(newSession(), "GUID-1", { strict: true }), null);
    // and a group that genuinely holds no pals is still a complete answer
    const none = load({ getPalList: async (s) => ok(s, "GetPalList.do", { palInfoList: {} }) });
    assert.equal(await none.resolveServerPalByGuid(newSession(), "GUID-1", { strict: true }), null);
});

test("non-strict callers keep the old swallow-and-continue contract", async () => {
    const resolve = load({ getProfileList: httpFailure(500) });
    assert.equal(await resolve.resolveServerPalByGuid(newSession(), "GUID-1"), null);
    const scoped = load({ getPalList: httpFailure(500) });
    assert.equal(await scoped.refreshResolvedPal(newSession(), { guid: "GUID-1", profileId: "P1", groupId: "GR1" }), null);
});
