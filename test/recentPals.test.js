"use strict";
// Recent-Pal history (src/platform/recentPals.js). The config module is mocked through the
// require cache — the same pattern test/loginBack.test.js uses — so nothing here can touch the
// real ~/.palsync/config.json.
const { test, afterEach } = require("node:test");
const assert = require("node:assert");

const configPath = require.resolve("../src/platform/config");
const recentPath = require.resolve("../src/platform/recentPals");

function loadStore({ initial = {}, failWrite = false, getThrows = false } = {}) {
    const state = { config: { ...initial }, writes: 0 };
    delete require.cache[recentPath];
    require.cache[configPath] = {
        id: configPath, filename: configPath, loaded: true,
        exports: {
            get(key, def) {
                if (getThrows) throw new Error("config unreadable");
                return state.config[key] !== undefined ? state.config[key] : def;
            },
            set(key, value) {
                state.writes++;
                if (failWrite) return false;
                state.config[key] = value;
                return true;
            }
        }
    };
    return { store: require(recentPath), state };
}

function entry(over = {}) {
    return {
        cloudUrl: "https://cloud.example", username: "dev@example.com", palGuid: "GUID-1",
        palName: "Audithelm-V1", workspaceDir: "/home/dev/projects/Audithelm-V1", agent: "pi",
        profileId: "P1", groupId: "GR1", profileName: "Profile", groupName: "Group",
        branch: "", palId: "ID-1", userId: "U-1", ...over
    };
}

afterEach(() => {
    delete require.cache[recentPath];
    delete require.cache[configPath];
});

test("missing or empty history is an empty list", () => {
    const { store } = loadStore();
    assert.deepEqual(store.list(), []);
    assert.deepEqual(store.ranked(store.list()), []);
});

test("a recorded launch is stored with count 1 and its timestamp", () => {
    const { store, state } = loadStore();
    const r = store.record(entry(), { now: "2026-09-18T10:00:00.000Z" });
    assert.equal(r.ok, true);
    const [stored] = store.list();
    assert.equal(stored.palName, "Audithelm-V1");
    assert.equal(stored.launchCount, 1);
    assert.equal(stored.lastLaunchedAt, "2026-09-18T10:00:00.000Z");
    assert.equal(stored.workspaceDir, "/home/dev/projects/Audithelm-V1");
    assert.equal(stored.agent, "pi");
    assert.equal(state.writes, 1);
});

test("re-recording the same pal bumps its count instead of duplicating it", () => {
    const { store } = loadStore();
    store.record(entry());
    store.record(entry());
    store.record(entry({ workspaceDir: "/mnt/projects/Audithelm-V1" }));
    const all = store.list();
    assert.equal(all.length, 1);
    assert.equal(all[0].launchCount, 3);
    assert.equal(all[0].workspaceDir, "/mnt/projects/Audithelm-V1"); // latest wins
});

test("identity is cloud + account + guid: same name in another account is a separate entry", () => {
    const { store } = loadStore();
    store.record(entry());
    store.record(entry({ username: "other@example.com", palGuid: "GUID-2", workspaceDir: "/home/other/Audithelm-V1" }));
    store.record(entry({ cloudUrl: "https://other.example", palGuid: "GUID-3" }));
    const all = store.list();
    assert.equal(all.length, 3);
    assert.equal(new Set(all.map(e => e.palName)).size, 1); // all named Audithelm-V1
    assert.equal(new Set(all.map(e => e.cloudUrl + "|" + e.username + "|" + e.palGuid)).size, 3);
});

test("history is bounded to 20 entries", () => {
    const { store } = loadStore();
    for (let i = 0; i < 40; i++) {
        store.record(entry({ palGuid: "GUID-" + i, palName: "Pal-" + i }), { now: "2026-09-18T10:00:" + String(i).padStart(2, "0") + ".000Z" });
    }
    const all = store.list();
    assert.equal(all.length, 20);
    assert.equal(all[0].palGuid, "GUID-39"); // newest first
    assert.ok(!all.some(e => e.palGuid === "GUID-0"));
});

test("ranking: most recently opened first, then usage count, ties by recency", () => {
    const { store } = loadStore({
        initial: {
            recentPals: [
                entry({ palGuid: "A", palName: "Frequent", launchCount: 9, lastLaunchedAt: "2026-09-01T00:00:00.000Z" }),
                entry({ palGuid: "B", palName: "Current", launchCount: 1, lastLaunchedAt: "2026-09-18T00:00:00.000Z" }),
                entry({ palGuid: "C", palName: "Tie-older", launchCount: 4, lastLaunchedAt: "2026-09-02T00:00:00.000Z" }),
                entry({ palGuid: "D", palName: "Tie-newer", launchCount: 4, lastLaunchedAt: "2026-09-03T00:00:00.000Z" }),
                entry({ palGuid: "E", palName: "Rare", launchCount: 1, lastLaunchedAt: "2026-09-04T00:00:00.000Z" })
            ]
        }
    });
    assert.deepEqual(store.ranked(store.list()).map(e => e.palName),
        ["Current", "Frequent", "Tie-newer", "Tie-older", "Rare"]);
});

test("the menu shows at most five pals", () => {
    const { store } = loadStore();
    for (let i = 0; i < 9; i++) store.record(entry({ palGuid: "G" + i, palName: "Pal" + i }));
    assert.equal(store.ranked(store.list()).length, 5);
    assert.equal(store.ranked(store.list(), 2).length, 2);
});

test("duplicate rows in a hand-edited file collapse into one, keeping the summed count", () => {
    const { store } = loadStore({
        initial: {
            recentPals: [
                entry({ launchCount: 2, workspaceDir: "/old" }),
                entry({ launchCount: 3, workspaceDir: "/new", lastLaunchedAt: "2026-09-18T00:00:00.000Z" })
            ]
        }
    });
    const all = store.list();
    assert.equal(all.length, 1);
    assert.equal(all[0].launchCount, 5);
    assert.equal(all[0].workspaceDir, "/new");
});

test("malformed history and malformed entries fall back safely", () => {
    const broken = loadStore({ initial: { recentPals: "not-a-list" } });
    assert.deepEqual(broken.store.list(), []);

    const partial = loadStore({
        initial: {
            recentPals: [
                null,
                "junk",
                { username: "no-cloud@example.com", palGuid: "G" },   // no cloudUrl
                { cloudUrl: "https://c", palGuid: "G" },               // no account
                { cloudUrl: "https://c", username: "u@example.com" },  // no guid
                entry({ palGuid: "KEEP" })
            ]
        }
    });
    const kept = partial.store.list();
    assert.equal(kept.length, 1);
    assert.equal(kept[0].palGuid, "KEEP");
    assert.equal(kept[0].launchCount, 1); // missing count reads as one launch
});

test("an unreadable config never throws — history just comes back empty", () => {
    const { store } = loadStore({ getThrows: true });
    assert.deepEqual(store.list(), []);
});

test("a failed write is reported, never thrown", () => {
    const { store } = loadStore({ failWrite: true });
    const r = store.record(entry());
    assert.equal(r.ok, false);
    assert.match(r.error, /could not write/);
    const s = store.setWorkspaceDir(entry(), "/tmp/x");
    assert.equal(s.ok, false);
    // forgetting an entry that was never stored is a no-op, not a failure
    assert.deepEqual(store.forget(entry()), { ok: true, removed: false });
});

test("an incomplete entry is refused rather than stored", () => {
    const { store, state } = loadStore();
    const r = store.record({ username: "u@example.com", palGuid: "G" });
    assert.equal(r.ok, false);
    assert.equal(state.writes, 0);
});

test("nothing secret is ever written: unknown fields are dropped, passwords never stored", () => {
    const { store, state } = loadStore();
    store.record(entry({ password: "hunter2", sessionAuthToken: "tok", session: { password: "x" } }));
    const raw = JSON.stringify(state.config.recentPals);
    assert.ok(!/hunter2|sessionAuthToken|"session"|"token"/.test(raw), raw);
    assert.deepEqual(Object.keys(state.config.recentPals[0]).sort(), [
        "agent", "cloudUrl", "groupId", "groupName", "lastLaunchedAt", "launchCount",
        "palGuid", "palId", "palName", "profileId", "profileName", "userId", "username", "workspaceDir"
    ]);
});

test("setWorkspaceDir changes the remembered folder without counting a launch", () => {
    const { store } = loadStore();
    store.record(entry(), { now: "2026-09-18T10:00:00.000Z" });
    const r = store.setWorkspaceDir(entry(), "/home/dev/pals/Audithelm-V1");
    assert.equal(r.ok, true);
    const [stored] = store.list();
    assert.equal(stored.workspaceDir, "/home/dev/pals/Audithelm-V1");
    assert.equal(stored.launchCount, 1);
    assert.equal(stored.lastLaunchedAt, "2026-09-18T10:00:00.000Z");
});

test("forget drops exactly the matching entry", () => {
    const { store } = loadStore();
    store.record(entry({ palGuid: "A", palName: "A" }));
    store.record(entry({ palGuid: "B", palName: "B" }));
    const r = store.forget(entry({ palGuid: "A" }));
    assert.equal(r.ok, true);
    assert.deepEqual(store.list().map(e => e.palGuid), ["B"]);
    assert.equal(store.forget(entry({ palGuid: "ZZZ" })).removed, false);
});

test("unrelated config preferences survive a history write", () => {
    const { store, state } = loadStore({ initial: { verification: "thorough", customClouds: [{ name: "x", url: "https://x" }] } });
    store.record(entry());
    assert.equal(state.config.verification, "thorough");
    assert.deepEqual(state.config.customClouds, [{ name: "x", url: "https://x" }]);
});
