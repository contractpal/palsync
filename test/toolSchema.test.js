
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
    assert.equal(advertised.tools.length, 29);
    assert.equal(Buffer.byteLength(JSON.stringify(advertised.tools)), 29003);
    const workflows = Object.fromEntries(advertised.tools
        .filter(tool => ["pal_test", "pal_preview", "pal_screenshot", "pal_exercise"].includes(tool.name))
        .map(tool => [tool.name, tool.inputSchema.properties.workflow.enum]));
    assert.ok(workflows.pal_test.includes("console-system"));
    for (const name of ["pal_preview", "pal_screenshot", "pal_exercise"]) {
        assert.ok(!workflows[name].includes("console-system"), name + " must only advertise renderable workflows");
    }
    assert.equal(actual, fixture);
    assert.deepStrictEqual(
        serializeToolDefinitions(TOOLS).slice().sort((a, b) => (a.name < b.name ? -1 : 1)),
        advertised.tools,
        "the wire listing is code-point sorted; TOOLS definition order is not"
    );
    assert.equal(advertised.instructions, SERVER_INSTRUCTIONS);
});
