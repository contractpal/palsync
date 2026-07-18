"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { TOOLS } = require("../src/mcp/tools");
const contextInject = require("../src/launcher/contextInject");
const manifestApi = require("../src/core/contextManifest");
const { tmpWorkspace } = require("./helpers");

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

test("pal_context returns sections by id and keyword without login", async () => {
    const ws = tmpWorkspace({ ".palsync.json": JSON.stringify({ palName: "Demo" }) });
    const tool = TOOLS.find(item => item.name === "pal_context");
    const exact = await tool.run({ workspaceDir: ws }, { section: "datasets" });
    const queried = await tool.run({ workspaceDir: ws }, { query: "create manifest" });
    assert.deepStrictEqual(exact.sections.map(item => item.id), ["datasets"]);
    assert.ok(exact.sections[0].content.includes("freeform"));
    assert.deepStrictEqual(queried.sections.map(item => item.id), ["creating-files"]);
    fs.rmSync(ws, { recursive: true, force: true });
});
