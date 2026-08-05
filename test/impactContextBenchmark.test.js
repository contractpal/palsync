"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateWorkspace } = require("../src/core/validate");
const {
    createFixture,
    nearestRank,
    runBenchmark,
} = require("../bench/impact-context");

const FACT_FIELDS = {
    directDependencies: "dependencies",
    directDependents: "dependents",
    candidateMatches: "candidates",
    unresolvedDynamic: "unresolved",
};

function withoutTimings(report) {
    const { p50Ms, p95Ms, ...deterministic } = report;
    return deterministic;
}

test("cold structural impact benchmark has deterministic facts and consistent truncation", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-impact-bench-test-"));
    try {
        createFixture(workspaceDir);
        const validation = validateWorkspace(workspaceDir);
        assert.deepStrictEqual(validation.findings, [], JSON.stringify(validation.findings));
        assert.strictEqual(validation.errors, 0);
        assert.strictEqual(validation.warnings, 0);
    } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }

    const first = runBenchmark({ iterations: 2 });
    const second = runBenchmark({ iterations: 2 });
    assert.deepStrictEqual(withoutTimings(second.report), withoutTimings(first.report));
    assert.deepStrictEqual(Object.keys(first.report), [
        "schema",
        "iterations",
        "p50Ms",
        "p95Ms",
        "factCounts",
        "messageBytes",
        "withinByteBudget",
    ]);
    assert.strictEqual(first.report.schema, "palsync/impact-benchmark/1");
    assert.strictEqual(first.report.iterations, 2);
    assert.deepStrictEqual(first.report.factCounts, {
        dependencies: 0,
        dependents: 100,
        candidates: 0,
        unresolved: 0,
        possibleDynamicIncoming: 10,
    });
    assert.strictEqual(first.formatted.ran, true);
    assert.strictEqual(first.report.messageBytes, Buffer.byteLength(first.formatted.message, "utf8"));
    assert.strictEqual(first.report.withinByteBudget, true);
    assert.ok(first.report.messageBytes <= 4096);
    assert.deepStrictEqual(JSON.parse(first.formatted.message), first.formatted.impact);

    for (const [resultField, countField] of Object.entries(FACT_FIELDS)) {
        assert.strictEqual(first.fullResult[resultField].length, first.report.factCounts[countField]);
        assert.strictEqual(
            first.formatted.impact[resultField].length + first.formatted.impact.omitted[resultField],
            first.fullResult[resultField].length,
            resultField
        );
    }
    assert.ok(first.formatted.impact.omitted.directDependents > 0);
    assert.ok(first.formatted.impact.directDependents.length < first.report.factCounts.dependents);

    assert.strictEqual(nearestRank([4, 1, 3, 2], 0.50), 2);
    assert.strictEqual(nearestRank([4, 1, 3, 2], 0.95), 4);
});
