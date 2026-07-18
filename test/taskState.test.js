"use strict";
// §4 palsync task/checkpoint: round-trip the EXECUTION.md task table (list -> set -> list),
// surgical single-row rewrite, --ready dependency resolution, checkpoint append, and the
// change-nothing-on-parse-failure guarantee. All pure (no fs).
const { test } = require("node:test");
const assert = require("node:assert");
const { parseTasks, listTasks, setStatus, appendCheckpoint } = require("../src/core/taskState");

// Template shape: NO |---| separator row (matches execution-template.md).
const EXEC = `# EXECUTION — demo
spec: SPEC.md (status: approved)   mode: full

## Build plan
Leaf-first.

## Tasks
| id | task | tier | spec ref | depends | status | success condition (behavioral + tool-checkable) |
| T1 | scaffold + shared fragments | cheap | §3, §6 | — | done | pal_validate 0 errors |
| T2 | first page (composition) | frontier | §4, §6 | T1 | todo | preview "<H1>" |
| T3 | second page | standard | §4 | T2 | todo | preview ok |

## Checkpoints (append-only, one line per completed task)
- T1 scaffolded

## Blockers (what needs the human — be exact)
`;

// Same table WITH a |---| separator row (real files often have one) — parser must tolerate both.
const EXEC_SEP = EXEC.replace(
    "| id | task | tier | spec ref | depends | status | success condition (behavioral + tool-checkable) |\n",
    "| id | task | tier | spec ref | depends | status | success condition |\n|----|------|------|----------|---------|--------|--------------------|\n"
);

test("parse + list: reads every task with id/status/depends", () => {
    const r = listTasks(EXEC);
    assert.ok(r.ok);
    assert.deepEqual(r.tasks.map(t => t.id), ["T1", "T2", "T3"]);
    assert.deepEqual(r.tasks.map(t => t.status), ["done", "todo", "todo"]);
    assert.deepEqual(r.tasks.find(t => t.id === "T2").depends, ["T1"]);
    assert.deepEqual(r.tasks.find(t => t.id === "T1").depends, []); // "—" -> no deps
});

test("--ready: first todo whose depends are all done", () => {
    const r = listTasks(EXEC, { ready: true });
    assert.equal(r.next.id, "T2"); // T1 done, so T2 (depends T1) is ready; T3 waits on T2
});

test("round-trip: set T2 done, list reflects it, then T3 becomes ready", () => {
    const upd = setStatus(EXEC, "T2", "done");
    assert.ok(upd.ok);
    assert.equal(upd.from, "todo");
    assert.equal(upd.to, "done");
    const r = listTasks(upd.text);
    assert.equal(r.tasks.find(t => t.id === "T2").status, "done");
    assert.equal(listTasks(upd.text, { ready: true }).next.id, "T3");
});

test("surgical rewrite: only the status cell changes, rest of the row verbatim", () => {
    const upd = setStatus(EXEC, "T2", "in_progress");
    const line = upd.text.split("\n").find(l => /\|\s*T2\s*\|/.test(l));
    assert.match(line, /first page \(composition\)/);
    assert.match(line, /preview "<H1>"/);
    assert.match(line, /\|\s*in_progress\s*\|/);
    assert.doesNotMatch(line, /\|\s*todo\s*\|/);
    // every other line unchanged
    const before = EXEC.split("\n"), after = upd.text.split("\n");
    const diff = before.filter((l, i) => l !== after[i]);
    assert.equal(diff.length, 1, "exactly one line changed");
});

test("separator-row table parses identically", () => {
    const r = listTasks(EXEC_SEP);
    assert.deepEqual(r.tasks.map(t => t.id), ["T1", "T2", "T3"]);
    assert.equal(setStatus(EXEC_SEP, "T3", "done").ok, true);
});

test("invalid status: error, no rewrite", () => {
    const r = setStatus(EXEC, "T2", "finished");
    assert.equal(r.ok, false);
    assert.match(r.error, /Invalid status/);
});

test("unknown id: error, no rewrite", () => {
    const r = setStatus(EXEC, "T99", "done");
    assert.equal(r.ok, false);
    assert.match(r.error, /No task with id/);
});

test("malformed table (no ## Tasks): parse error, changes nothing", () => {
    const bad = "# EXECUTION\n\n## Build plan\nno table here\n";
    assert.equal(parseTasks(bad).ok, false);
    const r = setStatus(bad, "T1", "done");
    assert.equal(r.ok, false);
    assert.match(r.error, /No "## Tasks" section/);
});

test("checkpoint append lands in Checkpoints, before Blockers", () => {
    // T2 must actually be done in the table before a "T2 done" checkpoint is accepted.
    const upd = setStatus(EXEC, "T2", "done");
    const r = appendCheckpoint(upd.text, "T2 done: preview contained the H1");
    assert.ok(r.ok);
    const lines = r.text.split("\n");
    const cpIdx = lines.findIndex(l => /^## Checkpoints/.test(l));
    const blIdx = lines.findIndex(l => /^## Blockers/.test(l));
    const added = lines.findIndex(l => /T2 done: preview contained the H1/.test(l));
    assert.ok(added > cpIdx && added < blIdx, "appended inside the Checkpoints section");
});

test("checkpoint into a file with no Checkpoints section: error", () => {
    const r = appendCheckpoint("## Tasks\n| id | status |\n| T1 | todo |\n", "x");
    assert.equal(r.ok, false);
});

// Fabricated-completion gate (2026-07-18 haiku QA report, finding #1)
test("checkpoint claiming a task done while its table status is todo: refused", () => {
    const r = appendCheckpoint(EXEC, "T2 complete — all files VALIDATED");
    assert.equal(r.ok, false);
    assert.match(r.error, /T2/);
    assert.match(r.error, /palsync task T2 done/);
});

test("checkpoint session summary with a done count contradicting the table: refused", () => {
    const r = appendCheckpoint(EXEC, "== session 1: 6 done, 0 blocked");
    assert.equal(r.ok, false);
    assert.match(r.error, /claims 6 done/);
    assert.match(r.error, /1 task\(s\)/);
});

test("checkpoint with an accurate done count and non-claim prose: accepted", () => {
    assert.ok(appendCheckpoint(EXEC, "== session 1: 1 done, 2 todo").ok);
    assert.ok(appendCheckpoint(EXEC, "T2 in progress: wiring the console page").ok);
    assert.ok(appendCheckpoint(EXEC, "T1 done earlier; dataset synced").ok); // T1 is done in the table
});
