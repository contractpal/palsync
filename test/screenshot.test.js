"use strict";
// Regression tests for runScreenshot (pal_screenshot core) — the auth-replay path, mocked.
// No network, no real browser: we inject a fake `playwright` and a fake `./test` (runTest) into
// the require cache BEFORE loading screenshot.js, so the test exercises the real navigation/
// sanitize/fallback logic against controllable mocks.
//
// What this PROVES (mocked): console pals navigate to the credential-bearing _previewUrl (the
// auth-replay step), success returns captured:true with a SANITIZED url (no cp-auth/credential in
// the result), and a replay failure returns a clean captured:false — never a raw throw.
// (The LIVE end-to-end render against a real console pal was verified separately.)
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");

// --- mutable mock state, set per test --------------------------------------
let nextRunTest;          // (session, guid, opts) => result object
let nextGoto;             // (url) => void | throws   (simulates auth replay)
let landedUrl;            // what page.url() returns after navigation
const gotoCalls = [];     // every URL navigated to this test
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]); // fake PNG
let chromiumPresent = true;

// --- inject fakes into the require cache ------------------------------------
function stub(id, exportsObj) {
    const resolved = require.resolve(id);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

const fakePage = {
    async goto(url) { gotoCalls.push(url); if (nextGoto) nextGoto(url); },
    url() { return landedUrl; },
    async screenshot() { return pngBytes; }
};
const fakeBrowser = {
    async newContext() { return { async newPage() { return fakePage; } }; },
    async close() {}
};
const fakePlaywright = { get chromium() { return chromiumPresent ? { async launch() { return fakeBrowser; } } : null; } };

// playwright resolves to the real install path; ./test is screenshot.js's sibling.
stub("playwright", fakePlaywright);
const testPath = path.join(__dirname, "..", "src", "core", "test.js");
require.cache[testPath] = { id: testPath, filename: testPath, loaded: true,
    exports: { runTest: (...a) => nextRunTest(...a) } };

const { runScreenshot } = require("../src/core/screenshot.js");

function reset() {
    gotoCalls.length = 0;
    nextGoto = null;
    chromiumPresent = true;
}

// --- tests ------------------------------------------------------------------

test("console pal: navigates the cp-auth'd _previewUrl, returns a sanitized url + PNG (no creds leak)", async () => {
    reset();
    const SECRET = "BASIC_dXNlcjpwYXNz_SECRET";
    nextRunTest = async () => ({
        ran: true, validated: true, kind: "console",
        rawToken: null,
        _previewUrl: "https://secure.cloudpiston.com/cpal/RunConsoleApp.do?cp-auth=" + SECRET + "&nxProfileId=1&cp-workflow=console"
    });
    landedUrl = "https://secure.cloudpiston.com/cpal/RunConsoleApp.do?cp-auth=" + SECRET; // landing still carries the cred

    const res = await runScreenshot({}, "GUID", {});

    assert.equal(res.captured, true, "console render should succeed");
    assert.equal(res.kind, "console");
    assert.ok(res.pngBase64, "a PNG must be returned");
    // The auth-replay step IS the navigation to the credential-bearing preview URL.
    assert.ok(gotoCalls[0].includes("cp-auth=" + SECRET), "must navigate to the cp-auth'd preview URL");
    // Returned url is sanitized to origin+path — query (and the credential in it) stripped.
    assert.equal(res.url, "https://secure.cloudpiston.com/cpal/RunConsoleApp.do");
    assert.ok(!res.url.includes("cp-auth"), "sanitized url must not carry cp-auth");
    // SECURITY: the credential never appears anywhere in the returned object, and _previewUrl is dropped.
    const hay = JSON.stringify(res);
    assert.ok(!hay.includes(SECRET), "credential must not leak into the result");
    assert.ok(!("_previewUrl" in res), "_previewUrl must not be returned");
});

test("console pal: auth-replay failure returns a clean captured:false (no throw, no url/cred in reason)", async () => {
    reset();
    const SECRET = "LEAKME_TOKEN";
    nextRunTest = async () => ({
        ran: true, validated: true, kind: "console",
        _previewUrl: "https://secure.cloudpiston.com/cpal/RunConsoleApp.do?cp-auth=" + SECRET
    });
    landedUrl = "about:blank";
    nextGoto = () => { throw new Error("page.goto: Timeout 30000ms exceeded.\n  navigating to https://secure.cloudpiston.com/cpal/RunConsoleApp.do?cp-auth=" + SECRET); };

    let res;
    await assert.doesNotReject(async () => { res = await runScreenshot({}, "GUID", {}); }, "must not throw — degrade to fallback");
    assert.equal(res.captured, false, "failed replay → captured:false");
    assert.equal(res.available, true, "capability is present; this is a per-pal failure");
    assert.ok(res.reason, "must explain the fallback");
    assert.ok(!res.reason.includes(SECRET), "reason must not echo the credential");
    assert.ok(!/https?:\/\/\S*cp-auth/.test(res.reason), "reason must not echo the cp-auth URL");
});

test("web pal: navigates the no-auth rawToken and returns captured:true", async () => {
    reset();
    nextRunTest = async () => ({ ran: true, validated: true, kind: "web", rawToken: "https://webpals.cloudpiston.com/site/", _previewUrl: null });
    landedUrl = "https://webpals.cloudpiston.com/site/";

    const res = await runScreenshot({}, "GUID", {});
    assert.equal(res.captured, true);
    assert.equal(res.kind, "web");
    assert.equal(gotoCalls[0], "https://webpals.cloudpiston.com/site/", "web navigates the rawToken");
    assert.ok(res.pngBase64);
});

test("no Playwright/Chromium runtime → captured:false, available:false (eyeball-gate fallback)", async () => {
    reset();
    chromiumPresent = false;
    nextRunTest = async () => { throw new Error("should not be reached when chromium is absent"); };

    const res = await runScreenshot({}, "GUID", {});
    assert.equal(res.captured, false);
    assert.equal(res.available, false, "missing capability is distinct from a per-pal failure");
    assert.ok(/Playwright|Chromium/i.test(res.reason));
});

test("not-validated pal → captured:false (no browser launched, no creds)", async () => {
    reset();
    nextRunTest = async () => ({ ran: true, validated: false, kind: "console", validation: [{ message: "needs save" }] });
    landedUrl = "x";
    const res = await runScreenshot({}, "GUID", {});
    assert.equal(res.captured, false);
    assert.equal(res.available, true);
    assert.equal(gotoCalls.length, 0, "must not navigate an unvalidated pal");
});
