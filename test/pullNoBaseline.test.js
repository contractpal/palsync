"use strict";
// A record with no per-file baseline can't say what differs from the server, so pal_pull must not
// silently overwrite the workspace — it asks (snapshot / force / neither). Refusal runs before any
// network call, so these tests need no session.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { tmpWorkspace } = require("./helpers");
const { TOOLS } = require("../src/mcp/tools");
const { diffWorkspace } = require("../src/core/localDrift");
const { snapshotWorkspace } = require("../src/core/snapshot");

const pull = TOOLS.find(t => t.name === "pal_pull");
const ctxFor = (workspaceDir, record) => ({ workspaceDir, record });

test("diffWorkspace reports noBaseline (not a real 'clean') for a record with no hashes", () => {
    const ws = tmpWorkspace({ "pages/a.html": "<p>a</p>" });
    const d = diffWorkspace({ palGuid: "g" }, ws);
    assert.equal(d.noBaseline, true);
    assert.equal(d.dirty, false);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_pull refuses with no baseline + files on disk, and offers snapshot or force", async () => {
    const ws = tmpWorkspace({ "pages/a.html": "<p>local edit</p>", "pal.json": "{}" });
    const res = await pull.run(ctxFor(ws, { palGuid: "g", palName: "P" }), {});
    assert.equal(res.pulled, false);
    assert.equal(res.refused, "no-baseline");
    assert.match(res.message, /snapshot:true/);
    assert.match(res.message, /force:true/);
    assert.equal(fs.readFileSync(path.join(ws, "pages", "a.html"), "utf8"), "<p>local edit</p>", "refusal must not touch disk");
    assert.equal(fs.existsSync(path.join(ws, ".palsync", "snapshots")), false, "refusal must not snapshot");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("snapshotWorkspace copies the tracked files, layout intact, and ignores untracked ones", () => {
    const ws = tmpWorkspace({ "pages/a.html": "A", "scripts/x.js": "X", "pal.json": "{}", "notes/mine.md": "private" });
    const snap = snapshotWorkspace(ws, "pre-pull");
    assert.equal(snap.files, 3);
    assert.match(snap.dir, /^\.palsync\/snapshots\/pre-pull-/);
    assert.equal(fs.readFileSync(path.join(snap.abs, "pages", "a.html"), "utf8"), "A");
    assert.equal(fs.readFileSync(path.join(snap.abs, "scripts", "x.js"), "utf8"), "X");
    assert.equal(fs.existsSync(path.join(snap.abs, "notes")), false);
    fs.rmSync(ws, { recursive: true, force: true });
});

const { adoptMarker, serverAdvanced } = require("../src/core/drift");

test("adoptMarker never replaces a known marker with nothing (that would disable the push drift gate)", () => {
    const rec = { lastModifiedDate: "2026-10-16 14:09:15.0" };
    for (const empty of [undefined, null, ""]) {
        assert.equal(adoptMarker(rec, empty), false);
        assert.equal(rec.lastModifiedDate, "2026-10-16 14:09:15.0");
    }
    assert.equal(adoptMarker(rec, "2026-10-17 09:00:00.0"), true);
    assert.equal(rec.lastModifiedDate, "2026-10-17 09:00:00.0");
    // The failure it prevents: with the marker gone, a newer server reads as "no drift".
    assert.equal(serverAdvanced(undefined, "2026-10-17 09:00:00.0"), false);
});

// Launcher setup(): a record with no baseline over existing files must not be pulled over silently.
const workspace = require("../src/launcher/workspace");
function noBaselineSetup(onDrift) {
    const ws = tmpWorkspace({ "pages/a.html": "<p>local</p>", "pal.json": "{}" });
    fs.writeFileSync(path.join(ws, ".palsync.json"), JSON.stringify({ palGuid: "g1", cloudUrl: "https://c.example", palName: "P" }));
    const run = () => workspace.setup({
        session: null, cloudUrl: "https://c.example", sel: { pal: { guid: "g1", name: "P" } },
        workspaceDir: ws, onDrift
    });
    return { ws, run };
}

test("setup() refuses a no-baseline workspace when headless", async () => {
    const { ws, run } = noBaselineSetup(undefined);
    await assert.rejects(run, /no recorded pull baseline/);
    assert.equal(fs.readFileSync(path.join(ws, "pages", "a.html"), "utf8"), "<p>local</p>");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("setup() asks via onDrift (phase no-baseline) and abort leaves the workspace untouched", async () => {
    const phases = [];
    const { ws, run } = noBaselineSetup(async info => { phases.push(info.phase); return "abort"; });
    await assert.rejects(run, /Cancelled/);
    assert.deepEqual(phases, ["no-baseline"]);
    assert.equal(fs.readFileSync(path.join(ws, "pages", "a.html"), "utf8"), "<p>local</p>");
    fs.rmSync(ws, { recursive: true, force: true });
});
