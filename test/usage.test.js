"use strict";
// usage.js's injected-context budget: a soft-threshold flag on palsync's OWN footprint
// (CLAUDE.palsync.md + skill descriptions + tool defs), never model token spend.
// Pure (writes to a temp dir, no network). Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const usage = require("../src/core/usage");

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "palsync-usage-")); }

test("injectedContext stays under the soft threshold for a real workspace", () => {
    const ws = tmp();
    fs.writeFileSync(path.join(ws, "CLAUDE.palsync.md"), "small doc");
    const out = usage.injectedContext(ws, []);
    assert.equal(out.overSoftThreshold, false);
});

test("injectedContext flags overSoftThreshold once the block exceeds it", () => {
    const ws = tmp();
    fs.writeFileSync(path.join(ws, "CLAUDE.palsync.md"), "x".repeat(usage.SOFT_THRESHOLD_BYTES + 1));
    const out = usage.injectedContext(ws, []);
    assert.equal(out.overSoftThreshold, true);
    assert.ok(out.total > usage.SOFT_THRESHOLD_BYTES);
});

test("formatCost prints the threshold flag line matching overSoftThreshold", () => {
    const under = tmp();
    fs.writeFileSync(path.join(under, "CLAUDE.palsync.md"), "small doc");
    assert.match(usage.formatCost(under, []), /within soft threshold/);

    const over = tmp();
    fs.writeFileSync(path.join(over, "CLAUDE.palsync.md"), "x".repeat(usage.SOFT_THRESHOLD_BYTES + 1));
    assert.match(usage.formatCost(over, []), /ABOVE SOFT THRESHOLD/);
});
