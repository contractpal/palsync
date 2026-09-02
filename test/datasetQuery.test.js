"use strict";
// MCP tool-wrapper seam tests for pal_dataset_query and pal_dataset_count.
// Invoke the advertised descriptor from TOOLS, stub the server, never call CloudPiston.
// Covers: wire shape (verified identity contract + XStream list wrappers), operator mapping,
// paging, row mapping, count-only, every distinct server-error branch, malformed response,
// every cap, invalid dataset/column/operator/bounds rejected before server, no mutating
// endpoint reachable, and no local artifact written.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const apiManagerPath = require.resolve("../lib/apiManager");
const usagePath = require.resolve("../src/core/usage");
const workHistoryPath = require.resolve("../src/mcp/workHistory");

function tmpWorkspaceWithDataset() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-dataset-"));
    const palJson = {
        datasets: {
            entry: [{
                string: "equipment",
                Dataset: {
                    name: "equipment",
                    freeform: true,
                    fields: {
                        DatasetField: [
                            { fieldName: "equipmentId", fieldType: "Primary key" },
                            { fieldName: "name", fieldType: "String", fieldSize: 100 },
                            { fieldName: "status", fieldType: "String", fieldSize: 20 },
                            { fieldName: "category", fieldType: "String", fieldSize: 50 }
                        ]
                    }
                }
            }, {
                string: "orders",
                Dataset: {
                    name: "orders",
                    freeform: true,
                    fields: {
                        DatasetField: [
                            { fieldName: "orderId", fieldType: "Primary key" },
                            { fieldName: "total", fieldType: "Number" }
                        ]
                    }
                }
            }]
        }
    };
    fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(palJson));
    fs.writeFileSync(path.join(dir, ".palsync.json"), JSON.stringify({
        palGuid: "test-guid-123",
        palName: "test-pal",
        lastModifiedDate: "2026-01-01 00:00:00.0",
        localHash: "abc"
    }));
    return dir;
}

// The XStream class tags QUERY_DATASET requires for DatasetFilter's two lists.
const CONDITION_CRITERIA = "com.contractpal.palbuilder.ConditionCriteria";
const COLUMN_ORDER_CRITERIA = "com.contractpal.palbuilder.ColumnOrderCriteria";

// Wrap a flat DatasetQueryResult fixture in the real wire shape: a ComposerResult whose
// customObject is the PalBuilderResponse, with CloudPiston's per-type list child tags
// (columns -> { string: [...] }, data -> { "string-array": [{ string: [cells] }] }).
function composerOk({ columns, data, totalRecords, startRecord, limit }) {
    const queryResult = { startRecord, limit, totalRecords };
    if (columns !== undefined) queryResult.columns = { string: columns };
    if (data !== undefined) queryResult.data = { "string-array": data.map(cells => ({ string: cells })) };
    return { success: true, customObject: { success: true, queryResult } };
}

function composerFailure(message) {
    return { success: false, messages: { "com.contractpal.Message": { message, type: "service" } } };
}

function loadToolsWithStub({ queryResult, rawResponse, queryImpl, capture }) {
    // Stub apiManager.queryDataset
    const origApi = require(apiManagerPath);
    const origQuery = origApi.CloudPistonAPIManager.queryDataset;
    let callCount = 0;
    let lastFilter = null;
    let lastResolved = null;
    const stub = async (session, resolved, filter) => {
        callCount++;
        lastResolved = resolved;
        lastFilter = JSON.parse(JSON.stringify(filter));
        if (capture) capture.filter = lastFilter;
        if (capture) capture.resolved = lastResolved;
        if (queryImpl) return queryImpl(session, resolved, filter);
        if (rawResponse !== undefined) return rawResponse;
        if (queryResult !== undefined) return composerOk(queryResult);
        return composerOk({
            columns: ["equipmentId", "name", "status"],
            data: [["1", "Hammer", "available"], ["2", "Drill", "checked"]],
            totalRecords: 42,
            startRecord: filter.startRecord,
            limit: filter.limit
        });
    };
    origApi.CloudPistonAPIManager.queryDataset = stub;

    // Also stub out usage / workHistory writes to detect persistence
    const usageMod = require(usagePath);
    const origAppendEvidence = usageMod.appendToolEvidence;
    const origRecordCall = usageMod.recordToolCall;
    let evidenceWritten = false;
    let evidenceRowsLeaked = false;
    usageMod.appendToolEvidence = (_dir, entry) => {
        evidenceWritten = true;
        const s = JSON.stringify(entry);
        if (s.includes("Hammer") || s.includes("Drill") || s.includes("SECRET_ROW")) evidenceRowsLeaked = true;
        return false;
    };
    usageMod.recordToolCall = () => {};

    const whMod = require(workHistoryPath);
    const origCreateRun = whMod.createWorkHistoryRun;
    const origWriteArtifact = whMod.writeArtifactFile;
    let workHistoryWritten = false;
    whMod.createWorkHistoryRun = () => { workHistoryWritten = true; return null; };
    whMod.writeArtifactFile = () => { workHistoryWritten = true; return null; };

    // Clear tools cache to pick up current adapter state
    const toolsPath = require.resolve("../src/mcp/tools");
    delete require.cache[toolsPath];
    const { TOOLS } = require("../src/mcp/tools");
    const queryTool = TOOLS.find(t => t.name === "pal_dataset_query");
    const countTool = TOOLS.find(t => t.name === "pal_dataset_count");

    function restore() {
        origApi.CloudPistonAPIManager.queryDataset = origQuery;
        usageMod.appendToolEvidence = origAppendEvidence;
        usageMod.recordToolCall = origRecordCall;
        whMod.createWorkHistoryRun = origCreateRun;
        whMod.writeArtifactFile = origWriteArtifact;
        delete require.cache[toolsPath];
    }

    return {
        queryTool,
        countTool,
        getCallCount: () => callCount,
        getLastFilter: () => lastFilter,
        getLastResolved: () => lastResolved,
        wasEvidenceWritten: () => evidenceWritten,
        wasRowsLeaked: () => evidenceRowsLeaked,
        wasWorkHistoryWritten: () => workHistoryWritten,
        restore
    };
}

function makeCtx(workspaceDir) {
    return {
        workspaceDir,
        session: { username: "u", password: "p", userId: "uid", environment: { url: "https://example.com" } },
        record: { palGuid: "test-guid-123", palName: "test-pal", lastModifiedDate: "2026-01-01 00:00:00.0", localHash: "abc" },
        // The lock lifecycle's already-resolved pal — what QUERY_DATASET's identity contract needs.
        lifecycle: { onActivity() {}, lockState: { resolved: RESOLVED } },
        persist: async () => {}
    };
}

const RESOLVED = { id: "INTERNAL-SESSION-ID", guid: "test-guid-123", profileId: "REAL-PROFILE-ID" };

// Adapter-level resolver matching what the MCP handlers pass in.
const resolvePal = async () => RESOLVED;

test("query wire shape: hard-coded QUERY_DATASET, dataset mode, paging, mode, conditions, order", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);
    const capture = {};
    const loaded = loadToolsWithStub({ capture });
    const res = await loaded.queryTool.run(ctx, {
        dataset: "equipment",
        startRecord: 5,
        limit: 10,
        mode: "OR",
        conditions: [{ column: "status", operator: "EQUAL", value1: "available" }],
        orderBy: [{ column: "name", order: "DESC" }]
    });
    assert.equal(res.ok, true);
    assert.equal(loaded.getCallCount(), 1);
    const f = loaded.getLastFilter();
    assert.equal(f.name, "equipment");
    assert.equal(f.view, false, "must be dataset mode, not DataView (DatasetFilter.java isView)");
    assert.equal(f.startRecord, 5);
    assert.equal(f.limit, 10);
    assert.equal(f.mode, "OR");
    // Each list is ONE wrapper element holding class-tagged entries. A plain array would make the
    // XML builder repeat the <criterias> wrapper per entry, which the server rejects.
    assert.deepStrictEqual(f.criterias, { [CONDITION_CRITERIA]: [{ column: "status", operator: "EQUAL", value1: "available" }] });
    assert.deepStrictEqual(f.selectOrder, { [COLUMN_ORDER_CRITERIA]: [{ column: "name", order: "DESC" }] });
    // Current Pal only, and the resolved record the identity contract requires.
    assert.deepStrictEqual(loaded.getLastResolved(), RESOLVED);
    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
});

test("operator vocabulary mapping for every vendored operator", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);
    // Use a mix that covers all operator arities: NULL (no value), EQUAL (one), BETWEEN (two)
    const ops = [
        { col: "status", op: "NULL", vals: {} },
        { col: "status", op: "NOT_NULL", vals: {} },
        { col: "status", op: "EQUAL", vals: { value1: "x" } },
        { col: "status", op: "NOT_EQUAL", vals: { value1: "x" } },
        { col: "status", op: "GREATER_THAN", vals: { value1: "x" } },
        { col: "status", op: "LESS_THAN", vals: { value1: "x" } },
        { col: "status", op: "GREATER_THAN_EQUAL", vals: { value1: "x" } },
        { col: "status", op: "LESS_THAN_EQUAL", vals: { value1: "x" } },
        { col: "status", op: "BETWEEN", vals: { value1: "a", value2: "z" } },
        { col: "status", op: "LIKE", vals: { value1: "%test%" } },
        { col: "status", op: "NOT_LIKE", vals: { value1: "%test%" } }
    ];
    for (const { col, op, vals } of ops) {
        const loaded = loadToolsWithStub({
            queryResult: { columns: ["status"], data: [["x"]], totalRecords: 1, startRecord: 0, limit: 1 }
        });
        const cond = Object.assign({ column: col, operator: op }, vals);
        const res = await loaded.queryTool.run(ctx, { dataset: "equipment", conditions: [cond] });
        assert.equal(res.ok, true, op + " should be accepted");
        const entries = loaded.getLastFilter().criterias[CONDITION_CRITERIA];
        assert.equal(entries[0].operator, op, op + " operator must pass through verbatim");
        if (vals.value1 !== undefined) assert.equal(entries[0].value1, vals.value1);
        if (vals.value2 !== undefined) assert.equal(entries[0].value2, vals.value2);
        loaded.restore();
    }
    fs.rmSync(dir, { recursive: true, force: true });
});

test("row mapping: columns/data aligned to row objects including empty and null cells", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);
    const loaded = loadToolsWithStub({
        queryResult: {
            columns: ["equipmentId", "name", "status"],
            data: [
                ["1", "Hammer", "available"],
                ["2", "", null],
                ["3", "Wrench"]
            ],
            totalRecords: 3,
            startRecord: 0,
            limit: 10
        }
    });
    const res = await loaded.queryTool.run(ctx, { dataset: "equipment" });
    assert.equal(res.ok, true);
    assert.equal(res.rows.length, 3);
    assert.deepStrictEqual(res.rows[0], { equipmentId: "1", name: "Hammer", status: "available" });
    assert.deepStrictEqual(res.rows[1], { equipmentId: "2", name: "", status: null });
    // Short row pads missing trailing columns with null
    assert.deepStrictEqual(res.rows[2], { equipmentId: "3", name: "Wrench", status: null });
    assert.equal(res.totalRecords, 3);
    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
});

test("query returns rows plus totalRecords, count returns only totalRecords and requests one row", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);

    // Query path
    {
        const loaded = loadToolsWithStub({
            queryResult: { columns: ["a"], data: [["1"], ["2"]], totalRecords: 100, startRecord: 0, limit: 20 }
        });
        const res = await loaded.queryTool.run(ctx, { dataset: "equipment", limit: 20 });
        assert.equal(res.ok, true);
        assert.ok(Array.isArray(res.rows), "query must return rows");
        assert.equal(typeof res.totalRecords, "number");
        assert.equal(loaded.getLastFilter().limit, 20);
        loaded.restore();
    }
    // Count path — hard-coded limit 1, no rows in return
    {
        const loaded = loadToolsWithStub({
            queryResult: { columns: ["a"], data: [["1"]], totalRecords: 99, startRecord: 0, limit: 1 }
        });
        const res = await loaded.countTool.run(ctx, {
            dataset: "equipment",
            conditions: [{ column: "status", operator: "EQUAL", value1: "available" }]
        });
        assert.equal(res.ok, true);
        assert.equal(res.totalRecords, 99);
        assert.equal(res.rows, undefined, "count must not return rows");
        assert.equal(loaded.getLastFilter().limit, 1, "count must request at most one row");
        assert.equal(loaded.getLastFilter().startRecord, 0);
        loaded.restore();
    }
    fs.rmSync(dir, { recursive: true, force: true });
});

test("count ignores caller limit and always requests one row", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);
    const loaded = loadToolsWithStub({
        queryResult: { columns: ["a"], data: [["1"]], totalRecords: 5, startRecord: 0, limit: 1 }
    });
    // Even if caller tries to pass limit via count (not in schema, but adapter hard-codes)
    const res = await loaded.countTool.run(ctx, { dataset: "equipment" });
    assert.equal(res.ok, true);
    assert.equal(loaded.getLastFilter().limit, 1);
    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
});

test("malformed server response is refused clearly", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);
    const malformedCases = [
        { queryResult: {} },
        { queryResult: { columns: "not-a-list", data: { "string-array": [] }, totalRecords: 0 } },
        { queryResult: { columns: { string: [] }, data: "not-a-list", totalRecords: 0 } },
        { queryResult: { columns: { string: [] }, data: { "string-array": [] }, totalRecords: "not-a-number" } },
        { queryResult: { columns: { string: ["a"] }, data: { "string-array": ["not-a-row"] }, totalRecords: 1 } }
    ];
    for (const bad of malformedCases) {
        const loaded = loadToolsWithStub({ rawResponse: { success: true, customObject: bad } });
        const res = await loaded.queryTool.run(ctx, { dataset: "equipment" });
        assert.equal(res.ok, false, "should refuse malformed " + JSON.stringify(bad));
        assert.match(res.error, /malformed/i);
        loaded.restore();
    }
    fs.rmSync(dir, { recursive: true, force: true });
});

// Every distinct transport/server failure gets its OWN message. An empty 200 used to be reported
// as "no response; check authentication/server status", which pointed at authentication when the
// server had simply declined a malformed request — the false hint that made this bug expensive.
test("each server failure mode is reported honestly and distinctly", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);

    // HTTP non-2xx: fetchAPI returns undefined but records the status.
    {
        const loaded = loadToolsWithStub({
            queryImpl: async (session) => {
                session.lastTransport = { endpoint: "ProcessPalBuilder.do", status: 503, ok: false, bytes: null };
                return undefined;
            }
        });
        const res = await loaded.queryTool.run(ctx, { dataset: "equipment" });
        assert.equal(res.ok, false);
        assert.match(res.error, /HTTP 503/);
        assert.doesNotMatch(res.error, /authentication/i, "an HTTP failure must not be blamed on authentication");
        loaded.restore();
    }

    // HTTP 200 with a zero-byte body: the server declined the request.
    {
        const loaded = loadToolsWithStub({
            queryImpl: async (session) => {
                session.lastTransport = { endpoint: "ProcessPalBuilder.do", status: 200, ok: true, bytes: 0 };
                return undefined;
            }
        });
        const res = await loaded.queryTool.run(ctx, { dataset: "equipment" });
        assert.equal(res.ok, false);
        assert.match(res.error, /declined/i);
        assert.match(res.error, /QUERY_DATASET/);
        assert.match(res.error, /empty body/i);
        assert.doesNotMatch(res.error, /authentication/i, "an empty 200 must not be blamed on authentication");
        loaded.restore();
    }

    // success=false: the server's own message, verbatim.
    for (const msg of ["Pal not found", "Invalid request", "Dataset not found: ghost", "Secure ID is null"]) {
        const loaded = loadToolsWithStub({ rawResponse: composerFailure(msg) });
        const res = await loaded.queryTool.run(ctx, { dataset: "equipment" });
        assert.equal(res.ok, false);
        assert.ok(res.error.includes(msg), "must surface the server message verbatim: " + res.error);
        loaded.restore();
    }

    // success=false with no message at all still says so rather than inventing a cause.
    {
        const loaded = loadToolsWithStub({ rawResponse: { success: false } });
        const res = await loaded.queryTool.run(ctx, { dataset: "equipment" });
        assert.equal(res.ok, false);
        assert.match(res.error, /no message returned/i);
        loaded.restore();
    }

    // An unresolvable pal is reported as such, and never reaches the server.
    {
        const loaded = loadToolsWithStub({});
        const { executeDatasetQuery } = require("../src/core/datasetQuery");
        const res = await executeDatasetQuery(dir, ctx.session, "test-guid-123", { dataset: "equipment" }, false, async () => null);
        assert.equal(res.ok, false);
        assert.match(res.error, /could not resolve pal/i);
        assert.equal(loaded.getCallCount(), 0);
        loaded.restore();
    }

    fs.rmSync(dir, { recursive: true, force: true });
});

// A zero-row result omits columns and data entirely — server-verified. That is success, not
// a malformed response.
test("empty result set maps to zero rows, not an error", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);
    const loaded = loadToolsWithStub({
        rawResponse: { success: true, customObject: { queryResult: { startRecord: 0, limit: 5, totalRecords: 0 } } }
    });
    const res = await loaded.queryTool.run(ctx, { dataset: "equipment", limit: 5 });
    assert.equal(res.ok, true);
    assert.deepStrictEqual(res.rows, []);
    assert.equal(res.totalRecords, 0);
    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
});

// A single row / single column comes back unwrapped (not an array) from the XML parse.
test("single-row and single-column responses map correctly", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);
    const loaded = loadToolsWithStub({
        rawResponse: { success: true, customObject: { queryResult: {
            startRecord: 0, limit: 1, totalRecords: 1,
            columns: { string: "equipmentId" },
            data: { "string-array": { string: "7" } }
        } } }
    });
    const res = await loaded.queryTool.run(ctx, { dataset: "equipment", limit: 1 });
    assert.equal(res.ok, true);
    assert.deepStrictEqual(res.rows, [{ equipmentId: "7" }]);
    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
});

test("caps: every cap is enforced — row count, condition count, string lengths, response bytes", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);

    // limit cap 100 — schema (zod) rejects >100, adapter also rejects
    {
        const loaded = loadToolsWithStub({});
        // Bypass zod by calling adapter directly with limit 200 (simulates caller tampering)
        const { executeDatasetQuery } = require("../src/core/datasetQuery");
        const r = await executeDatasetQuery(dir, ctx.session, ctx.record.palGuid, { dataset: "equipment", limit: 200 }, false, resolvePal);
        assert.equal(r.ok, false);
        assert.match(r.error, /limit/i);
        assert.equal(loaded.getCallCount(), 0, "must be refused before server call");
        loaded.restore();
    }

    // condition count cap
    {
        const loaded = loadToolsWithStub({});
        const many = Array.from({ length: 25 }, () => ({ column: "status", operator: "EQUAL", value1: "x" }));
        const res = await loaded.queryTool.run(ctx, { dataset: "equipment", conditions: many });
        assert.equal(res.ok, false);
        assert.match(res.error, /too many conditions/i);
        assert.equal(loaded.getCallCount(), 0);
        loaded.restore();
    }

    // string length cap — value1 too long
    {
        const loaded = loadToolsWithStub({});
        const long = "x".repeat(600);
        const res = await loaded.queryTool.run(ctx, { dataset: "equipment", conditions: [{ column: "status", operator: "EQUAL", value1: long }] });
        assert.equal(res.ok, false);
        assert.match(res.error, /exceeds/i);
        assert.equal(loaded.getCallCount(), 0);
        loaded.restore();
    }

    // dataset name length cap
    {
        const loaded = loadToolsWithStub({});
        const longName = "x".repeat(300);
        const res = await loaded.queryTool.run(ctx, { dataset: longName });
        assert.equal(res.ok, false);
        loaded.restore();
    }

    // response byte cap — honest truncation
    {
        const hugeRows = Array.from({ length: 100 }, (_, i) => [String(i), "x".repeat(5000), "available"]);
        const loaded = loadToolsWithStub({
            queryResult: {
                columns: ["equipmentId", "name", "status"],
                data: hugeRows,
                totalRecords: 100,
                startRecord: 0,
                limit: 100
            }
        });
        const res = await loaded.queryTool.run(ctx, { dataset: "equipment", limit: 100 });
        assert.equal(res.ok, true);
        assert.equal(res.truncated, true, "huge response must be truncated honestly");
        assert.ok(res.rows.length < 100, "truncated rows fewer than total");
        assert.equal(res.totalRecords, 100, "totalRecords stays truthful even when truncated");
        loaded.restore();
    }

    fs.rmSync(dir, { recursive: true, force: true });
});

test("invalid dataset / column / operator / bounds are rejected before server call", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);

    const cases = [
        { args: { dataset: "nonexistent" }, msg: /unknown dataset/i },
        { args: { dataset: "equipment", conditions: [{ column: "nope", operator: "EQUAL", value1: "x" }] }, msg: /unknown column/i },
        { args: { dataset: "equipment", conditions: [{ column: "status", operator: "FAKE_OP", value1: "x" }] }, msg: /operator/i },
        { args: { dataset: "equipment", startRecord: -1 }, msg: /startRecord/i },
        { args: { dataset: "equipment", limit: 0 }, msg: /limit/i },
        { args: { dataset: "equipment", mode: "XOR" }, msg: /mode/i },
        { args: { dataset: "equipment", conditions: [{ column: "status", operator: "NULL", value1: "x" }] }, msg: /must not have value1/i },
        { args: { dataset: "equipment", conditions: [{ column: "status", operator: "EQUAL" }] }, msg: /requires value1/i },
        { args: { dataset: "equipment", conditions: [{ column: "status", operator: "BETWEEN", value1: "a" }] }, msg: /requires value2/i },
        { args: { dataset: "equipment", conditions: [{ column: "status", operator: "EQUAL", value1: "x", value2: "y" }] }, msg: /must not have value2/i },
        { args: { dataset: "equipment", orderBy: [{ column: "nope", order: "ASC" }] }, msg: /unknown column/i },
        { args: { dataset: "equipment", orderBy: [{ column: "status", order: "FOO" }] }, msg: /order/i }
    ];

    for (const { args, msg } of cases) {
        const loaded = loadToolsWithStub({});
        const res = await loaded.queryTool.run(ctx, args);
        assert.equal(res.ok, false, "should refuse " + JSON.stringify(args));
        assert.match(res.error, msg, JSON.stringify(args) + " error " + res.error);
        assert.equal(loaded.getCallCount(), 0, "invalid input must not reach server for " + JSON.stringify(args));
        loaded.restore();
    }
    fs.rmSync(dir, { recursive: true, force: true });
});

test("operation is hard-coded to QUERY_DATASET — caller input cannot select save/update/sync/recreate", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);

    // Even if caller tries to smuggle operation / view inside args, adapter rejects or ignores
    {
        const loaded = loadToolsWithStub({});
        const res = await loaded.queryTool.run(ctx, { dataset: "equipment", operation: "UPDATE", view: true });
        assert.equal(res.ok, false);
        assert.match(res.error, /not caller-settable/i);
        assert.equal(loaded.getCallCount(), 0);
        loaded.restore();
    }

    // The apiManager layer hard-codes operation — verify the task always has QUERY_DATASET
    {
        const apiMod = require(apiManagerPath);
        let capturedTask = null;
        let capturedEndpoint = null;
        const origFetch = apiMod.CloudPistonAPIManager.fetchAPI;
        apiMod.CloudPistonAPIManager.fetchAPI = async (_session, endpoint, _headers, task) => {
            capturedTask = task;
            capturedEndpoint = endpoint;
            return { columns: [], data: [], totalRecords: 0, startRecord: 0, limit: 1 };
        };
        let capturedHeaders = null;
        apiMod.CloudPistonAPIManager.fetchAPI = async (_session, endpoint, headers, task) => {
            capturedTask = task;
            capturedEndpoint = endpoint;
            capturedHeaders = headers;
            return { success: true, customObject: { queryResult: { startRecord: 0, limit: 1, totalRecords: 0 } } };
        };
        try {
            await apiMod.CloudPistonAPIManager.queryDataset(ctx.session, RESOLVED, {
                name: "equipment", view: false, startRecord: 0, limit: 1, mode: "AND"
            });
            const req = capturedTask["com.contractpal.palbuilder.PalBuilderRequest"];
            assert.equal(req.operation, "QUERY_DATASET", "operation must be hard-coded QUERY_DATASET (PalBuilderRequest.java Operation.QUERY_DATASET)");
            assert.equal(req.datasetFilter.view, false, "must be dataset mode (DatasetFilter.java isView false)");
            assert.equal(capturedEndpoint, "ProcessPalBuilder.do");
            // Verified identity contract: guid + real profileId in the BODY, internal id in the
            // palId HEADER with profileId "-1". The guid in the palId header is what made the
            // server answer HTTP 200 with a zero-byte body.
            assert.equal(req.palId, RESOLVED.guid, "body palId must be the stable PAL-SE guid");
            assert.equal(req.profileId, RESOLVED.profileId, "body profileId must be the real profile id");
            assert.equal(capturedHeaders.get("palId"), RESOLVED.id, "header palId must be the internal session id");
            assert.equal(capturedHeaders.get("profileId"), "-1");
            assert.equal(capturedHeaders.get("lock-information"), null, "read path must not send a lock header");
        } finally {
            apiMod.CloudPistonAPIManager.fetchAPI = origFetch;
        }
    }

    fs.rmSync(dir, { recursive: true, force: true });
});

test("never acquires a Pal lock and never calls save/sync/recreate", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);
    const apiMod = require(apiManagerPath);
    let lockCalled = false;
    let saveCalled = false;
    let syncCalled = false;
    const origLock = apiMod.CloudPistonAPIManager.lockPal;
    const origSave = apiMod.CloudPistonAPIManager.savePal;
    const origSync = apiMod.CloudPistonAPIManager.syncDataSets;
    apiMod.CloudPistonAPIManager.lockPal = async () => { lockCalled = true; };
    apiMod.CloudPistonAPIManager.savePal = async () => { saveCalled = true; };
    apiMod.CloudPistonAPIManager.syncDataSets = async () => { syncCalled = true; };

    const loaded = loadToolsWithStub({
        queryResult: { columns: ["a"], data: [["1"]], totalRecords: 1, startRecord: 0, limit: 1 }
    });
    const res = await loaded.queryTool.run(ctx, { dataset: "equipment" });
    assert.equal(res.ok, true);
    assert.equal(lockCalled, false, "must never call lockPal");
    assert.equal(saveCalled, false, "must never call savePal");
    assert.equal(syncCalled, false, "must never call syncDataSets");

    apiMod.CloudPistonAPIManager.lockPal = origLock;
    apiMod.CloudPistonAPIManager.savePal = origSave;
    apiMod.CloudPistonAPIManager.syncDataSets = origSync;
    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
});

test("returned values are not persisted into usage, evidence, or work-history", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);
    const secret = "SECRET_ROW_VALUE_12345";
    const loaded = loadToolsWithStub({
        queryResult: {
            columns: ["equipmentId", "name"],
            data: [["1", secret]],
            totalRecords: 1,
            startRecord: 0,
            limit: 1
        }
    });
    const res = await loaded.queryTool.run(ctx, { dataset: "equipment" });
    assert.equal(res.ok, true);
    assert.equal(loaded.wasEvidenceWritten(), false, "must not write tool evidence");
    assert.equal(loaded.wasRowsLeaked(), false, "must not leak row values into evidence");
    assert.equal(loaded.wasWorkHistoryWritten(), false, "must not write work-history artifacts");

    // Also verify no file on disk contains the secret (usage file, evidence file, work-history)
    const usageFile = path.join(dir, ".palsync.usage.json");
    const evidenceFile = path.join(dir, ".palsync", "tool-evidence.jsonl");
    const historyDir = path.join(dir, ".agent-work-history");
    for (const p of [usageFile, evidenceFile]) {
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, "utf8");
            assert.equal(content.includes(secret), false, p + " must not contain row value");
        }
    }
    if (fs.existsSync(historyDir)) {
        const files = fs.readdirSync(historyDir, { recursive: true });
        for (const f of files) {
            const content = fs.readFileSync(path.join(historyDir, f), "utf8");
            assert.equal(content.includes(secret), false, "work-history must not contain row value");
        }
    }

    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
});

test("both tools are read-only in MCP annotations", () => {
    const toolsPath = require.resolve("../src/mcp/tools");
    delete require.cache[toolsPath];
    const { TOOLS } = require("../src/mcp/tools");
    const q = TOOLS.find(t => t.name === "pal_dataset_query");
    const c = TOOLS.find(t => t.name === "pal_dataset_count");
    assert.ok(q, "pal_dataset_query must exist");
    assert.ok(c, "pal_dataset_count must exist");
    for (const t of [q, c]) {
        assert.equal(t.annotations.readOnlyHint, true, t.name + " must be readOnly");
        assert.equal(t.annotations.destructiveHint, false, t.name + " must be non-destructive");
        assert.equal(t.annotations.idempotentHint, true, t.name + " must be idempotent");
    }
});

test("Current Pal only: validates against local manifest, view is always false", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);
    // Unknown dataset is refused locally (no server call) — proves local manifest validation
    {
        const loaded = loadToolsWithStub({});
        const res = await loaded.queryTool.run(ctx, { dataset: "ghost" });
        assert.equal(res.ok, false);
        assert.match(res.error, /unknown dataset/i);
        assert.equal(loaded.getCallCount(), 0);
        loaded.restore();
    }
    // Known dataset passes and view is hard-coded false
    {
        const loaded = loadToolsWithStub({});
        const res = await loaded.queryTool.run(ctx, { dataset: "orders" });
        assert.equal(res.ok, true);
        assert.equal(loaded.getLastFilter().view, false);
        loaded.restore();
    }
    fs.rmSync(dir, { recursive: true, force: true });
});

test("paging honored: startRecord and limit map exactly to wire filter", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);
    const loaded = loadToolsWithStub({
        queryResult: { columns: ["a"], data: [], totalRecords: 0, startRecord: 10, limit: 5 }
    });
    const res = await loaded.queryTool.run(ctx, { dataset: "equipment", startRecord: 10, limit: 5 });
    assert.equal(res.ok, true);
    assert.equal(loaded.getLastFilter().startRecord, 10);
    assert.equal(loaded.getLastFilter().limit, 5);
    loaded.restore();
    fs.rmSync(dir, { recursive: true, force: true });
});

test("returned rows are bounded by effective requested limit before byte truncation", async () => {
    const dir = tmpWorkspaceWithDataset();
    const ctx = makeCtx(dir);
    const manyRows = Array.from({ length: 20 }, (_, i) => [String(i), "name" + i, "available"]);
    const loaded = loadToolsWithStub({
        queryResult: {
            columns: ["equipmentId", "name", "status"],
            data: manyRows,
            totalRecords: 20,
            startRecord: 0,
            limit: 100
        }
    });
    const res = await loaded.queryTool.run(ctx, { dataset: "equipment", limit: 5 });
    assert.equal(res.ok, true);
    assert.equal(res.rows.length, 5, "must enforce effective limit even when server returns more rows");
    assert.equal(res.truncated, true, "truncation must be reported honestly when rows exceed limit");
    assert.equal(res.totalRecords, 20, "totalRecords stays truthful");
    // Default limit (20) when no limit arg: server returns 30 rows, only 20 returned
    const loaded2 = loadToolsWithStub({
        queryResult: {
            columns: ["equipmentId", "name", "status"],
            data: Array.from({ length: 30 }, (_, i) => [String(i), "n" + i, "available"]),
            totalRecords: 30,
            startRecord: 0,
            limit: 100
        }
    });
    const res2 = await loaded2.queryTool.run(ctx, { dataset: "equipment" });
    assert.equal(res2.ok, true);
    assert.equal(res2.rows.length, 20, "default limit 20 must be enforced");
    assert.equal(res2.truncated, true);
    loaded.restore();
    loaded2.restore();
    fs.rmSync(dir, { recursive: true, force: true });
});
