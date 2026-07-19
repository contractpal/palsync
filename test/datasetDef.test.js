"use strict";
// datasetDef linter: guards the fieldType set against the authoritative DatasetField.java enum.
// Regression for the old sampled-and-incomplete KNOWN_TYPES that falsely warned on valid types
// (Number, Decimal, Text) and steered integer/decimal guesses to lossy unsigned types.
// Pure, no network. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const { lintDatasetDef, lintPalDatasets } = require("../src/core/validate/datasetDef");

function ds(fields) {
    return JSON.stringify({ name: "things", fields: { DatasetField: fields } });
}
function typeFindings(jsonText) {
    return lintDatasetDef("datasets/things.json", jsonText).filter(f => f.rule === "datasetFieldType");
}

test("dataset structural rules are directly covered", () => {
    const cases = [
        ["datasetJsonParse", "{"],
        ["datasetNoColumns", JSON.stringify({ name: "things", fields: { DatasetField: [] } })],
        ["datasetNoPrimaryKey", ds([{ fieldName: "name", fieldType: "String" }])],
        ["datasetWrongFieldKeys", JSON.stringify({ name: "things", fields: [] })],
        ["datasetFieldMissingName", ds([{ fieldType: "Primary key" }])],
        ["datasetFieldMissingType", ds([{ fieldName: "thingId" }])],
    ];
    for (const [rule, src] of cases) {
        assert.ok(lintDatasetDef("datasets/things.json", src).some(f => f.rule === rule), rule + " should be emitted");
    }
});

test("pal.json datasets reject name/type aliases with exact repairs", () => {
    const findings = lintPalDatasets("pal.json", { datasets: { entry: [{
        string: "things",
        Dataset: { name: "things", fields: { DatasetField: [{ name: "thingId", type: "Primary key" }] } }
    }] } });
    for (const rule of ["datasetWrongFieldKeys", "datasetFieldMissingName", "datasetFieldMissingType", "datasetNoColumns", "datasetNoPrimaryKey"]) {
        assert.ok(findings.some(f => f.rule === rule && f.severity === "error"), rule);
    }
    assert.match(findings.find(f => f.rule === "datasetWrongFieldKeys").message, /name→fieldName.*type→fieldType/);
});

test("canonical pal.json DatasetField shape has no errors", () => {
    const findings = lintPalDatasets("pal.json", { datasets: { entry: [{
        string: "things",
        Dataset: { name: "things", freeform: true, fields: { DatasetField: [
            { fieldName: "thingId", fieldType: "Primary key" },
            { fieldName: "name", fieldType: "String", fieldSize: 100, notNull: true }
        ] } }
    }] } });
    assert.deepStrictEqual(findings.filter(f => f.severity === "error"), []);
});

test("valid authoritative types do not warn", () => {
    for (const t of ["Number", "Big Number", "Decimal", "Text", "Medium text", "Boolean",
                     "Date", "DateOnly", "Encrypted", "Small integer", "Unsigned integer"]) {
        const findings = typeFindings(ds([
            { fieldName: "thingId", fieldType: "Primary key" },
            { fieldName: "f", fieldType: t },
        ]));
        assert.strictEqual(findings.length, 0, t + " should be a recognized type");
    }
});

test("integer guess warns and suggests Number, not an unsigned type", () => {
    const findings = typeFindings(ds([
        { fieldName: "thingId", fieldType: "Primary key" },
        { fieldName: "count", fieldType: "int" },
    ]));
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0].message, /did you mean "Number"\?/);
    // the suggestion itself must be Number, not an unsigned variant
    assert.doesNotMatch(findings[0].message, /did you mean "[^"]*unsigned/);
});

test("decimal guess suggests Decimal", () => {
    const findings = typeFindings(ds([
        { fieldName: "thingId", fieldType: "Primary key" },
        { fieldName: "price", fieldType: "decimal" },
    ]));
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0].message, /did you mean "Decimal"\?/);
});
