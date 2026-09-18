

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { ToolListChangedNotificationSchema } = require("@modelcontextprotocol/sdk/types.js");
const { createServer, PROFILE_TOOLS, TOOLS } = require("../src/mcp/server");
const metadata = require("../src/mcp/pi-tools.json");
const { routeTools } = require("../src/core/piHelpers");
const { tmpWorkspace } = require("./helpers");

async function connect(profile) {
    const workspaceDir = tmpWorkspace();
    const server = createServer(async () => { throw new Error("context must stay lazy"); }, workspaceDir, { profile });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "profile-test", version: "1" });
    let listChanged = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => { listChanged++; });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, workspaceDir, changed: () => listChanged };
}

test("tool profiles expose exact initial sets", async () => {
    for (const profile of ["pi-minimal", "pi-standard", "pi-full", "claude", "codex", "opencode", "gemini", "cursor", "copilot"]) {
        const { client, workspaceDir } = await connect(profile);
        const actual = (await client.listTools()).tools.map(tool => tool.name).sort();
        const expected = PROFILE_TOOLS[profile].concat(["pi-minimal", "pi-standard"].includes(profile) ? ["pal_tools"] : []).sort();
        assert.deepStrictEqual(actual, expected, profile);
        await client.close();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
});

test("claude is the eager full set: sorted, no pal_tools", async () => {
    const { client, workspaceDir } = await connect("claude");
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(!names.includes("pal_tools"), "eager claude profile must not list pal_tools");
    assert.deepStrictEqual(names.slice().sort(), TOOLS.map(tool => tool.name).sort());
    for (let i = 1; i < names.length; i++) assert.ok(names[i - 1] < names[i], "claude listing is code-point sorted");
    await client.close();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
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

test("dataset routing reaches sync, query, and count for singular and plural requests", () => {
    const expected = ["pal_dataset_count", "pal_dataset_query", "pal_sync_datasets"];
    for (const query of ["dataset", "datasets"]) {
        assert.deepStrictEqual(routeTools(query, metadata).sort(), expected, query);
    }
    assert.ok(routeTools("query", metadata).includes("pal_dataset_query"));
    assert.ok(routeTools("count", metadata).includes("pal_dataset_count"));
    assert.ok(routeTools("data", metadata).includes("pal_dataset_query"));
    assert.ok(routeTools("data", metadata).includes("pal_dataset_count"));
    assert.ok(routeTools("sync", metadata).includes("pal_sync_datasets"));
});

test("unknown/default profile fails open to the full static set", async () => {
    const { client, workspaceDir } = await connect("unknown");
    assert.deepStrictEqual((await client.listTools()).tools.map(tool => tool.name).sort(), TOOLS.map(tool => tool.name).sort());
    await client.close();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
});

test("exact-name lazy activation is additive and idempotent", async () => {
    const { client, workspaceDir } = await connect("pi-minimal");
    const before = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(!before.includes("pal_status"), "pal_status stays lazy in Pi");
    assert.deepStrictEqual(routeTools("pal_status", metadata), ["pal_status"]);
    assert.deepStrictEqual(routeTools("pal_push pal_test", metadata).sort(), ["pal_push", "pal_test"]);
    await client.callTool({ name: "pal_tools", arguments: { query: "pal_status" } });
    const statusActive = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of before) assert.ok(statusActive.includes(name), name);
    assert.ok(statusActive.includes("pal_status"));
    await client.callTool({ name: "pal_tools", arguments: { query: "pal_status" } });
    assert.deepStrictEqual((await client.listTools()).tools.map(tool => tool.name), statusActive,
        "already-active tools need no repeated activation");
    await client.callTool({ name: "pal_tools", arguments: { query: "pal_push pal_test" } });
    const after = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of ["pal_status", "pal_push", "pal_test"]) assert.ok(after.includes(name), name);
    await client.close();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
});

test("lazy dataset activation enables only the dataset tools, is idempotent, and makes reads callable", async () => {
    const { client, workspaceDir, changed } = await connect("pi-minimal");
    const before = (await client.listTools()).tools.map(tool => tool.name);
    const expected = ["pal_dataset_count", "pal_dataset_query", "pal_sync_datasets"];
    const first = await client.callTool({ name: "pal_tools", arguments: { query: "datasets" } });
    assert.match(first.content.map(item => item.text || "").join("\n"), /Activated: pal_sync_datasets, pal_dataset_query, pal_dataset_count/);
    const afterFirst = (await client.listTools()).tools.map(tool => tool.name);
    assert.deepStrictEqual(afterFirst.filter(name => !before.includes(name)).sort(), expected);
    await client.callTool({ name: "pal_tools", arguments: { query: "datasets" } });
    assert.deepStrictEqual((await client.listTools()).tools.map(tool => tool.name), afterFirst, "activation is idempotent");
    for (const name of ["pal_dataset_query", "pal_dataset_count"]) {
        try {
            const result = await client.callTool({ name, arguments: { dataset: "equipment" } });
            assert.doesNotMatch((result.content || []).map(item => item.text || "").join("\n"), /disabled|not enabled|not found/i, name);
        } catch (error) {
            assert.doesNotMatch(String(error && error.message), /disabled|not enabled|not found/i, name);
        }
    }
    assert.ok(changed() > 0);
    await client.close();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
});

test("lazy activation enables every routed tool for calls and only adds tools", async () => {
    const { client, workspaceDir, changed } = await connect("pi-minimal");
    const before = (await client.listTools()).tools.map(tool => tool.name);
    const reachable = new Set();
    for (const query of ["sync", "browser", "runtime", "project", "spec"]) {
        for (const name of routeTools(query, metadata)) reachable.add(name);
        await client.callTool({ name: "pal_tools", arguments: { query } });
    }
    const after = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of before) assert.ok(after.includes(name));
    for (const name of reachable) {
        assert.ok(after.includes(name), name);
        try {
            const result = await client.callTool({ name, arguments: {} });
            const text = (result.content || []).map(item => item.text || "").join("\n");
            assert.doesNotMatch(text, /disabled|not enabled|not found/i, name);
        } catch (error) {
            assert.doesNotMatch(String(error && error.message), /disabled|not enabled|not found/i, name);
        }
    }
    assert.ok(changed() > 0);
    await client.close();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
});
