"use strict";
// Regression test for the needsCtx opt-out (server hygiene): a tool flagged needsCtx:false must
// run against a bare { workspaceDir } and NEVER trigger the ctx lifecycle (login + lock + idle
// timer), while a normal tool must resolve ctx exactly as before. We assert at the SERVER routing
// layer — driving createServer over an in-memory transport with a getCtx spy — because that is the
// contract: getCtx() is where login/lock happen, so "did getCtx run?" is "did we touch the server?".
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createServer } = require("../src/mcp/server");
// A fresh empty workspace — pal_validate lints it offline (missing pal.json / files degrade to a
// clean result), so the call succeeds without ever needing a session.
const { tmpWorkspace, parseEnvelope } = require("./helpers");

// Wire a client to a server built around a getCtx spy. The spy records every call and, if it ever
// runs, hands back a deliberately inert ctx (no real session) — so a ctx-requiring tool gets past
// routing but fails downstream, which is fine: we only assert WHETHER getCtx was invoked.
async function connect(workspaceDir) {
    const calls = { getCtx: 0 };
    const getCtx = async () => {
        calls.getCtx++;
        return { workspaceDir, session: null, record: { palGuid: "guid-x", palName: "X", lastModifiedDate: "0" } };
    };
    const server = createServer(getCtx, workspaceDir);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    return { client, calls };
}

test("offline tool (pal_validate) runs WITHOUT resolving ctx and returns deterministic envelopes", async () => {
    const ws = tmpWorkspace({ "pages/demo.html": "<input name=\"demo\">\n" });
    const { client, calls } = await connect(ws);
    const first = await client.callTool({ name: "pal_validate", arguments: {} });
    const second = await client.callTool({ name: "pal_validate", arguments: {} });
    assert.strictEqual(calls.getCtx, 0, "pal_validate must NOT trigger getCtx (no login/lock/session)");
    assert.strictEqual(first.isError, undefined, "pal_validate should succeed against a bare workspace");
    assert.equal(second.content[0].text, first.content[0].text);
    const parsed = parseEnvelope(first.content[0].text);
    assert.equal(parsed.envelope.ok, false);
    assert.ok(parsed.envelope.diagnosticCount > 0);
    await client.close();
    fs.rmSync(ws, { recursive: true, force: true });
});

test("ctx-requiring tool (pal_status) still resolves ctx exactly as before", async () => {
    const ws = tmpWorkspace();
    const { client, calls } = await connect(ws);
    // The inert ctx has session:null, so pal_status fails downstream — but routing MUST have called
    // getCtx first. That call count is the assertion; the downstream error is expected.
    await client.callTool({ name: "pal_status", arguments: {} });
    assert.strictEqual(calls.getCtx, 1, "pal_status must resolve ctx via getCtx (login + lock path)");
    await client.close();
    fs.rmSync(ws, { recursive: true, force: true });
});

test("dataset tools are lockless-but-authenticated: fresh call does not acquire Pal lock", async () => {
    const fs2 = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const apiManagerPath = require.resolve("../lib/apiManager");
    const origApi = require(apiManagerPath);
    const origQuery = origApi.CloudPistonAPIManager.queryDataset;
    origApi.CloudPistonAPIManager.queryDataset = async () => ({
        columns: ["a"],
        data: [["1"]],
        totalRecords: 1,
        startRecord: 0,
        limit: 1
    });
    const dir = fs2.mkdtempSync(path.join(os.tmpdir(), "palsync-dataset-lock-"));
    const palJson = {
        datasets: { entry: [{ string: "equipment", Dataset: { name: "equipment", freeform: true, fields: { DatasetField: [{ fieldName: "a", fieldType: "String" }] } } }] }
    };
    fs2.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(palJson));
    const calls = { lock: 0, noLock: 0, lastOpts: null };
    const getCtx = async (opts) => {
        calls.lastOpts = opts || {};
        if (opts && opts.acquireLock === false) calls.noLock++;
        else calls.lock++;
        return { workspaceDir: dir, session: { username: "u" }, record: { palGuid: "g", palName: "p", lastModifiedDate: "0" }, lifecycle: { onActivity() {} } };
    };
    const { createServer: createServer2 } = require("../src/mcp/server");
    const server = createServer2(getCtx, dir);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "dataset-lock", version: "0" });
    await Promise.all([server.connect(st), client.connect(ct)]);
    const res = await client.callTool({ name: "pal_dataset_query", arguments: { dataset: "equipment" } });
    assert.equal(calls.lock, 0, "fresh dataset query must not trigger lock acquisition");
    assert.equal(calls.noLock, 1, "fresh dataset query must call getCtx with acquireLock:false");
    assert.equal(calls.lastOpts.acquireLock, false);
    // Count tool also lockless
    calls.lock = 0;
    calls.noLock = 0;
    // Need fresh server to avoid memoization reuse of previous unlocked ctx
    const dir2 = fs2.mkdtempSync(path.join(os.tmpdir(), "palsync-dataset-lock2-"));
    fs2.writeFileSync(path.join(dir2, "pal.json"), JSON.stringify(palJson));
    const getCtx2 = async (opts) => {
        if (opts && opts.acquireLock === false) calls.noLock++;
        else calls.lock++;
        return { workspaceDir: dir2, session: { username: "u" }, record: { palGuid: "g", palName: "p", lastModifiedDate: "0" }, lifecycle: { onActivity() {} } };
    };
    const server2 = createServer2(getCtx2, dir2);
    const [ct2, st2] = InMemoryTransport.createLinkedPair();
    const client2 = new Client({ name: "dataset-count-lock", version: "0" });
    await Promise.all([server2.connect(st2), client2.connect(ct2)]);
    await client2.callTool({ name: "pal_dataset_count", arguments: { dataset: "equipment" } });
    assert.equal(calls.lock, 0, "pal_dataset_count must not acquire lock");
    // noLock should have incremented for count as well (second server's fresh call)
    await client.close();
    await client2.close();
    origApi.CloudPistonAPIManager.queryDataset = origQuery;
    fs2.rmSync(dir, { recursive: true, force: true });
    fs2.rmSync(dir2, { recursive: true, force: true });
});
