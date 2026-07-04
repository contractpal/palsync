"use strict";
// usage.js's injected-context budget: a soft-threshold flag on palsync's OWN footprint
// (CLAUDE.palsync.md + skill descriptions + tool defs), never model token spend.
// Pure (writes to a temp dir, no network). Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const usage = require("../src/core/usage");
const { tmpWorkspace } = require("./helpers");

test("injectedContext stays under the soft threshold for a real workspace", () => {
    const ws = tmpWorkspace({ "CLAUDE.palsync.md": "small doc" });
    const out = usage.injectedContext(ws, []);
    assert.equal(out.overSoftThreshold, false);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("injectedContext flags overSoftThreshold once the block exceeds it", () => {
    const ws = tmpWorkspace({ "CLAUDE.palsync.md": "x".repeat(usage.SOFT_THRESHOLD_BYTES + 1) });
    const out = usage.injectedContext(ws, []);
    assert.equal(out.overSoftThreshold, true);
    assert.ok(out.total > usage.SOFT_THRESHOLD_BYTES);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("formatCost prints the threshold flag line matching overSoftThreshold", () => {
    const under = tmpWorkspace({ "CLAUDE.palsync.md": "small doc" });
    assert.match(usage.formatCost(under, []), /within soft threshold/);

    const over = tmpWorkspace({ "CLAUDE.palsync.md": "x".repeat(usage.SOFT_THRESHOLD_BYTES + 1) });
    assert.match(usage.formatCost(over, []), /ABOVE SOFT THRESHOLD/);
    fs.rmSync(under, { recursive: true, force: true });
    fs.rmSync(over, { recursive: true, force: true });
});
