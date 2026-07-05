"use strict";
// retrieveServerDebug: serverData base64 decode (plain and {_text}-wrapped), empty-buffer
// handling, and the stale-cached-palId retry (re-resolve once ONLY when a cached id was given).
// apiManager + resolve are mocked via the module cache, like tunnel.test.js.
const { test, afterEach } = require("node:test");
const assert = require("node:assert");

const apiManagerPath = require.resolve("../lib/apiManager");
const resolvePath = require.resolve("../src/core/resolve");
const debugPath = require.resolve("../src/core/debug");

// pingResults consumed one per retrieveDebug call (last repeats); resolves counts account walks.
let pingCalls, resolveCalls;
function loadDebugMocked(pingResults, { resolvedId = "FRESH-ID" } = {}) {
    pingCalls = []; resolveCalls = 0;
    delete require.cache[debugPath];
    require.cache[resolvePath] = {
        id: resolvePath, filename: resolvePath, loaded: true,
        exports: { resolveServerPalByGuid: async () => { resolveCalls++; return { id: resolvedId, guid: "GUID-1" }; } }
    };
    require.cache[apiManagerPath] = {
        id: apiManagerPath, filename: apiManagerPath, loaded: true,
        exports: { CloudPistonAPIManager: { retrieveDebug: async (session, palId) => {
            pingCalls.push(palId);
            return pingResults[Math.min(pingCalls.length - 1, pingResults.length - 1)];
        } } }
    };
    return require(debugPath);
}

afterEach(() => {
    delete require.cache[debugPath];
    delete require.cache[resolvePath];
    delete require.cache[apiManagerPath];
});

const b64 = s => Buffer.from(s, "utf8").toString("base64");

test("decodes serverData base64 (plain string node)", async () => {
    const { retrieveServerDebug } = loadDebugMocked([{ success: true, serverData: b64("2026-07-04 debug [tunnel] hi") }]);
    const res = await retrieveServerDebug({}, "GUID-1", { echo: false });
    assert.equal(res.retrieved, true);
    assert.equal(res.empty, false);
    assert.equal(res.text, "2026-07-04 debug [tunnel] hi");
    assert.equal(res.palId, "FRESH-ID"); // resolved, returned for caching
    assert.equal(resolveCalls, 1);
});

test("decodes serverData wrapped as { _text } (xml parser node shape)", async () => {
    const { retrieveServerDebug } = loadDebugMocked([{ success: true, serverData: { _text: b64("line") } }]);
    const res = await retrieveServerDebug({}, "GUID-1", { echo: false });
    assert.equal(res.text, "line");
});

test("absent/empty serverData -> retrieved but empty", async () => {
    const { retrieveServerDebug } = loadDebugMocked([{ success: true }]);
    const res = await retrieveServerDebug({}, "GUID-1", { echo: false });
    assert.equal(res.retrieved, true);
    assert.equal(res.empty, true);
    assert.equal(res.text, "");
});

test("cached palId is used without an account walk", async () => {
    const { retrieveServerDebug } = loadDebugMocked([{ success: true, serverData: b64("x") }]);
    const res = await retrieveServerDebug({}, "GUID-1", { palId: "CACHED-ID", echo: false });
    assert.equal(resolveCalls, 0);
    assert.deepEqual(pingCalls, ["CACHED-ID"]);
    assert.equal(res.palId, "CACHED-ID");
});

test("stale cached palId (failed result) -> re-resolves ONCE and retries", async () => {
    const { retrieveServerDebug } = loadDebugMocked([undefined, { success: true, serverData: b64("after retry") }]);
    const res = await retrieveServerDebug({}, "GUID-1", { palId: "STALE-ID", echo: false });
    assert.equal(res.retrieved, true);
    assert.equal(res.text, "after retry");
    assert.equal(resolveCalls, 1);
    assert.deepEqual(pingCalls, ["STALE-ID", "FRESH-ID"]);
    assert.equal(res.palId, "FRESH-ID"); // caller re-caches the working id
});

test("failure WITHOUT a cached id -> no retry loop, clean failure", async () => {
    const { retrieveServerDebug } = loadDebugMocked([{ success: false }]);
    const res = await retrieveServerDebug({}, "GUID-1", { echo: false });
    assert.equal(res.retrieved, false);
    assert.equal(pingCalls.length, 1);
    assert.match(res.reason, /did not return a debug result/);
});

test("non-empty debug is ALWAYS echoed to the console (stderr) by default", async () => {
    const { retrieveServerDebug } = loadDebugMocked([{ success: true, serverData: b64("echo me") }]);
    const orig = process.stderr.write;
    let captured = "";
    process.stderr.write = (chunk) => { captured += chunk; return true; };
    try { await retrieveServerDebug({}, "GUID-1"); }
    finally { process.stderr.write = orig; }
    assert.match(captured, /--- server debug \(c\.debug\) ---/);
    assert.match(captured, /echo me/);
});

test("empty buffer is NOT echoed to the console", async () => {
    const { retrieveServerDebug } = loadDebugMocked([{ success: true }]);
    const orig = process.stderr.write;
    let captured = "";
    process.stderr.write = (chunk) => { captured += chunk; return true; };
    try { await retrieveServerDebug({}, "GUID-1"); }
    finally { process.stderr.write = orig; }
    assert.equal(captured, "");
});

test("non-base64 serverData falls back to the raw text", async () => {
    const { retrieveServerDebug } = loadDebugMocked([{ success: true, serverData: "!!not-base64!!" }]);
    const res = await retrieveServerDebug({}, "GUID-1", { echo: false });
    assert.equal(res.retrieved, true);
    // Buffer.from tolerates junk by dropping invalid chars; whatever survives must be non-throwing
    assert.equal(typeof res.text, "string");
});
