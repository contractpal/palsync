"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
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
