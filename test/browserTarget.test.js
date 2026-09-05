"use strict";
// The shared browser foundation: one canonical console target, one authenticated bootstrap, one
// state oracle. These are the regressions that let a screenshot of the wrong screen count as
// evidence and let an exercise report an action it never dispatched.

const { test, describe } = require("node:test");
const assert = require("node:assert");
const {
    normalizeTarget, buildTargetUrl, resolveTargetUrl, verifyState, deriveWebBase,
    describeTargetMismatch, openAuthenticatedScreen, attemptWithFreshTest
} = require("../src/core/browserTarget");

// ---- fakes -----------------------------------------------------------------------------------

function makePage({ url = "https://cp.example/console/run", text = "", headings = [], title = "" } = {}) {
    return {
        _url: url,
        on() {},
        url() { return this._url; },
        async innerText() { return text; },
        async evaluate() { return { title, headings }; }
    };
}

function makePrimitives({ page, chromium = {}, gotoError = null, landOn = null } = {}) {
    const gotoCalls = [];
    return {
        gotoCalls,
        deps: {
            loadChromium: () => chromium,
            getBrowser: async () => ({
                async newContext() {
                    return { async newPage() { return page; }, async close() {} };
                }
            }),
            waitForRenderablePage: async (pg, url) => {
                gotoCalls.push(url);
                if (gotoError) { if (landOn) pg._url = landOn; throw gotoError; }
                if (landOn) pg._url = landOn;
            },
            isLoginRedirect: (u) => /\/login\//i.test(String(u))
        }
    };
}

const CONSOLE_TEST = { ran: true, kind: "console", validated: true, _previewUrl: "https://cp.example/CreateTestConsole.do?token=abc&cp-auth=SECRET" };
const WEB_TEST = { ran: true, kind: "web", validated: true, rawToken: "https://webpals.example/t/xyz" };

// ---- target normalization --------------------------------------------------------------------

describe("normalizeTarget — one canonical console target", () => {
    test("no action and no params is a default-screen request, not an error", () => {
        assert.deepStrictEqual(normalizeTarget({}), { target: null });
    });

    test("action without params dispatches the bare action name", () => {
        assert.strictEqual(normalizeTarget({ action: "openClientList" }).target.dispatch, "openClientList");
    });

    test("action plus one param normalizes to the platform-native c:a form", () => {
        const { target } = normalizeTarget({ action: "openClientSetup", params: { id: 9 } });
        assert.strictEqual(target.action, "openClientSetup");
        assert.strictEqual(target.dispatch, "openClientSetup?id=9");
        assert.deepStrictEqual(target.paramKeys, ["id"]);
    });

    test("multiple params are preserved in order and encoded once", () => {
        const { target } = normalizeTarget({ action: "openStep", params: { id: 9, step: 8 } });
        assert.strictEqual(target.dispatch, "openStep?id=9&step=8");
    });

    test("values needing encoding survive as one query value", () => {
        const { target } = normalizeTarget({ action: "find", params: { q: "a&b=c d/e" } });
        assert.strictEqual(target.dispatch, "find?q=a%26b%3Dc+d%2Fe");
        // and decoding the dispatch string returns the original value
        assert.strictEqual(new URLSearchParams(target.dispatch.split("?")[1]).get("q"), "a&b=c d/e");
    });

    test("the combined action?param=value form is accepted (c-tags.md c:a spelling)", () => {
        const { target } = normalizeTarget({ action: "openClientSetup?id=9" });
        assert.strictEqual(target.action, "openClientSetup");
        assert.deepStrictEqual(target.params, { id: "9" });
        assert.strictEqual(target.dispatch, "openClientSetup?id=9");
    });

    test("combined and separate params agreeing on a value is accepted", () => {
        const { target } = normalizeTarget({ action: "openClientSetup?id=9", params: { id: 9 } });
        assert.strictEqual(target.dispatch, "openClientSetup?id=9");
    });

    test("combined and separate params disagreeing is REJECTED, never silently resolved", () => {
        const r = normalizeTarget({ action: "openClientSetup?id=9", params: { id: 10 } });
        assert.strictEqual(r.blocked, "conflicting-params");
        assert.strictEqual(r.conflictingKey, "id");
        assert.strictEqual(r.target, undefined);
        // the message names the key but never echoes either value
        assert.ok(!/\b9\b|\b10\b/.test(r.reason), r.reason);
    });

    test("params without an action are rejected", () => {
        assert.strictEqual(normalizeTarget({ params: { id: 9 } }).blocked, "params-require-action");
    });

    test("reserved keys are refused from either form", () => {
        assert.strictEqual(normalizeTarget({ action: "x", params: { "cp-auth": "n" } }).blocked, "reserved-param");
        assert.strictEqual(normalizeTarget({ action: "x?cp-workflow=other" }).blocked, "reserved-param");
    });

    test("non-scalar param values are refused", () => {
        assert.strictEqual(normalizeTarget({ action: "x", params: { id: { a: 1 } } }).blocked, "invalid-params");
    });

    test("an action that is only a query string is invalid", () => {
        assert.strictEqual(normalizeTarget({ action: "?id=9" }).blocked, "invalid-action");
    });

    test("an action name containing whitespace is invalid", () => {
        assert.strictEqual(normalizeTarget({ action: "open Client" }).blocked, "invalid-action");
    });
});

describe("buildTargetUrl / resolveTargetUrl", () => {
    test("the dispatch string rides as ONE encoded cp-ws-doaction value", () => {
        const url = buildTargetUrl("https://cp.example/t.do?token=1", "openClientSetup?id=9");
        const got = new URL(url);
        assert.strictEqual(got.searchParams.get("cp-ws-doaction"), "openClientSetup?id=9");
        assert.strictEqual(got.searchParams.get("token"), "1");
        // encoded, so the ? inside the value can never be mistaken for a query delimiter
        assert.ok(url.includes("cp-ws-doaction=openClientSetup%3Fid%3D9"), url);
    });

    test("existing auth/selection fields survive untouched", () => {
        const url = buildTargetUrl(CONSOLE_TEST._previewUrl, "openX");
        const got = new URL(url);
        assert.strictEqual(got.searchParams.get("cp-auth"), "SECRET");
        assert.strictEqual(got.searchParams.get("cp-ws-doaction"), "openX");
    });

    test("console without a target navigates to the plain preview URL", () => {
        const r = resolveTargetUrl(CONSOLE_TEST, null);
        assert.strictEqual(r.url, CONSOLE_TEST._previewUrl);
        assert.strictEqual(r.dispatched, false);
    });

    test("web resolves to its public token URL and never dispatches cp-ws-doaction", () => {
        const r = resolveTargetUrl(WEB_TEST, { dispatch: "x" });
        assert.strictEqual(r.url, WEB_TEST.rawToken);
        assert.strictEqual(r.dispatched, false);
    });

    test("a missing preview URL is reported, not navigated to", () => {
        assert.strictEqual(resolveTargetUrl({ kind: "console" }, null).blocked, "no-preview-url");
    });
});

test("deriveWebBase is origin plus the first path segment", () => {
    assert.strictEqual(deriveWebBase("https://webpals.example/abc123/index.html?x=1"), "https://webpals.example/abc123/");
    assert.strictEqual(deriveWebBase("https://webpals.example/"), "https://webpals.example/");
});

// ---- the state oracle ------------------------------------------------------------------------

describe("verifyState — rendered text, never window.location", () => {
    test("no expectation is honestly 'not proven', not a pass", async () => {
        const s = await verifyState(makePage({ text: "anything" }), undefined);
        assert.strictEqual(s.verified, null);
    });

    test("all expected strings visible verifies the state", async () => {
        const s = await verifyState(makePage({ text: "Client Setup\nStep 8 of 9" }), ["Client Setup", "Step 8"]);
        assert.strictEqual(s.verified, true);
        assert.ok(s.expect.every(r => r.found));
    });

    test("a missing expected string fails verification and reports which one", async () => {
        const s = await verifyState(makePage({ text: "Add Client\nStep 1", headings: ["Add Client"] }), ["Client Setup", "Step 8"]);
        assert.strictEqual(s.verified, false);
        assert.deepStrictEqual(s.expect.filter(r => !r.found).map(r => r.string), ["Client Setup", "Step 8"]);
        assert.deepStrictEqual(s.observed.headings, ["Add Client"]);
    });

    test("a stale window.location does not break verification", async () => {
        // URL still points at the previous screen (c:a leaves location stale) but the DOM is right.
        const pg = makePage({ url: "https://cp.example/console/OLD", text: "Client Setup Step 8", headings: ["Client Setup"] });
        const s = await verifyState(pg, ["Client Setup"]);
        assert.strictEqual(s.verified, true);
    });

    test("mismatch description reports requested vs observed without param values", () => {
        const line = describeTargetMismatch(
            { kind: "console", action: "openClientSetup", paramKeys: ["id"] },
            { expect: [{ string: "Step 8", found: false }], observed: { headings: ["Add Client"], title: "Console" } });
        assert.ok(line.includes("openClientSetup"));
        assert.ok(line.includes("paramKeys: id"));
        assert.ok(line.includes("Add Client"));
        assert.ok(!line.includes("id=9"));
    });
});

// ---- the authenticated bootstrap ---------------------------------------------------------------

describe("openAuthenticatedScreen", () => {
    test("console bootstrap succeeds and dispatches the target exactly once", async () => {
        const page = makePage({ text: "Client Setup Step 8", headings: ["Client Setup"] });
        const { deps, gotoCalls } = makePrimitives({ page });
        const r = await openAuthenticatedScreen(CONSOLE_TEST, {
            target: normalizeTarget({ action: "openClientSetup", params: { id: 9 } }).target,
            expect: ["Client Setup", "Step 8"]
        }, deps);
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.state.verified, true);
        assert.strictEqual(gotoCalls.length, 1);
        assert.strictEqual(new URL(gotoCalls[0]).searchParams.get("cp-ws-doaction"), "openClientSetup?id=9");
    });

    test("a login redirect is BLOCKED/auth and is retryable — the action never ran", async () => {
        const page = makePage();
        const { deps } = makePrimitives({ page, landOn: "https://cp.example/login/getLogin.do" });
        const r = await openAuthenticatedScreen(CONSOLE_TEST, { target: normalizeTarget({ action: "openX" }).target }, deps);
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.status, "blocked");
        assert.strictEqual(r.category, "auth");
        assert.strictEqual(r.retryable, true);
        assert.strictEqual(r.potentialMutationStarted, false);
    });

    test("a navigation failure AFTER an action was dispatched is never retryable", async () => {
        const page = makePage();
        const { deps } = makePrimitives({ page, gotoError: new Error("Timeout 10000ms exceeded") });
        const r = await openAuthenticatedScreen(CONSOLE_TEST, { target: normalizeTarget({ action: "deleteThing" }).target }, deps);
        assert.strictEqual(r.retryable, false);
        assert.strictEqual(r.potentialMutationStarted, true);
        assert.strictEqual(r.category, "navigation");
    });

    test("a navigation failure with NO action dispatched is retryable", async () => {
        const page = makePage();
        const { deps } = makePrimitives({ page, gotoError: new Error("net::ERR_TIMED_OUT") });
        const r = await openAuthenticatedScreen(CONSOLE_TEST, { target: null }, deps);
        assert.strictEqual(r.retryable, true);
        assert.strictEqual(r.potentialMutationStarted, false);
    });

    test("failure reasons never carry the credential-bearing URL", async () => {
        const page = makePage();
        const { deps } = makePrimitives({ page, gotoError: new Error("failed loading https://cp.example/t.do?cp-auth=SECRET") });
        const r = await openAuthenticatedScreen(CONSOLE_TEST, { target: null }, deps);
        assert.ok(!r.reason.includes("SECRET"), r.reason);
        assert.ok(r.reason.includes("<url>"), r.reason);
    });

    test("reaching the wrong screen is a targeting FAILURE, not a pass", async () => {
        const page = makePage({ text: "Add Client\nStep 1", headings: ["Add Client"] });
        const { deps } = makePrimitives({ page });
        const r = await openAuthenticatedScreen(CONSOLE_TEST, {
            target: normalizeTarget({ action: "openClientSetup", params: { id: 9 } }).target,
            expect: ["Client Setup", "Step 8"]
        }, deps);
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.status, "failed");
        assert.strictEqual(r.category, "targeting");
        assert.strictEqual(r.code, "initial-state-not-reached");
        assert.strictEqual(r.retryable, false);
    });

    test("a missing Chromium is BLOCKED/environment and unavailable", async () => {
        const { deps } = makePrimitives({ page: makePage(), chromium: null });
        const r = await openAuthenticatedScreen(CONSOLE_TEST, {}, deps);
        assert.strictEqual(r.available, false);
        assert.strictEqual(r.category, "environment");
        assert.strictEqual(r.retryable, false);
    });
});

describe("attemptWithFreshTest", () => {
    test("a retryable pre-action failure mints a FRESH test instance and retries once", async () => {
        let tests = 0, attempts = 0;
        const res = await attemptWithFreshTest(null, "g", {}, async () => {
            attempts++;
            return attempts === 1
                ? { retryable: true, potentialMutationStarted: false, status: "blocked" }
                : { status: "passed" };
        }, { runTest: async () => { tests++; return CONSOLE_TEST; }, wait: async () => {} });
        assert.strictEqual(tests, 2);
        assert.strictEqual(attempts, 2);
        assert.strictEqual(res.status, "passed");
        assert.strictEqual(res.retryAttempted, true);
    });

    test("a failure after a possible mutation is NEVER retried", async () => {
        let attempts = 0;
        const res = await attemptWithFreshTest(null, "g", {}, async () => {
            attempts++;
            return { retryable: true, potentialMutationStarted: true, status: "blocked" };
        }, { runTest: async () => CONSOLE_TEST, wait: async () => {} });
        assert.strictEqual(attempts, 1);
        assert.strictEqual(res.retryAttempted, false);
    });

    test("a targeting failure is not retried", async () => {
        let attempts = 0;
        await attemptWithFreshTest(null, "g", {}, async () => {
            attempts++;
            return { retryable: false, category: "targeting", status: "failed" };
        }, { runTest: async () => CONSOLE_TEST, wait: async () => {} });
        assert.strictEqual(attempts, 1);
    });
});
