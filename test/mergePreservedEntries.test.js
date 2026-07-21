"use strict";
// Unit tests for core/pull.js's mergePreservedEntries — specifically the fix that lets a new,
// unpushed data/datalists entry (created via core/dataObjects.js, which writes both the pal.json
// entry and the data/<name>.json / datalists/<name>.json mirror file) survive a forced pal_pull
// instead of being reported as "can't be created via push". Pure, no network. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const { mergePreservedEntries, CREATABLE_FOLDERS } = require("../src/core/pull");
const { buildDataEntry, buildDataListEntry } = require("../src/core/dataObjects");

test("data/datalists are in CREATABLE_FOLDERS", () => {
    assert.ok(CREATABLE_FOLDERS.has("data"));
    assert.ok(CREATABLE_FOLDERS.has("datalists"));
});

test("a new local Data entry (mirror file + pal.json entry) is carried forward on preserve", () => {
    const dataEntry = buildDataEntry("siteConfig", { companyName: "Acme Rentals" });
    const oldPalJson = { data: { entry: [dataEntry] } };
    const pal = { data: { entry: [] } }; // fresh server pal — doesn't have it yet

    const report = mergePreservedEntries(pal, oldPalJson, ["data/siteConfig.json"]);

    assert.deepStrictEqual(report, [{
        rel: "data/siteConfig.json", merged: true,
        note: "new local file — preserved and kept in pal.json for the next push",
    }]);
    assert.deepStrictEqual(pal.data.entry, [dataEntry]);
});

test("a new local DataList entry (mirror file + pal.json entry) is carried forward on preserve", () => {
    const listEntry = buildDataListEntry("offices", ["officeCode", "city"], [["SLC", "Salt Lake City"]]);
    const oldPalJson = { datalists: { entry: [listEntry] } };
    const pal = { datalists: { entry: [] } };

    const report = mergePreservedEntries(pal, oldPalJson, ["datalists/offices.json"]);

    assert.equal(report[0].merged, true);
    assert.deepStrictEqual(pal.datalists.entry, [listEntry]);
});

test("does not merge twice if the fresh pal already carries the entry", () => {
    const dataEntry = buildDataEntry("siteConfig", { a: "b" });
    const oldPalJson = { data: { entry: [dataEntry] } };
    const pal = { data: { entry: [dataEntry] } }; // already present (e.g. re-run)

    mergePreservedEntries(pal, oldPalJson, ["data/siteConfig.json"]);
    assert.equal(pal.data.entry.length, 1);
});

test("regression: base64 content types (e.g. fragments with a subpath) still match by full filename", () => {
    const fragEntry = { string: "contacts/list.html", Fragment: { name: "list" } };
    const oldPalJson = { fragments: { entry: [fragEntry] } };
    const pal = { fragments: { entry: [] } };

    const report = mergePreservedEntries(pal, oldPalJson, ["fragments/contacts/list.html"]);

    assert.equal(report[0].merged, true);
    assert.deepStrictEqual(pal.fragments.entry, [fragEntry]);
});

test("non-creatable folders (e.g. datasets) still refuse to merge", () => {
    const oldPalJson = { datasets: { entry: [{ string: "equipment", Dataset: {} }] } };
    const pal = { datasets: { entry: [] } };

    const report = mergePreservedEntries(pal, oldPalJson, ["datasets/equipment.json"]);

    assert.equal(report[0].merged, false);
    assert.match(report[0].note, /can't be created via push/);
    assert.deepStrictEqual(pal.datasets.entry, []);
});

test("a data entry preserved without a matching old pal.json entry is reported, not merged", () => {
    const pal = { data: { entry: [] } };
    const report = mergePreservedEntries(pal, { data: { entry: [] } }, ["data/orphan.json"]);
    assert.equal(report[0].merged, false);
    assert.match(report[0].note, /no pal\.json entry found/);
});
