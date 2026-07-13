"use strict";
// usage.js's injected-context budget: a soft-threshold flag on palsync's OWN footprint
// (CLAUDE.palsync.md + skill descriptions + tool defs), never model token spend.
// Pure (writes to a temp dir, no network). Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const usage = require("../src/core/usage");
const { tmpWorkspace } = require("./helpers");

test("recordToolCall batches calls and flushes the legacy usage file shape", () => {
    const ws = tmpWorkspace();
    usage.recordToolCall(ws, "pal_status", 7, 2);
    usage.recordToolCall(ws, "pal_status", 5, 2);
    usage.recordToolCall(ws, "pal_validate", 11, 3);

    assert.equal(fs.existsSync(`${ws}/${usage.USAGE_FILE}`), false);
    usage.formatCost(ws, []);

    const tally = JSON.parse(fs.readFileSync(`${ws}/${usage.USAGE_FILE}`, "utf8"));
    assert.deepEqual(Object.keys(tally).sort(), ["pid", "startedAt", "tools", "totalBytes", "totalCalls", "totalTokens", "updatedAt"]);
    assert.equal(tally.pid, process.pid);
    assert.equal(tally.totalCalls, 3);
    assert.equal(tally.totalBytes, 23);
    assert.equal(tally.totalTokens, 7);
    assert.deepEqual(tally.tools, {
        pal_status: { calls: 2, bytes: 12, tokens: 4 },
        pal_validate: { calls: 1, bytes: 11, tokens: 3 },
    });
    fs.rmSync(ws, { recursive: true, force: true });
});

test("contentStats: text ≈ bytes/4, images priced by pixel area not payload bytes", () => {
    const text = "x".repeat(400);
    // Minimal PNG header claiming 800x500 (IHDR width/height only — enough for the parser)
    const png = Buffer.alloc(33);
    png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(0x0d0a1a0a, 4);
    png.writeUInt32BE(13, 8); png.write("IHDR", 12);
    png.writeUInt32BE(800, 16); png.writeUInt32BE(500, 20);
    const stats = usage.contentStats([
        { type: "text", text },
        { type: "image", data: png.toString("base64"), mimeType: "image/png" },
    ]);
    assert.equal(stats.tokens, 100 + Math.ceil((800 * 500) / 750)); // 100 text + 534 image
    assert.ok(stats.bytes > 400);
});

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
    const report = usage.formatCost(under, []);
    assert.match(report, /within soft threshold/);
    assert.match(report, /Model-token spend is not visible to palsync/);

    const over = tmpWorkspace({ "CLAUDE.palsync.md": "x".repeat(usage.SOFT_THRESHOLD_BYTES + 1) });
    assert.match(usage.formatCost(over, []), /ABOVE SOFT THRESHOLD/);
    fs.rmSync(under, { recursive: true, force: true });
    fs.rmSync(over, { recursive: true, force: true });
});
