"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { TOOLS } = require("../src/mcp/tools");
const { createServer } = require("../src/mcp/server");
const contextInject = require("../src/launcher/contextInject");
const manifestApi = require("../src/core/contextManifest");
const palsyncfile = require("../src/core/palsyncfile");
const { routeItems } = require("../src/core/piHelpers");
const { tmpWorkspace } = require("./helpers");

function expectedLegacyContext(sections, { section, query } = {}) {
    let ids = section ? [section] : query ? routeItems(query, sections) : [];
    if (!ids.length && !section && !query) {
        const catalog = sections.map(item => ({ id: item.id, keywords: item.keywords }));
        return { ran: true, sections: [], message: JSON.stringify({ sections: catalog }) };
    }
    ids = [...new Set(ids)];
    const selected = sections.filter(item => ids.includes(item.id)).map(item => ({ id: item.id, content: item.content }));
    return { ran: true, sections: selected, message: JSON.stringify({ sections: selected }) };
}

function assertJsonMessage(result) {
    const value = result.ran ? result.impact : result.error;
    assert.deepStrictEqual(JSON.parse(result.message), value);
    assert.ok(Buffer.byteLength(result.message, "utf8") <= 4096);
}

test("workspace-stable sync tail stays below 4096 bytes", () => {
    const text = contextInject.syncSection("Demo", { cli: false, skillsDir: ".claude/skills" });
    assert.ok(Buffer.byteLength(text) < 4096, Buffer.byteLength(text) + " bytes");
});

test("context manifest exposes detailed sync contracts on demand", async () => {
    const ws = tmpWorkspace();
    await contextInject.inject(ws, { palName: "Demo", agent: "claude" });
    const manifest = manifestApi.readManifest(ws);
    for (const id of ["sync-workflow", "creating-files", "datasets"]) {
        const section = manifest.sections.find(item => item.name === id);
        assert.equal(section.class, "on-demand");
        assert.equal(section.eager, false);
        assert.ok(section.bytes > 0);
    }
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_context preserves exact no-arg, section, query, and section-over-query behavior", async () => {
    const ws = tmpWorkspace({ ".palsync.json": JSON.stringify({ palName: "Demo" }) });
    const tool = TOOLS.find(item => item.name === "pal_context");
    const sections = contextInject.onDemandSyncSections("Demo", { cli: false, skillsDir: ".claude/skills" });
    const cases = [
        {},
        { section: "datasets" },
        { query: "create manifest" },
        { section: "datasets", query: "create manifest" },
    ];

    for (const args of cases) {
        const actual = await tool.run({ workspaceDir: ws }, args);
        assert.deepStrictEqual(actual, expectedLegacyContext(sections, args));
    }
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_context target mode is local-only and returns compact impact JSON without a record", async () => {
    const ws = tmpWorkspace({
        "pages/home.html": '<c:fragment name="shared/nav"/>',
        "fragments/shared/nav.html": "<nav/>",
        "pal.json": JSON.stringify({
            pages: { entry: [{ string: "home.html", Page: { filename: "home.html" } }] },
            fragments: { entry: [{ string: "shared/nav.html", Fragment: { filename: "shared/nav.html" } }] },
        }),
    });
    const tool = TOOLS.find(item => item.name === "pal_context");
    const ctx = { workspaceDir: ws };
    Object.defineProperties(ctx, {
        session: { get() { throw new Error("target mode must not resolve login context"); } },
        record: { get() { throw new Error("target mode must read only its optional local record"); } },
    });

    const originalRead = palsyncfile.read;
    let reads = 0;
    palsyncfile.read = async (...args) => {
        reads++;
        return originalRead(...args);
    };
    let result;
    try { result = await tool.run(ctx, { target: "pages/home.html" }); }
    finally { palsyncfile.read = originalRead; }
    assert.strictEqual(reads, 1);
    assert.strictEqual(result.ran, true);
    assert.strictEqual(result.impact.target, "pages/home.html");
    assert.strictEqual(result.impact.freshness.lastKnownServerModifiedDate, null);
    assert.deepStrictEqual(result.impact.directDependencies.map(item => item.target.file), ["fragments/shared/nav.html"]);
    assertJsonMessage(result);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_context target mode bypasses getCtx at the MCP routing layer", async () => {
    const ws = tmpWorkspace({ "pages/home.html": "<main/>" });
    let contextCalls = 0;
    const server = createServer(async () => {
        contextCalls++;
        throw new Error("target mode must not resolve login context");
    }, ws);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "impact-context-test", version: "1" });
    try {
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        const result = await client.callTool({
            name: "pal_context",
            arguments: { target: "pages/home.html" },
        });
        assert.strictEqual(contextCalls, 0);
        const impact = JSON.parse(result.content[0].text);
        assert.strictEqual(impact.schema, "palsync/impact/1");
        assert.strictEqual(impact.target, "pages/home.html");
    } finally {
        await client.close();
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("pal_context rejects mixed modes before local context and formats target errors as bounded JSON", async () => {
    const tool = TOOLS.find(item => item.name === "pal_context");
    const missingWorkspace = "/workspace/that/must/not/be-read";
    const originalRead = palsyncfile.read;
    let reads = 0;
    palsyncfile.read = async () => {
        reads++;
        throw new Error("mixed mode must be rejected before local context read");
    };
    let mixed;
    try {
        mixed = await tool.run({ workspaceDir: missingWorkspace }, {
            section: "datasets",
            query: "create manifest",
            target: "pages/home.html",
        });
    } finally {
        palsyncfile.read = originalRead;
    }
    assert.strictEqual(reads, 0);
    assert.deepStrictEqual(mixed, {
        ran: false,
        error: {
            schema: "palsync/impact-error/1",
            target: "pages/home.html",
            error: {
                code: "mixed-modes",
                message: "Pass target alone for local structural impact; do not combine it with section or query.",
            },
            serverChecked: false,
        },
        message: JSON.stringify({
            schema: "palsync/impact-error/1",
            target: "pages/home.html",
            error: {
                code: "mixed-modes",
                message: "Pass target alone for local structural impact; do not combine it with section or query.",
            },
            serverChecked: false,
        }),
    });
    assert.deepStrictEqual(Object.keys(mixed).sort(), ["error", "message", "ran"]);
    assertJsonMessage(mixed);

    const ws = tmpWorkspace();
    for (const target of ["bad", "pages/missing.html", "pages/" + "x".repeat(600) + ".html"]) {
        const error = await tool.run({ workspaceDir: ws }, { target });
        assert.strictEqual(error.ran, false);
        assertJsonMessage(error);
    }
    fs.rmSync(ws, { recursive: true, force: true });
});
