---
name: pal-loop
description: "Build an approved GOAL.md to done: plan the work yourself, delegate building to subagents, verify every acceptance check with a fresh-context verifier, push, and prove each scripted check with pal_exercise."
---

# pal-loop — build an approved goal

## Core authority

The approved **GOAL.md** is the contract: its outcome, acceptance checks, fixed contracts,
constraints, and non-goals. Never change a check sentence, the outcome, or a fixed contract
without the user. Everything else — the plan, the file layout, the order of work — is yours.
Plan in your head or in a scratch file; nothing gates the plan. Build what the goal needs and
no more.

The goal is **done** when every scripted check passes `pal_exercise {"check":"<id>"}` on the
final pushed version, and the verifier passes every review-only check. The completion gate
(Stop hook, `palsync completion check`) enforces the scripted half from durable tool evidence.

How much to verify per change, and whether a final review runs, is decided in
[`../shared/references/verification.md`](../shared/references/verification.md). Read it once.

`pal-loop` orchestrates the `palbuilder-*` skills; it never replaces them. Never invent
PalBuilder syntax from generic web knowledge.

## Roles (goal eval 2026-11: cheapest and as correct as every other topology)

- **You (main agent):** plan, brief, review diffs, run the checks, decide. Keep your context
  small; you do not write most of the code.
- **Builder:** one subagent (a mid-tier model such as Sonnet) that writes the code. One writer
  at a time in a checkout. Reuse the **same builder** for fixes (send it the failures), so it keeps
  what it learned. Give it: the goal path, the part to build, the skills to load, the fixed
  contracts, and "push, then report files changed and pushes; do not claim behavior".
- **Verifier:** a **new** subagent with no conversation history, given only GOAL.md and this
  instruction: "run `pal_exercise {"check":"<id>"}` for every scripted check, judge each
  review-only check from `pal_screenshot` captures (desktop + mobile) against
  `palbuilder-frontend/references/ui-quality.md`, run `pal_validate` and `pal_test` for each
  workflow, do not edit files, return PASS/FAIL per check with the tool output for each FAIL."

No subagents available → you do both roles, and still verify against GOAL.md, not memory.

## The cycle

```
start → plan → build (builder) → push → verify (verifier) → fix (same builder) → … → done
```

### 1. Start

- In Pi, before calling a required inactive `pal_*` tool, call `pal_tools` once with its exact name,
  then call it directly.
- `pal_status` (activate it first in Pi if inactive); server newer than your last pull → `pal_pull` before edits.
- Not a git repo → `git init && git add -A && git commit -m "loop start"`. Commit an
  uncommitted approved GOAL.md first. Never stash, reset, or discard uncommitted work.
- Run `palsync doctor` only on first setup or when a failure points at the environment.

### 2. Plan

Read GOAL.md and the workspace. Decide the data, workflows, pages, and fragments, and the
order to build them in. Load the owning skills just in time: `palbuilder-frontend` (with
`references/ui-quality.md`), `palbuilder-workflow`, `palbuilder-data`, and any other surface
skill. Before creating the first page, fragment, script, style, workflow, or dataset, read
`../palbuilder-core/references/pal-json.md`: every created Pal object uses its typed manifest wrapper
(`{ "string", "<Type>": {...} }`); never guess or flatten it. Dataset field
types: `../pal-spec/references/palbuilder-types.md`. New pal: start
from the template with `cp` per [references/execute.md](references/execute.md).

Split the build only where it helps: a slice a builder can push and you can check. Most pals
need one to three builder briefs, not a task list.

### 3. Build

Brief the builder. It follows [references/execute.md](references/execute.md) and the owning
skills, runs `pal_impact` before it edits a shared page or fragment, pushes, and runs
`pal_sync_datasets` after it pushes a new dataset definition. Review its diff yourself (`git
diff`) for scope, duplication, and contract names before you verify.

### 4. Verify

Runtime tools see only the pushed version: push first. Run `pal_validate` and the cheap
checks yourself after each builder slice. When a slice covers checks, run their
`pal_exercise {"check":"<id>"}` yourself; for the final verification, start the fresh-context
verifier. [references/verify-mechanics.md](references/verify-mechanics.md) explains how to read
screenshot, exercise, and dataset results.

A failed check is a defect in the build until proven otherwise. If the script is wrong (a
selector, a wait, a scope), fix only its mechanics, keep every assertion its sentence needs,
and record the change and reason under `## Notes` in GOAL.md. Never weaken a check to pass.

### 5. Fix

Send every failure (check id + tool output) to the same builder in one brief. Push, then
re-verify only the failed checks plus anything the fix touched. Do a final full verifier run
before done. After **three** verify rounds that still fail on one check, stop on that check:
add `- BLOCKED <id>: <reason> || tried: <what you tried>` under `## Blockers` in GOAL.md.

If a bad version was pushed, restore the known-good local source and push it again; git alone
does not restore the server.

### 6. Done

`palsync completion check` must report `COMPLETE` or `BLOCKED_HANDOFF`. Commit. Report: what
shipped, the check results, each blocker, human gates (`captured:false` screenshots name
exactly what a person must look at), and decisions you made (also under `## Notes`). Then follow
the `review` setting: **off** → finish; **ask** → offer a final review; **auto** → run one
fresh-context `pal-review` and report its verdict. Session stats: call `pal_stats` once if wanted
(the only telemetry read). For a formal QA/eval report, use the `qa-report` skill.

## Hard invariants

- Never edit a check sentence, the outcome, or a fixed contract without the user.
- Never weaken or delete a check, or write a blocker, to finish faster.
- Never invent copy, facts, or assets. Never violate a constraint or non-goal.
- Never create or alter a dataset the goal says the pal only consumes.
- Runtime tools verify the pushed version: push before runtime checks.
- A claim without tool evidence is not a pass. Failed or unrun verification is not PASS.
- Destructive operations obey confirmation gates. Never deploy; deployment is human-only.
