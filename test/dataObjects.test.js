"use strict";
// Unit tests for core/dataObjects.js — the build/upsert/delete helpers behind
// pal_data_set/pal_data_delete/pal_datalist_set/pal_datalist_delete. Pure fs, no network.
// Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { tmpWorkspace } = require("./helpers");
const { lintPalJson } = require("../src/core/validate/palJson");
const {
    buildDataEntry, buildDataListEntry,
    upsertData, deleteData,
    upsertDataList, deleteDataList,
} = require("../src/core/dataObjects");

function readManifest(dir) {
    return JSON.parse(fs.readFileSync(path.join(dir, "pal.json"), "utf8"));
}

function basePalJson(extra) {
    return JSON.stringify(Object.assign({
        pages: { entry: [] }, fragments: { entry: [] }, styles: { entry: [] },
        scripts: { entry: [] }, images: { entry: [] }, emails: { entry: [] },
        attachments: { entry: [] }, datasets: { entry: [] },
    }, extra));
}

test("buildDataEntry produces the exact server-verified Data shape", () => {
    const entry = buildDataEntry("siteConfig", { companyName: "Acme Rentals", directoryPageSize: "25" });
    assert.deepStrictEqual(entry, {
        string: "siteConfig",
        Data: {
            name: "siteConfig",
            values: { entry: [
                { string: ["companyName", "Acme Rentals"] },
                { string: ["directoryPageSize", "25"] },
            ] },
        },
    });
});

test("buildDataEntry rejects an empty name", () => {
    assert.throws(() => buildDataEntry("", { a: "b" }), /non-empty string/);
    assert.throws(() => buildDataEntry("   ", { a: "b" }), /non-empty string/);
});

test("buildDataListEntry produces the exact server-verified DataList shape", () => {
    const entry = buildDataListEntry("offices", ["officeCode", "city"], [["SLC", "Salt Lake City"], ["DEN", "Denver"]]);
    assert.deepStrictEqual(entry, {
        string: "offices",
        DataList: {
            name: "offices",
            cols: { string: ["officeCode", "city"] },
            recs: { "string-array": [
                { string: ["SLC", "Salt Lake City"] },
                { string: ["DEN", "Denver"] },
            ] },
        },
    });
});

test("buildDataListEntry rejects empty columns and mismatched row length", () => {
    assert.throws(() => buildDataListEntry("offices", [], []), /non-empty array of non-empty column names/);
    assert.throws(() => buildDataListEntry("offices", ["a", "b"], [["only-one"]]), /row 0 must have exactly 2 cell/);
});

test("a tool-built Data and DataList entry passes lintPalJson clean", () => {
    const dataEntry = buildDataEntry("siteConfig", { companyName: "Acme Rentals" });
    const listEntry = buildDataListEntry("offices", ["officeCode", "city"], [["SLC", "Salt Lake City"]]);
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ data: { entry: [dataEntry] }, datalists: { entry: [listEntry] } }),
    });
    assert.deepStrictEqual(lintPalJson(dir).filter(f => f.rule === "invalidPalJsonShape"), []);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("upsertData creates a new entry, writes pal.json and the data/ mirror file, leaves siblings untouched", () => {
    const untouchedPage = { string: "index.html", Page: { name: "index" } };
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ pages: { entry: [untouchedPage] }, data: { entry: [] } }),
    });
    const res = upsertData(dir, "siteConfig", { companyName: "Acme Rentals" });
    assert.equal(res.created, true);
    assert.equal(res.name, "siteConfig");

    const manifest = readManifest(dir);
    assert.deepStrictEqual(manifest.pages.entry, [untouchedPage]); // sibling section untouched
    assert.equal(manifest.data.entry.length, 1);
    assert.deepStrictEqual(manifest.data.entry[0], buildDataEntry("siteConfig", { companyName: "Acme Rentals" }));

    const mirror = JSON.parse(fs.readFileSync(path.join(dir, "data", "siteConfig.json"), "utf8"));
    assert.deepStrictEqual(mirror, manifest.data.entry[0].Data);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("upsertData updates an existing entry in place without disturbing sibling entries", () => {
    const other = buildDataEntry("other", { x: "1" });
    const original = buildDataEntry("siteConfig", { companyName: "Acme Rentals" });
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ data: { entry: [other, original] } }),
    });
    const res = upsertData(dir, "siteConfig", { companyName: "New Name", supportEmail: "help@acme.example" });
    assert.equal(res.created, false);

    const manifest = readManifest(dir);
    assert.equal(manifest.data.entry.length, 2);
    assert.deepStrictEqual(manifest.data.entry[0], other); // sibling entry byte-identical
    assert.deepStrictEqual(manifest.data.entry[1], buildDataEntry("siteConfig", { companyName: "New Name", supportEmail: "help@acme.example" }));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("deleteData removes the entry and its mirror file, reports not-found when absent", () => {
    const entry = buildDataEntry("siteConfig", { a: "b" });
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ data: { entry: [entry] } }),
        "data/siteConfig.json": JSON.stringify(entry.Data),
    });
    const res = deleteData(dir, "siteConfig");
    assert.equal(res.deleted, true);
    assert.deepStrictEqual(readManifest(dir).data.entry, []);
    assert.equal(fs.existsSync(path.join(dir, "data", "siteConfig.json")), false);

    const again = deleteData(dir, "siteConfig");
    assert.equal(again.deleted, false);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("upsertDataList creates a new entry and writes the datalists/ mirror file", () => {
    const dir = tmpWorkspace({ "pal.json": basePalJson({ datalists: { entry: [] } }) });
    const res = upsertDataList(dir, "offices", ["officeCode", "city"], [["SLC", "Salt Lake City"], ["DEN", "Denver"]]);
    assert.equal(res.created, true);

    const manifest = readManifest(dir);
    assert.equal(manifest.datalists.entry.length, 1);
    const mirror = JSON.parse(fs.readFileSync(path.join(dir, "datalists", "offices.json"), "utf8"));
    assert.deepStrictEqual(mirror, manifest.datalists.entry[0].DataList);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("upsertDataList replaces rows wholesale on update (not a delta)", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ datalists: { entry: [buildDataListEntry("offices", ["officeCode", "city"], [["SLC", "Salt Lake City"]])] } }),
    });
    const res = upsertDataList(dir, "offices", ["officeCode", "city"], [["DEN", "Denver"]]);
    assert.equal(res.created, false);
    const manifest = readManifest(dir);
    assert.deepStrictEqual(manifest.datalists.entry[0].DataList.recs["string-array"], [{ string: ["DEN", "Denver"] }]);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("deleteDataList removes the entry and its mirror file, reports not-found when absent", () => {
    const entry = buildDataListEntry("offices", ["a"], [["1"]]);
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ datalists: { entry: [entry] } }),
        "datalists/offices.json": JSON.stringify(entry.DataList),
    });
    const res = deleteDataList(dir, "offices");
    assert.equal(res.deleted, true);
    assert.deepStrictEqual(readManifest(dir).datalists.entry, []);
    assert.equal(fs.existsSync(path.join(dir, "datalists", "offices.json")), false);

    const again = deleteDataList(dir, "offices");
    assert.equal(again.deleted, false);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("unwired data mirror — data/foo.json with no pal.json entry (lintPalJson)", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({}),
        "data/foo.json": JSON.stringify({ name: "foo", values: { entry: [] } }),
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "missingPalJsonEntry" && f.message.includes("data/foo.json"));
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /pal_data_set/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("wired data mirror — data/foo.json WITH a matching pal.json entry produces no finding", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ data: { entry: [buildDataEntry("foo", { a: "b" })] } }),
        "data/foo.json": JSON.stringify(buildDataEntry("foo", { a: "b" }).Data),
    });
    const findings = lintPalJson(dir).filter(f => f.message.includes("data/foo.json"));
    assert.strictEqual(findings.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("unwired datalists mirror — datalists/foo.json with no pal.json entry (lintPalJson)", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({}),
        "datalists/foo.json": JSON.stringify({ name: "foo", cols: { string: ["a"] }, recs: { "string-array": [] } }),
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "missingPalJsonEntry" && f.message.includes("datalists/foo.json"));
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0].message, /pal_datalist_set/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("upsertData initializes an empty-string data section (empty-XML-element convention)", () => {
    const dir = tmpWorkspace({ "pal.json": basePalJson({ data: "" }) });
    const res = upsertData(dir, "siteConfig", { a: "b" });
    assert.equal(res.created, true);
    assert.equal(readManifest(dir).data.entry.length, 1);
    fs.rmSync(dir, { recursive: true, force: true });
});
