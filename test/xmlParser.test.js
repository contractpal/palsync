"use strict";
// Regression tests for the DataList row-serialization corruption described in
// palsync-datalist-serialization-bug.md: pull's XML->JSON conversion (1) coerced numeric-looking
// String-typed cell values ("01") into bare JSON numbers, and (2) grouped a row's cells by
// tag name (string vs null) instead of preserving column position, silently reordering values
// whenever a null/empty cell wasn't at the end of the row. Both are fixed in lib/xmlParser.js.
// pal-level Data key/value maps (data.entry[].Data.values.entry[].string pairs) are serialized
// with the exact same heterogeneous <string>/<null> sibling-tag mechanism, just fixed at 2 cells
// (key, value) instead of N — covered here too. Pure string/XML fixtures, no network.
const { test } = require("node:test");
const assert = require("node:assert");
const { CloudPistonXMLParser, fixOrderSensitiveShapes, buildOrderSensitiveShapes } = require("../lib/xmlParser");

// Wraps a <datalists>...</datalists> fragment the way a real GetPal.do ComposerResult does
// (com.contractpal.composer.ComposerResult > pal > datalists > entry > DataList > ...).
function composerResultXml(datalistsInnerXml) {
    return "<com.contractpal.composer.ComposerResult><pal><datalists>" +
        datalistsInnerXml + "</datalists></pal></com.contractpal.composer.ComposerResult>";
}

function parse(xmlString) {
    const result = CloudPistonXMLParser().parse(xmlString)["com.contractpal.composer.ComposerResult"];
    return fixOrderSensitiveShapes(xmlString, result);
}

// Wraps a <data>...</data> fragment (com.contractpal.composer.ComposerResult > pal > data >
// entry > Data > ...), analogous to composerResultXml above.
function composerResultDataXml(dataInnerXml) {
    return "<com.contractpal.composer.ComposerResult><pal><data>" +
        dataInnerXml + "</data></pal></com.contractpal.composer.ComposerResult>";
}

test("DataList cell values never get coerced out of string type (leading zeros, booleans)", () => {
    const xml = composerResultXml(
        "<entry><DataList>" +
        "<name>months</name>" +
        "<cols><string>code</string><string>label</string><string>mon</string><string>num</string><string>bool</string></cols>" +
        "<recs><string-array><string>Jan</string><string>January</string><string>jan</string><string>01</string><string>true</string></string-array></recs>" +
        "</DataList></entry>"
    );
    const result = parse(xml);
    const dataList = result.pal.datalists.entry[0].DataList;
    assert.deepStrictEqual(dataList.recs, { "string-array": [{ string: ["Jan", "January", "jan", "01", "true"] }] });
});

test("DataList row cells stay pinned to their original column, regardless of which columns are null", () => {
    // Mirrors the exact `merge` shape from the bug report: columns 1-3 populated, 4-5 empty,
    // 6-7 populated. Without the fix this groups into { string: [5 values], null: ["",""] },
    // which reconstructs as if columns 4-5 held "x","x" and columns 6-7 were empty.
    const xml = composerResultXml(
        "<entry><DataList>" +
        "<name>merge</name>" +
        "<cols><string>label</string><string>orderField</string><string>customerField</string>" +
        "<string>orderValue</string><string>customerValue</string><string>options</string><string>recommend</string></cols>" +
        "<recs><string-array>" +
        "<string>Archived</string><string>archived</string><string>archived</string>" +
        "<null/><null/><string>x</string><string>x</string>" +
        "</string-array></recs>" +
        "</DataList></entry>"
    );
    const result = parse(xml);
    const dataList = result.pal.datalists.entry[0].DataList;
    assert.deepStrictEqual(dataList.recs, {
        "string-array": [{ string: ["Archived", "archived", "archived", null, null, "x", "x"] }]
    });
});

test("multiple DataLists and multiple rows are all reconstructed independently", () => {
    const xml = composerResultXml(
        "<entry><DataList>" +
        "<name>months</name>" +
        "<cols><string>code</string><string>num</string></cols>" +
        "<recs><string-array><string>Jan</string><string>01</string></string-array>" +
        "<string-array><string>Feb</string><string>02</string></string-array></recs>" +
        "</DataList></entry>" +
        "<entry><DataList>" +
        "<name>merge</name>" +
        "<cols><string>label</string><string>options</string></cols>" +
        "<recs><string-array><null/><string>x</string></string-array></recs>" +
        "</DataList></entry>"
    );
    const result = parse(xml);
    const [monthsEntry, mergeEntry] = result.pal.datalists.entry;
    assert.deepStrictEqual(monthsEntry.DataList.recs, {
        "string-array": [{ string: ["Jan", "01"] }, { string: ["Feb", "02"] }]
    });
    assert.deepStrictEqual(mergeEntry.DataList.recs, {
        "string-array": [{ string: [null, "x"] }]
    });
});

test("responses with no datalists section are left untouched", () => {
    const xml = "<com.contractpal.composer.ComposerResult><pal><id>123</id></pal></com.contractpal.composer.ComposerResult>";
    const result = parse(xml);
    assert.strictEqual(result.pal.id, 123);
    assert.strictEqual(result.pal.datalists, undefined);
});

test("non-string tags elsewhere still get normal number/boolean auto-parsing", () => {
    const xml = "<com.contractpal.composer.ComposerResult><count>42</count><flag>true</flag></com.contractpal.composer.ComposerResult>";
    const result = parse(xml);
    assert.strictEqual(result.count, 42);
    assert.strictEqual(result.flag, true);
});

test("Data value pairs never get coerced out of string type (leading zeros)", () => {
    const xml = composerResultDataXml(
        "<entry><Data>" +
        "<name>siteConfig</name>" +
        "<values><entry><string>zip</string><string>0123</string></entry></values>" +
        "</Data></entry>"
    );
    const result = parse(xml);
    const data = result.pal.data.entry[0].Data;
    assert.deepStrictEqual(data.values, { entry: [{ string: ["zip", "0123"] }] });
});

test("Data pair with a legitimately null value stays [key, null], not reordered", () => {
    // Without the fix this groups into { string: ["phone"], null: [""] }, which reconstructing
    // by "non-null cells first" would misread as the value living where the key should be.
    const xml = composerResultDataXml(
        "<entry><Data>" +
        "<name>siteConfig</name>" +
        "<values><entry><string>phone</string><null/></entry></values>" +
        "</Data></entry>"
    );
    const result = parse(xml);
    const data = result.pal.data.entry[0].Data;
    assert.deepStrictEqual(data.values, { entry: [{ string: ["phone", null] }] });
});

test("multiple Data entries and multiple pairs are all reconstructed independently", () => {
    const xml = composerResultDataXml(
        "<entry><Data>" +
        "<name>siteConfig</name>" +
        "<values>" +
        "<entry><string>companyName</string><string>Acme Rentals</string></entry>" +
        "<entry><string>zip</string><string>0123</string></entry>" +
        "</values>" +
        "</Data></entry>" +
        "<entry><Data>" +
        "<name>otherConfig</name>" +
        "<values><entry><null/><string>orphanValue</string></entry></values>" +
        "</Data></entry>"
    );
    const result = parse(xml);
    const [siteConfigEntry, otherConfigEntry] = result.pal.data.entry;
    assert.deepStrictEqual(siteConfigEntry.Data.values, {
        entry: [{ string: ["companyName", "Acme Rentals"] }, { string: ["zip", "0123"] }]
    });
    assert.deepStrictEqual(otherConfigEntry.Data.values, {
        entry: [{ string: [null, "orphanValue"] }]
    });
});

test("responses with no data section are left untouched", () => {
    const xml = "<com.contractpal.composer.ComposerResult><pal><id>123</id></pal></com.contractpal.composer.ComposerResult>";
    const result = parse(xml);
    assert.strictEqual(result.pal.id, 123);
    assert.strictEqual(result.pal.data, undefined);
});

// ---- Build-side (save/push) regression tests ----
//
// fast-xml-parser's XMLBuilder has its own, independent version of the row-reordering bug: given
// { string: ["a", "b", null] }, it renders every null-valued array entry FIRST (as <string/>),
// ahead of the real values, instead of at its original position. Saving a pal (Pal.toXml /
// apiManager's task-XML build) with a DataList row or Data pair that has a null cell anywhere but
// the end silently shifts every real cell over — server-verified: serviceTypes.json (pulled
// DataList) saved unmodified through the MCP tool and re-pulled came back as serviceTypes2.json,
// with every row's cells shifted right by one. buildOrderSensitiveShapes() fixes the build
// direction; round-tripping build -> parse -> fixOrderSensitiveShapes below is what proves it.

// Wraps a <queryResult>...</queryResult> fragment the way a real ProcessPalBuilder.do /
// QUERY_DATASET ComposerResult does (ComposerResult > customObject > queryResult > ...).
function composerResultQueryXml(queryResultInnerXml) {
    return "<com.contractpal.composer.ComposerResult><customObject>" +
        "<queryResult>" + queryResultInnerXml + "</queryResult>" +
        "</customObject></com.contractpal.composer.ComposerResult>";
}

test("DatasetQueryResult row cells stay pinned to their column when interior cells are null", () => {
    // Real Audithelm V1 / activityLog row (server-verified 2026-09-02): workspaceId and
    // actorProfileId are null. The order-losing parse groups this as
    // { string: ["1", "spike.jobwindow", ...], null: ["",""] }, which read naively puts `action`
    // in the workspaceId column and shifts every remaining value one place left.
    const xml = composerResultQueryXml(
        "<startRecord>0</startRecord><limit>2</limit><totalRecords>107</totalRecords>" +
        "<columns><string>activityId</string><string>workspaceId</string><string>actorProfileId</string>" +
        "<string>action</string><string>at</string></columns>" +
        "<data>" +
        "<string-array><string>1</string><null/><null/><string>spike.jobwindow</string><string>08-27-2026</string></string-array>" +
        "<string-array><string>2</string><string>1</string><null/><string>workspace.updated</string><null/></string-array>" +
        "</data>"
    );
    const result = parse(xml);
    assert.deepStrictEqual(result.customObject.queryResult.data, {
        "string-array": [
            { string: ["1", null, null, "spike.jobwindow", "08-27-2026"] },
            { string: ["2", "1", null, "workspace.updated", null] }
        ]
    });
});

test("a DatasetQueryResult with no data rows is left untouched", () => {
    const xml = composerResultQueryXml("<startRecord>0</startRecord><limit>5</limit><totalRecords>0</totalRecords>");
    const result = parse(xml);
    assert.deepStrictEqual(result.customObject.queryResult, { startRecord: 0, limit: 5, totalRecords: 0 });
});

function roundTripDataList(dataList) {
    const task = { pal: { datalists: { entry: [{ string: dataList.name, DataList: dataList }] } } };
    const xml = "<com.contractpal.composer.ComposerResult>" + buildOrderSensitiveShapes(task, false) +
        "</com.contractpal.composer.ComposerResult>";
    const parsed = CloudPistonXMLParser().parse(xml)["com.contractpal.composer.ComposerResult"];
    return fixOrderSensitiveShapes(xml, parsed).pal.datalists.entry[0].DataList;
}

function roundTripData(data) {
    const task = { pal: { data: { entry: [{ string: data.name, Data: data }] } } };
    const xml = "<com.contractpal.composer.ComposerResult>" + buildOrderSensitiveShapes(task, false) +
        "</com.contractpal.composer.ComposerResult>";
    const parsed = CloudPistonXMLParser().parse(xml)["com.contractpal.composer.ComposerResult"];
    return fixOrderSensitiveShapes(xml, parsed).pal.data.entry[0].Data;
}

test("build: a DataList row with a null cell mid-row survives save unshifted (serviceTypes repro)", () => {
    const dataList = {
        name: "serviceTypes",
        cols: { string: ["name", "code", "alt"] },
        recs: {
            "string-array": [
                { string: ["Can Cleaning", "can", "trash"] },
                { string: ["Power Washing", "power", null] }
            ]
        }
    };
    const result = roundTripDataList(dataList);
    assert.deepStrictEqual(result.recs, {
        "string-array": [
            { string: ["Can Cleaning", "can", "trash"] },
            { string: ["Power Washing", "power", null] }
        ]
    });
});

test("build: null cells anywhere in a DataList row stay pinned to their original column", () => {
    const dataList = {
        name: "merge",
        cols: { string: ["label", "orderField", "customerField", "orderValue", "customerValue", "options", "recommend"] },
        recs: {
            "string-array": [
                { string: ["Archived", "archived", "archived", null, null, "x", "x"] }
            ]
        }
    };
    const result = roundTripDataList(dataList);
    assert.deepStrictEqual(result.recs, {
        "string-array": [{ string: ["Archived", "archived", "archived", null, null, "x", "x"] }]
    });
});

test("build: multiple DataLists and rows are each reconstructed independently", () => {
    const task = {
        pal: {
            datalists: {
                entry: [
                    {
                        string: "months",
                        DataList: {
                            name: "months", cols: { string: ["code", "num"] },
                            recs: { "string-array": [{ string: ["Jan", "01"] }, { string: ["Feb", "02"] }] }
                        }
                    },
                    {
                        string: "merge",
                        DataList: {
                            name: "merge", cols: { string: ["label", "options"] },
                            recs: { "string-array": [{ string: [null, "x"] }] }
                        }
                    }
                ]
            }
        }
    };
    const xml = "<com.contractpal.composer.ComposerResult>" + buildOrderSensitiveShapes(task, false) +
        "</com.contractpal.composer.ComposerResult>";
    const parsed = CloudPistonXMLParser().parse(xml)["com.contractpal.composer.ComposerResult"];
    const fixed = fixOrderSensitiveShapes(xml, parsed);
    const [monthsEntry, mergeEntry] = fixed.pal.datalists.entry;
    assert.deepStrictEqual(monthsEntry.DataList.recs, {
        "string-array": [{ string: ["Jan", "01"] }, { string: ["Feb", "02"] }]
    });
    assert.deepStrictEqual(mergeEntry.DataList.recs, { "string-array": [{ string: [null, "x"] }] });
});

test("build: a Data pair with a null value survives save unshifted", () => {
    const data = {
        name: "siteConfig",
        values: { entry: [{ string: ["phone", null] }, { string: ["zip", "0123"] }] }
    };
    const result = roundTripData(data);
    assert.deepStrictEqual(result.values, {
        entry: [{ string: ["phone", null] }, { string: ["zip", "0123"] }]
    });
});

test("build: task with neither datalists nor data is left untouched (no-op)", () => {
    const task = { pal: { id: "123" } };
    const xml = buildOrderSensitiveShapes(task, false);
    assert.strictEqual(xml, "<pal><id>123</id></pal>");
});

test("build: the caller's original pal/task object is never mutated", () => {
    const dataList = {
        name: "months",
        cols: { string: ["code"] },
        recs: { "string-array": [{ string: [null] }] }
    };
    const task = { pal: { datalists: { entry: [{ string: "months", DataList: dataList }] } } };
    const before = JSON.stringify(task);
    buildOrderSensitiveShapes(task, false);
    assert.strictEqual(JSON.stringify(task), before);
});