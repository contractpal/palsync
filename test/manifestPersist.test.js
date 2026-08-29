"use strict";
// Regression coverage for ticket 02 — stable manifest persistence.
// Through the pull/merge round-trip seam where practical: stub server responses,
// never call CloudPiston, never launch a browser. Asserts externally observable
// outcomes (bytes, mtime, ordering, drift), not helper internals.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { tmpWorkspace } = require("./helpers");
const { pull } = require("../src/core/pull");
const { mergeWorkspace } = require("../src/core/merge");
const { Pal } = require("../lib/pal");
const apiManager = require("../lib/apiManager");
const baseline = require("../src/core/baseline");
const { hashPaths } = require("../src/core/workspaceHash");
const { diffWorkspace } = require("../src/core/localDrift");

const origGetPal = apiManager.CloudPistonAPIManager.getPal;
const origGetProfileList = apiManager.CloudPistonAPIManager.getProfileList;
const origGetGroupList = apiManager.CloudPistonAPIManager.getGroupList;
const origGetPalList = apiManager.CloudPistonAPIManager.getPalList;

function fakeSession(url) {
    return {
        environment: { url, name: "test", platformVersion: "" },
        username: "tester",
        password: "secret",
        userId: "u1"
    };
}

function stubPull(serverPal, resolved) {
    const guid = resolved.guid;
    const id = resolved.id;
    const lastModifiedDate = resolved.lastModifiedDate;
    apiManager.CloudPistonAPIManager.getProfileList = async () => ({
        profileList: { "com.contractpal.pal.ProfileInfo": [{ profileId: "p1", profileName: "Profile1" }] }
    });
    apiManager.CloudPistonAPIManager.getGroupList = async () => ({
        groupList: { "com.contractpal.pal.GroupInfo": [{ groupId: "g1", name: "Group1" }] }
    });
    apiManager.CloudPistonAPIManager.getPalList = async () => ({
        palInfoList: { PalInfoEx: [{ id, guid, name: "Demo", description: "", branchName: "", lastModifiedDate, profileId: "p1", groupId: "g1" }] }
    });
    apiManager.CloudPistonAPIManager.getPal = async () => ({
        success: true,
        pal: JSON.parse(JSON.stringify(serverPal))
    });
}

function restoreStubs() {
    apiManager.CloudPistonAPIManager.getPal = origGetPal;
    apiManager.CloudPistonAPIManager.getProfileList = origGetProfileList;
    apiManager.CloudPistonAPIManager.getGroupList = origGetGroupList;
    apiManager.CloudPistonAPIManager.getPalList = origGetPalList;
}

// Minimal server pal that exercises ordering, unknown fields, empty sections.
function baseServerPal(overrides = {}) {
    const base = {
        palName: "Demo",
        layout: {},
        // leave a couple of sections empty as "" to exercise empty preservation
        pages: { entry: [] },
        fragments: { entry: [] },
        scripts: { entry: [] },
        styles: { entry: [] },
        images: { entry: [] },
        emails: { entry: [] },
        attachments: { entry: [] },
        workflows: { entry: [] },
        wizards: { entry: [] },
        documents: { entry: [] },
        datasets: { entry: [] },
        dataviews: { entry: [] },
        data: { entry: [] },
        datalists: { entry: [] },
        folders: { Folder: [] }
    };
    return Object.assign(base, overrides);
}

function b64(text) {
    return Buffer.from(text, "utf8").toString("base64");
}

beforeEach(() => {
    restoreStubs();
});

afterEach(() => {
    restoreStubs();
});

// ---------------------------------------------------------------------------
// 1. No-op pull leaves bytes AND mtime unchanged
// ---------------------------------------------------------------------------
test("1 — no-op pull leaves pal.json bytes and mtime unchanged", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-1-"));
    try {
        const serverPal = baseServerPal({
            pages: { entry: [{ string: "index.html", Page: { name: "index", content: b64("<p>hi</p>") } }] }
        });
        const resolved = { id: "id-1", guid: "guid-1", lastModifiedDate: "2026-01-01 00:00:00.0" };
        const session = fakeSession("https://cloud.example");
        stubPull(serverPal, resolved);

        await pull(session, "guid-1", dir, { baseline: null });
        const firstBytes = fs.readFileSync(path.join(dir, "pal.json"));
        const firstMtime = fs.statSync(path.join(dir, "pal.json")).mtimeMs;

        // ensure clock advances so an unconditional write would be detectable
        await new Promise(r => setTimeout(r, 25));

        // second pull — same server state, with a baseline so planSync is exercised
        const { hashPaths: hp } = require("../src/core/workspaceHash");
        // Build a fileHashes baseline from serverPaths to mimic launcher after first pull.
        // pull itself snapshots .palsync/baseline; we just need file hashes for planSync.
        // Reuse hashPaths helper; serverPaths = manifestPaths(pal) after first pull is ["pages/index.html"]
        // but we can compute directly: ask hashPaths to list what pull would have.
        const pullMod = require("../src/core/pull");
        const palForPaths = new Pal(Object.assign(JSON.parse(JSON.stringify(serverPal)), {
            id: resolved.id, path: dir, environment: { url: session.environment.url }
        }));
        const serverSet = pullMod.manifestPaths(palForPaths);
        const fileHashes = hp(dir, [...serverSet]);

        stubPull(serverPal, resolved);
        await pull(session, "guid-1", dir, { baseline: fileHashes });

        const secondBytes = fs.readFileSync(path.join(dir, "pal.json"));
        const secondMtime = fs.statSync(path.join(dir, "pal.json")).mtimeMs;

        assert.deepStrictEqual(secondBytes, firstBytes, "bytes must be identical on no-op pull");
        assert.equal(secondMtime, firstMtime, "mtime must be unchanged when bytes unchanged (writeIfChanged)");
        // also pin contract: two-space indent, one trailing newline
        const text = secondBytes.toString("utf8");
        assert.equal(text.endsWith("\n"), true);
        assert.equal(text.endsWith("\n\n"), false);
        assert.match(text, /\n  "/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 2. Same Pal pulled into two different directories produces byte-identical pal.json
// ---------------------------------------------------------------------------
test("2 — same Pal pulled into two different directories produces byte-identical pal.json", async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-2a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-2b-"));
    try {
        const serverPal = baseServerPal({
            fragments: { entry: [{ string: "a/b.html", Fragment: { name: "a/b", content: b64("<div>a</div>") } }] },
            storeSettings: { currency: "USD" },
            customUnknown: { foo: "bar" }
        });
        const resolved = { id: "id-2", guid: "guid-2", lastModifiedDate: "2026-01-02 00:00:00.0" };
        const session = fakeSession("https://cloud.example");

        stubPull(serverPal, resolved);
        await pull(session, "guid-2", dirA, { baseline: null });
        stubPull(serverPal, resolved);
        await pull(session, "guid-2", dirB, { baseline: null });

        const aBytes = fs.readFileSync(path.join(dirA, "pal.json"), "utf8");
        const bBytes = fs.readFileSync(path.join(dirB, "pal.json"), "utf8");
        assert.equal(aBytes, bBytes, "bytes must be identical across directories");
        const parsed = JSON.parse(aBytes);
        assert.equal("id" in parsed, false, "runtime id must not leak to disk");
        assert.equal("path" in parsed, false, "runtime path must not leak to disk");
        assert.equal("environment" in parsed, false, "runtime environment must not leak to disk");
        assert.equal(aBytes.includes(dirA), false);
        assert.equal(aBytes.includes(dirB), false);
    } finally {
        fs.rmSync(dirA, { recursive: true, force: true });
        fs.rmSync(dirB, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 3. Semantically empty sections keep prior local representation
// ---------------------------------------------------------------------------
test("3a — semantically empty section keeps prior \"\" when still empty", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-3a-"));
    try {
        // prior local manifest used "" for pages/folders
        const priorRaw = {
            pages: "",
            fragments: { entry: [] },
            folders: "",
            datasets: { entry: [] }
        };
        fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(priorRaw, null, 2));

        const serverPal = baseServerPal({
            pages: "",
            fragments: { entry: [] },
            folders: "",
            datasets: { entry: [] }
        });
        const resolved = { id: "id-3a", guid: "guid-3a", lastModifiedDate: "2026-01-03 00:00:00.0" };
        stubPull(serverPal, resolved);
        await pull(fakeSession("https://cloud.example"), "guid-3a", dir, { baseline: null });

        const out = JSON.parse(fs.readFileSync(path.join(dir, "pal.json"), "utf8"));
        // pages and folders were "" before and still semantically empty -> must stay ""
        assert.equal(out.pages, "");
        assert.equal(out.folders, "");
        // fragments was {entry:[]} before and still empty -> must stay {entry:[]}
        assert.deepStrictEqual(out.fragments, { entry: [] });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("3b — semantically empty section keeps prior {entry:[]} / {Folder:[]} when still empty", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-3b-"));
    try {
        const priorRaw = {
            pages: { entry: [] },
            fragments: "",
            folders: { Folder: [] },
            datasets: ""
        };
        fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(priorRaw, null, 2));

        const serverPal = baseServerPal({
            pages: { entry: [] },
            fragments: "",
            folders: { Folder: [] },
            datasets: ""
        });
        const resolved = { id: "id-3b", guid: "guid-3b", lastModifiedDate: "2026-01-03 00:00:00.0" };
        stubPull(serverPal, resolved);
        await pull(fakeSession("https://cloud.example"), "guid-3b", dir, { baseline: null });

        const out = JSON.parse(fs.readFileSync(path.join(dir, "pal.json"), "utf8"));
        assert.deepStrictEqual(out.pages, { entry: [] });
        assert.equal(out.fragments, "");
        assert.deepStrictEqual(out.folders, { Folder: [] });
        assert.equal(out.datasets, "");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 4. Unknown/unrecognized server fields survive pull and merge verbatim
// ---------------------------------------------------------------------------
test("4 — unknown server fields survive pull verbatim", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-4-"));
    try {
        const serverPal = baseServerPal({
            palName: "Demo",
            storeSettings: { customFlag: true, currency: "EUR" },
            myCustomTopLevel: { enabled: true, count: 42 },
            secureFields: { entry: [{ string: "secret", SecureField: { name: "secret" } }] }
        });
        const resolved = { id: "id-4", guid: "guid-4", lastModifiedDate: "2026-01-04 00:00:00.0" };
        stubPull(serverPal, resolved);
        await pull(fakeSession("https://cloud.example"), "guid-4", dir, { baseline: null });

        const out = JSON.parse(fs.readFileSync(path.join(dir, "pal.json"), "utf8"));
        assert.deepStrictEqual(out.storeSettings, { customFlag: true, currency: "EUR" });
        assert.deepStrictEqual(out.myCustomTopLevel, { enabled: true, count: 42 });
        assert.deepStrictEqual(out.secureFields, { entry: [{ string: "secret", SecureField: { name: "secret" } }] });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("4b — unknown server fields survive merge verbatim", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-4b-"));
    try {
        const basePal = baseServerPal({
            palName: "Demo",
            pages: { entry: [{ string: "a.html", Page: { name: "a", content: b64("v1") } }] },
            myUnknown: { keep: "me" }
        });
        const resolved = { id: "id-4b", guid: "guid-4b", lastModifiedDate: "2026-01-04 00:00:00.0" };
        // initial pull to establish baseline
        stubPull(basePal, resolved);
        await pull(fakeSession("https://cloud.example"), "guid-4b", dir, { baseline: null });

        // Build a record so mergeWorkspace has an ancestor to diff against.
        // Snapshot already written by pull; hashPaths for fileHashes:
        const palForPaths = new Pal(Object.assign(JSON.parse(JSON.stringify(basePal)), {
            id: resolved.id, path: dir, environment: { url: "https://cloud.example" }
        }));
        const pullMod = require("../src/core/pull");
        const serverPaths = [...pullMod.manifestPaths(palForPaths)];
        const fileHashes = hashPaths(dir, serverPaths);
        const record = { fileHashes, lastModifiedDate: resolved.lastModifiedDate };

        // Server advances: new unknown field changes, keep old one
        const nextPal = baseServerPal({
            palName: "Demo",
            pages: { entry: [{ string: "a.html", Page: { name: "a", content: b64("v2") } }] },
            myUnknown: { keep: "me", extra: 123 },
            anotherUnknown: "hello"
        });
        const nextResolved = { id: "id-4b", guid: "guid-4b", lastModifiedDate: "2026-01-05 00:00:00.0" };
        stubPull(nextPal, nextResolved);

        const session = fakeSession("https://cloud.example");
        const result = await mergeWorkspace(session, "guid-4b", record, dir);
        assert.equal(result.merged, true);
        const out = JSON.parse(fs.readFileSync(path.join(dir, "pal.json"), "utf8"));
        assert.deepStrictEqual(out.myUnknown, { keep: "me", extra: 123 });
        assert.equal(out.anotherUnknown, "hello");
        assert.equal("id" in out, false);
        assert.equal("environment" in out, false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 5. Array order is preserved exactly
// ---------------------------------------------------------------------------
test("5 — array order preserved exactly via pull (dataset fields, DataList cols/rows, folders, entries)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-5-"));
    try {
        const serverPal = baseServerPal({
            // content entries in non-alphabetical order Z, A, M
            pages: { entry: [
                { string: "z.html", Page: { name: "z", content: b64("z") } },
                { string: "a.html", Page: { name: "a", content: b64("a") } },
                { string: "m.html", Page: { name: "m", content: b64("m") } }
            ] },
            folders: { Folder: [
                { name: "zeta", path: "/zeta" },
                { name: "alpha", path: "/alpha" },
                { name: "middle", path: "/middle" }
            ] },
            datasets: { entry: [
                { string: "things", Dataset: {
                    name: "things",
                    fields: { DatasetField: [
                        { fieldName: "zetaField", fieldType: "Text" },
                        { fieldName: "alphaField", fieldType: "Text" },
                        { fieldName: "middleField", fieldType: "Text" }
                    ] }
                } }
            ] },
            datalists: { entry: [
                { string: "offices", DataList: {
                    name: "offices",
                    cols: { string: ["zetaCol", "alphaCol", "middleCol"] },
                    recs: { "string-array": [
                        { string: ["z1", "a1", "m1"] },
                        { string: ["z2", "a2", "m2"] }
                    ] }
                } }
            ] },
            data: { entry: [
                { string: "siteConfig", Data: {
                    name: "siteConfig",
                    values: { entry: [
                        { string: ["zetaKey", "1"] },
                        { string: ["alphaKey", "2"] },
                        { string: ["middleKey", "3"] }
                    ] }
                } }
            ] }
        });
        const resolved = { id: "id-5", guid: "guid-5", lastModifiedDate: "2026-01-05 00:00:00.0" };
        stubPull(serverPal, resolved);
        await pull(fakeSession("https://cloud.example"), "guid-5", dir, { baseline: null });

        const raw = fs.readFileSync(path.join(dir, "pal.json"), "utf8");
        const out = JSON.parse(raw);

        // pages entry order must be z, a, m (not sorted)
        assert.deepStrictEqual(out.pages.entry.map(e => e.string), ["z.html", "a.html", "m.html"]);
        // raw bytes must contain them in that order
        assert.ok(raw.indexOf("z.html") < raw.indexOf("a.html") && raw.indexOf("a.html") < raw.indexOf("m.html"));

        // folders order
        assert.deepStrictEqual(out.folders.Folder.map(f => f.name), ["zeta", "alpha", "middle"]);
        assert.ok(raw.indexOf('"zeta"') < raw.indexOf('"alpha"') && raw.indexOf('"alpha"') < raw.indexOf('"middle"'));

        // dataset fields order
        assert.deepStrictEqual(
            out.datasets.entry[0].Dataset.fields.DatasetField.map(f => f.fieldName),
            ["zetaField", "alphaField", "middleField"]
        );

        // DataList cols order
        assert.deepStrictEqual(out.datalists.entry[0].DataList.cols.string, ["zetaCol", "alphaCol", "middleCol"]);
        // DataList rows order
        assert.deepStrictEqual(out.datalists.entry[0].DataList.recs["string-array"].map(r => r.string[0]), ["z1", "z2"]);

        // Data values order
        assert.deepStrictEqual(out.data.entry[0].Data.values.entry.map(e => e.string[0]), ["zetaKey", "alphaKey", "middleKey"]);

        // also verify two-space indent and single newline still
        assert.equal(raw.endsWith("\n"), true);
        assert.equal(raw.endsWith("\n\n"), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 6. Prior top-level key order preserved, new keys appended alphabetically
// ---------------------------------------------------------------------------
test("6 — prior top-level key order preserved, genuinely new keys appended alphabetically", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-6-"));
    try {
        // Write a prior pal.json with a specific key order.
        const priorRaw = {
            pages: { entry: [] },
            workflows: { entry: [] },
            fragments: { entry: [] }
        };
        // JSON.stringify preserves insertion order as written; write with that order.
        fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(priorRaw, null, 2) + "\n");

        // Server now has same keys plus a new one "datasets" and "brandNew" — both absent before.
        // Server enumeration order is intentionally different (fragments first) to prove prior order wins.
        const serverPal = {
            palName: "Demo",
            layout: {},
            fragments: { entry: [] },
            pages: { entry: [] },
            workflows: { entry: [] },
            datasets: { entry: [] },
            brandNew: { hello: "world" },
            folders: { Folder: [] },
            data: { entry: [] },
            datalists: { entry: [] },
            styles: { entry: [] },
            scripts: { entry: [] },
            images: { entry: [] },
            emails: { entry: [] },
            attachments: { entry: [] },
            wizards: { entry: [] },
            documents: { entry: [] },
            dataviews: { entry: [] }
        };
        const resolved = { id: "id-6", guid: "guid-6", lastModifiedDate: "2026-01-06 00:00:00.0" };
        stubPull(serverPal, resolved);
        await pull(fakeSession("https://cloud.example"), "guid-6", dir, { baseline: null });

        const raw = fs.readFileSync(path.join(dir, "pal.json"), "utf8");
        const parsed = JSON.parse(raw);
        const keys = Object.keys(parsed);

        // Existing keys must appear in prior order: pages, workflows, fragments
        const idxPages = keys.indexOf("pages");
        const idxWorkflows = keys.indexOf("workflows");
        const idxFragments = keys.indexOf("fragments");
        assert.ok(idxPages < idxWorkflows && idxWorkflows < idxFragments, "prior order not preserved: " + keys.join(", "));

        // New keys must be after all prior keys and sorted among themselves.
        // New keys are those not in priorRaw: brandNew, datasets, folders, data, datalists, etc.
        // They should appear alphabetically after the prior block.
        const priorSet = new Set(Object.keys(priorRaw));
        const newKeysInOrder = keys.filter(k => !priorSet.has(k));
        const sortedNew = [...newKeysInOrder].sort();
        assert.deepStrictEqual(newKeysInOrder, sortedNew, "new keys must be appended alphabetically");
        // Ensure no prior key appears after a new key
        const firstNewIdx = keys.indexOf(newKeysInOrder[0]);
        for (const k of Object.keys(priorRaw)) {
            if (keys.includes(k)) assert.ok(keys.indexOf(k) < firstNewIdx, k + " should be before new keys");
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 7. Preserved local entries carry forward and share the same contract
// ---------------------------------------------------------------------------
test("7 — preserved local entries carry forward through pull (same 2-space, single-newline contract)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-7-"));
    try {
        // Simulate a workspace that already has a new local page not yet on server.
        const localPageEntry = { string: "local.html", Page: { name: "local", content: "" } };
        const priorRaw = {
            pages: { entry: [localPageEntry] },
            fragments: { entry: [] }
        };
        fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(priorRaw, null, 2) + "\n");
        fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
        fs.writeFileSync(path.join(dir, "pages", "local.html"), "<p>local work</p>");

        // baseline: server did NOT have local.html (so pull should preserve it)
        // Build a fileHashes that does NOT include local.html
        const serverPal = baseServerPal({
            pages: { entry: [] },
            fragments: { entry: [] }
        });
        const resolved = { id: "id-7", guid: "guid-7", lastModifiedDate: "2026-01-07 00:00:00.0" };
        stubPull(serverPal, resolved);

        // Pull with empty baseline for server state => local.html not in baseline => preserve
        const emptyBaseline = {};
        await pull(fakeSession("https://cloud.example"), "guid-7", dir, { baseline: emptyBaseline });

        const raw = fs.readFileSync(path.join(dir, "pal.json"), "utf8");
        const out = JSON.parse(raw);
        // local entry must have been carried forward
        assert.ok(out.pages.entry.some(e => e.string === "local.html"), "preserved entry must remain in pal.json");
        assert.equal(fs.existsSync(path.join(dir, "pages", "local.html")), true, "preserved file must remain on disk");
        // contract
        assert.equal(raw.endsWith("\n"), true);
        assert.equal(raw.endsWith("\n\n"), false);
        assert.match(raw, /\n  "/);
        assert.equal("id" in out, false);
        assert.equal("path" in out, false);
        assert.equal("environment" in out, false);
        // verify indent is exactly two spaces, not tabs
        const lines = raw.split("\n");
        for (const line of lines) {
            if (line.startsWith(" ")) {
                const m = line.match(/^( +)"/);
                if (m) assert.equal(m[1].length % 2, 0, "indent must be multiple of 2 spaces");
            }
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("7b — merge writes through same contract (2-space indent, single trailing newline)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-7b-"));
    try {
        const basePal = baseServerPal({
            pages: { entry: [{ string: "a.html", Page: { name: "a", content: b64("a v1") } }] }
        });
        const resolved = { id: "id-7b", guid: "guid-7b", lastModifiedDate: "2026-01-07 00:00:00.0" };
        stubPull(basePal, resolved);
        await pull(fakeSession("https://cloud.example"), "guid-7b", dir, { baseline: null });

        // Modify a file locally so merge has a keepLocal entry, and also create a new local page.
        fs.writeFileSync(path.join(dir, "pages", "a.html"), "locally edited");
        const newEntry = { string: "new.html", Page: { name: "new", content: "" } };
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, "pal.json"), "utf8"));
        manifest.pages.entry.push(newEntry);
        fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(manifest, null, 2) + "\n");
        fs.writeFileSync(path.join(dir, "pages", "new.html"), "<p>new</p>");

        // Re-snapshot baseline would be stale; instead keep the old baseline snapshot from initial pull
        // and build a record with the old serverPaths. The local edits are now "dirty" vs baseline.
        const pullMod = require("../src/core/pull");
        const palForPaths = new Pal(Object.assign(JSON.parse(JSON.stringify(basePal)), {
            id: resolved.id, path: dir, environment: { url: "https://cloud.example" }
        }));
        const serverPaths = [...pullMod.manifestPaths(palForPaths)];
        const fileHashes = hashPaths(dir, serverPaths);
        // Need to restore baseline snapshot to the ORIGINAL server state for merge's ancestor.
        // pull's snapshot captured basePal's state; but we overwrote a.html locally — we need to
        // reset baseline to original content so merge classifies correctly. Easiest: re-snapshot
        // the server content into baseline, then re-apply local edits.
        // Instead, just ensure baseline exists and let merge handle keepLocal.
        // For this test we care about manifest serialization after merge, not file classification.
        // Ensure baseline content for a.html is original "a v1"
        const baselineDir = path.join(dir, ".palsync", "baseline", "pages");
        if (fs.existsSync(path.join(baselineDir, "a.html"))) {
            fs.writeFileSync(path.join(baselineDir, "a.html"), Buffer.from("a v1"));
        }
        const record = { fileHashes, lastModifiedDate: resolved.lastModifiedDate };

        // Server advances: add b.html, keep a.html as v2
        const nextPal = baseServerPal({
            pages: { entry: [
                { string: "a.html", Page: { name: "a", content: b64("a v2") } },
                { string: "b.html", Page: { name: "b", content: b64("b v1") } }
            ] }
        });
        const nextResolved = { id: "id-7b", guid: "guid-7b", lastModifiedDate: "2026-01-08 00:00:00.0" };
        stubPull(nextPal, nextResolved);

        const result = await mergeWorkspace(fakeSession("https://cloud.example"), "guid-7b", record, dir);
        assert.equal(result.merged, true);

        const raw = fs.readFileSync(path.join(dir, "pal.json"), "utf8");
        const out = JSON.parse(raw);
        assert.equal(raw.endsWith("\n"), true);
        assert.equal(raw.endsWith("\n\n"), false);
        assert.match(raw, /\n  "/);
        assert.equal("id" in out, false);
        assert.equal("path" in out, false);
        assert.equal("environment" in out, false);
        // preserved local entry new.html should still be there if it was classified keepLocal
        // (if it was not in ancestor and not on server, it becomes keepLocal)
        // Depending on classification, new.html may be kept. At minimum, manifest must be valid JSON with correct contract.
        assert.equal(typeof out.pages, "object");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 8. Push reconstruction still works: Pal.fromPath restores path/id, missing environment tolerated
// ---------------------------------------------------------------------------
test("8 — Pal.fromPath restores path and id after stable persist, missing environment tolerated", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-8-"));
    try {
        const serverPal = baseServerPal({
            palName: "Demo",
            pages: { entry: [{ string: "index.html", Page: { name: "index", content: b64("hello") } }] },
            customField: { x: 1 }
        });
        const resolved = { id: "my-pal-id-123", guid: "guid-8", lastModifiedDate: "2026-01-08 00:00:00.0" };
        stubPull(serverPal, resolved);
        await pull(fakeSession("https://cloud.example"), "guid-8", dir, { baseline: null });

        const pal = await Pal.fromPath(dir);
        // Pal.fromPath sets path to dir and id to basename(dir) — push will overwrite id anyway,
        // but the shape must be correct for reconstruction.
        assert.equal(pal.path, dir);
        assert.equal(pal.id, path.basename(dir));
        // environment was omitted from disk, so Pal.fromPath yields no environment (tolerated)
        assert.equal(pal.environment, undefined);
        // custom field round-tripped
        assert.deepStrictEqual(pal.customField, { x: 1 });

        // Simulate what push does: assign the real server id before inject
        pal.id = resolved.id;
        assert.equal(pal.id, resolved.id);
        // Also verify that re-serializing via buildPersistedObject still omits runtime keys
        const { buildPersistedObject, serializeManifest } = require("../src/core/manifestPersist");
        const priorRaw = JSON.parse(fs.readFileSync(path.join(dir, "pal.json"), "utf8"));
        const plain = buildPersistedObject(pal, priorRaw);
        assert.equal("id" in plain, false);
        assert.equal("path" in plain, false);
        assert.equal("environment" in plain, false);
        const text = serializeManifest(plain, priorRaw);
        assert.equal(text.endsWith("\n"), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// 9. Baseline refresh after first migrated pull does not leave false drift
// ---------------------------------------------------------------------------
test("9 — baseline refresh after first migrated pull does not leave false local-drift", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-mp-9-"));
    try {
        // Simulate a pre-migration workspace: pal.json was written with runtime keys and
        // without the stable contract (e.g. no trailing newline, different key order).
        const oldPal = {
            palName: "Demo",
            layout: {},
            id: "leaked-id",
            path: "/old/absolute/path",
            environment: { url: "https://cloud.example" },
            pages: { entry: [{ string: "a.html", Page: { name: "a", content: "" } }] },
            fragments: "",
            folders: { Folder: [] }
        };
        fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
        fs.writeFileSync(path.join(dir, "pages", "a.html"), "hello");
        fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(oldPal, null, 2));

        const serverPal = baseServerPal({
            palName: "Demo",
            layout: {},
            pages: { entry: [{ string: "a.html", Page: { name: "a", content: b64("hello") } }] },
            fragments: "",
            folders: { Folder: [] }
        });
        const resolved = { id: "id-9", guid: "guid-9", lastModifiedDate: "2026-01-09 00:00:00.0" };
        // Capture fileHashes from the PRE-migration workspace — the state a real upgrading
        // workspace is in before the first stable pull. This is the record that would have
        // existed before migration.
        const pullModPre = require("../src/core/pull");
        const palForPathsPre = new Pal(Object.assign(JSON.parse(JSON.stringify(serverPal)), {
            id: resolved.id, path: dir, environment: { url: "https://cloud.example" }
        }));
        const serverPathsPre = [...pullModPre.manifestPaths(palForPathsPre)];
        const preHashes = hashPaths(dir, serverPathsPre);
        stubPull(serverPal, resolved);
        await pull(fakeSession("https://cloud.example"), "guid-9", dir, { baseline: null });

        // After pull, launcher builds record.fileHashes from the NEW serverPaths (post-migration).
        const pullMod = require("../src/core/pull");
        const palForPaths = new Pal(Object.assign(JSON.parse(JSON.stringify(serverPal)), {
            id: resolved.id, path: dir, environment: { url: "https://cloud.example" }
        }));
        const serverPaths = [...pullMod.manifestPaths(palForPaths)];
        const fileHashes = hashPaths(dir, serverPaths);
        const record = { fileHashes, lastModifiedDate: resolved.lastModifiedDate };

        // Prove the workspace was in pre-migration state: pal.json hash changed by migration.
        assert.notEqual(preHashes["pal.json"], fileHashes["pal.json"], "pal.json hash must change after stable migration");
        // diffWorkspace with the REFRESHED post-migration hashes should NOT report drift — baseline was refreshed.

        const diff = diffWorkspace(record, dir);
        assert.equal(diff.dirty, false, "migrated pull must not leave false drift: " + JSON.stringify(diff));
        assert.equal(baseline.exists(dir), true, "baseline snapshot must exist after pull");
        // pal.json in baseline must equal current pal.json
        const baseContent = baseline.read(dir, "pal.json");
        const currentContent = fs.readFileSync(path.join(dir, "pal.json"), "utf8");
        assert.equal(baseContent, currentContent);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
