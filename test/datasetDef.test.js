"use strict";
// datasetDef linter: guards the fieldType set against the authoritative DatasetField.java enum.
// Regression for the old sampled-and-incomplete KNOWN_TYPES that falsely warned on valid types
// (Number, Decimal, Text) and steered integer/decimal guesses to lossy unsigned types.
// Pure, no network. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const { lintDatasetDef } = require("../src/core/validate/datasetDef");

function ds(fields) {
    return JSON.stringify({ name: "things", fields: { DatasetField: fields } });
}
function typeFindings(jsonText) {
    return lintDatasetDef("datasets/things.json", jsonText).filter(f => f.rule === "datasetFieldType");
}

test("dataset structural rules are directly covered", () => {
    const cases = [
        ["datasetJsonParse", "{"],
        ["datasetNoFields", JSON.stringify({ name: "things", fields: { DatasetField: [] } })],
        ["datasetNoPrimaryKey", ds([{ fieldName: "name", fieldType: "String" }])],
    ];
    for (const [rule, src] of cases) {
        assert.ok(lintDatasetDef("datasets/things.json", src).some(f => f.rule === rule), rule + " should be emitted");
    }
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
