"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadChromium } = require("../src/core/browser.js");
const { inspectDesignQuality } = require("../src/core/screenshot.js");
const { recordScreenshotEvidence } = require("../src/mcp/tools.js");

test("responsive visual gate requires both viewports and clears on a later failure", () => {
    const ctx = {};
    let gate = recordScreenshotEvidence(ctx, { route: "/", viewportName: "desktop", clean: true });
    assert.equal(gate.complete, false);
    assert.equal(ctx.renderVerified, false);

    gate = recordScreenshotEvidence(ctx, { route: "/", viewportName: "mobile", clean: true });
    assert.equal(gate.complete, true);
    assert.equal(ctx.renderVerified, true);

    gate = recordScreenshotEvidence(ctx, { route: "/about", viewportName: "desktop", clean: true });
    assert.equal(gate.complete, false, "a newly reviewed route still needs its mobile capture");
    gate = recordScreenshotEvidence(ctx, { route: "/about", viewportName: "mobile", clean: false });
    assert.equal(gate.complete, false);
    assert.equal(ctx.renderVerified, false, "a later failed capture must clear the prior pass");
});

test("browser design audit executes its real DOM, geometry, and accessibility checks", async (t) => {
    const chromium = loadChromium();
    if (!chromium) return t.skip("Playwright is unavailable");

    let browser;
    try { browser = await chromium.launch({ headless: true }); }
    catch (e) { return t.skip("Chromium runtime is unavailable: " + e.message.split("\n")[0]); }

    try {
        const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
        await page.setContent("<!doctype html><html><body><main><h1>One</h1><h1>Two</h1>" +
            "<div style='width:600px'>overflow</div><input name='name'><table><tr><td>row</td></tr></table>" +
            "</main></body></html>");
        const bad = await inspectDesignQuality(page, { kind: "console", viewportName: "mobile" });
        const rules = new Set(bad.findings.filter(f => f.severity === "error").map(f => f.rule));
        assert.equal(bad.inspected, true);
        assert.ok(rules.has("horizontalOverflow"));
        assert.ok(rules.has("pageHeading"));
        assert.ok(rules.has("controlLabel"));
        assert.ok(rules.has("tableHeaders"));

        await page.setContent("<!doctype html><html><body><main><h1>Equipment</h1>" +
            "<label for='name'>Name</label><input id='name' name='name'>" +
            "<table><thead><tr><th scope='col'>Name</th></tr></thead><tbody><tr><td>Projector</td></tr></tbody></table>" +
            "<button style='width:40px;height:40px'>Save</button></main></body></html>");
        const good = await inspectDesignQuality(page, { kind: "console", viewportName: "mobile" });
        assert.equal(good.inspected, true);
        assert.equal(good.errors, 0);
        assert.equal(good.pass, true);
    } finally {
        await browser.close();
    }
});

test("design audit flags unstyled links and control typography, and spares styled markup", async (t) => {
    const chromium = loadChromium();
    if (!chromium) return t.skip("Playwright is unavailable");
    let browser;
    try { browser = await chromium.launch({ headless: true }); }
    catch (e) { return t.skip("Chromium runtime is unavailable: " + e.message.split("\n")[0]); }

    const warningRules = (audit) => new Set(audit.findings.filter(f => f.severity === "warning").map(f => f.rule));

    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.setContent("<!doctype html><html><body style=\"font-family:'Pal Sans',sans-serif\">" +
            "<main><h1>Equipment</h1><a href='/items'>All items</a>" +
            "<button style='font-family:Courier;width:40px;height:40px'>Save</button>" +
            "</main></body></html>");
        const bad = await inspectDesignQuality(page, { kind: "web", viewportName: "desktop" });
        assert.equal(bad.inspected, true);
        const badRules = warningRules(bad);
        assert.ok(badRules.has("unstyledLink"), "a raw underlined anchor outside prose must be flagged");
        assert.ok(badRules.has("unstyledControlTypography"), "a control overriding the body font must be flagged");
        const link = bad.findings.find(f => f.rule === "unstyledLink");
        assert.equal(link.severity, "warning");
        assert.equal(link.count, 1);
        assert.equal(bad.findings.find(f => f.rule === "unstyledControlTypography").severity, "warning");

        await page.setContent("<!doctype html><html><body style=\"font-family:'Pal Sans',sans-serif\">" +
            "<main><h1>Equipment</h1><a class='pb-button' href='/items'>All items</a>" +
            "<p>See the <a href='/help'>help guide</a> for details.</p>" +
            "<button style='font-family:inherit;width:40px;height:40px'>Save</button>" +
            "</main></body></html>");
        const good = await inspectDesignQuality(page, { kind: "web", viewportName: "desktop" });
        assert.equal(good.inspected, true);
        const goodRules = warningRules(good);
        assert.ok(!goodRules.has("unstyledLink"), "pb-* links and inline prose links must not be flagged");
        assert.ok(!goodRules.has("unstyledControlTypography"), "controls inheriting the body font must not be flagged");
    } finally {
        await browser.close();
    }
});

test("console audit samples identify #cp-root ancestry and scope note", async (t) => {
    const chromium = loadChromium();
    if (!chromium) return t.skip("Playwright is unavailable");
    let browser;
    try { browser = await chromium.launch({ headless: true }); }
    catch (e) { return t.skip("Chromium runtime is unavailable: " + e.message.split("\n")[0]); }
    try {
        const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
        await page.setContent("<body><div id='cp-root'><main><h1>One</h1><table><tr><td>row</td></tr></table></main></div></body>");
        const audit = await inspectDesignQuality(page, { kind: "console", viewportName: "mobile" });
        assert.equal(audit.scope, "#cp-root");
        assert.ok(audit.notes.some(n => /platform-chrome exception cannot apply/.test(n)));
        assert.ok(audit.findings.some(f => f.rule === "tableHeaders" && f.samples[0].includes("[inside #cp-root]")));
    } finally { await browser.close(); }
});
