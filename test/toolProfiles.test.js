"use strict";

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
    for (const profile of ["pi-minimal", "pi-standard", "pi-full", "claude", "codex", "opencode"]) {
        const { client, workspaceDir } = await connect(profile);
        const actual = (await client.listTools()).tools.map(tool => tool.name).sort();
        const expected = PROFILE_TOOLS[profile].concat(["pi-minimal", "pi-standard", "claude"].includes(profile) ? ["pal_tools"] : []).sort();
        assert.deepStrictEqual(actual, expected, profile);
        await client.close();
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
});

test("unknown/default profile fails open to the full static set", async () => {
    const { client, workspaceDir } = await connect("unknown");
    assert.deepStrictEqual((await client.listTools()).tools.map(tool => tool.name).sort(), TOOLS.map(tool => tool.name).sort());
    await client.close();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
});

test("lazy activation enables every routed tool for calls and only adds tools", async () => {
    const { client, workspaceDir, changed } = await connect("claude");
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
