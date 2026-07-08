"use strict";
// Scaffold tests: workflows are now a creatable type (file + pal.json entry with workflowType),
// and a missing template file must not crash the whole apply. Uses the bundled console-app
// starter into a temp workspace. Pure, no network. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { applyTemplate } = require("../src/core/scaffold");
const { tmpWorkspace } = require("./helpers");

function tempWorkspace() {
    return tmpWorkspace({
        "pal.json": JSON.stringify({
            layout: { name: "T" },
            pages: { entry: [] }, fragments: { entry: [] }, styles: { entry: [] }, workflows: { entry: [] }
        })
    });
}

test("console-app starter creates a workflow entry with the console workflowType (7)", () => {
    const ws = tempWorkspace();
    const r = applyTemplate(ws, "console-app", { palName: "T" });
    const pal = JSON.parse(fs.readFileSync(path.join(ws, "pal.json"), "utf8"));
    const wf = pal.workflows.entry.find(e => e.string === "console.js");
    assert.ok(wf, "expected a workflows entry for console.js");
    assert.equal(wf.Workflow.workflowType, 7);               // palTypeConsole -> 7
    assert.equal(pal.layout.consoleWorkflow, "console.js", "Should auto-register consoleWorkflow pointer");
    assert.equal(wf.Workflow.contentType, "text/javascript");
    assert.ok(fs.existsSync(path.join(ws, "workflows", "console.js")), "workflow file written to disk");
    assert.ok(r.created.includes("workflows/console.js"), "workflow reported as created");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("bundled starters apply cleanly — every manifest file exists (no skips)", () => {
    for (const name of ["console-app", "web-marketing"]) {
        const ws = tempWorkspace();
        const r = applyTemplate(ws, name, { palName: "T" });
        assert.deepEqual(r.skipped, [], name + " should have no skipped (missing) files");
        assert.ok(r.created.length > 0, name + " created files");
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("bundled UI starters include spacing.css before theme.css", () => {
    for (const name of ["console-app", "web-marketing"]) {
        const ws = tempWorkspace();
        applyTemplate(ws, name, { palName: "T" });
        const pal = JSON.parse(fs.readFileSync(path.join(ws, "pal.json"), "utf8"));
        assert.ok(fs.existsSync(path.join(ws, "styles", "spacing.css")), name + " writes spacing.css");
        assert.ok(pal.styles.entry.some(e => e.string === "spacing.css"), name + " registers spacing.css");

        const pagePath = name === "console-app" ? "pages/console.html" : "pages/home.html";
        const page = fs.readFileSync(path.join(ws, pagePath), "utf8");
        const spacingIx = page.indexOf("../Styles/spacing.css");
        const themeIx = page.indexOf("../Styles/theme.css");
        assert.ok(spacingIx > -1, name + " links spacing.css");
        assert.ok(themeIx > -1, name + " links theme.css");
        assert.ok(spacingIx < themeIx, name + " loads spacing.css before theme.css");
        fs.rmSync(ws, { recursive: true, force: true });
    }
});
