"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");
const contextInject = require("../src/launcher/contextInject");
const manifestApi = require("../src/core/contextManifest");

test("context manifest is deterministic and workspace edits do not invalidate it", async () => {
    const ws = tmpWorkspace({ "EXECUTION.md": "# Execution\n" });
    await contextInject.inject(ws, { palName: "Demo", agent: "claude" });
    const file = path.join(ws, manifestApi.MANIFEST);
    const first = fs.readFileSync(file, "utf8");
    const firstMtime = fs.statSync(file).mtimeMs;
    fs.writeFileSync(path.join(ws, "EXECUTION.md"), "# Execution\nchanged\n");
    await new Promise(resolve => setTimeout(resolve, 20));
    await contextInject.inject(ws, { palName: "Demo", agent: "claude" });
    assert.equal(fs.readFileSync(file, "utf8"), first);
    assert.equal(fs.statSync(file).mtimeMs, firstMtime);
    assert.equal(fs.existsSync(path.join(ws, manifestApi.PREVIOUS)), false);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("context manifest exposes eager stability and diagnoses a pal-name change", async () => {
    const ws = tmpWorkspace();
    await contextInject.inject(ws, { palName: "Alpha", agent: "codex" });
    await contextInject.inject(ws, { palName: "Beta", agent: "codex" });
    const current = manifestApi.readManifest(ws);
    const previous = manifestApi.readManifest(ws, true);
    const diff = manifestApi.diffManifests(previous, current);
    assert.deepStrictEqual(diff, {
        changed: true,
        firstDivergentSection: "sync-section",
        reason: "pal name changed"
    });
    const summary = manifestApi.eagerSummary(current);
    assert.equal(current.sections.find(section => section.name === "tool-definitions").bytes, 16861);
    assert.ok(current.sections.every(section => !section.source.includes("\\")));
    assert.ok(summary.stablePrefixBytes > 0);
    assert.ok(summary.dynamicTailBytes > 0);
    assert.ok(summary.totalBytes < require("../src/core/usage").SOFT_THRESHOLD_BYTES);
    assert.match(manifestApi.formatInspect(current), /provider cache status unavailable/i);
    assert.match(manifestApi.formatDiff(previous, current), /First divergent section: sync-section/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("metadata-only agent changes remain visible divergences", () => {
    const previous = { palsyncVersion: "1", agent: "codex", palName: "Demo", sections: [] };
    const current = { palsyncVersion: "1", agent: "opencode", palName: "Demo", sections: [] };
    assert.deepStrictEqual(manifestApi.diffManifests(previous, current), {
        changed: true,
        firstDivergentSection: "runtime-agent",
        reason: "agent changed codex→opencode"
    });
});
