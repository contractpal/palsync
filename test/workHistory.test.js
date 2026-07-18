"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { tmpWorkspace } = require("./helpers");
const {
    HISTORY_DIR,
    safeSlug,
    createWorkHistoryRun,
    writeArtifactFile,
    writeContentAddressedArtifact,
    writeRunMetadata,
    writeRunNotes,
    recordSessionCost
} = require("../src/mcp/workHistory");
const usage = require("../src/core/usage");

test("safeSlug keeps readable feature labels filesystem-safe", () => {
    assert.equal(safeSlug("Equipment / List: mobile view"), "Equipment-List-mobile-view");
    assert.equal(safeSlug("", "fallback"), "fallback");
});

test("createWorkHistoryRun creates a gitignored per-run folder", () => {
    const ws = tmpWorkspace({ ".gitignore": "node_modules/\n" });
    const run = createWorkHistoryRun(ws, {
        tool: "pal_screenshot",
        feature: "Equipment / List",
        now: new Date("2026-07-07T21:46:27.000Z")
    });

    assert.ok(run.dir.startsWith(path.join(ws, HISTORY_DIR)));
    assert.ok(fs.existsSync(run.dir));
    assert.match(path.basename(run.dir), /^2026-07-07T21-46-27-000Z--pal_screenshot--Equipment-List$/);
    assert.match(fs.readFileSync(path.join(ws, ".gitignore"), "utf8"), /\.agent-work-history\//);
});

test("writeArtifactFile, metadata, and notes stay inside the run folder", () => {
    const ws = tmpWorkspace();
    const run = createWorkHistoryRun(ws, { tool: "pal_fetch", feature: "about.html" });

    const body = writeArtifactFile(run, "body.html", "<html></html>", "utf8");
    const metadata = writeRunMetadata(run, { status: 200, artifact: "body.html" });
    const notes = writeRunNotes(run, ["# pal_fetch", "", "- Status: 200"]);

    assert.equal(path.dirname(body), run.dir);
    assert.equal(path.dirname(metadata), run.dir);
    assert.equal(path.dirname(notes), run.dir);
    assert.equal(JSON.parse(fs.readFileSync(metadata, "utf8")).status, 200);
    assert.match(fs.readFileSync(notes, "utf8"), /# pal_fetch/);
});

test("content-addressed artifacts reuse a deterministic path", () => {
    const ws = tmpWorkspace();
    const value = { findings: [{ code: "x" }] };
    const first = writeContentAddressedArtifact(ws, "pal_validate", value);
    const second = writeContentAddressedArtifact(ws, "pal_validate", value);
    assert.equal(second, first);
    assert.match(first, /^\.agent-work-history\/pal_validate\/[a-f0-9]{16}\.json$/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(ws, first), "utf8")), value);
});

test("recordSessionCost appends to the .palsync/session-cost.json sidecar", () => {
    const ws = tmpWorkspace();
    const filePath = recordSessionCost(ws, {
        model: "haiku-4.5",
        provider: "anthropic",
        tokensIn: 500,
        tokensCached: 10,
        tokensOut: 150,
        cost: 0.003,
        phase: "review"
    });
    assert.ok(filePath);
    assert.ok(fs.existsSync(filePath));
    const sc = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(sc.entries.length, 1);
    assert.equal(sc.entries[0].model, "haiku-4.5");
    assert.equal(sc.entries[0].phase, "review");

    recordSessionCost(ws, {
        model: "haiku-4.5",
        provider: "anthropic",
        tokensIn: 600,
        tokensCached: 20,
        tokensOut: 200,
        cost: 0.004
    });
    const sc2 = JSON.parse(fs.readFileSync(path.join(ws, usage.SESSION_COST_FILE), "utf8"));
    assert.equal(sc2.entries.length, 2);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("recordSessionCost is best-effort and returns null for invalid input", () => {
    const ws = tmpWorkspace();
    assert.equal(recordSessionCost(null, { model: "x", provider: "y" }), null);
    assert.equal(recordSessionCost(ws, { provider: "y" }), null);
    assert.equal(recordSessionCost(ws, { model: "x" }), null);
    fs.rmSync(ws, { recursive: true, force: true });
});
