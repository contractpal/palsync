"use strict";
// Prompt-cache-stability determinism: tool listings, canonical serialization, and
// execution bytes must be identical for identical inputs, through the REAL protocol
// path (createServer + SDK Client over InMemoryTransport) wherever possible.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createServer, TOOLS, PROFILE_TOOLS } = require("../src/mcp/server");
const { serializeEnvelope } = require("../src/mcp/envelope");
const { stableStringify } = require("../src/core/stableStringify");
const { makeRunId, readExerciseOrdinal, takeExerciseOrdinal } = require("../src/core/exercise");
const { writeContentAddressedArtifact } = require("../src/mcp/workHistory");
const { tmpWorkspace } = require("./helpers");

// getCtx must stay lazy: offline tools never call it, so the stub throws to prove it.
function stubGetCtx() {
    return async () => { throw new Error("context must stay lazy"); };
}

async function connect(profile, workspaceDir) {
    const ws = workspaceDir || tmpWorkspace();
    const server = createServer(stubGetCtx(), ws, { profile });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "determinism-test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, workspaceDir: ws };
}

async function close(client, workspaceDir) {
    try { await client.close(); } catch (e) { /* best-effort */ }
    fs.rmSync(workspaceDir, { recursive: true, force: true });
}

function namesOf(listing) {
    return listing.tools.map(tool => tool.name);
}

function assertAscending(names) {
    for (let i = 1; i < names.length; i++) {
        assert.ok(names[i - 1] < names[i],
            "tool names must be strictly ascending by code-point: " + names[i - 1] + " vs " + names[i]);
    }
}

test("listTools is byte-identical across consecutive calls (pi-minimal)", async () => {
    const { client, workspaceDir } = await connect("pi-minimal");
    const first = await client.listTools();
    const second = await client.listTools();
    assert.equal(JSON.stringify(second), JSON.stringify(first));
    await close(client, workspaceDir);
});

test("listTools names are strictly ascending by code-point (all profiles)", async () => {
    for (const profile of Object.keys(PROFILE_TOOLS)) {
        const { client, workspaceDir } = await connect(profile);
        const names = namesOf(await client.listTools());
        assertAscending(names);
        await close(client, workspaceDir);
    }
});

test("two separately constructed servers list byte-identical tools", async () => {
    const a = await connect("pi-standard");
    const b = await connect("pi-standard");
    const first = await a.client.listTools();
    const second = await b.client.listTools();
    assert.equal(JSON.stringify(second), JSON.stringify(first));
    await close(a.client, a.workspaceDir);
    await close(b.client, b.workspaceDir);
});

test("claude profile is the eager full set: identical to codex, no pal_tools", async () => {
    const claude = await connect("claude");
    const codex = await connect("codex");
    const claudeListing = await claude.client.listTools();
    const codexListing = await codex.client.listTools();
    assert.equal(JSON.stringify(claudeListing), JSON.stringify(codexListing));
    const names = namesOf(claudeListing);
    assert.ok(!names.includes("pal_tools"), "eager claude profile must not list pal_tools");
    assert.deepStrictEqual(names.slice().sort(), TOOLS.map(tool => tool.name).sort());
    assertAscending(names);
    await close(claude.client, claude.workspaceDir);
    await close(codex.client, codex.workspaceDir);
});

test("pi-minimal lists exactly 4 sorted tools with pal_tools in sorted position", async () => {
    const { client, workspaceDir } = await connect("pi-minimal");
    const names = namesOf(await client.listTools());
    assert.deepStrictEqual(names, ["pal_context", "pal_spec_lint", "pal_tools", "pal_validate"]);
    await close(client, workspaceDir);
});

test("serializeEnvelope is key-order-insensitive: identical detailsRef and message", () => {
    const ws = tmpWorkspace();
    try {
        const source = { ok: false, filesChecked: 3, findings: [
            { severity: "error", rule: "demo", file: "pages/a.html", line: 2, message: "Remove it." }
        ] };
        // Same logical value, different insertion order at every level.
        const shuffled = { findings: [
            { message: "Remove it.", line: 2, file: "pages/a.html", rule: "demo", severity: "error" }
        ], filesChecked: 3, ok: false };
        const first = serializeEnvelope(ws, "pal_validate", source);
        const second = serializeEnvelope(ws, "pal_validate", shuffled);
        assert.equal(second.detailsRef, first.detailsRef);
        assert.equal(second.message, first.message);
    } finally {
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("stableStringify sorts keys recursively and preserves array order", () => {
    const a = { z: 1, a: { d: [3, 2, 1], c: 2, b: 1 }, m: [{ y: 1, x: 2 }] };
    const b = { m: [{ x: 2, y: 1 }], a: { b: 1, c: 2, d: [3, 2, 1] }, z: 1 };
    assert.equal(stableStringify(b), stableStringify(a));
    assert.equal(stableStringify(a, 2).indexOf('"a"') < stableStringify(a, 2).indexOf('"m"'), true);
    // Array order is significant: reordered arrays serialize differently.
    assert.notEqual(stableStringify([1, 2, 3]), stableStringify([3, 2, 1]));
});

test("stableStringify matches JSON.stringify for null and undefined placement", () => {
    assert.equal(stableStringify(null), JSON.stringify(null));
    assert.equal(stableStringify({ a: 1, b: undefined }), JSON.stringify({ a: 1, b: undefined }));
    assert.equal(stableStringify({ b: undefined, a: 1 }), JSON.stringify({ a: 1 }));
    assert.equal(stableStringify([1, undefined, 3]), JSON.stringify([1, undefined, 3]));
    assert.equal(stableStringify([1, undefined, 3]), "[1,null,3]");
    assert.strictEqual(stableStringify(undefined), JSON.stringify(undefined));
});

test("identical offline executions return identical bytes via callTool", async () => {
    // pal_validate is needsCtx:false (bare { workspaceDir }, no login/lock) and fully
    // deterministic on a fixed workspace, so two real protocol-path executions must agree.
    const ws = tmpWorkspace({ "pages/demo.html": "<input name=\"demo\">\n" });
    const server = createServer(stubGetCtx(), ws, { profile: "pi-minimal" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "determinism-test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
        const first = await client.callTool({ name: "pal_validate", arguments: {} });
        const second = await client.callTool({ name: "pal_validate", arguments: {} });
        assert.equal(JSON.stringify(second), JSON.stringify(first));
        assert.equal(second.content[0].text, first.content[0].text);
    } finally {
        await close(client, ws);
    }
});

test("makeRunId is deterministic per ordinal and unique across ordinals", () => {
    const steps = [{ action: "create", params: { name: "a-{{runId}}" } }, { click: "Save" }];
    assert.equal(makeRunId(steps, 3), makeRunId(steps, 3));
    assert.equal(makeRunId(steps), makeRunId(steps, 0));
    assert.notEqual(makeRunId(steps, 3), makeRunId(steps, 4));
    assert.notEqual(makeRunId(steps, 0), makeRunId([{ action: "other" }], 0));
});

test("exercise ordinal counter round-trips on a tmp workspace", () => {
    const ws = tmpWorkspace();
    try {
        assert.equal(readExerciseOrdinal(ws), 0, "missing counter file reads as 0");
        assert.equal(takeExerciseOrdinal(ws), 0, "take returns the prior value");
        assert.equal(readExerciseOrdinal(ws), 1, "take advances the counter");
        assert.equal(takeExerciseOrdinal(ws), 1);
        assert.equal(readExerciseOrdinal(ws), 2);
        // The counter lives under .agent-work-history/pal_exercise/ordinal.
        const ordinalFile = path.join(ws, ".agent-work-history", "pal_exercise", "ordinal");
        assert.equal(fs.readFileSync(ordinalFile, "utf8").trim(), "2");
        assert.equal(readExerciseOrdinal(null), 0, "no workspace reads as 0");
    } finally {
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("writeContentAddressedArtifact dedups strings and Buffers with split extensions", () => {
    const ws = tmpWorkspace();
    try {
        const text = stableStringify({ ok: true, n: 1 }, 2) + "\n";
        const firstJson = writeContentAddressedArtifact(ws, "pal_validate", text);
        const secondJson = writeContentAddressedArtifact(ws, "pal_validate", text);
        assert.equal(secondJson, firstJson, "identical strings dedup to one path");
        assert.match(firstJson, /\.json$/);
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
        const firstPng = writeContentAddressedArtifact(ws, "pal_screenshot", png);
        const secondPng = writeContentAddressedArtifact(ws, "pal_screenshot", Buffer.from(png));
        assert.equal(secondPng, firstPng, "identical Buffers dedup to one path");
        assert.match(firstPng, /\.png$/);
        assert.notEqual(firstPng, firstJson);
        assert.deepStrictEqual(fs.readFileSync(path.join(ws, firstPng)), png);
    } finally {
        fs.rmSync(ws, { recursive: true, force: true });
    }
});
