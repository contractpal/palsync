"use strict";
// usage.js's injected-context budget: a soft-threshold flag on palsync's OWN footprint
// (CLAUDE.palsync.md + skill descriptions + tool defs), never model token spend.
// Pure (writes to a temp dir, no network). Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const usage = require("../src/core/usage");
const { tmpWorkspace } = require("./helpers");

test("recordToolCall batches calls and flushes usage v2", () => {
    const ws = tmpWorkspace();
    usage.recordToolCall(ws, "pal_status", 7, 2);
    usage.recordToolCall(ws, "pal_status", 5, 2);
    usage.recordToolCall(ws, "pal_validate", 11, 3);

    assert.equal(fs.existsSync(`${ws}/${usage.USAGE_FILE}`), false);
    usage.formatCost(ws, []);

    const tally = JSON.parse(fs.readFileSync(`${ws}/${usage.USAGE_FILE}`, "utf8"));
    assert.equal(tally.version, 2);
    assert.equal(tally.pid, process.pid);
    assert.equal(tally.totalCalls, 3);
    assert.equal(tally.totalBytes, 23);
    assert.equal(tally.totalTokens, 7);
    assert.equal(tally.totalRawBytes, 23);
    assert.equal(tally.totalReturnedBytes, 23);
    assert.equal(tally.tools.pal_status.rawBytes, 12);
    assert.equal(tally.tools.pal_status.returnedBytes, 12);
    assert.equal(tally.tools.pal_status.maxReturnedBytes, 7);
    assert.equal(tally.tools.pal_validate.calls, 1);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("usage v2 records condensation, cache denominator, duration, and max response", () => {
    const ws = tmpWorkspace();
    usage.recordToolCall(ws, "pal_validate", 40, 10, {
        rawBytes: 100,
        returnedBytes: 40,
        resultCacheHits: 3,
        resultCacheMisses: 1,
        durationMs: 12.5
    });
    usage.recordToolCall(ws, "pal_validate", 20, 5, {
        rawBytes: 50,
        returnedBytes: 20,
        resultCacheHits: 1,
        resultCacheMisses: 0,
        durationMs: 7.5
    });
    usage.formatCost(ws, []);
    const tally = JSON.parse(fs.readFileSync(`${ws}/${usage.USAGE_FILE}`, "utf8"));
    assert.equal(tally.totalRawBytes, 150);
    assert.equal(tally.totalReturnedBytes, 60);
    assert.equal(tally.resultCacheHits, 4);
    assert.equal(tally.resultCacheMisses, 1);
    assert.equal(tally.totalDurationMs, 20);
    assert.equal(tally.tools.pal_validate.maxReturnedBytes, 40);
    assert.match(usage.formatCost(ws, []), /80\.0% hit rate/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("v1 usage migrates and launcher context events survive a new server pid", () => {
    const migrated = usage.normalizeV2({
        pid: 1, startedAt: "old", totalCalls: 1, totalBytes: 9, totalTokens: 3,
        tools: { pal_status: { calls: 1, bytes: 9, tokens: 3 } }
    });
    assert.equal(migrated.version, 2);
    assert.equal(migrated.totalRawBytes, 9);
    assert.equal(migrated.tools.pal_status.returnedBytes, 9);

    const ws = tmpWorkspace();
    fs.writeFileSync(path.join(ws, usage.USAGE_FILE), JSON.stringify({
        version: 2,
        pid: -1,
        startedAt: "launcher",
        tools: {},
        contextGenerations: [{ agent: "codex", changed: true, firstDivergentSection: "sync-section" }]
    }));
    usage.recordToolCall(ws, "pal_status", 1, 1);
    usage.formatCost(ws, []);
    const tally = JSON.parse(fs.readFileSync(path.join(ws, usage.USAGE_FILE), "utf8"));
    assert.equal(tally.pid, process.pid);
    assert.equal(tally.contextGenerations.length, 1);
    assert.equal(tally.contextGenerations[0].agent, "codex");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("recordToolCall counts successful evidence separately from failed calls", () => {
    const ws = tmpWorkspace();
    usage.recordToolCall(ws, "pal_exercise", 10, 3, { successful: false });
    usage.recordToolCall(ws, "pal_exercise", 10, 3, { successful: true });
    usage.formatCost(ws, []);
    const tally = JSON.parse(fs.readFileSync(`${ws}/${usage.USAGE_FILE}`, "utf8"));
    assert.equal(tally.tools.pal_exercise.calls, 2);
    assert.equal(tally.tools.pal_exercise.successfulCalls, 1);
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
    assert.match(report, /Model-token spend \(harness-reported via \.palsync\/session-cost\.json\):/);
    assert.match(report, /not available — sidecar absent or empty/);

    const over = tmpWorkspace({ "CLAUDE.palsync.md": "x".repeat(usage.SOFT_THRESHOLD_BYTES + 1) });
    assert.match(usage.formatCost(over, []), /ABOVE SOFT THRESHOLD/);
    fs.rmSync(under, { recursive: true, force: true });
    fs.rmSync(over, { recursive: true, force: true });
});

test("formatCost joins a session-cost sidecar with exact model/token/cost fields", () => {
    const ws = tmpWorkspace({ "CLAUDE.palsync.md": "small doc" });
    fs.mkdirSync(path.join(ws, ".palsync"), { recursive: true });
    fs.writeFileSync(
        path.join(ws, usage.SESSION_COST_FILE),
        JSON.stringify({
            entries: [
                { model: "claude-sonnet-4", provider: "anthropic", tokensIn: 1000, tokensCached: 100, tokensOut: 400, cost: 0.0123, currency: "USD" }
            ]
        })
    );
    const report = usage.formatCost(ws, []);
    assert.match(report, /claude-sonnet-4 \(anthropic\)/);
    assert.match(report, /in:\s+1,000\s+provider-reported cached:\s+100\s+out:\s+400\s+cost:\s+\$0\.0123 USD/);
    assert.match(report, /total\s+in:\s+1,000/);
    assert.doesNotMatch(report, /not available — sidecar absent/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("formatCost prints build/review phase splits when phase markers exist", () => {
    const ws = tmpWorkspace({ "CLAUDE.palsync.md": "small doc" });
    fs.mkdirSync(path.join(ws, ".palsync"), { recursive: true });
    fs.writeFileSync(
        path.join(ws, usage.SESSION_COST_FILE),
        JSON.stringify({
            entries: [
                { model: "builder", provider: "anthropic", phase: "build", tokensIn: 1000, tokensCached: 50, tokensOut: 300, cost: 0.0100 },
                { model: "reviewer", provider: "anthropic", phase: "review", tokensIn: 500, tokensCached: 25, tokensOut: 100, cost: 0.0040 }
            ]
        })
    );
    const report = usage.formatCost(ws, []);
    assert.match(report, /build\s+in:\s+1,000\s+provider-reported cached:\s+50\s+out:\s+300\s+cost:\s+\$0\.0100 USD/);
    assert.match(report, /review\s+in:\s+500\s+provider-reported cached:\s+25\s+out:\s+100\s+cost:\s+\$0\.0040 USD/);
    assert.match(report, /total\s+in:\s+1,500\s+provider-reported cached:\s+75\s+out:\s+400\s+cost:\s+\$0\.0140 USD/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("formatCost is explicit when session cost fields are missing, without estimating", () => {
    const ws = tmpWorkspace({ "CLAUDE.palsync.md": "small doc" });
    fs.mkdirSync(path.join(ws, ".palsync"), { recursive: true });
    fs.writeFileSync(
        path.join(ws, usage.SESSION_COST_FILE),
        JSON.stringify({
            entries: [
                { model: "claude-sonnet-4", provider: "anthropic", tokensIn: 800, tokensCached: 0, tokensOut: 200 }
            ]
        })
    );
    const report = usage.formatCost(ws, []);
    assert.match(report, /cost: not provided/);
    assert.doesNotMatch(report, /cost: \$/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("readSessionCost falls back to a bare array or single object", () => {
    const ws1 = tmpWorkspace();
    fs.mkdirSync(path.join(ws1, ".palsync"), { recursive: true });
    fs.writeFileSync(path.join(ws1, usage.SESSION_COST_FILE), JSON.stringify([{ model: "a", provider: "p", tokensIn: 1, tokensCached: 0, tokensOut: 1 }]));
    assert.equal(usage.readSessionCost(ws1).entries.length, 1);

    const ws2 = tmpWorkspace();
    fs.mkdirSync(path.join(ws2, ".palsync"), { recursive: true });
    fs.writeFileSync(path.join(ws2, usage.SESSION_COST_FILE), JSON.stringify({ model: "b", provider: "q", tokensIn: 2, tokensCached: 0, tokensOut: 2 }));
    assert.equal(usage.readSessionCost(ws2).entries.length, 1);

    fs.rmSync(ws1, { recursive: true, force: true });
    fs.rmSync(ws2, { recursive: true, force: true });
});
