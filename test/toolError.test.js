"use strict";
// MCP isError contract: server.js sets isError:true ONLY for results a tool marks toolError —
// the request was invalid or the environment was unavailable. A behavioral outcome stays a normal
// result. We assert at the SERVER routing layer (createServer + in-memory transport), because that
// converter is the single place the flag is applied, and the text of a flagged result must stand
// alone (Pi's extension throws an Error built from that text only).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { tmpWorkspace } = require("./helpers");

const exercisePath = require.resolve("../src/core/exercise");
const screenshotPath = require.resolve("../src/core/screenshot");
const toolsPath = require.resolve("../src/mcp/tools");
const serverPath = require.resolve("../src/mcp/server");

// Wire a client to a server whose getCtx hands back an inert ctx. No lifecycle means
// ensureFreshStart skips the drift gate (it only runs when ctx.lifecycle exists), so these
// calls stay offline and deterministic.
async function connect(workspaceDir) {
    const { createServer } = require("../src/mcp/server");
    const ctx = {
        workspaceDir,
        session: null,
        record: { palGuid: "guid-x", palName: "X", lastModifiedDate: "0" }
    };
    const server = createServer(async () => ctx, workspaceDir);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "tool-error", version: "0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    return client;
}

function restore(modPath, saved) {
    if (saved) require.cache[modPath] = saved;
    else delete require.cache[modPath];
}

// Swap one core module export, then reload tools+server so their destructured imports see the
// stub. Everything else in the real module stays in place. Restored even when the test throws.
async function withStub(modPath, name, value, fn) {
    const savedMod = require.cache[modPath];
    const savedTools = require.cache[toolsPath];
    const savedServer = require.cache[serverPath];
    const real = require(modPath);
    require.cache[modPath] = {
        id: modPath, filename: modPath, loaded: true,
        exports: Object.assign({}, real, { [name]: value })
    };
    delete require.cache[toolsPath];
    delete require.cache[serverPath];
    try {
        return await fn();
    } finally {
        restore(modPath, savedMod);
        restore(toolsPath, savedTools);
        restore(serverPath, savedServer);
    }
}

test("pal_exercise invalid steps is an MCP error whose text carries the reason", async () => {
    const ws = tmpWorkspace();
    const client = await connect(ws);
    // Reaches the real runExercise: whitespace-only expect fails step validation before any
    // server call, which is exactly an invalid REQUEST.
    const res = await client.callTool({ name: "pal_exercise", arguments: { steps: [{ expect: [" "] }] } });
    assert.strictEqual(res.isError, true, "invalid steps must be isError");
    assert.match(res.content[0].text, /INVALID STEPS/);
    assert.match(res.content[0].text, /non-whitespace/);
    await client.close();
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_screenshot invalid-expect is an MCP error whose text carries the reason", async () => {
    const ws = tmpWorkspace();
    const client = await withStub(screenshotPath, "runScreenshot", async () => ({
        captured: false, available: true, blocked: "invalid-expect",
        reason: "expect must be an array of non-whitespace visible strings that prove the requested screen was reached."
    }), () => connect(ws));
    const res = await client.callTool({ name: "pal_screenshot", arguments: { expect: [" "] } });
    assert.strictEqual(res.isError, true, "an invalid expect is a request error");
    assert.match(res.content[0].text, /expect must be an array of non-whitespace/);
    await client.close();
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_dataset_query unknown dataset is an MCP error whose text carries the reason", async () => {
    const palJson = {
        datasets: { entry: [{
            string: "equipment",
            Dataset: { name: "equipment", freeform: true, fields: { DatasetField: [{ fieldName: "a", fieldType: "String" }] } }
        }] }
    };
    const ws = tmpWorkspace({ "pal.json": JSON.stringify(palJson) });
    const client = await connect(ws);
    // Local validation refuses before any server call — an invalid REQUEST, not a server failure.
    const res = await client.callTool({ name: "pal_dataset_query", arguments: { dataset: "missing" } });
    assert.strictEqual(res.isError, true, "unknown dataset must be isError");
    assert.match(res.content[0].text, /unknown dataset "missing"/);
    await client.close();
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_exercise behavioral fail stays a normal result (not isError)", async () => {
    const ws = tmpWorkspace();
    const client = await withStub(exercisePath, "runExercise", async () => ({
        ran: true, kind: "web", mode: "fetch", pass: false, status: "failed", category: "behavior",
        failedStep: 1, steps: [{ step: 1, label: "open", pass: false, error: "missing expected text" }]
    }), () => connect(ws));
    const res = await client.callTool({ name: "pal_exercise", arguments: { steps: [{ action: "open" }] } });
    assert.ok(!res.isError, "a behavioral fail is the pal's result, not a tool error");
    assert.match(res.content[0].text, /BEHAVIOR FAIL/);
    await client.close();
    fs.rmSync(ws, { recursive: true, force: true });
});
