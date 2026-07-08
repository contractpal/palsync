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
let pageText;             // what page.innerText("body") returns (for render-error detection)
const gotoCalls = [];     // every URL navigated to this test
const callLog = [];       // high-level browser operations, for ordering assertions
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]); // fake PNG
let chromiumPresent = true;
let nextEvaluate;         // (fn, args) => any | throws — simulates page.evaluate for the JPEG downscale
let nextStylePageState;   // returned by no-arg evaluate() calls for stylesheet diagnostics
let pageListeners;

function emitPage(event, arg) {
    for (const fn of (pageListeners[event] || [])) fn(arg);
}

// --- inject fakes into the require cache ------------------------------------
function stub(id, exportsObj) {
    const resolved = require.resolve(id);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

const fakePage = {
    on(event, handler) { (pageListeners[event] = pageListeners[event] || []).push(handler); },
    async goto(url, opts) { callLog.push("goto:" + ((opts && opts.waitUntil) || "")); gotoCalls.push(url); if (nextGoto) nextGoto(url); },
    async waitForLoadState(state) { callLog.push("load:" + state); },
    async waitForFunction() { callLog.push("waitForStyles"); },
    async waitForTimeout() { callLog.push("settle"); },
    url() { return landedUrl; },
    async innerText() { return pageText; },
    async screenshot() { callLog.push("screenshot"); return pngBytes; },
    async evaluate(fn, args) {
        if (args && Object.prototype.hasOwnProperty.call(args, "pngBase64")) return nextEvaluate(fn, args);
        if (nextStylePageState instanceof Error) throw nextStylePageState;
        return nextStylePageState;
    }
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

const { runScreenshot, detectRenderError } = require("../src/core/screenshot.js");

function reset() {
    gotoCalls.length = 0;
    callLog.length = 0;
    pageListeners = {};
    nextGoto = null;
    chromiumPresent = true;
    pageText = "Equipment\nAdd equipment"; // a normal, error-free rendered page by default
    nextStylePageState = {
        links: [{
            href: "https://webpals.cloudpiston.com/site/Styles/theme.css",
            media: "",
            mediaMatches: true,
            disabled: false,
            sheetPresent: true,
            rules: 42,
            access: "ok",
            error: null
        }],
        inlineStyleTags: 0,
        totalStyleSheets: 1,
        bodyComputed: {
            fontFamily: "Inter, sans-serif",
            margin: "0px",
            backgroundColor: "rgb(247, 248, 251)",
            color: "rgb(20, 24, 33)"
        }
    };
    // Default: the in-page canvas re-encode succeeds, mirroring a real browser's behavior.
    nextEvaluate = (fn, args) => ({ dataUrl: "data:image/jpeg;base64,FAKESMALL", width: 800, height: 500 });
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
    assert.equal(res.styleStatus.likelyLoaded, true, "loaded CSS should be reported as loaded");
    assert.equal(res.styleStatus.loaded, 1);
    assert.equal(res.styleStatus.linked, 1);
    assert.ok(callLog.indexOf("waitForStyles") !== -1, "must wait for stylesheet attachment");
    assert.ok(callLog.indexOf("waitForStyles") < callLog.indexOf("screenshot"), "must wait before capturing the PNG");
});

test("web pal: missing/failed CSS is reported in styleStatus with sanitized URLs", async () => {
    reset();
    const SECRET = "DO_NOT_LEAK";
    nextRunTest = async () => ({ ran: true, validated: true, kind: "web", rawToken: "https://webpals.cloudpiston.com/site/", _previewUrl: null });
    landedUrl = "https://webpals.cloudpiston.com/site/";
    nextStylePageState = {
        links: [{
            href: "https://webpals.cloudpiston.com/site/Styles/theme.css?token=" + SECRET,
            media: "",
            mediaMatches: true,
            disabled: false,
            sheetPresent: false,
            rules: null,
            access: "none",
            error: null
        }],
        inlineStyleTags: 0,
        totalStyleSheets: 0,
        bodyComputed: null
    };
    nextGoto = () => {
        emitPage("requestfailed", {
            resourceType: () => "stylesheet",
            url: () => "https://webpals.cloudpiston.com/site/Styles/theme.css?token=" + SECRET,
            failure: () => ({ errorText: "net::ERR_FAILED" })
        });
    };

    const res = await runScreenshot({}, "GUID", {});
    assert.equal(res.captured, true, "CSS diagnostics must not sink the image capture");
    assert.equal(res.styleStatus.likelyLoaded, false);
    assert.equal(res.styleStatus.loaded, 0);
    assert.equal(res.styleStatus.linked, 1);
    assert.equal(res.styleStatus.missingStylesheets[0].href, "https://webpals.cloudpiston.com/site/Styles/theme.css");
    assert.equal(res.styleStatus.failedRequests[0].url, "https://webpals.cloudpiston.com/site/Styles/theme.css");
    assert.ok(!JSON.stringify(res.styleStatus).includes(SECRET), "style diagnostics must not leak URL query tokens");
});

test("a successful capture also returns a downscaled JPEG alongside the full-res PNG", async () => {
    reset();
    nextRunTest = async () => ({ ran: true, validated: true, kind: "web", rawToken: "https://webpals.cloudpiston.com/site/", _previewUrl: null });
    landedUrl = "https://webpals.cloudpiston.com/site/";

    const res = await runScreenshot({}, "GUID", {});
    assert.equal(res.captured, true);
    assert.ok(res.pngBase64, "full-res PNG still returned (goes to the on-disk file)");
    assert.equal(res.jpegSmallBase64, "FAKESMALL", "small JPEG extracted from the data: URL");
    assert.deepEqual(res.smallDims, { width: 800, height: 500 });
});

test("if the in-page downscale fails, the capture still succeeds with jpegSmallBase64:null (PNG fallback)", async () => {
    reset();
    nextEvaluate = () => { throw new Error("evaluate not supported in this context"); };
    nextRunTest = async () => ({ ran: true, validated: true, kind: "web", rawToken: "https://webpals.cloudpiston.com/site/", _previewUrl: null });
    landedUrl = "https://webpals.cloudpiston.com/site/";

    const res = await runScreenshot({}, "GUID", {});
    assert.equal(res.captured, true, "downscale failure must not sink a successful capture");
    assert.ok(res.pngBase64, "full-res PNG is still returned");
    assert.equal(res.jpegSmallBase64, null);
    assert.equal(res.smallDims, null);
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

// The Haiku test-03 failure mode: a workflow that COMPILED + validated but THREW at render time
// (bad SQL). pal_test said VALIDATED; only reading the rendered page catches it.
const CLOUDPISTON_ERROR = [
    "Workflow:    console.js",
    "Message:    SQLSyntaxErrorException: Unknown column 'equipmentId' in 'field list'",
    "Function:    list",
    "Method Called:    DataSet.getRecords",
    "Approx. Line no:    66."
].join("\n");

test("captured render with a runtime error block → captured:true + renderError populated", async () => {
    reset();
    nextRunTest = async () => ({ ran: true, validated: true, kind: "console",
        _previewUrl: "https://secure.cloudpiston.com/cpal/RunConsoleApp.do?cp-auth=x" });
    landedUrl = "https://secure.cloudpiston.com/cpal/RunConsoleApp.do";
    pageText = "Equipment\n" + CLOUDPISTON_ERROR; // the page rendered the error, not the UI

    const res = await runScreenshot({}, "GUID", {});
    assert.equal(res.captured, true, "still a capture — the PNG shows the error banner");
    assert.ok(res.renderError, "the runtime error must be detected");
    assert.match(res.renderError.message, /Unknown column 'equipmentId'/);
    assert.equal(res.renderError.exception, "SQLSyntaxErrorException");
    assert.equal(res.renderError.line, "66");
});

test("clean render → renderError is null", async () => {
    reset();
    nextRunTest = async () => ({ ran: true, validated: true, kind: "web", rawToken: "https://webpals.cloudpiston.com/site/" });
    landedUrl = "https://webpals.cloudpiston.com/site/";
    pageText = "Equipment\nAdd equipment\nNo equipment yet. Add your first item to get started.";
    const res = await runScreenshot({}, "GUID", {});
    assert.equal(res.captured, true);
    assert.equal(res.renderError, null, "a normal page must not be flagged");
});

// --- detectRenderError (pure, text-only) -----------------------------------

test("detectRenderError parses the CloudPiston runtime-error block", () => {
    const e = detectRenderError("Equipment\n" + CLOUDPISTON_ERROR);
    assert.ok(e, "should detect the error block");
    assert.match(e.message, /Unknown column 'equipmentId'/);
    assert.equal(e.exception, "SQLSyntaxErrorException");
    assert.equal(e.workflow, "console.js");
    assert.equal(e.function, "list");
    assert.equal(e.methodCalled, "DataSet.getRecords");
    assert.equal(e.line, "66");
});

test("detectRenderError catches a bare exception with no labeled block", () => {
    const e = detectRenderError("<div>oops</div> java.lang.NullPointerException at foo");
    assert.ok(e, "an exception class name alone is enough to flag");
    assert.equal(e.exception, "java.lang.NullPointerException");
});

test("detectRenderError returns null for a normal rendered UI", () => {
    const page = "Equipment\nAdd equipment\nName Category Status Checked out to Actions\n" +
        "Drill Power tools Available\nNo equipment yet. Add your first item to get started.";
    assert.equal(detectRenderError(page), null);
});

test("detectRenderError does not false-positive on the word 'exceptional'", () => {
    assert.equal(detectRenderError("This tool offers exceptional performance."), null);
});

test("detectRenderError handles empty / non-string input", () => {
    assert.equal(detectRenderError(""), null);
    assert.equal(detectRenderError(null), null);
    assert.equal(detectRenderError(undefined), null);
});
