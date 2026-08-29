"use strict";
// Shared read adapter for pal_dataset_query and pal_dataset_count.
// Both tools use the builder's dedicated dataset-query operation and must remain
// structurally read-only. Evidence per repo policy: operation constant, dataset-mode
// flag, operator vocabulary, and total-count field are cited from vendored server
// source in comments and in the adapter's hard-coded values.

const fs = require("fs");
const path = require("path");
const { CloudPistonAPIManager } = require("../../lib/apiManager");

// ---------------------------------------------------------------------------
// Caps — bounded before the server call, response bytes bounded after.
// Chosen to match spec "recommended 100" for row limit and to keep request/response
// small enough for model context. Honest truncation is reported when the response
// byte cap is hit.
// ---------------------------------------------------------------------------
const MAX_LIMIT = 100;
const MAX_CONDITIONS = 20;
const MAX_ORDER = 10;
const MAX_STRING_LENGTH = 500;
const MAX_NAME_LENGTH = 200;
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_QUERY_LIMIT = 20;

// Validated operator vocabulary — exact keys from
// com/contractpal/palbuilder/DatasetFilterCriteria.java Operator enum.
const VALID_OPERATORS = new Set([
    "NULL",
    "NOT_NULL",
    "EQUAL",
    "NOT_EQUAL",
    "GREATER_THAN",
    "LESS_THAN",
    "GREATER_THAN_EQUAL",
    "LESS_THAN_EQUAL",
    "BETWEEN",
    "LIKE",
    "NOT_LIKE"
]);

// Operators that require / forbid value fields.
const NO_VALUE_OPS = new Set(["NULL", "NOT_NULL"]);
const TWO_VALUE_OPS = new Set(["BETWEEN"]);

const VALID_ORDERS = new Set(["ASC", "DESC", "NATURAL"]);
const VALID_MODES = new Set(["AND", "OR"]);

// ---------------------------------------------------------------------------
// Manifest helpers — validate dataset and column names against the local
// pal.json before any server call. Current Pal only.
// ---------------------------------------------------------------------------
function readPalJson(workspaceDir) {
    const p = path.join(workspaceDir, "pal.json");
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
        return null;
    }
}

function datasetNames(palJson) {
    if (!palJson || !palJson.datasets || !Array.isArray(palJson.datasets.entry)) return [];
    return palJson.datasets.entry.filter(e => e && typeof e.string === "string").map(e => e.string);
}

function datasetFields(palJson, datasetName) {
    if (!palJson || !palJson.datasets || !Array.isArray(palJson.datasets.entry)) return null;
    const entry = palJson.datasets.entry.find(e => e && e.string === datasetName);
    if (!entry || !entry.Dataset || !entry.Dataset.fields) return null;
    const node = entry.Dataset.fields.DatasetField;
    if (!node) return [];
    const arr = Array.isArray(node) ? node : [node];
    return arr.filter(f => f && typeof f.fieldName === "string").map(f => f.fieldName);
}

function validateDatasetName(palJson, name) {
    if (typeof name !== "string" || !name.trim()) {
        return "dataset must be a non-empty string";
    }
    if (name.length > MAX_NAME_LENGTH) {
        return "dataset name exceeds " + MAX_NAME_LENGTH + " characters";
    }
    // No path traversal or weird characters — dataset names are identifiers.
    if (/[\/\\]/.test(name)) {
        return "dataset must not contain path separators";
    }
    const known = datasetNames(palJson);
    if (!known.includes(name)) {
        const hint = known.length ? " Known datasets: " + known.join(", ") : " No datasets defined in pal.json.";
        return "unknown dataset " + JSON.stringify(name) + "." + hint;
    }
    return null;
}

function validateColumn(palJson, datasetName, column) {
    if (typeof column !== "string" || !column.trim()) {
        return "column must be a non-empty string";
    }
    if (column.length > MAX_NAME_LENGTH) {
        return "column name exceeds " + MAX_NAME_LENGTH + " characters";
    }
    const fields = datasetFields(palJson, datasetName);
    if (!Array.isArray(fields)) return "cannot validate column — dataset fields missing";
    if (!fields.includes(column)) {
        return "unknown column " + JSON.stringify(column) + " for dataset " + JSON.stringify(datasetName) +
            ". Known columns: " + (fields.length ? fields.join(", ") : "(none)");
    }
    return null;
}

function validateConditions(palJson, datasetName, conditions) {
    if (conditions === undefined || conditions === null) return null;
    if (!Array.isArray(conditions)) return "conditions must be an array";
    if (conditions.length > MAX_CONDITIONS) {
        return "too many conditions: " + conditions.length + " exceeds cap " + MAX_CONDITIONS;
    }
    for (let i = 0; i < conditions.length; i++) {
        const c = conditions[i];
        const prefix = "conditions[" + i + "]";
        if (!c || typeof c !== "object" || Array.isArray(c)) {
            return prefix + " must be an object";
        }
        // column
        if (typeof c.column !== "string" || !c.column.trim()) {
            return prefix + ".column must be a non-empty string";
        }
        const colErr = validateColumn(palJson, datasetName, c.column);
        if (colErr) return prefix + ".column: " + colErr;
        // operator
        if (typeof c.operator !== "string" || !VALID_OPERATORS.has(c.operator)) {
            return prefix + ".operator must be one of " + [...VALID_OPERATORS].join(", ");
        }
        const op = c.operator;
        // For NO_VALUE_OPS, value1/value2 must be absent or empty
        if (NO_VALUE_OPS.has(op)) {
            if (c.value1 !== undefined && c.value1 !== null && String(c.value1) !== "") {
                return prefix + ": operator " + op + " must not have value1";
            }
            if (c.value2 !== undefined && c.value2 !== null && String(c.value2) !== "") {
                return prefix + ": operator " + op + " must not have value2";
            }
        } else if (TWO_VALUE_OPS.has(op)) {
            if (c.value1 === undefined || c.value1 === null || String(c.value1) === "") {
                return prefix + ": operator " + op + " requires value1";
            }
            if (c.value2 === undefined || c.value2 === null || String(c.value2) === "") {
                return prefix + ": operator " + op + " requires value2";
            }
            if (String(c.value1).length > MAX_STRING_LENGTH) {
                return prefix + ".value1 exceeds " + MAX_STRING_LENGTH + " characters";
            }
            if (String(c.value2).length > MAX_STRING_LENGTH) {
                return prefix + ".value2 exceeds " + MAX_STRING_LENGTH + " characters";
            }
        } else {
            if (c.value1 === undefined || c.value1 === null || String(c.value1) === "") {
                return prefix + ": operator " + op + " requires value1";
            }
            if (String(c.value1).length > MAX_STRING_LENGTH) {
                return prefix + ".value1 exceeds " + MAX_STRING_LENGTH + " characters";
            }
            if (c.value2 !== undefined && c.value2 !== null && String(c.value2) !== "") {
                return prefix + ": operator " + op + " must not have value2";
            }
        }
        // Reject nested groups or unexpected keys that would expand scope
        const allowed = new Set(["column", "operator", "value1", "value2"]);
        for (const k of Object.keys(c)) {
            if (!allowed.has(k)) {
                return prefix + ": unknown field " + JSON.stringify(k);
            }
        }
    }
    return null;
}

function validateOrderBy(palJson, datasetName, orderBy) {
    if (orderBy === undefined || orderBy === null) return null;
    if (!Array.isArray(orderBy)) return "orderBy must be an array";
    if (orderBy.length > MAX_ORDER) {
        return "too many orderBy entries: " + orderBy.length + " exceeds cap " + MAX_ORDER;
    }
    for (let i = 0; i < orderBy.length; i++) {
        const o = orderBy[i];
        const prefix = "orderBy[" + i + "]";
        if (!o || typeof o !== "object" || Array.isArray(o)) {
            return prefix + " must be an object";
        }
        if (typeof o.column !== "string" || !o.column.trim()) {
            return prefix + ".column must be a non-empty string";
        }
        const colErr = validateColumn(palJson, datasetName, o.column);
        if (colErr) return prefix + ".column: " + colErr;
        if (o.order !== undefined && o.order !== null && !VALID_ORDERS.has(o.order)) {
            return prefix + ".order must be one of " + [...VALID_ORDERS].join(", ");
        }
        const allowed = new Set(["column", "order"]);
        for (const k of Object.keys(o)) {
            if (!allowed.has(k)) {
                return prefix + ": unknown field " + JSON.stringify(k);
            }
        }
    }
    return null;
}

function validatePaging(startRecord, limit, isCount) {
    if (startRecord !== undefined && startRecord !== null) {
        if (!Number.isInteger(startRecord) || startRecord < 0) {
            return "startRecord must be an integer >= 0";
        }
        if (String(startRecord).length > 10) return "startRecord string too long";
    }
    if (isCount) return null; // limit is hard-coded for count, caller value ignored
    if (limit !== undefined && limit !== null) {
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
            return "limit must be an integer between 1 and " + MAX_LIMIT;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Wire filter builder — maps validated inputs to the DatasetFilter shape
// expected by com/contractpal/palbuilder/DatasetFilter.java and its
// GroupFilterCriteria superclass. The builder request operation is hard-coded
// to QUERY_DATASET and view is hard-coded to false (dataset mode) —
// caller input cannot select a different operation or DataView mode.
// ---------------------------------------------------------------------------
function buildWireFilter(args, isCount) {
    const dataset = args.dataset;
    const startRecord = args.startRecord !== undefined && args.startRecord !== null ? args.startRecord : 0;
    const limit = isCount ? 1 : (args.limit !== undefined && args.limit !== null ? args.limit : DEFAULT_QUERY_LIMIT);
    const mode = args.mode || "AND";
    const conditions = args.conditions || [];
    const orderBy = args.orderBy || [];

    const criterias = conditions.map(c => {
        const obj = {
            column: c.column,
            operator: c.operator
        };
        if (c.value1 !== undefined && c.value1 !== null) obj.value1 = String(c.value1);
        if (c.value2 !== undefined && c.value2 !== null) obj.value2 = String(c.value2);
        return obj;
    });

    const selectOrder = orderBy.map(o => ({
        column: o.column,
        order: o.order || "ASC"
    }));

    // Evidence: com/contractpal/palbuilder/DatasetFilter.java fields:
    //   name, view, startRecord, limit, selectOrder plus GroupFilterCriteria
    //   mode and criterias. view:false = dataset mode, not DataView.
    // Evidence: com/nxlight/palbuilder/webstart/services/PalServiceManager.java
    //   getDatasetData uses Operation.QUERY_DATASET hard-coded.
    return {
        name: dataset,
        view: false,
        startRecord: startRecord,
        limit: limit,
        mode: mode,
        criterias: criterias,
        selectOrder: selectOrder
    };
}

// ---------------------------------------------------------------------------
// Response mapping — DatasetQueryResult columns/data to row objects.
// Evidence: com/contractpal/palbuilder/DatasetQueryResult.java fields
//   columns:String[], data:String[][], totalRecords:int, startRecord, limit
// ---------------------------------------------------------------------------
function mapResult(queryResult) {
    if (!queryResult || typeof queryResult !== "object") {
        throw new Error("malformed server response: expected DatasetQueryResult object");
    }
    const columns = queryResult.columns;
    const data = queryResult.data;
    const totalRecords = queryResult.totalRecords;

    if (!Array.isArray(columns)) {
        throw new Error("malformed server response: columns must be an array");
    }
    if (data !== null && data !== undefined && !Array.isArray(data)) {
        throw new Error("malformed server response: data must be an array or null");
    }
    if (typeof totalRecords !== "number" || !Number.isInteger(totalRecords) || totalRecords < 0) {
        throw new Error("malformed server response: totalRecords must be a non-negative integer");
    }

    const rows = [];
    const rawData = Array.isArray(data) ? data : [];
    for (const rowArr of rawData) {
        if (!Array.isArray(rowArr)) {
            throw new Error("malformed server response: each data row must be an array");
        }
        const obj = {};
        for (let i = 0; i < columns.length; i++) {
            const col = columns[i];
            // Preserve null vs string alignment, including empty cells.
            // If row is shorter than columns, missing trailing cells are null.
            const val = i < rowArr.length ? rowArr[i] : null;
            obj[col] = val === undefined ? null : val;
        }
        rows.push(obj);
    }
    return { columns, rows, totalRecords };
}

function checkResponseBytes(obj) {
    const bytes = Buffer.byteLength(JSON.stringify(obj), "utf8");
    return bytes;
}

// ---------------------------------------------------------------------------
// Shared read adapter — validates locally, builds wire filter, calls server,
// maps result, enforces response byte cap. Never acquires a lock, never
// writes to usage/evidence/work-history, never persists returned values.
// ---------------------------------------------------------------------------
async function executeDatasetQuery(workspaceDir, session, palGuid, args, isCount) {
    const palJson = readPalJson(workspaceDir);
    if (!palJson) {
        return { ok: false, error: "cannot read pal.json in workspace " + workspaceDir };
    }

    if (!args || typeof args.dataset !== "string") {
        return { ok: false, error: "dataset is required" };
    }
    let dsErr = validateDatasetName(palJson, args.dataset);
    if (dsErr) return { ok: false, error: "REFUSED: " + dsErr };

    if (args.mode !== undefined && args.mode !== null && !VALID_MODES.has(args.mode)) {
        return { ok: false, error: 'REFUSED: mode must be "AND" or "OR"' };
    }

    const pagingErr = validatePaging(args.startRecord, args.limit, isCount);
    if (pagingErr) return { ok: false, error: "REFUSED: " + pagingErr };

    const condErr = validateConditions(palJson, args.dataset, args.conditions);
    if (condErr) return { ok: false, error: "REFUSED: " + condErr };

    const orderErr = validateOrderBy(palJson, args.dataset, args.orderBy);
    if (orderErr) return { ok: false, error: "REFUSED: " + orderErr };

    // Reject operation / view override attempts if caller somehow passed them
    if (args.operation !== undefined || args.view !== undefined) {
        return { ok: false, error: "REFUSED: operation and view are not caller-settable" };
    }

    const wireFilter = buildWireFilter(args, isCount);

    // String length cap already enforced per field; also enforce filter JSON size quickly
    const filterBytes = Buffer.byteLength(JSON.stringify(wireFilter), "utf8");
    if (filterBytes > 32 * 1024) {
        return { ok: false, error: "REFUSED: filter too large (" + filterBytes + " bytes)" };
    }

    // Evidence: PalBuilderRequest.Operation.QUERY_DATASET (PalBuilderRequest.java)
    // and view:false (DatasetFilter.java isView). This adapter never calls save/sync/recreate.
    let raw;
    try {
        raw = await CloudPistonAPIManager.queryDataset(session, palGuid, wireFilter);
    } catch (e) {
        return { ok: false, error: "dataset query failed: " + (e && e.message ? e.message : String(e)) };
    }

    if (raw === undefined || raw === null) {
        return { ok: false, error: "dataset query request failed — no response; check authentication/server status" };
    }

    // The apiManager may return the ComposerResult's queryResult directly or the full result.
    // Normalize: if raw has queryResult field, use it; else use raw itself if it looks like
    // DatasetQueryResult (has columns/totalRecords). This tolerates both shapes.
    let queryResult = raw;
    if (raw && typeof raw === "object" && raw.queryResult !== undefined) {
        queryResult = raw.queryResult;
    }
    let mapped;
    try {
        mapped = mapResult(queryResult);
    } catch (e) {
        return { ok: false, error: e.message };
    }

    // Row limit first, then the byte cap: a server returning many small rows must not exceed the
    // requested page size just because the payload happens to fit.
    const effectiveLimit = isCount ? 1 : (args.limit !== undefined && args.limit !== null ? args.limit : DEFAULT_QUERY_LIMIT);
    let rows = mapped.rows;
    let truncated = false;
    if (!isCount && rows.length > effectiveLimit) {
        rows = rows.slice(0, effectiveLimit);
        truncated = true;
    }
    const payloadForSize = isCount ? { totalRecords: mapped.totalRecords } : { rows, totalRecords: mapped.totalRecords };
    let bytes = checkResponseBytes(payloadForSize);
    if (!isCount && bytes > MAX_RESPONSE_BYTES) {
        // Truncate row array until under cap, preserving totalRecords truthfully.
        truncated = true;
        let lo = 0;
        let hi = rows.length;
        // Binary search for largest prefix that fits
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            const trial = { rows: rows.slice(0, mid), totalRecords: mapped.totalRecords };
            const b = checkResponseBytes(trial);
            if (b <= MAX_RESPONSE_BYTES) lo = mid;
            else hi = mid - 1;
        }
        rows = rows.slice(0, lo);
        bytes = checkResponseBytes({ rows, totalRecords: mapped.totalRecords });
    }

    if (isCount) {
        return { ok: true, totalRecords: mapped.totalRecords };
    }
    return {
        ok: true,
        rows: rows,
        totalRecords: mapped.totalRecords,
        truncated: truncated,
        responseBytes: bytes
    };
}

module.exports = {
    executeDatasetQuery
};
