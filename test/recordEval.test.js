"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { tmpWorkspace } = require("./helpers");
const usage = require("../src/core/usage");
const { buildRow, reviewFields } = require("../scripts/record-eval");

const EXECUTION = [
    "## Tasks",
    "| id | task | status | depends |",
    "|---|---|---|---|",
    "| T1 | Build | done | — |",
    "| T2 | Verify | todo | T1 |",
].join("\n");

function evalWorkspace() {
    const root = tmpWorkspace({});
    const workspace = path.join(root, "01_crud_cheap");
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, "EXECUTION.md"), EXECUTION);
    fs.writeFileSync(path.join(workspace, ".palsync.json"), JSON.stringify({
        palGuid: "PAL-1", lastModifiedDate: "M1"
    }));
    fs.writeFileSync(path.join(workspace, ".palsync.usage.json"), JSON.stringify({
        startedAt: "2026-07-18T12:00:00.000Z", tools: {}
    }));
    return { root, workspace };
}

function evidence(workspace, tool, overrides = {}) {
    assert.equal(usage.appendToolEvidence(workspace, Object.assign({
        tool, palGuid: "PAL-1", marker: "M1"
    }, overrides)), true);
}

const IMPACT_SCENARIO = "impact_01_shared_fragment-on";
const IMPACT_MANIFEST = JSON.parse(fs.readFileSync(path.join(
    __dirname, "..", "eval", "impact", "impact_01_shared_fragment", "baseline-manifest.json"
), "utf8"));

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
}

function trajectory(overrides = {}) {
    const value = {
        schema: "palsync/impact-trajectory/1",
        acceptance: "pass",
        regression: "pass",
        targetCalls: 1,
        targetBeforeFirstEdit: true,
        readsBeforeFirstCorrectWrite: 3,
        searchesBeforeFirstCorrectWrite: 1,
        writesOutsideOracle: 0,
        calls: { mcp: 12, read: 8, other: 15 },
        pushes: 2,
        failedVerificationLoops: 0,
        hardRuleViolations: 0,
        wallTimeMs: 420000,
        falseExactReferences: 0,
        impactResponseBytes: 1800,
    };
    return Object.assign(value, overrides);
}

function impactWorkspace(t, { variant = "on", trajectoryValue, usageValue, sessionCostValue } = {}) {
    const { root, workspace } = evalWorkspace();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const receiptPath = path.join(workspace, ".palsync", "impact-start.json");
    const trajectoryPath = path.join(root, "evidence", "coded-trajectory.json");
    const transcriptPath = path.join(root, "transcripts", "raw-session.jsonl");
    const scenario = "impact_01_shared_fragment-" + variant;
    const receipt = {
        schema: "palsync/impact-start/1",
        evalKey: scenario,
        taskKey: "impact_01_shared_fragment",
        variant,
        fixtureDigest: IMPACT_MANIFEST.fixtureDigest,
        fixtureFiles: { ...IMPACT_MANIFEST.files },
        manifest: {
            mode: "fixture-sections-merged-onto-pulled",
            fixtureSections: ["fragments", "pages"],
            preservedServerKeys: ["layout"]
        },
        palGuid: "PAL-1",
        serverMarker: "START-MARKER",
        serverPaths: [...IMPACT_MANIFEST.expectedServerPaths],
        localHash: IMPACT_MANIFEST.fixtureDigest.slice("sha256:".length),
        fileHashes: { ...IMPACT_MANIFEST.files },
        lint: { errors: 0, warnings: 0 },
        push: { pushed: true, newMarker: "START-MARKER" },
        regressionBaseline: { path: "baseline/baseline.json", mapped: "START-MARKER", arms: ["validate"] },
        seededAt: "2026-08-03T12:00:00.000Z",
    };
    writeJson(receiptPath, receipt);
    // record-eval verifies the arm text the workspace actually received against this repo's arm for
    // the scenario, because the arm is seeded from the INSTALLED palsync while scoring reads the repo:
    // a stale install would otherwise serve the previous generation's arm and silently turn a
    // facts-injected ON arm back into a bare mandate. Seed it exactly as evalSpec.injectImpactSpec
    // does so the fixture exercises the real agreement rather than a restatement of it.
    const { resolveSpec, ARM_BLOCK_START, ARM_BLOCK_END } = require("../src/core/evalSpec");
    const armText = fs.readFileSync(resolveSpec(scenario).armPath, "utf8").trim();
    fs.writeFileSync(path.join(workspace, "EXECUTION.md"),
        EXECUTION + "\n\n" + ARM_BLOCK_START + "\n## Evaluator-owned impact arm\n\n" +
        armText + "\n" + ARM_BLOCK_END + "\n");
    writeJson(trajectoryPath, trajectoryValue || (variant === "off" ? trajectory({
        targetCalls: 0, targetBeforeFirstEdit: false, impactResponseBytes: null
    }) : trajectory()));
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    fs.writeFileSync(transcriptPath, "{\"event\":\"raw transcript bytes\"}\n");
    writeJson(path.join(workspace, ".palsync.usage.json"), usageValue || {
        startedAt: "2026-07-18T12:00:00.000Z",
        totalCalls: 7,
        totalReturnedBytes: 800,
        totalTokens: 200,
        tools: {},
    });
    if (sessionCostValue !== undefined) {
        writeJson(path.join(workspace, ".palsync", "session-cost.json"), sessionCostValue);
    } else {
        writeJson(path.join(workspace, ".palsync", "session-cost.json"), { entries: [{
            model: "claude-haiku-4-5", provider: "anthropic", tokensIn: 10,
            tokensCached: 2, tokensOut: 5, cost: 0.25, currency: "USD"
        }] });
    }
    return {
        root, workspace, receipt, receiptPath, trajectoryPath, transcriptPath,
        args: {
            workspaceDir: workspace,
            model: "claude-haiku-4-5",
            harness: "claude-code",
            scenario,
            variant,
            pair: "impact01-r1",
            pairOrder: "off-first",
            orchSkills: "main@abc1234",
            palbuilderSkills: "legacy@2026-08-03",
            trajectory: trajectoryPath,
            transcript: transcriptPath,
        }
    };
}

function impactRow(h, overrides = {}) {
    return buildRow({ ...h.args, ...overrides });
}

function mutateJson(file, mutate) {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    mutate(value);
    writeJson(file, value);
}

function digest(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("record-eval derives current-marker exercise count and truthful pushOk from tool evidence", () => {
    const { root, workspace } = evalWorkspace();
    fs.writeFileSync(path.join(workspace, "REVIEW.md"), "## Verdict: CHANGES-NEEDED\n\n**Total: 11 / 16**\n");
    evidence(workspace, "pal_push");
    evidence(workspace, "pal_exercise", { runId: "one" });
    evidence(workspace, "pal_exercise", { runId: "two" });
    evidence(workspace, "pal_exercise", { runId: "three" });
    evidence(workspace, "pal_exercise", { marker: "OLD", runId: "stale" });

    const row = buildRow({ workspaceDir: workspace, model: "claude-haiku-4-5", harness: "claude-code" });
    assert.deepEqual(Object.assign({}, row, { sha: "<sha>" }), {
        date: "2026-07-18",
        sha: "<sha>",
        scenario: "01_crud_equipment_checkout",
        model: "claude-haiku-4-5",
        harness: "claude-code",
        verdict: "CHANGES-NEEDED",
        tasksDone: 1,
        tasksTotal: 2,
        pushOk: true,
        exerciseCount: 3,
        score12: "11/16",
    });
    fs.rmSync(root, { recursive: true, force: true });
});

test("record-eval excludes stale-marker evidence for exercise and push", () => {
    const { root, workspace } = evalWorkspace();
    evidence(workspace, "pal_exercise", { marker: "OLD" });
    evidence(workspace, "pal_push", { marker: "OLD" });
    const row = buildRow({ workspaceDir: workspace, model: "m", harness: "pi" });
    assert.equal(row.exerciseCount, 0);
    assert.equal(row.pushOk, false);
    fs.rmSync(root, { recursive: true, force: true });
});

test("record-eval treats an authoritative evidence file with no push as pushOk false", () => {
    const { root, workspace } = evalWorkspace();
    evidence(workspace, "pal_exercise");
    fs.writeFileSync(path.join(workspace, ".palsync.usage.json"), JSON.stringify({
        startedAt: "2026-07-18T12:00:00.000Z",
        tools: { pal_push: { successfulCalls: 9 }, pal_exercise: { successfulCalls: 9 } }
    }));
    const row = buildRow({ workspaceDir: workspace, model: "m", harness: "pi" });
    assert.equal(row.exerciseCount, 1);
    assert.equal(row.pushOk, false);
    fs.rmSync(root, { recursive: true, force: true });
});

test("record-eval falls back to legacy successfulCalls only when evidence file is absent", () => {
    const { root, workspace } = evalWorkspace();
    fs.writeFileSync(path.join(workspace, ".palsync.usage.json"), JSON.stringify({
        startedAt: "2026-07-18T12:00:00.000Z",
        tools: { pal_push: { successfulCalls: 2 }, pal_exercise: { successfulCalls: 6 } }
    }));
    assert.equal(fs.existsSync(path.join(workspace, usage.TOOL_EVIDENCE_FILE)), false);
    const row = buildRow({ workspaceDir: workspace, model: "m", harness: "pi" });
    assert.equal(row.exerciseCount, 6);
    assert.equal(row.pushOk, true);
    fs.rmSync(root, { recursive: true, force: true });
});

test("record-eval reads the canonical pal-review REVIEW.md format (verdict + §12 line)", () => {
    const { root, workspace } = evalWorkspace();
    fs.writeFileSync(path.join(workspace, "REVIEW.md"), [
        "# REVIEW — equipment_checkout — 2026-07-18 — reviewer: fresh session",
        "verdict: PASS",
        "§12: 16/16  — acceptance-criteria tally (count only criteria with cited evidence; feeds eval/scores.jsonl)",
        "pal_validate: ok=true diagnosticCount=0",
    ].join("\n"));
    evidence(workspace, "pal_push");
    evidence(workspace, "pal_exercise");

    const row = buildRow({ workspaceDir: workspace, model: "claude-haiku-4-5", harness: "claude-code" });
    assert.equal(row.verdict, "PASS");
    assert.equal(row.score12, "16/16");
    assert.equal(row.tasksDone, 1);
    fs.rmSync(root, { recursive: true, force: true });
});

test("missing REVIEW.md evidence records BROKEN without inventing a score", () => {
    assert.deepEqual(reviewFields(""), { verdict: "BROKEN", score12: null });
});

test("1. complete impact off row records strict experiment and usage evidence", t => {
    const h = impactWorkspace(t, { variant: "off" });
    const coded = JSON.parse(fs.readFileSync(h.trajectoryPath, "utf8"));
    const row = impactRow(h);
    assert.deepEqual(row.experiment, {
        schema: "palsync/impact-experiment/1",
        pair: "impact01-r1",
        pairOrder: "off-first",
        variant: "off",
        taskKey: "impact_01_shared_fragment",
        impactTarget: "fragments/shared/navbar.html",
        orchSkills: "main@abc1234",
        palbuilderSkills: "legacy@2026-08-03",
        fixtureDigest: IMPACT_MANIFEST.fixtureDigest,
        fixtureFiles: IMPACT_MANIFEST.files,
        startMarker: "START-MARKER",
        startPalGuid: "PAL-1",
        trajectory: coded,
        primaryExplorationActions: 4,
        armFile: {
            name: "off.md",
            sha256: digest(fs.readFileSync(require("../src/core/evalSpec")
                .resolveSpec("impact_01_shared_fragment-off").armPath)),
            // An OFF arm injects no facts, so there is no payload to size.
            factsBytes: null,
        },
        trajectoryFile: {
            name: "coded-trajectory.json",
            sha256: digest(fs.readFileSync(h.trajectoryPath)),
        },
        transcriptFile: {
            name: "raw-session.jsonl",
            sha256: digest(fs.readFileSync(h.transcriptPath)),
        },
    });
    assert.deepEqual(row.palsyncUsage, { calls: 7, returnedBytes: 800, estimatedTokens: 200 });
    assert.deepEqual(row.modelUsage, {
        tokensIn: 10, tokensCached: 2, tokensOut: 5, totalTokens: 15, cost: 0.25, currency: "USD"
    });
});

test("2. complete adopted impact on row remains standard-fields-first", t => {
    const h = impactWorkspace(t);
    const row = impactRow(h);
    assert.deepEqual(Object.keys(row).slice(0, 11), [
        "date", "sha", "scenario", "model", "harness", "verdict", "tasksDone", "tasksTotal",
        "pushOk", "exerciseCount", "score12"
    ]);
    assert.equal(row.experiment.variant, "on");
    // The ON arm injects the facts, so the row carries the payload's byte size — that is what the
    // response-budget gate measures now that no arm calls the tool.
    assert.equal(row.experiment.armFile.name, "on.md");
    assert.ok(row.experiment.armFile.factsBytes > 0);
    assert.ok(row.experiment.armFile.factsBytes <= 4096);
    assert.equal(row.experiment.trajectory.targetCalls, 1);
    assert.equal(row.experiment.trajectory.targetBeforeFirstEdit, true);
    assert.equal(row.experiment.trajectory.impactResponseBytes, 1800);
    assert.equal(row.experiment.primaryExplorationActions, 4);
});

test("3. non-adopted impact on row remains valid evidence", t => {
    const h = impactWorkspace(t, { trajectoryValue: trajectory({
        targetCalls: 0, targetBeforeFirstEdit: false, impactResponseBytes: null
    }) });
    const row = impactRow(h);
    assert.equal(row.experiment.variant, "on");
    assert.equal(row.experiment.trajectory.targetCalls, 0);
    assert.equal(row.experiment.trajectory.targetBeforeFirstEdit, false);
    assert.equal(row.experiment.trajectory.impactResponseBytes, null);
});

test("4. every required impact flag rejects when missing", t => {
    const h = impactWorkspace(t);
    for (const flag of [
        "variant", "pair", "pairOrder", "orchSkills", "palbuilderSkills", "trajectory", "transcript"
    ]) {
        assert.throws(() => impactRow(h, { [flag]: undefined }), /Impact --/i, flag);
    }
});

test("5. receipt scenario, variant, task spec, and current Pal mismatches reject", t => {
    const h = impactWorkspace(t);
    const originalReceipt = JSON.parse(fs.readFileSync(h.receiptPath, "utf8"));
    const cases = [
        ["scenario", receipt => { receipt.evalKey = "impact_02_nested_fragment-on"; }],
        ["variant", receipt => { receipt.variant = "off"; }],
        ["task spec", receipt => { receipt.taskKey = "impact_02_nested_fragment"; }],
        ["Pal", receipt => { receipt.palGuid = "PAL-OTHER"; }],
    ];
    for (const [label, mutate] of cases) {
        const receipt = structuredClone(originalReceipt);
        mutate(receipt);
        writeJson(h.receiptPath, receipt);
        assert.throws(() => impactRow(h), /must agree/, label);
    }
});

test("6. malformed trajectory, exact-schema/type/coherence errors, and every numeric field reject", t => {
    const h = impactWorkspace(t);
    fs.writeFileSync(h.trajectoryPath, "{");
    assert.throws(() => impactRow(h), /Malformed impact trajectory JSON/);

    const invalidShapes = [
        Object.assign(trajectory(), { extra: 1 }),
        Object.assign(trajectory(), { targetBeforeFirstEdit: "true" }),
        Object.assign(trajectory(), { acceptance: "unknown" }),
        // acceptance has no third state; only regression does.
        Object.assign(trajectory(), { acceptance: "stale" }),
        Object.assign(trajectory(), { regression: "unknown" }),
        Object.assign(trajectory(), { readsBeforeFirstCorrectWrite: null }),
        Object.assign(trajectory(), { targetCalls: 0, targetBeforeFirstEdit: true, impactResponseBytes: null }),
        Object.assign(trajectory(), { calls: { mcp: 1, read: 1 } }),
    ];
    for (const value of invalidShapes) {
        writeJson(h.trajectoryPath, value);
        assert.throws(() => impactRow(h), /impact trajectory/i);
    }

    // A stale regression records: an agent that pushed before checking has no verdict, and
    // discarding such arms would select for compliant runs.
    writeJson(h.trajectoryPath, Object.assign(trajectory(), { regression: "stale" }));
    assert.equal(impactRow(h).experiment.trajectory.regression, "stale");
    writeJson(h.trajectoryPath, trajectory());

    const fields = [
        ["targetCalls"], ["readsBeforeFirstCorrectWrite"], ["searchesBeforeFirstCorrectWrite"],
        ["writesOutsideOracle"], ["pushes"], ["failedVerificationLoops"],
        ["hardRuleViolations"], ["wallTimeMs"], ["falseExactReferences"],
        ["impactResponseBytes"], ["calls", "mcp"], ["calls", "read"], ["calls", "other"]
    ];
    for (const fieldPath of fields) {
        const value = trajectory();
        let parent = value;
        for (const part of fieldPath.slice(0, -1)) parent = parent[part];
        parent[fieldPath.at(-1)] = fieldPath[0] === "wallTimeMs" ? 0 : -1;
        writeJson(h.trajectoryPath, value);
        assert.throws(() => impactRow(h), /integer/, fieldPath.join("."));
    }
});

test("7. off-arm target-call contamination rejects", t => {
    const h = impactWorkspace(t, { variant: "off" });
    const contaminated = [
        { targetCalls: 1, targetBeforeFirstEdit: false, impactResponseBytes: 10 },
        { targetCalls: 0, targetBeforeFirstEdit: true, impactResponseBytes: null },
        { targetCalls: 0, targetBeforeFirstEdit: false, impactResponseBytes: 0 },
    ];
    for (const overrides of contaminated) {
        writeJson(h.trajectoryPath, trajectory(overrides));
        assert.throws(() => impactRow(h), /zero targetCalls|off arm contains target-call contamination/i);
    }
});

test("8. null pre-correct-write metrics are preserved with a null primary metric", t => {
    const h = impactWorkspace(t, { trajectoryValue: trajectory({
        readsBeforeFirstCorrectWrite: null,
        searchesBeforeFirstCorrectWrite: null,
    }) });
    const row = impactRow(h);
    assert.equal(row.experiment.trajectory.readsBeforeFirstCorrectWrite, null);
    assert.equal(row.experiment.trajectory.searchesBeforeFirstCorrectWrite, null);
    assert.equal(row.experiment.primaryExplorationActions, null);
});

test("9. absent palsync usage retains an all-null usage object", t => {
    const h = impactWorkspace(t);
    fs.rmSync(path.join(h.workspace, ".palsync.usage.json"));
    assert.deepEqual(impactRow(h).palsyncUsage, {
        calls: null, returnedBytes: null, estimatedTokens: null
    });
});

test("10. malformed palsync usage JSON, root, or present totals reject", t => {
    const h = impactWorkspace(t);
    const file = path.join(h.workspace, ".palsync.usage.json");
    fs.writeFileSync(file, "{");
    assert.throws(() => impactRow(h), /Malformed impact palsync usage JSON/);
    for (const value of [[], null]) {
        writeJson(file, value);
        assert.throws(() => impactRow(h), /usage root/);
    }
    const base = { totalCalls: 1, totalReturnedBytes: 2, totalTokens: 3 };
    for (const field of Object.keys(base)) {
        for (const invalid of [-1, Infinity, "1"]) {
            writeJson(file, { ...base, [field]: invalid });
            assert.throws(() => impactRow(h), /finite non-negative number/, field + "=" + invalid);
        }
    }
});

test("11. absent or defined-empty session cost records modelUsage null", t => {
    const h = impactWorkspace(t);
    const file = path.join(h.workspace, ".palsync", "session-cost.json");
    fs.rmSync(file);
    assert.equal(impactRow(h).modelUsage, null);
    for (const empty of [[], { entries: [] }]) {
        writeJson(file, empty);
        assert.equal(impactRow(h).modelUsage, null);
    }
});

test("12. malformed session-cost JSON/root, missing identity, and mixed invalid entries reject", t => {
    const h = impactWorkspace(t);
    const file = path.join(h.workspace, ".palsync", "session-cost.json");
    fs.writeFileSync(file, "{");
    assert.throws(() => impactRow(h), /Malformed impact session-cost JSON/);
    for (const root of [null, {}, { entries: {} }]) {
        writeJson(file, root);
        assert.throws(() => impactRow(h), /session-cost root/);
    }
    const valid = { model: "m", provider: "p", tokensIn: 1, tokensCached: 0, tokensOut: 1 };
    for (const field of ["model", "provider"]) {
        writeJson(file, [{ ...valid, [field]: "" }]);
        assert.throws(() => impactRow(h), new RegExp(field));
    }
    writeJson(file, [valid, { ...valid, model: "" }]);
    assert.throws(() => impactRow(h), /model/);
});

test("13. malformed, negative, fractional, or missing token fields reject before totaling", t => {
    const h = impactWorkspace(t);
    const file = path.join(h.workspace, ".palsync", "session-cost.json");
    const valid = { model: "m", provider: "p", tokensIn: 1, tokensCached: 2, tokensOut: 3 };
    for (const field of ["tokensIn", "tokensCached", "tokensOut"]) {
        for (const invalid of ["1", -1, 1.5, undefined]) {
            const entry = { ...valid, [field]: invalid };
            writeJson(file, entry);
            assert.throws(() => impactRow(h), /non-negative integer/, field + "=" + invalid);
        }
    }
});

test("14. cached tokens are reported separately and not double-counted", t => {
    const h = impactWorkspace(t, { sessionCostValue: [
        { model: "m", provider: "p", tokensIn: 10, tokensCached: 8, tokensOut: 2 },
        { model: "m", provider: "p", tokensIn: 5, tokensCached: 4, tokensOut: 3 },
    ] });
    assert.deepEqual(impactRow(h).modelUsage, {
        tokensIn: 15, tokensCached: 12, tokensOut: 5, totalTokens: 20, cost: null, currency: null
    });
});

test("15. cost currencies are required and consistent; no-cost entries keep currency null", t => {
    const h = impactWorkspace(t);
    const file = path.join(h.workspace, ".palsync", "session-cost.json");
    const base = { model: "m", provider: "p", tokensIn: 1, tokensCached: 0, tokensOut: 1 };
    writeJson(file, { ...base, cost: 0.1 });
    assert.throws(() => impactRow(h), /currency/);
    writeJson(file, [{ ...base, cost: 0.1, currency: "USD" }, { ...base, cost: 0.2, currency: "EUR" }]);
    assert.throws(() => impactRow(h), /currencies must all agree/);
    writeJson(file, [{ ...base, currency: "USD" }, { ...base, currency: "EUR" }]);
    assert.deepEqual(impactRow(h).modelUsage, {
        tokensIn: 2, tokensCached: 0, tokensOut: 2, totalTokens: 4, cost: null, currency: null
    });
});

test("16. fixtureFiles copy exactly from receipt and every hash is lowercase sha256", t => {
    const h = impactWorkspace(t);
    const row = impactRow(h);
    assert.deepEqual(row.experiment.fixtureFiles, h.receipt.fixtureFiles);
    assert.notStrictEqual(row.experiment.fixtureFiles, h.receipt.fixtureFiles);
    for (const hash of Object.values(row.experiment.fixtureFiles)) assert.match(hash, /^[0-9a-f]{64}$/);

    mutateJson(h.receiptPath, receipt => { receipt.fixtureFiles["pal.json"] = "sha256:wrong"; });
    assert.throws(() => impactRow(h), /fixtureFiles hash/);
});

test("17. transcript and trajectory store basenames and sha256 hashes of exact bytes", t => {
    const h = impactWorkspace(t);
    fs.writeFileSync(h.transcriptPath, Buffer.from([0, 1, 2, 255, 10]));
    const row = impactRow(h);
    assert.deepEqual(row.experiment.trajectoryFile, {
        name: path.basename(h.trajectoryPath), sha256: digest(fs.readFileSync(h.trajectoryPath))
    });
    assert.deepEqual(row.experiment.transcriptFile, {
        name: path.basename(h.transcriptPath), sha256: digest(fs.readFileSync(h.transcriptPath))
    });
});

// The guard that makes the arm generation trustworthy: arms are SEEDED from the globally installed
// palsync (eval/impact/ ships in package.json "files") but SCORED against this repo, so a stale install
// serves the previous generation's arm text and silently reverts a facts-injected ON arm to a bare
// mandate — the same class of undetectable on-arm-becomes-off-arm failure that invalidated the headless
// runs. The receipt pins fixture files, not arm text, so nothing else would catch it.
test("17b. arm text the workspace did not receive from this repo rejects the row", async t => {
    const { ARM_BLOCK_START, ARM_BLOCK_END } = require("../src/core/evalSpec");
    await t.test("a stale install's arm text", () => {
        const h = impactWorkspace(t);
        fs.writeFileSync(path.join(h.workspace, "EXECUTION.md"),
            EXECUTION + "\n\n" + ARM_BLOCK_START + "\n## Evaluator-owned impact arm\n\n" +
            "Impact-context experiment arm: ON.\nBefore the first edit to any server-tracked file, " +
            "call pal_context once with target=\"fragments/shared/navbar.html\".\n" + ARM_BLOCK_END + "\n");
        assert.throws(() => impactRow(h), /ran against a different palsync install/);
    });
    await t.test("no arm block at all", () => {
        const h = impactWorkspace(t);
        fs.writeFileSync(path.join(h.workspace, "EXECUTION.md"), EXECUTION + "\n");
        assert.throws(() => impactRow(h), /missing the evaluator-owned arm block/);
    });
    await t.test("no EXECUTION.md", () => {
        const h = impactWorkspace(t);
        fs.rmSync(path.join(h.workspace, "EXECUTION.md"));
        // Rejected upstream by the task reader, which opens EXECUTION.md before the arm check runs; the
        // arm check keeps its own required-file branch so it cannot depend on that ordering.
        assert.throws(() => impactRow(h), /ENOENT|EXECUTION\.md is required/);
    });
});

test("18. missing receipt, transcript, or trajectory rejects an impact row", t => {
    const h = impactWorkspace(t);
    for (const [file, pattern] of [
        [h.receiptPath, /start receipt is required/],
        [h.transcriptPath, /transcript file is required/],
        [h.trajectoryPath, /trajectory file is required/],
    ]) {
        fs.rmSync(file);
        assert.throws(() => impactRow(h), pattern);
        if (file === h.receiptPath) writeJson(file, h.receipt);
        if (file === h.transcriptPath) fs.writeFileSync(file, "transcript\n");
        if (file === h.trajectoryPath) writeJson(file, trajectory());
    }
});

test("19. receipt requires the exact canonical fields and scalar formats", t => {
    const h = impactWorkspace(t);
    const cases = [
        ["missing field", receipt => { delete receipt.localHash; }, /contain exactly/],
        ["extra field", receipt => { receipt.workspaceDir = "/tmp/leak"; }, /contain exactly/],
        ["schema", receipt => { receipt.schema = "palsync/impact-start/0"; }, /schema/],
        ["required string", receipt => { receipt.taskKey = " "; }, /taskKey.*non-empty string/],
        ["variant enum", receipt => { receipt.variant = "control"; }, /variant must be off or on/],
        ["fixture digest", receipt => { receipt.fixtureDigest = "sha256:ABC"; }, /fixtureDigest/],
        ["local hash", receipt => { receipt.localHash = "ABC"; }, /localHash/],
        ["seed timestamp", receipt => { receipt.seededAt = "2026-02-30T00:00:00.000Z"; }, /valid ISO timestamp/],
    ];
    for (const [label, mutate, pattern] of cases) {
        const receipt = structuredClone(h.receipt);
        mutate(receipt);
        writeJson(h.receiptPath, receipt);
        assert.throws(() => impactRow(h), pattern, label);
    }
});

test("20. receipt hashes, server paths, lint, and push must remain coherent", t => {
    const h = impactWorkspace(t);
    const cases = [
        // localHash is deliberately NOT pinned to fixtureDigest any more: seeding merges the
        // fixture's sections onto the pulled manifest, so the staged pal.json carries this Pal's
        // server identity and hashes differently. Server-tracked files still must match exactly.
        // localHash is deliberately NOT pinned to fixtureDigest any more, and pal.json may diverge:
        // seeding merges the fixture's sections onto the pulled manifest, so the staged manifest
        // carries this Pal's server identity. Every other file must still match exactly.
        ["server-tracked file diverges from fixture", receipt => {
            receipt.fileHashes = { ...receipt.fileHashes, "pages/console.html": "d".repeat(64) };
        }, /fileHashes must deep-equal fixtureFiles/],
        ["empty fixtureFiles", receipt => {
            receipt.fixtureFiles = {};
        }, /fixtureFiles must be a non-empty object/],
        ["empty fileHashes", receipt => {
            receipt.fileHashes = {};
        }, /fileHashes must be a non-empty object/],
        ["raw file hash", receipt => {
            receipt.fileHashes["pal.json"] = "sha256:" + receipt.fileHashes["pal.json"];
        }, /fileHashes hash/],
        // A divergent pal.json is now EXPECTED, so equality is asserted on the key set instead.
        ["fileHashes key set", receipt => {
            delete receipt.fileHashes["pal.json"];
        }, /fileHashes must deep-equal fixtureFiles/],
        ["serverPaths type", receipt => {
            receipt.serverPaths = "pages/console.html";
        }, /serverPaths must be an array/],
        ["serverPaths complete", receipt => {
            receipt.serverPaths.pop();
        }, /serverPaths must be code-point-sorted/],
        ["serverPaths sorted", receipt => {
            receipt.serverPaths.reverse();
        }, /serverPaths must be code-point-sorted/],
        ["lint exact keys", receipt => {
            receipt.lint.checked = true;
        }, /lint must contain exactly/],
        ["lint zero", receipt => {
            receipt.lint.warnings = 1;
        }, /lint must be exactly 0 errors and 0 warnings/],
        ["push exact keys", receipt => {
            receipt.push.serverPaths = [];
        }, /push must contain exactly/],
        ["push result", receipt => {
            receipt.push.pushed = false;
        }, /push must be pushed true/],
        ["push marker", receipt => {
            receipt.push.newMarker = "OTHER";
        }, /newMarker matching serverMarker/],
    ];
    for (const [label, mutate, pattern] of cases) {
        const receipt = structuredClone(h.receipt);
        mutate(receipt);
        writeJson(h.receiptPath, receipt);
        assert.throws(() => impactRow(h), pattern, label);
    }
});

test("21. coordinated receipt mutations cannot replace the committed baseline", t => {
    const h = impactWorkspace(t);
    const receipt = structuredClone(h.receipt);
    const firstServerPath = receipt.serverPaths[0];
    receipt.fixtureFiles = {
        "pal.json": "b".repeat(64),
        [firstServerPath]: "c".repeat(64),
    };
    receipt.fileHashes = { ...receipt.fixtureFiles };
    receipt.serverPaths = [firstServerPath];
    receipt.localHash = "a".repeat(64);
    receipt.fixtureDigest = "sha256:" + receipt.localHash;
    writeJson(h.receiptPath, receipt);
    assert.throws(() => impactRow(h), /must match the committed baseline manifest/);
});

test("22. impact skill pins reject malformed branch, name, SHA, and date forms", t => {
    const h = impactWorkspace(t);
    assert.doesNotThrow(() => impactRow(h, { palbuilderSkills: "core@abcdef0" }));
    for (const [flag, invalid] of [
        ["orchSkills", "main@ABC1234"],
        ["orchSkills", "main@abc123"],
        ["orchSkills", "@abc1234"],
        ["palbuilderSkills", "core@ABC1234"],
        ["palbuilderSkills", "core@abc123"],
        ["palbuilderSkills", "core@2026-02-30"],
        ["palbuilderSkills", "@2026-08-03"],
    ]) {
        assert.throws(() => impactRow(h, { [flag]: invalid }), /Impact --(?:orch|palbuilder)-skills/, flag + "=" + invalid);
    }
});

test("23. strict impact evidence rejects symlinks", t => {
    const h = impactWorkspace(t);
    const files = [
        h.receiptPath,
        h.trajectoryPath,
        h.transcriptPath,
        path.join(h.workspace, ".palsync.usage.json"),
        path.join(h.workspace, ".palsync", "session-cost.json"),
    ];
    for (const file of files) {
        const target = file + ".target";
        fs.renameSync(file, target);
        fs.symlinkSync(target, file);
        assert.throws(() => impactRow(h), /is not a regular file/, path.basename(file));
        fs.rmSync(file);
        fs.renameSync(target, file);
    }
});
