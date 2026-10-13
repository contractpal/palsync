"use strict";
// Unit tests for pal creation — pure, no network. Run: npm test  (node --test).
// The live round-trip is scripts/create-pal-probe.js --verify (creates a real pal).
const { test } = require("node:test");
const assert = require("node:assert");
const { buildPalInfoEx, extractCreated, extractKeys, chooseDefaultKey } = require("../src/core/createPal");

const FIXED = new Date(Date.UTC(2026, 5, 20, 14, 30, 5, 0));   // 2026-06-20 14:30:05 UTC

test("buildPalInfoEx: required fields + spec defaults", () => {
    const b = buildPalInfoEx({ name: "Acme Portal", groupIds: ["g1", "g2"], now: FIXED });
    assert.equal(b.name, "Acme Portal");
    assert.equal(b.description, "Acme Portal");      // blank -> name
    assert.equal(b.category, "Acme Portal");         // blank -> name
    assert.equal(b.modeConsole, true);               // a pal can be multiple types
    assert.equal(b.modeWeb, true);
    assert.equal(b.modeTransaction, true);
    assert.ok(!("guid" in b));                        // guid NOT sent — server mints it
    assert.deepEqual(b.groupIds, { string: ["g1", "g2"] });
    assert.deepEqual(b.importPal, { layout: { name: "Acme Portal", category: "Acme Portal", description: "Acme Portal" } });
});

test("buildPalInfoEx: description/category override the name default", () => {
    const b = buildPalInfoEx({ name: "N", description: "D", category: "C", groupIds: ["g1"], now: FIXED });
    assert.equal(b.description, "D");
    assert.equal(b.category, "C");
});

test("buildPalInfoEx: dates are XStream-parseable UTC timestamps with a GMT zone token", () => {
    const b = buildPalInfoEx({ name: "N", groupIds: ["g1"], now: FIXED });
    // pattern the server's DateConverter accepts: "yyyy-MM-dd HH:mm:ss.S z"
    assert.equal(b.createDate, "2026-06-20 14:30:05.0 GMT");
    assert.equal(b.lastModifiedDate, "2026-06-20 14:30:05.0 GMT");
    assert.ok(Number.isFinite(Date.parse(b.createDate)));   // a real, parseable instant
});

test("buildPalInfoEx: guards", () => {
    assert.throws(() => buildPalInfoEx({ groupIds: ["g1"] }), /name is required/);
    assert.throws(() => buildPalInfoEx({ name: "N", groupIds: [] }), /at least one groupId/);
    assert.throws(() => buildPalInfoEx({ name: "N" }), /at least one groupId/);
});

test("extractCreated: reads guid from the customObject envelope (the real create result)", () => {
    assert.deepEqual(
        extractCreated({ success: true, customObject: { id: "8BC7", guid: "PAL-SE-19EF", name: "Test Pal", _class: "PalInfoEx" } }),
        { id: "8BC7", guid: "PAL-SE-19EF", name: "Test Pal" });
});

test("extractCreated: also handles PalInfoEx object and always-array forms", () => {
    assert.deepEqual(
        extractCreated({ success: true, PalInfoEx: { id: "1", guid: "abc", name: "N" } }),
        { id: "1", guid: "abc", name: "N" });
    assert.deepEqual(
        extractCreated({ success: true, PalInfoEx: [{ id: "2", guid: "def", name: "M" }] }),
        { id: "2", guid: "def", name: "M" });
});

test("extractKeys: parses the GetKeysForBuilder customObject NameValue list", () => {
    const resp = {
        success: true,
        customObject: {
            "com.contractpal.NameValue": [
                { name: "** Developer Activation Key I **", value: "AAA" },
                { name: "Normal Key", value: "BBB" }
            ],
            _class: "list"
        }
    };
    const keys = extractKeys(resp);
    assert.equal(keys.length, 2);
    assert.deepEqual(keys[0], { name: "** Developer Activation Key I **", value: "AAA" });
    assert.deepEqual(extractKeys({ success: false }), []);
});

test("chooseDefaultKey: prefers a non-Developer key (Developer keys can't run Web workflows)", () => {
    // The exact ordering that bit macroweek-web: the Developer key comes first.
    const keys = [
        { name: "** Developer Activation Key I **", value: "AAA" },
        { name: "Normal Key", value: "BBB" }
    ];
    assert.equal(chooseDefaultKey(keys).value, "BBB");
    // All-developer profile: fall back to the first key rather than returning nothing.
    assert.equal(chooseDefaultKey([{ name: "** Developer Activation Key I **", value: "AAA" }]).value, "AAA");
    // Empty / missing.
    assert.equal(chooseDefaultKey([]), null);
    assert.equal(chooseDefaultKey(undefined), null);
});

test("extractCreated: throws on failure or missing guid", () => {
    assert.throws(() => extractCreated({ success: false }), /failed/);
    assert.throws(() => extractCreated(undefined), /failed/);
    assert.throws(() => extractCreated({ success: true, PalInfoEx: { id: "1" } }), /no guid/);
});

test("extractKeys: empty list (system enterprise) yields no keys", () => {
    assert.deepEqual(extractKeys({ success: true, customObject: { _class: "list" } }), []);
});

test("buildPalInfoEx: omits activationKeyId when absent, rejects non-scalar", () => {
    const base = { name: "N", groupIds: ["g"] };
    assert.equal("activationKeyId" in buildPalInfoEx(base), false);
    assert.equal("activationKeyId" in buildPalInfoEx({ ...base, activationKeyId: "" }), false);
    assert.equal(buildPalInfoEx({ ...base, activationKeyId: "AbC" }).activationKeyId, "AbC");
    assert.throws(() => buildPalInfoEx({ ...base, activationKeyId: { _class: "list" } }), /must be a string/);
    assert.throws(() => buildPalInfoEx({ ...base, activationKeyId: ["A"] }), /must be a string/);
});
