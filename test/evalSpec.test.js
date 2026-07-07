"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { listSpecs, resolveSpec, injectSpec } = require("../src/core/evalSpec");
const { tmpWorkspace } = require("./helpers");

test("listSpecs returns the 5 frozen benchmark specs", () => {
    const specs = listSpecs();
    assert.equal(specs.length, 5);
    const keys = specs.map(s => s.key).sort();
    assert.deepEqual(keys, [
        "01_crud_equipment_checkout",
        "02_data_structures_company_directory",
        "03_console_tx_service_requests",
        "04_interpal_tunnels_partner_bridge",
        "05_marketing_website"
    ]);
    const eq = specs.find(s => s.key === "01_crud_equipment_checkout");
    assert.equal(eq.suggestedName, "equipment_checkout");
});

test("resolveSpec throws a helpful error on an unknown key", () => {
    assert.throws(() => resolveSpec("bogus"), /Unknown eval spec "bogus"\. Available: 01_/);
});

test("resolveSpec accepts a numeric prefix", () => {
    const spec = resolveSpec("01");
    assert.equal(spec.key, "01_crud_equipment_checkout");
});

test("injectSpec writes all 4 files flat, fills the placeholder, and rewrites relative paths", () => {
    const ws = tmpWorkspace();
    const spec = resolveSpec("01_crud_equipment_checkout");
    const r = injectSpec(ws, spec, { fillValue: "https://x.test (pal: foo)" });
    assert.deepEqual(r.written.sort(), ["COMPONENTS.md", "DESIGN_SYSTEM.md", "EXECUTION.md", "SPEC.md"]);
    for (const f of ["SPEC.md", "EXECUTION.md", "DESIGN_SYSTEM.md", "COMPONENTS.md"]) {
        assert.ok(fs.existsSync(path.join(ws, f)), f + " should exist at workspace root");
    }
    const specContent = fs.readFileSync(path.join(ws, "SPEC.md"), "utf8");
    assert.ok(!specContent.includes("<WORKSPACE"), "placeholder should be replaced");
    assert.ok(specContent.includes("https://x.test (pal: foo)"), "fillValue should be present");
    assert.ok(specContent.includes("./DESIGN_SYSTEM.md"), "relative design system path should be rewritten to ./");
    assert.ok(!specContent.includes("../DESIGN_SYSTEM.md"), "should not contain the old ../ reference");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("injectSpec never overwrites an existing file", () => {
    const ws = tmpWorkspace();
    const spec = resolveSpec("01_crud_equipment_checkout");
    injectSpec(ws, spec, { fillValue: "x" });
    fs.writeFileSync(path.join(ws, "SPEC.md"), "MODIFIED BY AGENT");
    const r2 = injectSpec(ws, spec, { fillValue: "y" });
    assert.ok(r2.skipped.includes("SPEC.md"));
    assert.equal(fs.readFileSync(path.join(ws, "SPEC.md"), "utf8"), "MODIFIED BY AGENT");
    fs.rmSync(ws, { recursive: true, force: true });
});
