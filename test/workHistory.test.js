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
    writeRunMetadata,
    writeRunNotes
} = require("../src/mcp/workHistory");

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
