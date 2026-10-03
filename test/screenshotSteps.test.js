"use strict";
// pal_screenshot steps: reach a state behind clicks/fills/AJAX with pal_exercise's step engine, then
// capture that final screen. A failed step never captures.

const { test, describe } = require("node:test");
const assert = require("node:assert");
const { runScreenshot } = require("../src/core/screenshot");
const { exerciseByBrowser } = require("../src/core/exercise");
const { screenshotEvidenceIdentity } = require("../src/mcp/tools");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function fakePage(texts) {
    let call = 0;
    const current = () => texts[Math.min(call, texts.length - 1)];
    return {
        shots: 0,
        on() {},
        url: () => "https://secure.test/console?cp-auth=SECRET",
        locator() { return { async count() { return 1; }, first() { return this; }, getByText() { return this; }, async click() { call++; } }; },
        getByText() { return { async count() { return 1; }, first() { return this; }, async click() { call++; } }; },
        async innerText() { return current(); },
        async content() { return "<body>" + current() + "</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {},
        async screenshot() { this.shots++; return PNG; },
        async evaluate(fn, args) {
            if (args && Object.prototype.hasOwnProperty.call(args, "pngBase64")) return { dataUrl: "data:image/jpeg;base64,SMALL", width: 10, height: 10 };
            if (args && args.audit === "palsync-design-v1") return { inspected: true, version: 2, metrics: {}, errors: 0, warnings: 0, pass: true, findings: [] };
            return { links: [], inlineStyleTags: 0, totalStyleSheets: 0, bodyComputed: null, title: "", headings: [] };
        }
    };
}

function browserDeps(pg) {
    return {
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }),
        releaseBrowser: () => {},
        waitForRenderablePage: async () => {},
        runTest: async () => ({ ran: true, validated: true, kind: "console", _previewUrl: "https://secure.test/console?cp-auth=SECRET" }),
        wait: async () => {}
    };
}

describe("exercise capture hook", () => {
    test("afterSteps runs once on the final screen after every step passed", async () => {
        const pg = fakePage(["Orders", "Fake API Order\nOrder form"]);
        const seen = [];
        const res = await exerciseByBrowser(
            { kind: "console", _previewUrl: "https://secure.test/console" },
            [{ click: "Fake API Order", expect: ["Order form"] }], undefined, browserDeps(pg), null, null,
            { onPage: () => seen.push("page"), afterSteps: async (p, info) => { seen.push("after:" + info.kind); return { ok: await p.innerText() }; } });
        assert.equal(res.pass, true);
        assert.deepStrictEqual(seen, ["page", "after:console"]);
        assert.deepStrictEqual(res.capture, { ok: "Fake API Order\nOrder form" });
    });

    test("a failed step never runs afterSteps", async () => {
        const pg = fakePage(["Orders", "Orders"]);
        let called = false;
        const res = await exerciseByBrowser(
            { kind: "console", _previewUrl: "https://secure.test/console" },
            [{ click: "Fake API Order", expect: ["Order form"] }], undefined, browserDeps(pg), null, null,
            { afterSteps: async () => { called = true; } });
        assert.equal(res.pass, false);
        assert.equal(called, false);
        assert.equal(res.capture, undefined);
    });
});

describe("runScreenshot with steps", () => {
    test("captures the screen reached by the steps and verifies it with the merged expect", async () => {
        const pg = fakePage(["Orders", "Fake API Order\nOrder form\nSaved"]);
        const res = await runScreenshot({}, "g", {
            workflow: "console", steps: [{ click: "Fake API Order", expect: ["Order form"] }], expect: ["Saved"]
        }, browserDeps(pg));
        assert.equal(res.captured, true, res.reason);
        assert.equal(res.stateVerified, true);
        assert.deepStrictEqual(res.requestedState.expect, ["Order form", "Saved"]);
        assert.deepStrictEqual(res.requestedState.clickPath, ["Fake API Order"]);
        assert.equal(res.pngBase64, PNG.toString("base64"));
        assert.equal(res.jpegSmallBase64, "SMALL");
        assert.equal(res.designAudit.errors, 0);
        assert.doesNotMatch(res.url, /SECRET/);
        assert.equal(pg.shots, 1);
    });

    test("steps without any final expect capture an unverified state", async () => {
        const pg = fakePage(["Orders", "Order form"]);
        const res = await runScreenshot({}, "g", { workflow: "console", steps: [{ click: "Fake API Order" }] }, browserDeps(pg));
        assert.equal(res.captured, true);
        assert.equal(res.stateVerified, null);
    });

    test("a failed step returns no image", async () => {
        const pg = fakePage(["Orders", "Orders"]);
        const res = await runScreenshot({}, "g", {
            workflow: "console", steps: [{ click: "Fake API Order", expect: ["Order form"] }]
        }, browserDeps(pg));
        assert.equal(res.captured, false);
        assert.equal(res.pngBase64, undefined);
        assert.equal(res.jpegSmallBase64, undefined);
        assert.equal(res.evidence, undefined);
        assert.match(res.reason, /Steps did not reach the screen/);
    });

    test("a blocked run reports its own reason, not a step failure", async () => {
        const deps = Object.assign(browserDeps(fakePage(["Orders"])), {
            getBrowser: async () => { throw new Error("Executable doesn't exist"); }
        });
        const res = await runScreenshot({}, "g", { workflow: "console", steps: [{ click: "Add" }] }, deps);
        assert.equal(res.captured, false);
        assert.match(res.reason, /Chromium browser is not/);
        assert.doesNotMatch(res.reason, /Steps did not reach|pal_exercise/);
    });

    test("top-level action with steps is rejected before any browser work", async () => {
        const res = await runScreenshot({}, "g", { action: "openOrders", steps: [{ click: "Add" }] },
            { loadChromium: () => ({}), runTest: async () => { throw new Error("must not mint a test"); } });
        assert.equal(res.captured, false);
        assert.equal(res.blocked, "invalid-steps");
        assert.match(res.reason, /initial/);
    });
});

test("a step-driven capture is its own reviewed state identity", () => {
    const base = screenshotEvidenceIdentity({ kind: "console", action: "openOrders" });
    const behind = screenshotEvidenceIdentity({ kind: "console", action: "openOrders", clickPath: ["Fake API Order"] });
    assert.equal(base, "console:default:openOrders");
    assert.equal(behind, "console:default:openOrders>Fake API Order");
});

describe("text-transform aware matching", () => {
    const { readMatchText } = require("../src/core/browserTarget");
    const { checkBrowserStep } = require("../src/core/exercise");
    const pg = { async evaluate() { return "Step 1 of 8\nSaved"; } };

    test("an expect written from markup matches CSS-uppercased text", async () => {
        const text = await readMatchText(pg, "STEP 1 OF 8\nSaved");
        assert.equal(checkBrowserStep(text, "", { expect: ["Step 1 of 8", "STEP 1 OF 8"] }).pass, true);
    });

    test("matching stays exact: no case folding", async () => {
        const text = await readMatchText({ async evaluate() { return "Changes not saved"; } }, "Changes not saved");
        assert.equal(checkBrowserStep(text, "", { expect: ["Saved"] }).pass, false);
    });

    test("a page that cannot report untransformed text falls back to displayed text", async () => {
        assert.equal(await readMatchText({ async evaluate() { throw new Error("gone"); } }, "STEP 1"), "STEP 1");
        assert.equal(await readMatchText({ async evaluate() { return {}; } }, "STEP 1"), "STEP 1");
    });
});
