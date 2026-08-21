"use strict";
// §4 palsync task/checkpoint: round-trip the EXECUTION.md task table (list -> set -> list),
// surgical single-row rewrite, --ready dependency resolution, checkpoint append, and the
// change-nothing-on-parse-failure guarantee. All pure (no fs).
const { test } = require("node:test");
const assert = require("node:assert");
const { parseTasks, listTasks, renderReadyTicket, setStatus, setStatusWithReason, appendCheckpoint, blockerReasons, terminalReasonState, MAX_BLOCKER_REASON } = require("../src/core/taskState");
const { bodyText, parseSpec } = require("../src/core/specLint");

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

test("blocked-style transitions atomically require and record normalized reasons", () => {
    for (const status of ["blocked", "needs-human", "needs-frontier"]) {
        assert.equal(setStatusWithReason(EXEC, "T2", status).ok, false);
        assert.equal(setStatusWithReason(EXEC, "T2", status, "  \n ", "retried").ok, false);
        const r = setStatusWithReason(EXEC, "T2", status, "Provider offline\nneeds owner action", "retried push twice");
        assert.ok(r.ok);
        assert.match(r.text, new RegExp("\\|\\s*" + status.replace("-", "\\-") + "\\s*\\|"));
        assert.match(r.text, new RegExp("- BLOCKED T2 \\[" + status + "\\]: Provider offline needs owner action \\|\\| tried: retried push twice"));
        assert.equal(terminalReasonState(r.text).complete, true);
    }
});

// Track C: the cheapest escape from a hard task is declaring it blocked, so blocked/needs-human
// must carry durable evidence of the workaround already attempted. needs-frontier is exempt.
test("blocked and needs-human require --tried; needs-frontier does not", () => {
    for (const status of ["blocked", "needs-human"]) {
        const missing = setStatusWithReason(EXEC, "T2", status, "Provider offline");
        assert.equal(missing.ok, false);
        assert.equal(missing.error, "Status \"" + status + "\" requires --tried describing the automated workaround you attempted first.");
        assert.equal(setStatusWithReason(EXEC, "T2", status, "Provider offline", "   ").ok, false);
        assert.match(EXEC, /\| T2 .*\| todo \|/); // nothing written on refusal
    }
    const frontier = setStatusWithReason(EXEC, "T2", "needs-frontier", "Needs new structure");
    assert.ok(frontier.ok);
    assert.match(frontier.text, /- BLOCKED T2 \[needs-frontier\]: Needs new structure$/m);
    assert.equal(terminalReasonState(frontier.text).complete, true);
});

test("legacy blocker lines without a tried clause still parse and satisfy the terminal state", () => {
    const legacy = setStatus(EXEC, "T2", "blocked").text
        .replace("- T1 scaffolded", "- T1 scaffolded\n- BLOCKED T2 [blocked]: Provider offline");
    const parsed = blockerReasons(legacy).get("t2");
    assert.equal(parsed.reason, "Provider offline");
    assert.equal(parsed.tried, "");
    assert.equal(terminalReasonState(legacy).complete, true);
});

test("reason and tried are normalized separately: '||' sanitized, each bounded, both round-trip", () => {
    const piped = setStatusWithReason(EXEC, "T2", "blocked", "a || tried: fake", "ran pal_push || pal_validate");
    assert.ok(piped.ok);
    assert.equal(piped.reason, "a / tried: fake");
    assert.equal(piped.tried, "ran pal_push / pal_validate");
    const pipedBack = blockerReasons(piped.text).get("t2");
    assert.equal(pipedBack.reason, "a / tried: fake");
    assert.equal(pipedBack.tried, "ran pal_push / pal_validate");

    const long = setStatusWithReason(EXEC, "T2", "blocked", "r".repeat(MAX_BLOCKER_REASON + 50), "t".repeat(MAX_BLOCKER_REASON + 50));
    assert.equal(long.reason.length, MAX_BLOCKER_REASON);
    assert.equal(long.tried.length, MAX_BLOCKER_REASON);
    const longBack = blockerReasons(long.text).get("t2");
    assert.equal(longBack.reason, "r".repeat(MAX_BLOCKER_REASON));
    assert.equal(longBack.tried, "t".repeat(MAX_BLOCKER_REASON));
    assert.equal(terminalReasonState(long.text).complete, true);
});

test("reason append is atomic, bounded, preserves checkpoints, and avoids duplicates", () => {
    const noCheckpoints = EXEC.replace("## Checkpoints (append-only, one line per completed task)", "## Notes");
    const failed = setStatusWithReason(noCheckpoints, "T2", "blocked", "waiting", "retried once");
    assert.equal(failed.ok, false);
    assert.match(noCheckpoints, /\| T2 .*\| todo \|/);

    const long = "x".repeat(MAX_BLOCKER_REASON + 50);
    const first = setStatusWithReason(EXEC, "T2", "blocked", long, "retried once");
    assert.equal(first.reason.length, MAX_BLOCKER_REASON);
    assert.match(first.text, /- T1 scaffolded/);
    const second = setStatusWithReason(first.text, "T2", "blocked", long, "retried once");
    assert.equal(second.unchanged, true);
    assert.equal((second.text.match(/- BLOCKED T2/g) || []).length, 1);
});

test("ordinary statuses reject reasons and remain backward compatible without one", () => {
    assert.equal(setStatusWithReason(EXEC, "T2", "done", "not allowed").ok, false);
    assert.equal(setStatusWithReason(EXEC, "T2", "done", undefined, "not allowed").ok, false);
    assert.match(setStatusWithReason(EXEC, "T2", "done", undefined, "not allowed").error, /does not accept --tried/);
    const r = setStatusWithReason(EXEC, "T2", "in_progress");
    assert.ok(r.ok);
    assert.equal(listTasks(r.text).tasks.find(task => task.id === "T2").status, "in_progress");
    assert.equal(terminalReasonState(setStatus(EXEC, "T2", "blocked").text).complete, false);
});

// --- slice 02: ready-ticket print (pure render seam) ---
const SPEC_READY = `# SPEC \u2014 demo
status: approved

## 1. Vision
vision body

## 3. Sitemap & routing
sitemap body unique 3ABC

## 4. Copy
copy body unique 4XYZ line one
copy body unique 4XYZ line two

## 6. Layout
layout body unique 6MNO

## 8. Data model
### 8a. Datasets to CREATE
create block A unique 8AAA
### dataset: foo
| field | type | size | notes |
| fooId | Primary key | \u2014 | |

### 8b. Datasets CONSUMED \u2014 none.
consumed block B unique 8BBB

## 11. Guardrails
never body unique 11NEVER should always appear

## 12. Acceptance criteria
criteria body
`;

const SPEC_NEVER_TITLE = SPEC_READY.replace("## 11. Guardrails", "## 11. Custom Title That Is Not Never");

const EXEC_READY = `# EXECUTION \u2014 demo
spec: SPEC.md (status: approved)   mode: full

## Build plan
Leaf-first.

## Tasks
| id | task | tier | spec ref | depends | status | success condition (behavioral + tool-checkable) |
| T1 | scaffold + shared fragments | cheap | \u00A73, \u00A76 | \u2014 | done | pal_validate 0 errors |
| T2 | first page (composition) | frontier | \u00A74, \u00A76 | T1 | todo | preview "<H1>" contains heading |
| T3 | second page | standard | \u00A74 | T2 | todo | preview ok |

## Checkpoints (append-only, one line per completed task)
- T1 scaffolded

## Blockers (what needs the human \u2014 be exact)
`;

test("listTasks ready gains full row: tier, specRef, successCondition", () => {
    const r = listTasks(EXEC_READY, { ready: true });
    assert.ok(r.ok);
    assert.equal(r.next.id, "T2");
    assert.equal(r.next.status, "todo");
    assert.equal(r.next.tier, "frontier");
    assert.equal(r.next.specRef, "\u00A74, \u00A76");
    assert.equal(r.next.task, "first page (composition)");
    assert.equal(r.next.successCondition, 'preview "<H1>" contains heading');
    assert.deepEqual(r.next.depends, ["T1"]);
});

test("ready print contains every ticket field", () => {
    const rendered = renderReadyTicket(EXEC_READY, SPEC_READY);
    assert.equal(rendered.ok, true);
    const out = rendered.ticket;
    assert.match(out, /id:\s*T2/);
    assert.match(out, /status:\s*todo/);
    assert.match(out, /tier:\s*frontier/);
    assert.match(out, /depends:\s*T1/);
    assert.match(out, /spec ref:\s*\u00A74, \u00A76/);
    assert.match(out, /task:\s*first page \(composition\)/);
    assert.match(out, /success condition:\s*preview "<H1>" contains heading/);
});

test("every section named by spec ref is spliced verbatim, in ref order", () => {
    const rendered = renderReadyTicket(EXEC_READY, SPEC_READY);
    assert.equal(rendered.ok, true);
    const out = rendered.ticket;
    const idx4 = out.indexOf("copy body unique 4XYZ line one");
    const idx6 = out.indexOf("layout body unique 6MNO");
    assert.ok(idx4 !== -1, "\u00A74 body present");
    assert.ok(idx6 !== -1, "\u00A76 body present");
    assert.ok(idx4 < idx6, "\u00A74 before \u00A76 in ref order");
    assert.ok(out.includes("copy body unique 4XYZ line two"));
    const revExec = EXEC_READY.replace("\u00A74, \u00A76", "\u00A76, \u00A74");
    const rev = renderReadyTicket(revExec, SPEC_READY);
    assert.equal(rev.ok, true);
    const rIdx4 = rev.ticket.indexOf("copy body unique 4XYZ");
    const rIdx6 = rev.ticket.indexOf("layout body unique 6MNO");
    assert.ok(rIdx6 < rIdx4, "reversed ref order respected");
});

test("\u00A711 is spliced on every ready ticket, located by number not title", () => {
    const rendered = renderReadyTicket(EXEC_READY, SPEC_READY);
    assert.equal(rendered.ok, true);
    assert.ok(rendered.ticket.includes("never body unique 11NEVER"), "\u00A711 body present");
    const withWeird = renderReadyTicket(EXEC_READY, SPEC_NEVER_TITLE);
    assert.equal(withWeird.ok, true);
    assert.ok(withWeird.ticket.includes("never body unique 11NEVER"), "\u00A711 found by number despite title change");
    assert.match(withWeird.ticket, /--- SPEC \u00A711 ---/);
});

test("\u00A78b ref splices only the consumed-dataset subsection", () => {
    const exec8b = `# EXECUTION \u2014 demo
spec: SPEC.md (status: approved)   mode: full

## Build plan
Leaf-first.

## Tasks
| id | task | tier | spec ref | depends | status | success condition |
| T1 | data task | standard | \u00A78b | \u2014 | todo | ok |

## Checkpoints
## Blockers
`;
    const rendered = renderReadyTicket(exec8b, SPEC_READY);
    assert.equal(rendered.ok, true);
    assert.ok(rendered.ticket.includes("consumed block B unique 8BBB"), "8b present");
    assert.equal(rendered.ticket.includes("create block A unique 8AAA"), false, "8a must be absent for 8b ref");
    assert.ok(rendered.ticket.includes("never body unique 11NEVER"), "\u00A711 still spliced");
});

test("nothing is truncated, summarized, or capped", () => {
    const longBody = "LONG line " + "x".repeat(2000) + "\n" + "y".repeat(3000);
    const specLong = SPEC_READY.replace("layout body unique 6MNO", longBody);
    const rendered = renderReadyTicket(EXEC_READY, specLong);
    assert.equal(rendered.ok, true);
    assert.ok(rendered.ticket.includes("x".repeat(2000)));
    assert.ok(rendered.ticket.includes("y".repeat(3000)));
    assert.ok(rendered.ticket.includes("never body unique 11NEVER"));
});

test("unresolvable spec ref token fails with task id and token, no partial ticket", () => {
    const execBad = EXEC_READY.replace("\u00A74, \u00A76", "\u00A799");
    const rendered = renderReadyTicket(execBad, SPEC_READY);
    assert.equal(rendered.ok, false);
    assert.equal(rendered.token, "\u00A799");
    assert.equal(rendered.taskId, "T2");
    assert.match(rendered.error, /T2/);
    assert.match(rendered.error, /\u00A799/);
    assert.equal(rendered.ticket, undefined, "no partial ticket");
    const execMal = EXEC_READY.replace("\u00A74, \u00A76", "abc");
    const mal = renderReadyTicket(execMal, SPEC_READY);
    assert.equal(mal.ok, false);
    assert.equal(mal.token, "abc");
});

test("missing SPEC.md exits non-zero with distinct message", () => {
    const missing = renderReadyTicket(EXEC_READY, null);
    assert.equal(missing.ok, false);
    assert.match(missing.error, /SPEC\.md is missing/);
    const empty = renderReadyTicket(EXEC_READY, "   \n");
    assert.equal(empty.ok, false);
    assert.match(empty.error, /SPEC\.md is missing/);
    // distinct from bad-ref error
    const bad = renderReadyTicket(EXEC_READY.replace("\u00A74, \u00A76", "\u00A799"), SPEC_READY);
    assert.notEqual(missing.error, bad.error);
});

test("palsync task list without --ready stays byte-identical to today", () => {
    const r = listTasks(EXEC_READY);
    assert.ok(r.ok);
    assert.equal(r.tasks.length, 3);
    const lines = r.tasks.map(t => t.id + "\t" + t.status + "\t" + (t.depends.length ? "depends:" + t.depends.join(",") : "\u2014") + "\t" + t.task);
    assert.equal(lines[0], "T1\tdone\t\u2014\tscaffold + shared fragments");
    assert.equal(lines[1], "T2\ttodo\tdepends:T1\tfirst page (composition)");
    assert.equal(lines[2], "T3\ttodo\tdepends:T2\tsecond page");
    // listTasks non-ready must not leak tier/specRef/successCondition into shape
    for (const t of r.tasks) {
        assert.equal(Object.hasOwn(t, "tier"), false);
        assert.equal(Object.hasOwn(t, "specRef"), false);
        assert.equal(Object.hasOwn(t, "successCondition"), false);
    }
});

test("missing \u00A711 is a hard failure before any ticket is produced", () => {
    const specNo11 = SPEC_READY.replace("## 11. Guardrails\nnever body unique 11NEVER should always appear\n", "");
    const rendered = renderReadyTicket(EXEC_READY, specNo11);
    assert.equal(rendered.ok, false);
    assert.equal(rendered.kind, "missingNever");
    assert.match(rendered.error, /\u00A711/);
    assert.equal(rendered.ticket, undefined, "no partial ticket");
    // distinct kind/message from the other hard failures
    const missing = renderReadyTicket(EXEC_READY, null);
    assert.equal(missing.kind, "missingSpec");
    assert.notEqual(rendered.error, missing.error);
    assert.notEqual(rendered.kind, missing.kind);
    const bad = renderReadyTicket(EXEC_READY.replace("\u00A74, \u00A76", "\u00A799"), SPEC_READY);
    assert.equal(bad.kind, "badRef");
    assert.notEqual(rendered.error, bad.error);
});

test("no ready task case behaves as today: message plus non-zero", () => {
    const execNoReady = `# EXECUTION \u2014 demo
spec: SPEC.md (status: approved)   mode: full

## Build plan

## Tasks
| id | task | tier | spec ref | depends | status | success condition |
| T1 | a | cheap | \u00A73 | \u2014 | done | ok |
| T2 | b | standard | \u00A74 | T1 | done | ok |

## Checkpoints
`;
    const rendered = renderReadyTicket(execNoReady, SPEC_READY);
    assert.equal(rendered.ok, false);
    assert.equal(rendered.noReady, true);
    assert.match(rendered.error, /No ready task/);
});

