"use strict";
// The server lists and enables every tool: prompt-side gating lives in the harness, and Pi's
// native extension is the only prompt gate (see docs/decisions/lazy-tool-activation.md).
// Keyword routing over pi-tools.json metadata stays tested here because that extension still
// uses routeTools to decide which tools to activate in the prompt.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createServer, TOOLS } = require("../src/mcp/server");
const metadata = require("../src/mcp/pi-tools.json");
const { routeTools } = require("../src/core/piHelpers");
const { tmpWorkspace } = require("./helpers");

async function connect(workspaceDir) {
    const ws = workspaceDir || tmpWorkspace();
    const server = createServer(async () => { throw new Error("context must stay lazy"); }, ws);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "tool-listing-test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, workspaceDir: ws };
}

test("server lists and enables every tool, with no pal_tools", async () => {
    const { client, workspaceDir } = await connect();
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.deepStrictEqual(names, TOOLS.map(tool => tool.name).sort(), "every TOOLS entry is advertised");
    assert.ok(!names.includes("pal_tools"), "the server never gates tools with pal_tools");
    // A tool that used to be lazy in the Pi profile is callable directly — no activation round trip.
    const result = await client.callTool({ name: "pal_status", arguments: {} });
    const text = (result.content || []).map(item => item.text || "").join("\n");
    assert.doesNotMatch(text, /disabled|not enabled|not found/i);
    await client.close();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
});

test("regression: the Pi extension is the only prompt gate", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "pi-extension", "index.ts"), "utf8");
    assert.doesNotMatch(source, /PALSYNC_TOOL_PROFILE/, "the extension must not spawn the server with a tool profile");
    assert.doesNotMatch(source, /client!?\.call\(\s*["']pal_tools["']/, "pal_tools must not call the server");
});

test("pal_impact is lazily reachable by weak-model words and not in the eager core", () => {
    const eager = require("../src/core/piHelpers").eagerToolNames(metadata);
    assert.ok(!eager.includes("pal_impact"), "pal_impact must stay lazy (zero eager bytes)");
    for (const query of ["impact", "dependents", "blast radius", "affected"]) {
        assert.ok(routeTools(query, metadata).includes("pal_impact"), query);
    }
    assert.ok(routeTools("project", metadata).includes("pal_impact"), "project group");
});

test("pal_ast is lazily reachable by weak-model words and not in the eager core", () => {
    const eager = require("../src/core/piHelpers").eagerToolNames(metadata);
    assert.ok(!eager.includes("pal_ast"), "pal_ast must stay lazy (zero eager bytes)");
    for (const query of ["ast", "refactor", "rename", "pattern", "structural", "codemod", "search", "rewrite"]) {
        assert.ok(routeTools(query, metadata).includes("pal_ast"), query);
    }
    assert.ok(routeTools("project", metadata).includes("pal_ast"), "project group");
});

test("dataset routing reaches sync and query for singular and plural requests", () => {
    const expected = ["pal_dataset_query", "pal_sync_datasets"];
    for (const query of ["dataset", "datasets"]) {
        assert.deepStrictEqual(routeTools(query, metadata).sort(), expected, query);
    }
    assert.ok(routeTools("query", metadata).includes("pal_dataset_query"));
    assert.ok(routeTools("data", metadata).includes("pal_dataset_query"));
    assert.ok(routeTools("sync", metadata).includes("pal_sync_datasets"));
});
