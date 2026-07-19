"use strict";
// Lint Dataset definitions for shapes SyncDataSet.do and the pal save reject. Dataset definitions
// appear both as datasets/<name>.json and inline at datasets.entry[].Dataset in pal.json.
//
// Static registry pins (ruleRegistry.test.js scans literal emitters):
// rule: "datasetJsonParse"; rule: "datasetWrongFieldKeys"; rule: "datasetFieldMissingName";
// rule: "datasetFieldMissingType"; rule: "datasetNoColumns"; rule: "datasetFieldType";
// rule: "datasetNoPrimaryKey".
//
// ERROR evidence: live workspace equipment_checkout-cc-haiku-9df2c3e-01, save attempt
// .agent-work-history/pal_sync_datasets/383303c2d67253c1.json (2026-07-19). Fields serialized
// from name/type aliases as null and the server returned "invalid name for field null", "invalid
// type for field null", and "No primary key specified". Empty definitions were subsequently
// rejected because "dataset definitions must be saved first". These errors mirror those guaranteed
// server rejections; the recognized-type check remains advisory.

// Exact strings from com/contractpal/pal/DatasetField.java TYPE_* constants.
const KNOWN_TYPES = new Set([
    "String", "Text", "Medium text", "Char",
    "Date", "DateOnly", "DateTimeMS",
    "Boolean",
    "Tiny integer", "Small integer", "Medium integer", "Number", "Big Number",
    "Tiny unsigned integer", "Small unsigned integer", "Medium unsigned integer", "Unsigned integer", "Big unsigned integer",
    "Decimal",
    "Encrypted",
    "File", "File Encrypted", "Remote File", "Remote File Encrypted",
    "Primary key", "Pal id", "Transaction id", "Profile id",
    "Pal id auto populate", "Transaction id auto populate", "Profile id auto populate"
]);

// Serialized fields declared by the vendored DatasetField.java class.
const FIELD_KEYS = new Set([
    "fieldName", "fieldType", "indexed", "fieldSize", "description", "notNull", "notEmpty",
    "defaultValue", "validation"
]);

// Common WRONG guesses → the real PalBuilder type to suggest. Lowercased, whitespace-stripped keys.
const SUGGESTIONS = {
    "integer": "Number", "int": "Number", "number": "Number", "numeric": "Number",
    "long": "Big Number", "bigint": "Big Number",
    "float": "Decimal", "double": "Decimal", "decimal": "Decimal",
    "bool": "Boolean", "boolean": "Boolean",
    "text": "String", "string": "String", "varchar": "String", "longtext": "Text", "mediumtext": "Medium text", "char": "Char",
    "datetime": "Date", "timestamp": "Date", "time": "Date", "date": "Date",
    "pk": "Primary key", "id": "Primary key", "primarykey": "Primary key", "uuid": "Primary key"
};

function finding(rel, severity, rule, message) {
    return { file: rel, line: 0, column: 0, severity, rule, message };
}

function lintDatasetObject(rel, ds, fallbackName) {
    const findings = [];
    const name = (ds && ds.name) || fallbackName || rel;
    const fieldsNode = ds && ds.fields;
    const bareArray = Array.isArray(fieldsNode);
    const wrapped = fieldsNode && !bareArray ? fieldsNode.DatasetField : undefined;
    const fields = wrapped === undefined || wrapped === null ? [] : (Array.isArray(wrapped) ? wrapped : [wrapped]);

    if (bareArray) {
        findings.push(finding(rel, "error", "datasetWrongFieldKeys",
            "Dataset '" + name + "' uses a bare fields array. Wrap it as fields.DatasetField: { \"fields\": { \"DatasetField\": [...] } }."));
    } else if (fieldsNode && typeof fieldsNode === "object" && wrapped === undefined) {
        findings.push(finding(rel, "error", "datasetWrongFieldKeys",
            "Dataset '" + name + "' has no fields.DatasetField wrapper. Use { \"fields\": { \"DatasetField\": [...] } }."));
    }

    let usable = 0;
    let pkCount = 0;
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (!field || typeof field !== "object" || Array.isArray(field)) continue;
        const unknown = Object.keys(field).filter(key => !FIELD_KEYS.has(key));
        if (unknown.length && (field.fieldName === undefined || field.fieldType === undefined)) {
            findings.push(finding(rel, "error", "datasetWrongFieldKeys",
                "Dataset '" + name + "', field " + (i + 1) + " uses non-canonical key(s): " + unknown.join(", ") +
                ". Rename name→fieldName and type→fieldType; DatasetField keys must match the serialized shape."));
        }
        if (typeof field.fieldName !== "string" || !field.fieldName.trim()) {
            findings.push(finding(rel, "error", "datasetFieldMissingName",
                "Dataset '" + name + "', field " + (i + 1) + " is missing a non-empty fieldName. Rename name→fieldName."));
        }
        if (typeof field.fieldType !== "string" || !field.fieldType.trim()) {
            findings.push(finding(rel, "error", "datasetFieldMissingType",
                "Dataset '" + name + "', field '" + (field.fieldName || i + 1) + "' is missing a non-empty fieldType. Rename type→fieldType."));
        }
        if (typeof field.fieldName === "string" && field.fieldName.trim() &&
                typeof field.fieldType === "string" && field.fieldType.trim()) usable++;
        if (field.fieldType === "Primary key") pkCount++;
        if (field.fieldType !== undefined && !KNOWN_TYPES.has(field.fieldType)) {
            const suggestion = SUGGESTIONS[String(field.fieldType).toLowerCase().replace(/\s+/g, "")];
            findings.push(finding(rel, "warn", "datasetFieldType",
                "Dataset '" + name + "', field '" + field.fieldName + "': fieldType \"" + field.fieldType + "\" is not a recognized PalBuilder type" +
                (suggestion ? " — did you mean \"" + suggestion + "\"?" : ".") +
                " The server will reject the sync with \"invalid type\" if it's wrong. Valid types include: " + [...KNOWN_TYPES].join(", ") + "."));
        }
    }

    if (usable === 0) {
        findings.push(finding(rel, "error", "datasetNoColumns",
            "Dataset '" + name + "' has zero usable fields.DatasetField columns. Add at least { \"fieldName\": \"" + name +
            "Id\", \"fieldType\": \"Primary key\" }; dataset definitions must be saved before sync."));
    }
    if (fields.length > 0 && pkCount === 0) {
        findings.push(finding(rel, "error", "datasetNoPrimaryKey",
            "Dataset '" + name + "' has no field with fieldType \"Primary key\". Add one (normally named <dataset>Id)."));
    }
    return findings;
}

function lintDatasetDef(rel, jsonText) {
    let ds;
    try { ds = JSON.parse(jsonText); }
    catch (e) {
        return [finding(rel, "error", "datasetJsonParse",
            "This dataset file is not valid JSON: " + (e && e.message ? e.message : String(e)) + ". Fix the JSON so the dataset can be saved.")];
    }
    return lintDatasetObject(rel, ds);
}

function lintPalDatasets(rel, manifest) {
    const findings = [];
    const entries = manifest && manifest.datasets && manifest.datasets.entry;
    const list = Array.isArray(entries) ? entries : (entries ? [entries] : []);
    for (const entry of list) {
        if (!entry || !entry.Dataset) continue;
        findings.push(...lintDatasetObject(rel, entry.Dataset, entry.string));
    }
    return findings;
}

module.exports = { lintDatasetDef, lintPalDatasets, KNOWN_TYPES, SUGGESTIONS };
