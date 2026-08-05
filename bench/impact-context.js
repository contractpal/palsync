#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildImpactSnapshot } = require("../src/core/validate/snapshot");
const {
    buildStructuralImpact,
    resolveImpactTarget,
    formatImpactResult,
} = require("../src/core/impactContext");

const SCHEMA = "palsync/impact-benchmark/1";
const SHARED_TARGET = "fragments/shared.html";
const DEFAULT_WARMUPS = 5;
const DEFAULT_ITERATIONS = 50;
const MESSAGE_BUDGET = 4096;

function writeFixtureFile(workspaceDir, rel, content) {
    const filename = path.join(workspaceDir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
}

function createFixture(workspaceDir) {
    const pages = [];
    const fragments = [];

    for (let index = 0; index < 100; index++) {
        const id = String(index).padStart(3, "0");
        const pageName = "page-" + id;
        const pageFilename = pageName + ".html";
        const fragmentName = "unique-" + id;
        const fragmentFilename = fragmentName + ".html";
        const references = [
            '<c:fragment name="' + fragmentName + '"/>',
            '<c:fragment name="shared"/>',
        ];
        if (index % 10 === 0) references.push('<c:fragment name="${dynamicFragment}"/>');

        pages.push({
            string: pageFilename,
            Page: { name: pageName, filename: pageFilename, palType: "palTypeConsole" },
        });
        fragments.push({
            string: fragmentFilename,
            Fragment: {
                name: fragmentName,
                filename: fragmentFilename,
                palType: "palTypeConsole",
                parseable: true,
            },
        });

        writeFixtureFile(workspaceDir, "pages/" + pageFilename,
            '<html xmlns:c="contractpal"><body><main class="pb-main">' +
            references.join("") + "</main></body></html>\n");
        writeFixtureFile(workspaceDir, "fragments/" + fragmentFilename,
            '<c:ignore xmlns:c="contractpal"><section class="pb-section">Unique ' +
            id + "</section></c:ignore>\n");
    }

    fragments.push({
        string: "shared.html",
        Fragment: {
            name: "shared",
            filename: "shared.html",
            palType: "palTypeConsole",
            parseable: true,
        },
    });
    writeFixtureFile(workspaceDir, SHARED_TARGET,
        '<c:ignore xmlns:c="contractpal"><section class="pb-section">Shared</section></c:ignore>\n');
    writeFixtureFile(workspaceDir, "workflows/benchmark.js", [
        "function run(controller) {",
        "    var payload = controller.createPayload();",
        '    payload.set("dynamicFragment", "shared");',
        "}",
        "",
    ].join("\n"));

    const empty = { entry: [] };
    const manifest = {
        pages: { entry: pages },
        fragments: { entry: fragments },
        workflows: {
            entry: [{
                string: "benchmark.js",
                Workflow: { name: "benchmark", filename: "benchmark.js", workflowType: 7 },
            }],
        },
        styles: empty,
        scripts: empty,
        images: empty,
        emails: empty,
        attachments: empty,
        datasets: empty,
    };
    writeFixtureFile(workspaceDir, "pal.json", JSON.stringify(manifest, null, 2) + "\n");
}

function measureIteration(workspaceDir) {
    const started = process.hrtime.bigint();
    const snapshot = buildImpactSnapshot(workspaceDir);
    const analysis = buildStructuralImpact(snapshot);
    const fullResult = resolveImpactTarget(analysis, SHARED_TARGET);
    const formatted = formatImpactResult(fullResult);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    return { elapsedMs, fullResult, formatted };
}

function nearestRank(values, percentile) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.ceil(percentile * sorted.length) - 1];
}

function positiveInteger(value, label) {
    if (!Number.isInteger(value) || value < 1) throw new TypeError(label + " must be a positive integer");
    return value;
}

function runBenchmark({ iterations = DEFAULT_ITERATIONS, warmups = DEFAULT_WARMUPS } = {}) {
    positiveInteger(iterations, "iterations");
    positiveInteger(warmups, "warmups");

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-impact-bench-"));
    try {
        createFixture(workspaceDir);
        for (let index = 0; index < warmups; index++) measureIteration(workspaceDir);

        const measured = [];
        for (let index = 0; index < iterations; index++) measured.push(measureIteration(workspaceDir));

        const timingsMs = measured.map(iteration => iteration.elapsedMs);
        const { fullResult, formatted } = measured[measured.length - 1];
        const messageBytes = Buffer.byteLength(formatted.message, "utf8");
        const report = {
            schema: SCHEMA,
            iterations,
            p50Ms: Number(nearestRank(timingsMs, 0.50).toFixed(3)),
            p95Ms: Number(nearestRank(timingsMs, 0.95).toFixed(3)),
            factCounts: {
                dependencies: fullResult.directDependencies.length,
                dependents: fullResult.directDependents.length,
                candidates: fullResult.candidateMatches.length,
                unresolved: fullResult.unresolvedDynamic.length,
                possibleDynamicIncoming: fullResult.coverage.possibleDynamicIncoming,
            },
            messageBytes,
            withinByteBudget: formatted.ran && messageBytes <= MESSAGE_BUDGET,
        };
        return { report, fullResult, formatted };
    } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

function run(options) {
    return runBenchmark(options).report;
}

if (require.main === module) process.stdout.write(JSON.stringify(run(), null, 2) + "\n");

module.exports = { createFixture, nearestRank, runBenchmark, run };
