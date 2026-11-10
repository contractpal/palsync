"use strict";
// Live GetPal.do answers carry no lastModifiedDate, and the MCP lock caches an identity-only
// `resolved` ({id, guid, profileId}). pull() must still return a fresh drift marker, else the
// record keeps the old one: status says "server newer" forever and every push refuses on drift.
// The marker is read before the content, so a push between the reads can only cause a drift refusal.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { CloudPistonAPIManager } = require("../lib/apiManager");
const { pull } = require("../src/core/pull");
const { tmpWorkspace } = require("./helpers");

const SESSION = { environment: { url: "https://example.invalid" } };
const PAL = { layout: { name: "P", category: "P" } };
const MARKER = "2026-11-10 12:18:36.0";

async function withServer(getPal, fn) {
    const names = ["getPal", "getProfileList", "getGroupList", "getPalList"];
    const orig = names.map(n => CloudPistonAPIManager[n]);
    const calls = { list: 0, order: [] };
    CloudPistonAPIManager.getPal = async () => { calls.order.push("content"); return getPal; };
    CloudPistonAPIManager.getProfileList = async () => ({ profileList: { "com.contractpal.pal.ProfileInfo": [{ profileId: "P1" }] } });
    CloudPistonAPIManager.getGroupList = async () => ({ groupList: { "com.contractpal.pal.GroupInfo": [{ groupId: "G1" }] } });
    CloudPistonAPIManager.getPalList = async () => {
        calls.list++;
        calls.order.push("marker");
        return { palInfoList: { PalInfoEx: [{ id: "ID2", guid: "G", lastModifiedDate: MARKER }] } };
    };
    const ws = tmpWorkspace({});
    try { await fn(ws, calls); }
    finally {
        names.forEach((n, i) => { CloudPistonAPIManager[n] = orig[i]; });
        fs.rmSync(ws, { recursive: true, force: true });
    }
}

test("pull() reads the marker from the pal list when GetPal.do and the cached identity omit it", async () => {
    await withServer({ success: true, pal: PAL }, async (ws, calls) => {
        const res = await pull(SESSION, "G", ws, { resolved: { id: "ID", guid: "G", profileId: "P1" } });
        assert.equal(res.resolved.lastModifiedDate, MARKER);
        assert.equal(res.resolved.id, "ID", "the cached identity stays; only the marker is adopted");
        assert.equal(calls.list, 1);
    });
});

test("pull() replaces an old cached marker and reads the marker before the content", async () => {
    await withServer({ success: true, pal: PAL }, async (ws, calls) => {
        const pre = { id: "ID", guid: "G", profileId: "P1", lastModifiedDate: "2026-11-05 09:00:00.0" };
        const res = await pull(SESSION, "G", ws, { resolved: pre });
        assert.equal(res.resolved.lastModifiedDate, MARKER);
        assert.deepEqual(calls.order, ["marker", "content"]);
    });
});
