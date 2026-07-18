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
    const ws = tmpWorkspace({ "pages/demo.html": "<c:debug />\n" });
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
