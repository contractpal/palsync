---
name: pal-loop
description: "Execute or resume approved SPEC.md + EXECUTION.md tasks faithfully: inspect, edit, cheap feedback, push, verify in proportion to the change."
---

# pal-loop — execution state machine

## Core authority

Execute the approved **SPEC.md** faithfully. SPEC.md is authoritative: never silently
redesign, expand scope, invent requirements, or amend it. A genuine ambiguity or
spec conflict is a blocker or an amendment-path event, not permission to guess.
Durable task and build state lives in **EXECUTION.md**, not only in model context.

`pal-loop` orchestrates foundational `palbuilder-*` skills; it does not replace or
summarize them. Do not substitute generic programming or web knowledge for a
required PalBuilder skill.

**How much to verify, and whether a final review runs, is decided in exactly one place:**
[`../shared/references/verification.md`](../shared/references/verification.md). Read it once
per session. Nothing in this skill overrides it.

## The cycle

```
understand → inspect only what is needed → edit → cheap feedback → push
           → proportional verification → next task
```

### 1. Start

In Pi, run `palsync usage start --phase build` first. Then, and only this:

- Read EXECUTION.md (`palsync task list --ready`) — on resume it outranks model memory.
- `pal_status`; server newer than your last pull → `pal_pull` before editing.
- Not a git repo → `git init && git add -A && git commit -m "loop start"`.
- State the policy line once: `PalSync: <verification> checks · Final review: <review>`.

Do **not** run broad health checks just because a session started. Run `palsync doctor` when
setting up for the first time, when the environment or dependencies changed, when configuration
looks broken, when a failure points at the environment, or when the user asks. Do not run
`pal_test` or capture render baselines before a task needs them.
[references/session-start.md](references/session-start.md) holds the status-transition and git
mechanics; open it when you need them.

### 2. Pick

Run `palsync task list --ready`. The returned ticket, its spliced SPEC sections, and
§11 constraints are the complete task requirement. Surface assumptions; no eligible
task means enter **Complete** below. A frontier-tier task needing new structure requires
an available advisor; otherwise mark it `needs-frontier` and move to an independent ready task.

Before farming a task to a subagent, read
[references/delegation.md](references/delegation.md). Delegation is optional; the
orchestrator owns verification and state transitions.

### 3. Prepare

Mark the selected task `in_progress` through the task CLI, immediately.

Load exactly the SPEC §9 skills needed for this task, just in time:

- frontend task → `palbuilder-frontend` and `design-build`
- workflow task → `palbuilder-workflow`
- data task → `palbuilder-data`
- any other platform surface → its corresponding owning `palbuilder-*` skill

Before creating the first page, fragment, script, style, workflow, or dataset in this
session, read `../palbuilder-core/references/pal-json.md` through its file-backed and
named-entry examples. This is mandatory and only needs to happen once per session
unless the needed entry type was not covered. Every created Pal object must use its
real typed manifest wrapper; never guess or flatten the `{ "string", "<Type>": {...} }`
shape. SPEC §8a datasets are CREATE definitions: follow `palbuilder-data` plus the
manifest/schema guidance and sync them after creation. SPEC §8b datasets are CONSUMED
dependencies: never create or alter them. Before the first UI markup or CSS, load
`design-build` and checkpoint its six-line design brief; its signature idea must make the
Pal non-generic. At T-final, apply its existing "no zeroes" rubric rule. No vision means no
rubric score: follow `vision-routing.md` or record a `HUMAN GATE`.

### 4. Execute

Read [references/execute.md](references/execute.md) now. Make the smallest
spec-traceable change, reuse existing code and platform primitives before adding
anything, and touch only task-named files (plus cleanup made necessary by the change).
Follow the owning PalBuilder skills for platform syntax and semantics. Run `pal_impact`
before editing an existing page or fragment other files reference (silent for new
files). Run free `pal_ast` `mode:"search"` whenever a touched class, attribute, or
function may have other consumers. `pal_ast` `apply:true` is only for an identical
mechanical change across three or more spec-ref-named files, after a dry run whose
diff is checkpointed and followed by one `pal_push`.

### 5. Verify

Batch the task's edits, then push — runtime tools only see the pushed version. Pick the
checks from [`../shared/references/verification.md`](../shared/references/verification.md):
its risk table decides which of compile / render / behavior / regression apply here, and
`palsync verify` prints that plan for your current diff. Say in one plain sentence why an
expensive check is running, before running it.

Read [references/verify-mechanics.md](references/verify-mechanics.md) for HOW to run and read
a check (screenshot branch recovery, console targeting, exercise failures, dataset sync,
warning waivers). Every success-condition clause needs current tool evidence; an attempted
check, a compile, or a chat assertion is not a PASS.

### 6. Resolve

**Pass:** mark the task `done`, checkpoint concise evidence, and commit the completed
task. Re-read the success condition verbatim before `done` and cite evidence for every
clause. One completed task gets one commit.

**Fail:** fix and re-verify; do not use force or bypass flags to bury a failure. After
two unsuccessful attempts, use the session-start transition procedure to record
`blocked`, `needs-human`, or `needs-frontier` with the required evidence. Inspect
state before replaying an action that might have changed data. If a bad version was
pushed, restore the known-good local source and re-push it (pull/merge first when
server drift requires it); git alone does not restore the server.

### 7. Continue

**Mode:** in `full`, unmet §5 edge-case handling or §12 per-feature criteria is a
defect and blocks; in `lite`, verify the required floor and happy-path criterion for
each primary action without manufacturing full-mode rigor.

Select the next ready, independent task. There is **no review pause between tasks** and no
per-task regression sweep: step 5 already proved what changed.

End the session when the user asks, when only terminally blocked tasks remain, when context
has degraded, or when the work is complete. Finish the current task, leave none
`in_progress`, commit, and run `palsync session-summary`.
Do not auto-continue via the Claude Stop hook or Pi queue. Report what shipped, each blocker and required decision, frontier work,
human gates, and next work. Never end a turn with unchecked tasks unless every remaining task
is terminally blocked; name every blocker explicitly. For a formal QA/eval report, use the
`qa-report` skill.

### 8. Complete

When no eligible task remains, read [references/handoff.md](references/handoff.md).
Summarize what changed, what was checked, and what was deliberately not checked and why.
Then follow the `review` setting: **off** → finish; **ask** → offer a final review and let
the user decide; **auto** → dispatch one fresh-context `pal-review` and report its verdict.
`palsync completion check` states which of those applies.

## Hard invariants

- Never silently edit SPEC.md. For an amendment path, use
  `../pal-spec/references/amendment-path.md`: write an amendment proposal;
  propose → human approve → re-gate → continue. The loop never silently self-amends.
- Never violate §11 NEVER constraints.
- Never create or alter a §8b consumed dataset.
- Never invent missing copy, facts, or assets.
- Never weaken a task or success condition to make it pass.
- Runtime tools verify the pushed version; push before runtime checks.
- Every success-condition clause needs evidence.
- Failed or unrun verification is not PASS.
- Destructive operations obey confirmation gates.
- Task-state changes are written durably.
- Completed tasks get a checkpoint and git commit.
- Never deploy; deployment is human-only.
