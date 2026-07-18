"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createServer, SERVER_INSTRUCTIONS } = require("../src/mcp/server");
const { TOOLS } = require("../src/mcp/tools");
const { serializeToolDefinitions } = require("../src/mcp/toolSchema");

async function advertisedTools() {
    const server = createServer(async () => { throw new Error("tool schema listing must not resolve context"); }, process.cwd());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "schema-snapshot", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const listed = await client.listTools();
    const instructions = client.getInstructions();
    await client.close();
    return {
        tools: listed.tools.map(({ name, title, description, inputSchema, annotations }) => ({
            name, title, description, inputSchema, annotations
        })),
        instructions
    };
}

test("advertised MCP tool schema matches the committed wire snapshot", async () => {
    const advertised = await advertisedTools();
    const actual = JSON.stringify(advertised.tools, null, 2) + "\n";
    const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "tool-schema.snapshot.json"), "utf8");
    assert.equal(advertised.tools.length, 20);
    assert.equal(Buffer.byteLength(JSON.stringify(advertised.tools)), 19204);
    assert.equal(actual, fixture);
    assert.deepStrictEqual(serializeToolDefinitions(TOOLS), advertised.tools);
    assert.equal(advertised.instructions, SERVER_INSTRUCTIONS);
});
