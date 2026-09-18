"use strict";
// Approved amendments are human edits; PalSync supplies the deterministic proposal,
// version, validation, and continuation gates around that decision.
const { test } = require("node:test");
const assert = require("node:assert");
const { lintSpec } = require("../src/core/specLint");
const { proposeAmendment, renderReadyTicket } = require("../src/core/taskState");

const SPEC = `# SPEC — Widget Tracker
status: approved
reality_check: pass
spec version: 1
mode: lite

## 3. Sitemap
widgets

## 4. Copy
- Score is shown as a rating.

## 11. Constraints
- NEVER change unrelated widgets.

## 12. Acceptance criteria
- pal_validate: 0 errors
- pal_test: ok
- every nav link routes

## 14. Amendment log
`;
const EXEC = `# EXECUTION — Widget Tracker
spec: SPEC.md (status: approved)   mode: lite
spec version: 1

## Tasks
| id | task | tier | spec ref | depends | status | success condition |
| T1 | foundation | cheap | §3 | — | done | pal_validate 0 errors |
| T2 | show score | standard | §4 | T1 | done | preview rating |
| T3 | submit score | standard | §4 | T2 | todo | pal_test ok |
| T4 | unrelated audit | standard | §3 | T1 | done | pal_validate 0 errors |

## Checkpoints
- T1 done

## Blockers
`;

test("proposal is production-state only: it blocks the affected task and never mutates SPEC", () => {
    const before = SPEC;
    const proposed = proposeAmendment(EXEC, { id: "T2", specRef: "§4", fact: "Rating cannot be created", change: "use Decimal", tried: "validated dataset type" });
    assert.ok(proposed.ok);
    assert.equal(SPEC, before);
    assert.match(proposed.text, /\| T2 \| show score \| standard \| §4 \| T1 \| blocked \|/);
    assert.match(proposed.text, /AMENDMENT PROPOSAL \(§4\).*Awaiting human approval/);
});

test("denied proposal leaves the contract unchanged", () => {
    const proposed = proposeAmendment(EXEC, { id: "T2", specRef: "§4", fact: "Rating cannot be created", change: "use Decimal", tried: "validated dataset type" });
    assert.ok(proposed.ok);
    // No approved edit/reconciliation follows: the versioned contract remains unchanged.
    assert.equal(SPEC.match(/spec version: (\d+)/)[1], "1");
    assert.match(proposed.text, /spec version: 1/);
});

test("approved amendment blocks stale execution until reconciliation updates its version", () => {
    const amended = SPEC.replace("spec version: 1", "spec version: 2")
        .replace("Score is shown as a rating.", "Score is shown as a decimal.")
        .replace("## 14. Amendment log\n", "## 14. Amendment log\n- v2 (2026-07-20, approved by sam): §4 — rating → decimal — reality forced it because: Rating cannot be created. Re-gate: §4 → pass.\n");
    const stale = renderReadyTicket(EXEC.replace("| T2 | show score | standard | §4 | T1 | done | preview rating |", "| T2 | show score | standard | §4 | T1 | todo | preview rating |"), amended);
    assert.equal(stale.ok, false);
    assert.equal(stale.kind, "inconsistentContract");
    assert.match(stale.error, /spec version/);

    // Human/model reconciliation changes only impacted rows: T2 reopens, T3's changed
    // requirement is updated, and unrelated completed T4 plus its evidence stay intact.
    const reconciled = EXEC.replace("spec version: 1", "spec version: 2")
        .replace("| T2 | show score | standard | §4 | T1 | done | preview rating |", "| T2 | show score | standard | §4 | T1 | todo | preview decimal |")
        .replace("| T3 | submit score | standard | §4 | T2 | todo | pal_test ok |", "| T3 | submit decimal score | standard | §4 | T2 | todo | pal_test decimal value | ");
    const ready = renderReadyTicket(reconciled, amended);
    assert.ok(ready.ok, ready.error);
    assert.equal(ready.next.id, "T2", "reopened completed task is reworked first");
    assert.match(reconciled, /\| T4 \| unrelated audit \| standard \| §3 \| T1 \| done \|/);
    assert.match(reconciled, /- T1 done/);
    assert.equal(lintSpec(amended, { hasBaseline: false }).counts.HARD_FLAG, 0);
});
