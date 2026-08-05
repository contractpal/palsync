"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");
const completionGate = require("../src/core/completionGate");
const { claudeStopOutput } = require("../src/core/completionHook");
const { run, runHookCommand } = require("../src/cli/syncCommands");
const usage = require("../src/core/usage");

function execution(status = "done", checkpoint = "") {
    return `## Tasks
| id | task | status |
| T1 | Build | ${status} |

## Checkpoints
${checkpoint}
`;
}

function workspace(status = "done", checkpoint = "") {
    return tmpWorkspace({
        "EXECUTION.md": execution(status, checkpoint),
        ".palsync.json": JSON.stringify({ palGuid: "PAL-1", lastModifiedDate: "M1" })
    });
}

function writeReview(ws, verdict = "PASS") {
    fs.writeFileSync(path.join(ws, "REVIEW.md"), `# REVIEW\nverdict: ${verdict}\n## §12 visual\n| criterion | result |\n|---|---|\n| copy matches | PASS |\n`);
}

test("completion state machine preserves non-applicable and work-in-progress replies", () => {
    const absent = tmpWorkspace();
    assert.deepEqual(completionGate.checkWorkspace(absent).state, "NOT_APPLICABLE");
    const empty = tmpWorkspace({ "EXECUTION.md": "## Tasks\n| id | status |\n\n## Checkpoints\n" });
    assert.equal(completionGate.checkWorkspace(empty).state, "NOT_APPLICABLE");
    // An EXECUTION.md that never declares a "## Tasks" section is a workspace without task
    // tracking, not a broken table. Treating it as MALFORMED made the gate unsatisfiable — the
    // section is evaluator-owned, so the agent could not add it, and the Stop hook re-blocked every
    // turn until the host force-overrode. The impact eval fixtures (bounded rename, no task table)
    // hit exactly this on the first live arm.
    const noTasks = tmpWorkspace({ "EXECUTION.md": "# Execution\n\n1. Rename the fragment.\n2. Push.\n" });
    const noTasksGate = completionGate.checkWorkspace(noTasks);
    assert.equal(noTasksGate.state, "NOT_APPLICABLE");
    assert.equal(noTasksGate.allow, true);
    assert.equal(claudeStopOutput(noTasksGate), null, "a task-free EXECUTION.md must not block the Stop hook");
    // A section that IS present but broken stays actionable, so it still blocks.
    const broken = tmpWorkspace({ "EXECUTION.md": "## Tasks\nno table here\n" });
    assert.equal(completionGate.checkWorkspace(broken).state, "MALFORMED_EXECUTION");
    fs.rmSync(noTasks, { recursive: true, force: true });
    fs.rmSync(broken, { recursive: true, force: true });
    for (const status of ["todo", "in_progress"]) {
        const ws = workspace(status);
        const gate = completionGate.checkWorkspace(ws);
        assert.equal(gate.state, "WORK_IN_PROGRESS");
        assert.equal(gate.allow, true);
        fs.rmSync(ws, { recursive: true, force: true });
    }
    fs.rmSync(absent, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
});

test("all-done completion requires a current explicit PASS review", () => {
    const ws = workspace();
    // A PASS review also needs durable clean desktop+mobile render evidence; without these rows
    // the gate would (correctly) stay REVIEW_FAILED even after the PASS verdict lands.
    for (const viewportName of ["desktop", "mobile"]) {
        assert.equal(usage.appendToolEvidence(ws, {
            tool: "pal_screenshot", palGuid: "PAL-1", marker: "M1",
            route: "/", viewportName, renderClean: true
        }), true);
    }
    assert.equal(completionGate.checkWorkspace(ws).state, "REVIEW_FAILED");
    writeReview(ws, "CHANGES-NEEDED");
    assert.equal(completionGate.checkWorkspace(ws).state, "REVIEW_FAILED");
    writeReview(ws, "PASS");
    const complete = completionGate.checkWorkspace(ws);
    assert.equal(complete.state, "COMPLETE");
    assert.equal(complete.allow, true);
    assert.equal(complete.completionPassed, true);
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(ws, "EXECUTION.md"), future, future);
    assert.equal(completionGate.checkWorkspace(ws).state, "REVIEW_FAILED");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("terminal handoffs require matching machine-readable reasons", () => {
    const missing = workspace("blocked");
    const bad = completionGate.checkWorkspace(missing);
    assert.equal(bad.state, "MISSING_BLOCKER_REASON");
    assert.match(bad.message, /palsync task T1 blocked --reason/);
    fs.rmSync(missing, { recursive: true, force: true });

    for (const [status, state] of [["blocked", "BLOCKED_HANDOFF"], ["needs-human", "BLOCKED_HANDOFF"], ["needs-frontier", "FRONTIER_HANDOFF"]]) {
        const ws = workspace(status, `- BLOCKED T1 [${status}]: owner action required`);
        const gate = completionGate.checkWorkspace(ws);
        assert.equal(gate.state, state);
        assert.equal(gate.allow, true);
        assert.equal(gate.completionPassed, false);
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("malformed EXECUTION deterministically fails plain CLI", async () => {
    const ws = tmpWorkspace({ "EXECUTION.md": "## Tasks\nnot a table\n" });
    const gate = completionGate.checkWorkspace(ws);
    assert.equal(gate.state, "MALFORMED_EXECUTION");
    assert.equal(gate.allow, false);
    const oldLog = console.log; console.log = () => {};
    try { assert.equal(await run("completion", ["check", "--dir", ws]), 1); }
    finally { console.log = oldLog; fs.rmSync(ws, { recursive: true, force: true }); }
});

test("Claude Stop output uses block decision JSON, while hook exceptions fail open", async () => {
    const output = claudeStopOutput({ allow: false, message: "Review missing" });
    assert.deepEqual(output, { decision: "block", reason: "Review missing" });
    assert.equal(claudeStopOutput({ allow: true }), null);

    const ws = workspace();
    const oldLog = console.log, oldError = console.error; const logged = [];
    console.log = value => logged.push(value); console.error = () => {};
    try {
        assert.equal(await runHookCommand(["completion", "--mode", "claude"], JSON.stringify({ cwd: ws, stop_hook_active: true })), 0);
        assert.deepEqual(JSON.parse(logged.pop()), { decision: "block", reason: completionGate.checkWorkspace(ws).message });
        assert.equal(await runHookCommand(["completion", "--mode", "claude"], "{bad"), 0);
    } finally {
        console.log = oldLog; console.error = oldError; fs.rmSync(ws, { recursive: true, force: true });
    }
});
