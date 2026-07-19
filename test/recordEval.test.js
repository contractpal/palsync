"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");
const { buildRow, reviewFields } = require("../scripts/record-eval");

const EXECUTION = [
    "## Tasks",
    "| id | task | status | depends |",
    "|---|---|---|---|",
    "| T1 | Build | done | — |",
    "| T2 | Verify | todo | T1 |",
].join("\n");

test("record-eval derives the structured row from workspace evidence", () => {
    const root = tmpWorkspace({});
    const workspace = path.join(root, "01_crud_cheap");
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, "EXECUTION.md"), EXECUTION);
    fs.writeFileSync(path.join(workspace, "REVIEW.md"), "## Verdict: CHANGES-NEEDED\n\n**Total: 11 / 16**\n");
    fs.writeFileSync(path.join(workspace, ".palsync.usage.json"), JSON.stringify({
        startedAt: "2026-07-18T12:00:00.000Z",
        tools: {
            pal_push: { successfulCalls: 1 },
            pal_exercise: { successfulCalls: 3 },
        },
    }));

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

test("missing REVIEW.md evidence records BROKEN without inventing a score", () => {
    assert.deepEqual(reviewFields(""), { verdict: "BROKEN", score12: null });
});
