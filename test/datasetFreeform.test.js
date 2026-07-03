"use strict";
// ensureFreeformDefault: a Dataset with `freeform` unset provisions a table with NO per-field
// columns, so column queries throw "Unknown column" at runtime (verified live against the Haiku
// test-03 CRUD run). The sync step defaults freeform:true on any target that omitted it, writing the
// corrected definition back to pal.json before the save. Pure fs, no network.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ensureFreeformDefault } = require("../src/core/datasets");

function tmpWorkspace(datasets) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-freeform-"));
    fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify({ datasets: { entry: datasets } }, null, 1));
    return dir;
}
function readDatasets(dir) {
    return JSON.parse(fs.readFileSync(path.join(dir, "pal.json"), "utf8")).datasets.entry;
}

test("defaults freeform:true on a target that omitted it, writes it back", () => {
    const dir = tmpWorkspace([{ string: "equipment", Dataset: { name: "equipment", fields: { DatasetField: [] } } }]);
    const defaulted = ensureFreeformDefault(dir, ["equipment"]);
    assert.deepStrictEqual(defaulted, ["equipment"]);
    assert.strictEqual(readDatasets(dir)[0].Dataset.freeform, true, "freeform persisted to pal.json");
});

test("honors an explicit freeform:false (does not override)", () => {
    const dir = tmpWorkspace([{ string: "audit", Dataset: { name: "audit", freeform: false, fields: { DatasetField: [] } } }]);
    const defaulted = ensureFreeformDefault(dir, ["audit"]);
    assert.deepStrictEqual(defaulted, [], "explicit false is intentional — never flipped");
    assert.strictEqual(readDatasets(dir)[0].Dataset.freeform, false);
});

test("leaves an already-true dataset unchanged (no needless rewrite)", () => {
    const dir = tmpWorkspace([{ string: "users", Dataset: { name: "users", freeform: true, fields: { DatasetField: [] } } }]);
    const defaulted = ensureFreeformDefault(dir, ["users"]);
    assert.deepStrictEqual(defaulted, []);
});

test("only touches TARGET datasets, not every entry in pal.json", () => {
    const dir = tmpWorkspace([
        { string: "equipment", Dataset: { name: "equipment", fields: { DatasetField: [] } } },
        { string: "other", Dataset: { name: "other", fields: { DatasetField: [] } } }
    ]);
    const defaulted = ensureFreeformDefault(dir, ["equipment"]);
    assert.deepStrictEqual(defaulted, ["equipment"]);
    const entries = readDatasets(dir);
    assert.strictEqual(entries.find(e => e.string === "equipment").Dataset.freeform, true);
    assert.strictEqual(entries.find(e => e.string === "other").Dataset.freeform, undefined, "non-target untouched");
});

test("no pal.json → returns [] without throwing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-freeform-none-"));
    assert.deepStrictEqual(ensureFreeformDefault(dir, ["x"]), []);
});
