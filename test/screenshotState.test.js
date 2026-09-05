"use strict";
// pal_screenshot must never present a picture of the wrong screen as render evidence.
// These tests drive runScreenshot through injected browser primitives (no module stubbing).

const { test, describe } = require("node:test");
const assert = require("node:assert");
const { runScreenshot } = require("../src/core/screenshot");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const CONSOLE_PREVIEW = "https://secure.test/CreateTestConsole.do?token=t&cp-auth=SUPERSECRET";

function fakePage({ url, text, headings = [], title = "Console" }) {
    return {
        _url: url,
        on() {},
        url() { return this._url; },
        async innerText() { return text; },
        async content() { return "<html>" + text + "</html>"; },
        async screenshot() { return PNG; },
        async waitForFunction() {},
        async waitForLoadState() {},
        async waitForTimeout() {},
        async goto(u) { this._url = u; },
        async evaluate(fn, args) {
            const src = String(fn);
            if (args && Object.prototype.hasOwnProperty.call(args, "pngBase64")) {
                return { dataUrl: "data:image/jpeg;base64,SMALL", width: 10, height: 10 };
            }
            if (args && args.audit === "palsync-design-v1") {
                return { inspected: true, version: 2, metrics: {}, errors: 0, warnings: 0, pass: true, findings: [] };
            }
            if (src.includes("role='heading'")) return { title, headings };
            return { links: [], inlineStyleTags: 0, totalStyleSheets: 0, bodyComputed: null };
        }
    };
}

function harness({ pages, tests, landOn = null }) {
    const gotoCalls = [];
    let released = 0, contexts = 0, i = 0;
    const state = { gotoCalls, get released() { return released; }, get contexts() { return contexts; } };
    state.deps = {
        runTest: async () => tests[Math.min(i, tests.length - 1)],
        loadChromium: () => ({}),
        releaseBrowser: () => { released++; },
        wait: async () => {},
        getBrowser: async () => ({
            async newContext() {
                contexts++;
                const pg = pages[Math.min(i, pages.length - 1)];
                return { async newPage() { return pg; }, async close() { i++; } };
            }
        }),
        waitForRenderablePage: async (pg, url) => {
            gotoCalls.push(url);
            if (landOn) pg._url = typeof landOn === "function" ? landOn(gotoCalls.length) : landOn;
        }
    };
    return state;
}

const consoleTest = () => ({ ran: true, validated: true, kind: "console", _previewUrl: CONSOLE_PREVIEW });

describe("pal_screenshot state verification", () => {
    test("a verified console action capture reports requested and observed state", async () => {
        const pg = fakePage({ url: "https://secure.test/console", text: "Client Setup\nStep 8 of 9", headings: ["Client Setup"] });
        const h = harness({ pages: [pg], tests: [consoleTest()] });
        const res = await runScreenshot({}, "g", {
            workflow: "console", action: "openClientSetup", params: { id: 9 }, expect: ["Client Setup", "Step 8"]
        }, h.deps);
        assert.strictEqual(res.captured, true);
        assert.strictEqual(res.stateVerified, true);
        assert.strictEqual(res.requestedState.action, "openClientSetup");
        assert.deepStrictEqual(res.requestedState.paramKeys, ["id"]);
        assert.deepStrictEqual(res.observedState.headings, ["Client Setup"]);
        assert.strictEqual(new URL(h.gotoCalls[0]).searchParams.get("cp-ws-doaction"), "openClientSetup?id=9");
    });

    test("requested Client Setup/Step 8 but observed Overview is NOT verified evidence", async () => {
        const pg = fakePage({ url: "https://secure.test/console", text: "Overview\nNo client activity yet.", headings: ["Overview"] });
        const h = harness({ pages: [pg], tests: [consoleTest()] });
        const res = await runScreenshot({}, "g", {
            workflow: "console", action: "openClientSetup", params: { id: 9 }, expect: ["Client Setup", "Step 8"]
        }, h.deps);
        assert.strictEqual(res.captured, false);
        assert.strictEqual(res.category, "targeting");
        assert.ok(res.reason.includes("Overview"), res.reason);
        assert.ok(!res.pngBase64, "no accepted image rides a targeting failure");
    });

    test("requested an existing client but observed Add Client/Step 1 is NOT verified evidence", async () => {
        const pg = fakePage({ url: "https://secure.test/console", text: "Add Client\nStep 1 of 9", headings: ["Add Client"] });
        const h = harness({ pages: [pg], tests: [consoleTest()] });
        const res = await runScreenshot({}, "g", {
            workflow: "console", action: "openClientSetup", params: { id: 9 }, expect: ["Client Setup", "Step 8"]
        }, h.deps);
        assert.strictEqual(res.captured, false);
        assert.strictEqual(res.stateVerified, false);
        assert.deepStrictEqual(res.observedState.headings, ["Add Client"]);
    });

    test("the WRONG screen is a targeting failure — captured:false, image labelled failure evidence", async () => {
        const pg = fakePage({ url: "https://secure.test/console", text: "Add Client\nStep 1 of 9", headings: ["Add Client"] });
        const h = harness({ pages: [pg], tests: [consoleTest()] });
        const res = await runScreenshot({}, "g", {
            workflow: "console", action: "openClientSetup", params: { id: 9 }, expect: ["Client Setup", "Step 8"]
        }, h.deps);
        assert.strictEqual(res.captured, false);
        assert.strictEqual(res.blocked, "initial-state-not-reached");
        assert.strictEqual(res.category, "targeting");
        assert.strictEqual(res.stateVerified, false);
        assert.strictEqual(res.pngBase64, undefined);
        assert.ok(res.failureEvidence.jpegBase64, "failure image is retained");
        assert.match(res.failureEvidence.label, /NOT accepted render evidence/);
        assert.ok(res.reason.includes("Add Client"), res.reason);
        assert.ok(res.reason.includes("openClientSetup"), res.reason);
        // the requested record id is never echoed back
        assert.ok(!res.reason.includes("id=9"), res.reason);
    });

    test("an action with no declared expectation is honestly 'not proven', never a silent pass", async () => {
        const pg = fakePage({ url: "https://secure.test/console", text: "Whatever", headings: ["Whatever"] });
        const h = harness({ pages: [pg], tests: [consoleTest()] });
        const res = await runScreenshot({}, "g", { workflow: "console", action: "openClientSetup" }, h.deps);
        assert.strictEqual(res.captured, true);
        assert.strictEqual(res.stateVerified, null);
    });

    test("a stale window.location does not defeat verification", async () => {
        // The URL still shows the previous screen (c:a leaves location stale) but the DOM is right.
        const pg = fakePage({ url: "https://secure.test/console/PREVIOUS", text: "Client Setup Step 8", headings: ["Client Setup"] });
        const h = harness({ pages: [pg], tests: [consoleTest()] });
        const res = await runScreenshot({}, "g", { workflow: "console", action: "openClientSetup", expect: ["Step 8"] }, h.deps);
        assert.strictEqual(res.stateVerified, true);
    });

    test("param values are redacted out of observed state", async () => {
        const pg = fakePage({ url: "https://secure.test/console", text: "Client SECRET42 Setup", headings: ["Client SECRET42 Setup"], title: "SECRET42" });
        const h = harness({ pages: [pg], tests: [consoleTest()] });
        const res = await runScreenshot({}, "g", { workflow: "console", action: "openClientSetup", params: { id: "SECRET42" }, expect: ["Client"] }, h.deps);
        assert.strictEqual(res.captured, true);
        assert.ok(!JSON.stringify(res.observedState).includes("SECRET42"), JSON.stringify(res.observedState));
    });

    test("no returned field carries the credential-bearing preview URL", async () => {
        const pg = fakePage({ url: CONSOLE_PREVIEW, text: "Client Setup", headings: ["Client Setup"] });
        const h = harness({ pages: [pg], tests: [consoleTest()] });
        const res = await runScreenshot({}, "g", { workflow: "console", expect: ["Client Setup"] }, h.deps);
        assert.strictEqual(res.captured, true);
        assert.ok(!JSON.stringify(res).includes("SUPERSECRET"));
        assert.strictEqual(res.url, "https://secure.test/CreateTestConsole.do");
    });
});

describe("pal_screenshot authentication recovery", () => {
    test("a login redirect retries ONCE against a fresh test instance and can then succeed", async () => {
        const bad = fakePage({ url: "https://secure.test/x", text: "" });
        const good = fakePage({ url: "https://secure.test/console", text: "Client Setup", headings: ["Client Setup"] });
        const h = harness({
            pages: [bad, good], tests: [consoleTest(), consoleTest()],
            landOn: (n) => n === 1 ? "https://secure.test/login/getLogin.do" : "https://secure.test/console"
        });
        const res = await runScreenshot({}, "g", { workflow: "console", expect: ["Client Setup"] }, h.deps);
        assert.strictEqual(res.captured, true);
        assert.strictEqual(res.retryAttempted, true);
        assert.strictEqual(h.contexts, 2);
        assert.strictEqual(h.released, 2, "every acquired browser is released");
    });

    test("a persistent login redirect stays BLOCKED — never captured, never retried twice", async () => {
        const pg = fakePage({ url: "https://secure.test/login/getLogin.do", text: "Sign in" });
        const h = harness({ pages: [pg], tests: [consoleTest(), consoleTest()], landOn: "https://secure.test/login/getLogin.do" });
        const res = await runScreenshot({}, "g", { workflow: "console" }, h.deps);
        assert.strictEqual(res.captured, false);
        assert.strictEqual(res.category, "auth");
        assert.strictEqual(res.authExpired, true);
        assert.strictEqual(h.contexts, 2, "exactly one retry");
    });

    test("an action-bearing navigation failure is NEVER replayed", async () => {
        const pg = fakePage({ url: "https://secure.test/console", text: "" });
        const h = harness({ pages: [pg], tests: [consoleTest(), consoleTest()] });
        h.deps.waitForRenderablePage = async (p, url) => { h.gotoCalls.push(url); throw new Error("Timeout 10000ms exceeded"); };
        const res = await runScreenshot({}, "g", { workflow: "console", action: "deleteClient", params: { id: 9 } }, h.deps);
        assert.strictEqual(res.captured, false);
        assert.strictEqual(res.potentialMutationStarted, true);
        assert.strictEqual(h.gotoCalls.length, 1, "the possibly-mutating action was dispatched once and never replayed");
    });
});

describe("pal_screenshot WEB browser review", () => {
    const webTest = () => ({ ran: true, validated: true, kind: "web", rawToken: "https://webpals.test/abc/" });

    test("a WEB page route is selected after landing and then verified", async () => {
        const pg = fakePage({ url: "https://webpals.test/abc/index.html", text: "Equipment List", headings: ["Equipment List"] });
        const h = harness({ pages: [pg], tests: [webTest()], landOn: "https://webpals.test/abc/index.html" });
        const res = await runScreenshot({}, "g", { page: "equipment.pal", expect: ["Equipment List"] }, h.deps);
        assert.strictEqual(res.captured, true);
        assert.strictEqual(res.stateVerified, true);
        assert.deepStrictEqual(h.gotoCalls, ["https://webpals.test/abc/", "https://webpals.test/abc/equipment.pal"]);
    });

    test("a WEB page that renders the wrong screen fails targeting", async () => {
        const pg = fakePage({ url: "https://webpals.test/abc/index.html", text: "Home", headings: ["Home"] });
        const h = harness({ pages: [pg], tests: [webTest()], landOn: "https://webpals.test/abc/index.html" });
        const res = await runScreenshot({}, "g", { page: "equipment.pal", expect: ["Equipment List"] }, h.deps);
        assert.strictEqual(res.captured, false);
        assert.strictEqual(res.category, "targeting");
    });

    test("a console action is refused on a WEB pal", async () => {
        const h = harness({ pages: [fakePage({ url: "x", text: "" })], tests: [webTest()] });
        const res = await runScreenshot({}, "g", { action: "doThing" }, h.deps);
        assert.strictEqual(res.blocked, "web-action-not-allowed");
    });
});

describe("pal_screenshot request validation", () => {
    test("conflicting combined/separate params are rejected before any Test call", async () => {
        let tested = false;
        const h = harness({ pages: [fakePage({ url: "x", text: "" })], tests: [consoleTest()] });
        h.deps.runTest = async () => { tested = true; return consoleTest(); };
        const res = await runScreenshot({}, "g", { workflow: "console", action: "openClient?id=9", params: { id: 10 } }, h.deps);
        assert.strictEqual(res.blocked, "conflicting-params");
        assert.strictEqual(tested, false, "no Test call for an invalid request");
    });

    test("expect must be an array of non-empty strings", async () => {
        const h = harness({ pages: [fakePage({ url: "x", text: "" })], tests: [consoleTest()] });
        assert.strictEqual((await runScreenshot({}, "g", { expect: "Client Setup" }, h.deps)).blocked, "invalid-expect");
        assert.strictEqual((await runScreenshot({}, "g", { expect: [""] }, h.deps)).blocked, "invalid-expect");
        assert.strictEqual((await runScreenshot({}, "g", { expect: [" "] }, h.deps)).blocked, "invalid-expect");
        assert.strictEqual((await runScreenshot({}, "g", { expect: ["\n"] }, h.deps)).blocked, "invalid-expect");
    });
});
