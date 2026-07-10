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

test("bundled UI starters include spacing.css before design-system.css", () => {
    for (const name of ["console-app", "web-marketing"]) {
        const ws = tempWorkspace();
        applyTemplate(ws, name, { palName: "T" });
        const pal = JSON.parse(fs.readFileSync(path.join(ws, "pal.json"), "utf8"));
        assert.ok(fs.existsSync(path.join(ws, "styles", "spacing.css")), name + " writes spacing.css");
        assert.ok(pal.styles.entry.some(e => e.string === "spacing.css"), name + " registers spacing.css");

        const pagePath = name === "console-app" ? "pages/console.html" : "pages/home.html";
        const page = fs.readFileSync(path.join(ws, pagePath), "utf8");
        const spacingIx = page.indexOf("../Styles/spacing.css");
        const dsIx = page.indexOf("../Styles/design-system.css");
        assert.ok(spacingIx > -1, name + " links spacing.css");
        assert.ok(dsIx > -1, name + " links design-system.css");
        assert.ok(spacingIx < dsIx, name + " loads spacing.css before design-system.css");
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("bundled UI starters ship the 4 canonical design-system files and never theme.css", () => {
    for (const name of ["console-app", "web-marketing"]) {
        const ws = tempWorkspace();
        applyTemplate(ws, name, { palName: "T" });
        const pal = JSON.parse(fs.readFileSync(path.join(ws, "pal.json"), "utf8"));

        for (const f of ["spacing.css", "design-system.css"]) {
            assert.ok(fs.existsSync(path.join(ws, "styles", f)), name + " writes styles/" + f);
            assert.ok(pal.styles.entry.some(e => e.string === f), name + " registers styles/" + f);
        }
        for (const f of ["pb-ui.js", "pb-motion.js"]) {
            assert.ok(fs.existsSync(path.join(ws, "scripts", f)), name + " writes scripts/" + f);
            assert.ok(pal.scripts.entry.some(e => e.string === f), name + " registers scripts/" + f);
        }

        assert.ok(!fs.existsSync(path.join(ws, "styles", "theme.css")), name + " must not scaffold theme.css");
        assert.ok(!(pal.styles.entry || []).some(e => e.string === "theme.css"), name + " must not register theme.css");

        const pagePath = name === "console-app" ? "pages/console.html" : "pages/home.html";
        const page = fs.readFileSync(path.join(ws, pagePath), "utf8");
        assert.doesNotMatch(page, /theme\.css/, name + " page shell must not reference theme.css");
        assert.match(page, /<script type="module" src="\.\.\/Scripts\/pb-ui\.js"><\/script>/, name + " loads pb-ui.js as a module script");
        assert.match(page, /<script type="module" src="\.\.\/Scripts\/pb-motion\.js"><\/script>/, name + " loads pb-motion.js as a module script");
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("starter design assets remain byte-identical to the canonical skill references", () => {
    const canonical = path.join(__dirname, "..", "bundled-context", "skills", "design-system-init", "references");
    const starters = path.join(__dirname, "..", "bundled-context", "starters");
    for (const name of ["console-app", "web-marketing"]) {
        for (const f of ["spacing.css", "design-system.css"]) {
            assert.deepStrictEqual(
                fs.readFileSync(path.join(starters, name, "styles", f)),
                fs.readFileSync(path.join(canonical, f)),
                name + " styles/" + f + " must match the canonical reference byte-for-byte"
            );
        }
        for (const f of ["pb-ui.js", "pb-motion.js"]) {
            assert.deepStrictEqual(
                fs.readFileSync(path.join(starters, name, "scripts", f)),
                fs.readFileSync(path.join(canonical, f)),
                name + " scripts/" + f + " must match the canonical reference byte-for-byte"
            );
        }
    }
});

test("web-marketing starter defaults to content-led hierarchy, not AI-slop effects", () => {
    const ws = tempWorkspace();
    applyTemplate(ws, "web-marketing", { palName: "T" });
    const nav = fs.readFileSync(path.join(ws, "fragments", "navbar.html"), "utf8");
    const home = fs.readFileSync(path.join(ws, "fragments", "home-body.html"), "utf8");
    const css = fs.readFileSync(path.join(ws, "styles", "design-system.css"), "utf8");

    assert.match(nav, /class="pb-skip-link"/, "skip link is focus-only by default");
    assert.match(home, /pb-hero--split/);
    assert.match(home, /pb-proof-panel/);
    assert.match(home, /pb-editorial-split/);
    assert.match(home, /pb-outcome-list/);
    assert.doesNotMatch(home, /pb-hero--aurora|pb-bento|data-ticker/, "starter should not default to decorative AI-slop patterns");
    assert.match(css, /\.pb-form-card\s*\{/);
    assert.match(css, /\.pb-row-actions\s*\{/);
    assert.match(css, /\.pb-skip-link\s*\{/);
    assert.match(css, /\.pb-navbar--marketing\s*\{[^}]*top:\s*0;/s, "marketing nav is full-width/sticky, not a floating pill");
    fs.rmSync(ws, { recursive: true, force: true });
});
