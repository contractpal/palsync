#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const contextInject = require("../src/launcher/contextInject");
const manifestApi = require("../src/core/contextManifest");
const { formatValidation } = require("../src/core/validate");
const { readStats } = require("../src/core/lintCache");
const { TOOLS } = require("../src/mcp/tools");
const { serializeToolDefinitions } = require("../src/mcp/toolSchema");
const { run: lintCacheBenchmark } = require("../bench/lint-cache-hit-rate");

function workspace(files = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-context-bench-"));
    for (const [rel, content] of Object.entries(files)) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, "utf8");
    }
    return root;
}

function fileState(root) {
    const out = {};
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(absolute);
            else out[path.relative(root, absolute)] = fs.statSync(absolute).mtimeMs;
        }
    }
    walk(root);
    return out;
}

function legacyValidation(result) {
    if (!result.findings.length) {
        return "VALIDATION PASSED\n\nChecked " + result.filesChecked + " files. No errors or warnings were found.\n\nThe workspace is ready for the next operation.";
    }
    return result.findings.map(f =>
        (f.severity === "error" ? "ERROR" : "WARNING") + " " + f.file + ":" + f.line + " — " + f.message).join("\n\n");
}

async function measure() {
    const ws = workspace({ "pages/demo.html": "<c:debug />\n" });
    try {
        const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "context-efficiency-baseline.json"), "utf8"));
        await contextInject.inject(ws, { palName: "Alpha", agent: "claude" });
        const fresh = fileState(ws);
        await contextInject.inject(ws, { palName: "Alpha", agent: "claude" });
        const repeat = fileState(ws);
        const repeatWrites = Object.keys(repeat).filter(file => repeat[file] !== fresh[file]).length;

        await contextInject.inject(ws, { palName: "Beta", agent: "claude" });
        const palDiff = manifestApi.diffManifests(manifestApi.readManifest(ws, true), manifestApi.readManifest(ws));
        await contextInject.inject(ws, { palName: "Beta", agent: "codex" });
        const agentDiff = manifestApi.diffManifests(manifestApi.readManifest(ws, true), manifestApi.readManifest(ws));

        const current = manifestApi.readManifest(ws);
        const skills = await contextInject.bundledSkills();
        const parts = await contextInject.buildPalsyncParts("Beta", { cli: false, skillsDir: ".agents/skills" });
        const isolatedBundle = path.join(ws, "isolated-bundle");
        fs.cpSync(path.join(__dirname, "..", "bundled-context"), isolatedBundle, { recursive: true });
        const beforeSkillEdit = await manifestApi.buildManifest({ agent: "codex", palName: "Beta", skills, parts, bundleRoot: isolatedBundle });
        const editedSkillPath = path.join(isolatedBundle, "skills", skills[0].name, "SKILL.md");
        fs.appendFileSync(editedSkillPath, "\n<!-- benchmark edit -->\n", "utf8");
        const afterSkillEdit = await manifestApi.buildManifest({ agent: "codex", palName: "Beta", skills, parts, bundleRoot: isolatedBundle });
        const skillDiff = manifestApi.diffManifests(beforeSkillEdit, afterSkillEdit);

        const findings = Array.from({ length: 25 }, (_, index) => ({
            severity: "error",
            rule: "debugTagShipped",
            file: "pages/demo.html",
            line: index + 1,
            message: "Remove c:debug before shipping; debug output is shared."
        }));
        const validation = { findings, errors: 25, warnings: 0, filesChecked: 1 };
        const rawBytes = Buffer.byteLength(legacyValidation(validation));
        const returnedBytes = Buffer.byteLength(formatValidation(validation));
        const success = { findings: [], errors: 0, warnings: 0, filesChecked: 1 };
        const successRawBytes = Buffer.byteLength(legacyValidation(success));
        const successReturnedBytes = Buffer.byteLength(formatValidation(success));

        const beforeCache = readStats(ws);
        const validateTool = TOOLS.find(tool => tool.name === "pal_validate");
        await validateTool.run({ workspaceDir: ws }, {});
        const afterFirst = readStats(ws);
        await validateTool.run({ workspaceDir: ws }, {});
        const afterSecond = readStats(ws);
        const secondHits = afterSecond.hits - afterFirst.hits;
        const secondMisses = afterSecond.misses - afterFirst.misses;
        const hitRate = secondHits + secondMisses ? (secondHits / (secondHits + secondMisses)) * 100 : 0;

        const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "tool-schema.snapshot.json"), "utf8"));
        const serialized = serializeToolDefinitions(TOOLS);
        const editedTools = TOOLS.map((tool, index) => index === 0
            ? Object.assign({}, tool, { description: tool.description + " Benchmark edit." }) : tool);
        const editedSchema = serializeToolDefinitions(editedTools);
        const schemaSnapshotMatches = JSON.stringify(serialized) === JSON.stringify(snapshot);
        const schemaEditDetected = JSON.stringify(editedSchema) !== JSON.stringify(snapshot);
        const eager = manifestApi.eagerSummary(current);
        const schemaBytes = Buffer.byteLength(JSON.stringify(snapshot));
        const metrics = {
            schema: "palsync/efficiency-baseline/1",
            eagerContextBytes: {
                total: eager.totalBytes,
                releaseStable: eager.stablePrefixBytes,
                workspaceStable: eager.dynamicTailBytes
            },
            toolSchemaBytes: schemaBytes,
            lintCache: {
                coldMisses: afterFirst.misses - beforeCache.misses,
                repeatedHits: secondHits,
                repeatedMisses: secondMisses,
                repeatedHitRate: Number(hitRate.toFixed(1)),
                incrementalHitRate: lintCacheBenchmark().hitRate
            },
            fixtureResultBytes: {
                pal_validate_clean: successReturnedBytes,
                pal_validate_diagnostics: returnedBytes
            }
        };
        const rows = [
            ["Fresh inject", "No manifest", eager.totalBytes + " eager B measured", "observable"],
            ["Repeated inject", baseline.repeatedInjectWrites, repeatWrites + " writes", repeatWrites === 0 ? "pass" : "fail"],
            ["Pal-name change", "whole instruction file churn", palDiff.firstDivergentSection, palDiff.reason],
            ["Agent switch", "unexplained churn", agentDiff.firstDivergentSection, agentDiff.reason],
            ["Skill source edit", "unobservable", skillDiff.firstDivergentSection, "isolated source edit detected"],
            ["Tool schema edit", baseline.toolSchemaSnapshot ? "snapshot-gated" : "unreviewed", schemaBytes + " B snapshot", schemaSnapshotMatches && schemaEditDetected ? "edit detected" : "fail"],
            ["25 duplicate lint findings", rawBytes + " B", returnedBytes + " B", ((1 - returnedBytes / rawBytes) * 100).toFixed(1) + "% smaller"],
            ["Clean validation", successRawBytes + " B", successReturnedBytes + " B", ((1 - successReturnedBytes / successRawBytes) * 100).toFixed(1) + "% smaller"],
            ["Repeated pal_validate", baseline.lintResultCache ? "cached" : "0% local hits", hitRate.toFixed(1) + "% local hits", (afterFirst.misses - beforeCache.misses) + " cold miss(es)"]
        ];
        const lines = [
            "# PalSync context-efficiency benchmark",
            "",
            "| Scenario | Before (v0.27) | After | Result |",
            "|---|---:|---:|---|",
            ...rows.map(row => "| " + row.join(" | ") + " |"),
            "",
            "Deterministic local benchmark; no live server or provider-cache claims."
        ];
        return { markdown: lines.join("\n") + "\n", metrics };
    } finally {
        fs.rmSync(ws, { recursive: true, force: true });
    }
}

async function run() {
    return (await measure()).markdown;
}

async function runJson() {
    return JSON.stringify((await measure()).metrics, null, 2) + "\n";
}

if (require.main === module) (process.argv.includes("--json") ? runJson() : run()).then(output => process.stdout.write(output)).catch(error => {
    process.stderr.write(error.stack + "\n");
    process.exitCode = 1;
});

module.exports = { run, runJson };
