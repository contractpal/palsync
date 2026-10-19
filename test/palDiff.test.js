"use strict";
// pal_diff: read-only compare of the workspace against the server, a snapshot, or the baseline.
// The server pull is stubbed (require.cache) before tools.js loads, so nothing touches the network.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const pullPath = require.resolve("../src/core/pull");
const realPull = require("../src/core/pull");
let serverFiles = {};
require.cache[pullPath].exports = Object.assign({}, realPull, {
    pull: async (session, guid, targetDir) => {
        for (const [rel, content] of Object.entries(serverFiles)) {
            const abs = path.join(targetDir, ...rel.split("/"));
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content);
        }
        return { resolved: { lastModifiedDate: "2026-10-16 14:09:15.0" }, serverPaths: Object.keys(serverFiles) };
    }
});
const { tmpWorkspace } = require("./helpers");
const { TOOLS } = require("../src/mcp/tools");
const { compareTrees, lineHunks } = require("../src/core/diff");
const { snapshotWorkspace } = require("../src/core/snapshot");
const baseline = require("../src/core/baseline");

const diff = TOOLS.find(t => t.name === "pal_diff");
const ctxFor = ws => ({
    workspaceDir: ws, session: {}, record: { palGuid: "g1" },
    lifecycle: { lockState: { resolved: { id: "x", guid: "g1", profileId: "p", lastModifiedDate: "2026-10-16 14:09:15.0" } } }
});
const rm = ws => fs.rmSync(ws, { recursive: true, force: true });

test("lineHunks pinpoints an inserted, changed and removed line", () => {
    const { hunks } = lineHunks("a\nb\nc\nd", "a\nB\nc\nx\nd");
    assert.deepEqual(hunks.map(h => [h.line, h.ref, h.local]), [[2, ["b"], ["B"]], [4, [], ["x"]]]);
});

test("compareTrees: changed / localOnly / referenceOnly / identical; pal.json ignores key order", () => {
    const ws = tmpWorkspace({ "pages/same.html": "s", "pages/edit.html": "local", "pages/new.html": "n", "pal.json": '{"b":1,"a":2}' });
    const ref = tmpWorkspace({ "pages/same.html": "s", "pages/edit.html": "server", "pages/gone.html": "g", "pal.json": '{"a":2,"b":1}' });
    const c = compareTrees(ws, ref);
    assert.deepEqual(c.changed, ["pages/edit.html"]);
    assert.deepEqual(c.localOnly, ["pages/new.html"]);
    assert.deepEqual(c.referenceOnly, ["pages/gone.html"]);
    assert.equal(c.identical, 2);
    rm(ws); rm(ref);
});

test("pal_diff against the server reports the diff, never writes the workspace, cleans its scratch dir", async () => {
    const ws = tmpWorkspace({ "pages/a.html": "local\nline", "pages/b.html": "same", "pal.json": "{}" });
    serverFiles = { "pages/a.html": "server\nline", "pages/b.html": "same", "pal.json": "{}", "pages/srv.html": "x" };
    const before = fs.readdirSync(require("os").tmpdir()).filter(n => n.startsWith("palsync-diff-")).length;
    const res = await diff.run(ctxFor(ws), { path: "pages/a.html" });
    assert.equal(res.ok, true);
    assert.deepEqual(res.changed, ["pages/a.html"]);
    assert.deepEqual(res.referenceOnly, ["pages/srv.html"]);
    assert.equal(res.serverMarker, "2026-10-16 14:09:15.0");
    assert.match(res.message, /- server/);
    assert.match(res.message, /\+ local/);
    assert.equal(fs.readFileSync(path.join(ws, "pages", "a.html"), "utf8"), "local\nline");
    assert.equal(fs.readdirSync(require("os").tmpdir()).filter(n => n.startsWith("palsync-diff-")).length, before, "scratch dir removed");
    rm(ws);
});

test("pal_diff says so when local and server match", async () => {
    const ws = tmpWorkspace({ "pages/a.html": "same", "pal.json": "{}" });
    serverFiles = { "pages/a.html": "same", "pal.json": "{}" };
    const res = await diff.run(ctxFor(ws), {});
    assert.equal(res.total, 0);
    assert.match(res.message, /^No differences: all 2 tracked files match the server/);
    rm(ws);
});

test("pal_diff against a snapshot shows what a pull changed; no snapshot is a clear error", async () => {
    const ws = tmpWorkspace({ "pages/a.html": "before", "pal.json": "{}" });
    const none = await diff.run(ctxFor(ws), { against: "snapshot" });
    assert.equal(none.ok, false);
    assert.match(none.message, /snapshot:true/);
    snapshotWorkspace(ws, "pre-pull");
    fs.writeFileSync(path.join(ws, "pages", "a.html"), "after");
    const res = await diff.run(ctxFor(ws), { against: "snapshot" });
    assert.deepEqual(res.changed, ["pages/a.html"]);
    rm(ws);
});

test("pal_diff against the baseline is text-only and errors when there is no baseline", async () => {
    const ws = tmpWorkspace({ "pages/a.html": "v1", "images/logo.png": "bin", "pal.json": "{}" });
    const none = await diff.run(ctxFor(ws), { against: "baseline" });
    assert.equal(none.ok, false);
    baseline.snapshot(ws, ["pages/a.html", "images/logo.png"]);
    fs.writeFileSync(path.join(ws, "pages", "a.html"), "v2");
    const res = await diff.run(ctxFor(ws), { against: "baseline" });
    assert.deepEqual(res.changed, ["pages/a.html"]);
    assert.equal(res.skippedBinary, 1);
    assert.equal(res.localOnly.length, 0, "binaries must not read as only-on-disk");
    rm(ws);
});
