"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { extract, toEntries, build, writeSidecar, SOURCE } = require("../scripts/extract-session-cost");
const { assertWindow, markerToDate, projectDirFor } = require("../scripts/backfill-impact-model-usage");
const { validateModelUsage } = require("../scripts/record-eval");

const FIXTURE = path.join(__dirname, "fixtures", "session-cost-transcript.jsonl");
const text = () => fs.readFileSync(FIXTURE, "utf8");

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "palsync-session-cost-"));
}

// The single riskiest line in the extractor: one API response is logged as several assistant lines
// carrying the SAME usage object, so summing lines instead of requests overcounts ~2x. Measured on
// pilot arm 1: 19,076 in+out raw vs 8,773 deduped.
test("dedups repeated usage blocks by requestId", () => {
    const { models, stats } = extract(text());
    assert.equal(stats.usageLines, 7);
    assert.equal(stats.requests, 4, "req_A counted once, plus req_B, req_D, and the id-less line");
    assert.equal(models.length, 1);
    assert.equal(models[0].model, "claude-haiku-4-5-20251001");
    assert.equal(models[0].requests, 4);
});

test("keeps the first usage per requestId and reports a divergent repeat", () => {
    const { models, stats } = extract(text());
    assert.equal(stats.inconsistentRequests, 1, "the second req_A block disagrees and is reported");
    // 999 tokens from the divergent repeat must not appear anywhere in the totals.
    assert.equal(models[0].inputTokens, 16);
    assert.equal(models[0].outputTokens, 77);
});

test("counts a usage line that has no requestId rather than dropping spend", () => {
    const { stats } = extract(text());
    assert.equal(stats.missingRequestId, 1);
});

test("skips host-fabricated placeholder models", () => {
    const { models, stats } = extract(text());
    assert.equal(stats.syntheticSkipped, 1);
    assert.deepEqual(models.map(m => m.model), ["claude-haiku-4-5-20251001"]);
});

test("throws when a non-assistant line starts carrying usage", () => {
    const line = JSON.stringify({ type: "ai-title", requestId: "req_T",
        message: { model: "claude-haiku-4-5-20251001", usage: { input_tokens: 1, output_tokens: 1 } } });
    assert.throws(() => extract(line + "\n"), /type 'ai-title' but carries message.usage/);
});

test("maps cache-creation tokens into tokensIn and cache reads into tokensCached", () => {
    const [entry] = toEntries(extract(text()).models);
    // in: (10+200) + (5+100) + (1+0) + (0+300)
    assert.equal(entry.tokensIn, 616);
    assert.equal(entry.tokensCached, 3000);
    assert.equal(entry.tokensOut, 77);
    assert.equal(entry.provider, "anthropic");
});

test("prices the 1h/5m cache-write split from the data, defaulting an absent split to 5m", () => {
    const [entry] = toEntries(extract(text()).models);
    // input 16 * 1.00 + 1h 200 * 2.00 + 5m (100 + the 300 with no split) * 1.25 + read 3000 * 0.10
    // + out 77 * 5.00 = 1601 per-MTok-units
    assert.equal(entry.cost, 0.001601);
    assert.equal(entry.currency, "USD");
});

test("records tokens but omits cost for a model with no rate-table entry", () => {
    const line = JSON.stringify({ type: "assistant", requestId: "req_X",
        message: { model: "claude-unpriced-9", usage: { input_tokens: 7, output_tokens: 3 } } });
    const result = build({ transcriptText: line + "\n", transcriptPath: "x.jsonl" });
    assert.deepEqual(result.unpriced, ["claude-unpriced-9"]);
    const [entry] = result.sidecar.entries;
    assert.equal(entry.tokensIn, 7);
    assert.ok(!("cost" in entry), "cost is never estimated");
    assert.ok(!("currency" in entry));
});

test("the emitted sidecar satisfies record-eval's own modelUsage validator", () => {
    const result = build({ transcriptText: text(), transcriptPath: FIXTURE });
    const usage = validateModelUsage({ exists: true, value: result.sidecar, bytes: null });
    assert.equal(usage.tokensIn, 616);
    assert.equal(usage.tokensOut, 77);
    assert.equal(usage.totalTokens, 693, "record-eval fixes totalTokens = tokensIn + tokensOut");
    assert.equal(usage.cost, 0.001601);
});

test("carries the billed window so a caller can bound it against the arm", () => {
    const { stats } = extract(text());
    assert.equal(stats.firstUsageAt, "2026-08-05T23:45:54.000Z");
    // req_D at 23:46:09, not the 23:46:11 divergent req_A repeat: the window spans the requests
    // that were COUNTED, so a deduped line cannot stretch it past the arm.
    assert.equal(stats.lastUsageAt, "2026-08-05T23:46:09.000Z");
});

test("phase tags every entry when asked", () => {
    const [entry] = toEntries(extract(text()).models, "build");
    assert.equal(entry.phase, "build");
});

test("refuses to overwrite a sidecar written by someone else unless forced", () => {
    const dir = tempDir();
    const target = path.join(dir, ".palsync", "session-cost.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ entries: [] }));
    const { sidecar } = build({ transcriptText: text(), transcriptPath: FIXTURE });
    assert.throws(() => writeSidecar(dir, sidecar, false), /refusing to overwrite/);
    writeSidecar(dir, sidecar, true);
    assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).source, SOURCE);
    // Its own output is replaceable without --force, so re-running the extractor is safe.
    writeSidecar(dir, sidecar, false);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("extraction is reproducible byte-for-byte", () => {
    const a = build({ transcriptText: text(), transcriptPath: FIXTURE });
    const b = build({ transcriptText: text(), transcriptPath: FIXTURE });
    assert.equal(JSON.stringify(a.sidecar), JSON.stringify(b.sidecar));
});

// The backfill's window guard replaces the pinned transcript sha256, which cannot work: the host
// appends bookkeeping lines after an arm ends, so every recorded row's hash has already drifted.
// What still needs catching is a session RESUMED after the arm, which adds real API calls.
function row(wallTimeMs) {
    return { experiment: { startMarker: "2026-08-05 17:45:34.0", trajectory: { wallTimeMs } } };
}

test("window guard accepts usage inside the arm and rejects a resumed session", () => {
    const stats = { firstUsageAt: "2026-08-05T23:45:54.000Z", lastUsageAt: "2026-08-05T23:47:59.000Z" };
    const ok = assertWindow(row(115531), stats);
    assert.equal(ok.markerToFirstMs, 20000);
    assert.throws(() => assertWindow(row(5000), stats), /usage window .* exceeds wall time/);
});

test("window guard rejects usage recorded before the arm's server marker", () => {
    const stats = { firstUsageAt: "2026-08-05T23:40:00.000Z", lastUsageAt: "2026-08-05T23:40:10.000Z" };
    assert.throws(() => assertWindow(row(115531), stats), /precedes the arm's server marker/);
});

test("derives the host transcript dir from the workspace path", () => {
    assert.equal(path.basename(projectDirFor("/Users/apple/PalBuilder/impact_01_shared_fragment03")),
        "-Users-apple-PalBuilder-impact-01-shared-fragment03");
});

test("parses the server marker as local wall-clock time", () => {
    const date = markerToDate("2026-08-05 17:45:34.0");
    assert.equal(date.getHours(), 17);
    assert.equal(date.getMinutes(), 45);
    assert.equal(markerToDate("not a marker"), null);
});
