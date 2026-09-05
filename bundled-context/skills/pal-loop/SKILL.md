---
name: pal-loop
description: "Execute or resume approved SPEC.md + EXECUTION.md tasks faithfully; verify, checkpoint, commit, and hand off for independent review."
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

## State machine

Repeat this short cycle until handoff or a terminal blocker.

### 1. Start

In Pi, first run `palsync usage start --phase build`; do this before reading any reference,
running doctor/status/pull/smoke checks, or using build tools. The extension captures the
structured baseline automatically. Then read [references/session-start.md](references/session-start.md)
before the first task. Ensure the spec is approved and reality-checked, the workspace is viable,
git is initialized, reviewer dispatch is available, and the required smoke checks pass.
Use its CLI transition procedure, session-start reads, doctor, server-status/pull,
and just-in-time loading mechanics. On resume, trust EXECUTION.md over model memory.

### 2. Pick

Run `palsync task list --ready`. The returned ticket, its spliced SPEC sections, and
§11 constraints are the complete task requirement. Surface assumptions; no eligible
task means enter **Complete / handoff** below. A frontier-tier task needing new
structure requires an available advisor; otherwise mark it `needs-frontier` and move
only to an independent ready task.

Before farming a task to a subagent, read
[references/delegation.md](references/delegation.md). Delegation is optional; the
orchestrator owns verification and state transitions.

### 3. Prepare

Mark the selected task `in_progress` through the task CLI, immediately.

Load exactly the SPEC §9 skills needed for this task, just in time. In particular:

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
`design-build` and checkpoint its six-line design brief; its
signature idea must make the Pal non-generic. At T-final, apply its existing “no
zeroes” rubric rule. No vision means no rubric score: follow `vision-routing.md` or
record a `HUMAN GATE`.

### 4. Execute

Read [references/execute.md](references/execute.md) now. Make the smallest
spec-traceable change, reuse existing code and platform primitives before adding
anything, and touch only task-named files (plus cleanup made necessary by the change).
Follow the owning PalBuilder skills for platform syntax and semantics. Run `pal_impact`
before editing an existing page or fragment other files reference (silent for new
files). Run free `pal_ast` `mode:"search"` whenever a touched class, attribute, or
function may have other consumers. `pal_ast` `apply:true` is only for an identical
mechanical change across three or more spec-ref-named files, after a dry run whose
diff is checkpointed and followed by one `pal_push`; never use it for copy or design.

### 5. Verify

Read [references/verify-ladder.md](references/verify-ladder.md) now. Batch the
final task edits, then push before every runtime/render check: runtime tools inspect
the pushed version. Use the applicable push/test/fetch-or-preview/SEO/screenshot/
exercise/dataset and warning procedures from that reference. Verify every
success-condition clause with current tool evidence; an attempted check, compile,
screenshot path, or chat assertion is not a PASS.

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

Apply the review cadence in [references/handoff.md](references/handoff.md), including
its brownfield regression check when `baseline/` exists. Then select the next ready,
independent task. A task that caused a brownfield regression must be reopened and
blocked according to that reference.

End the current build session after three non-cheap completed tasks, any completed
frontier task, or a task consuming both verification retries. Record the `session tasks:
<n>/3` checkpoint counter; cheap tasks do not increment it. Finish the current task,
leave none `in_progress`, commit, and run `palsync session-summary` using the reference
mechanics. A fresh delegated next task may satisfy this handoff. Do not auto-continue
via the Claude Stop hook or Pi queue. Also stop when the user asks, only terminally
blocked tasks remain, or completion has passed. Report what
shipped, each blocker and required decision, frontier work, human gates, and next work.
Never end a turn with unchecked tasks unless every remaining task is terminally blocked;
name every blocker explicitly. For a formal QA/eval report, use the `qa-report` skill
and `bundled-context/skills/qa-report/references/report-template.md`.

### 8. Complete / handoff

When no eligible task remains, read [references/handoff.md](references/handoff.md) in
full. Independent fresh-context `pal-review` is mandatory; all tasks `done` is not
build completion. Follow its regression, session-summary, review dispatch,
CHANGES-NEEDED, and re-review procedures. Final completion requires a current review
PASS **and** `palsync completion check`. A reviewer-dispatch failure is a `HUMAN GATE`,
not a valid build PASS.

## Hard invariants

- Never silently edit SPEC.md. For an amendment path, use
  `../pal-spec/references/amendment-path.md`: write an amendment proposal; propose → human approve → re-gate → continue. The loop never silently self-amends.
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
- Independent `pal-review` is required before build completion.
- Build completion also requires `pal_test` VALIDATED (0 notes) for every workflow
  touched by this build.
- Never deploy; deployment is human-only.
