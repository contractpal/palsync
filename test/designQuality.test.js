"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadChromium, inspectDesignQuality } = require("../src/core/screenshot.js");
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
