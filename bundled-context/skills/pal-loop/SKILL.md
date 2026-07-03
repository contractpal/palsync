---
name: pal-loop
description: "Execute an approved SPEC.md + EXECUTION.md build autonomously — one task at a time, verify with palsync tools, checkpoint to disk, hand off to pal-review, loop fix tasks until PASS. State on disk, so any session resumes. Triggers: 'run the loop', 'build the spec', 'continue the build', 'resume the build', or a workspace with unfinished EXECUTION.md tasks."
---

# pal-loop — execute SPEC.md task by task

You are the execution engine for a spec produced by **pal-spec**: the spec holds every decision, so
your job is faithful execution plus honest verification. Do not redesign, improve the copy, or add
scope — a wrong or incomplete spec is a blocker for the human, never something you fix by editing
SPEC.md yourself. State lives ON DISK in EXECUTION.md, never only in your context; write every state
change to the file the moment it happens, so a dead session resumes on the truth.

---

## Before the first task (once per session)

1. **Targeted reads, not the whole spec** (the spec is re-read per task via `spec ref`, so loading it
   all now just burns tokens): read SPEC.md's **frontmatter** (note `mode:` full|lite, `pal:` type
   web|console, `review cadence:` each-task|every-N|end — absent = end), **§2 Decisions & open
   questions**, and **§11 Constraints (NEVER)**; and EXECUTION.md's **task table**, its **last session
   summary**, and **Blockers**. Each task's full SPEC.md section(s) load in the cycle below (step 1).
   (Exception: pal-review reads everything — that's its job, not this one's.)
2. **Gate — spec must be ready**, because building on an unapproved spec wastes the whole run:
   - `status: draft` → STOP: "The spec isn't approved — set status: approved, or run pal-spec."
   - Trust the structured marker if present: `reality_check: blocked` → STOP; `pass` → proceed;
     `not_run`/absent → text fallback.
   - Text fallback: any unresolved `HARD FLAG` in **§13 Reality check** → STOP and list them.
   - No §13 and no marker (spec predates the gate) → proceed, but record a caveat in the session summary.
3. Not a git repo → `git init && git add -A && git commit -m "loop start"`. Commit after every task.
   **git is a LOCAL checkpoint only** — the PalBuilder server is the source of truth, so `git checkout`
   reverts local files but does NOT undo a change you already pushed (recovery: step 8). Never push this repo.
4. **Load exactly the skills SPEC.md §9 lists, before coding, once** — §9 is the manifest; don't guess
   it (it may include palbuilder-jobs-http/websockets, easy to forget). palbuilder-frontend and
   design-build are always there. **pal-restraint is not in §9** — it's a default discipline (step 5), not a selectable skill.
5. `pal_status`; if the server is newer than the last pull, `pal_pull` first.
6. **Smoke-test before picking work:** `pal_validate`, plus `pal_test` on whichever workflow the
   Checkpoints section shows as last touched — a prior session or lossy compaction can leave the
   workspace broken despite what EXECUTION.md says. Either fails → fix that before starting a new task.

## The task cycle (repeat until done or blocked)

1. **Pick** the first `todo` task whose `depends` are all `done`; none → "Ending a session." Read its
   `spec ref` and **re-read those SPEC.md section(s) before building** — the success condition derives
   from the requirement, not from invention.
2. **Tier check.** Task tier `frontier` and you're not frontier-class (unsure: does it need NEW
   structure, not just following the spec?) → **if an advisor capability is available** (e.g.
   `/advisor`), call it with full context (spec ref, clone target, hard rules) for the missing
   judgment/plan; you still execute, verify, and commit — advisor decides, it doesn't replace your
   verification. **No advisor** → set `needs-frontier`, log a checkpoint, move to the next eligible
   task; don't attempt it badly. (Orchestrators MAY instead dispatch by tier to sized subagents —
   cheap→Haiku, standard→Sonnet. **Delegating? Read `references/delegation.md` first — required protocol.**)
3. **Human-gate check.** Console *compile* is verifiable headlessly (`pal_test`), so it's NOT a gate;
   the console *render* may or may not be — see step 6 and the canonical rule
   `../pal-review/references/console-render-verification.md`. Continue with independent tasks while a
   gate is open. Web renders are agent-visible, so web tasks have no gate.
4. **Mark** the task `in_progress` in EXECUTION.md — write the file now, not later.
5. **Execute exactly as specced:**
   - Scaffold task (T1): **apply the matching starter** (`web-marketing`/`console-app`) via
     `palsync scaffold` and adapt it — never hand-generate scaffold files from scratch.
   - Copy: **§4**, verbatim — these exact words ship.
   - Layout: **§6** composition, applying the design system via **design-build** (the spec carries no colors/fonts).
   - SEO head values: **§7** (web only).
   - Schemas: **§8a** (CREATE). **§8b** datasets are CONSUMED, read-only — never create or alter them;
     before reading one, confirm its §8b fields exist live (`pal_status`/a read action) — a missing field is a blocker.
   The palbuilder/design/seo skills are HOW; the spec is WHAT. Apply **pal-restraint** on every line
   (reuse before building, platform before library, minimum that works, touch only the files this task names).
6. **Verify** against the success condition with tool outputs, not opinion — offline FIRST so a bad
   result never reaches the server:
   - `pal_validate` → 0 errors (instant offline check; fix real warnings).
   - `pal_push` (push policy `checkpoint` → ask the user first).
   - `pal_test` → fresh SERVER validation, workflow VALIDATED, 0 notes — the real compile (console AND
     web) the save API doesn't give. Always run after a workflow change; read `messages` too
     (whole-test failures like "Pal is not a Web Pal" live there).
   - **Web pages:** `pal_preview` → CHECK the returned HTML actually contains the exact strings the
     success condition names; `pal_seo_audit` → 0 errors.
   - **Console screens:** compile via `pal_test` (do verify it); verify the render per the canonical
     rule (`captured:true` → judge against §12 VISUAL, mark `done`; `captured:false` → `needs-human`
     with a `HUMAN GATE:` Blockers entry). Verify data effects indirectly — after a write, run the spec's read-back action and confirm the row.
   - `pal_sync_datasets` after pushing a **§8a** definition (never §8b).
   - `pal_preview`/`pal_seo_audit`/`pal_test` all act on the LAST PUSHED version — push before verifying.
7. **On pass:** set `done`; append one checkpoint line (date, task id, tool-output summary);
   `git add -A && git commit -m "<task id>: <task name>"`; continue.
7a. **Review-cadence pause** (SPEC.md `review cadence`, absent = `end`):
   - `end`: no pause — continue to the next task.
   - `each-task`: pause; report the task (what shipped + step-6 evidence) and **wait for the human's
     go-ahead** before the next task — don't self-approve.
   - `every-N`: track a counter on the checkpoint line (`since last review: 2/3`); at N, pause like
     `each-task` (report every task since the last pause) and reset; below N, continue.
   This is independent of the push `checkpoint` gate (per-push) and the build-completion pal-review handoff (always runs).
7b. **Brownfield regression re-check** — gated on `baseline/` existing (absent → skip). Runs at each
   7a pause **and unconditionally at the build-completion handoff** (under `end`, only there). NOT
   per-task — step 6 already catches immediate breakage, and re-running the whole baseline that often wastes tool calls.
   - **Freshness first** — run the baseline-freshness rule (canonical: `../pal-init/SKILL.md` Step 3);
     stale → `needs-human`, skip every comparison this cycle; never verdict against a stale baseline.
   - `pal_validate` vs `baseline.json`'s `validate`; `pal_test` on each listed workflow vs `validate: pass`.
   - `pal_preview`/`pal_screenshot` on each `captured: true` page — confirm it still renders and the
     recorded `h1s` are present (same string check as step 6). Whether the LOOK shifted is pal-review's regression arm; this only confirms it renders and content didn't disappear.
   - **Viewport fallback:** an `eyeball_only: true` viewport stays `needs-human` (never a silent pass);
     a was-`captured:true`-now-timing-out viewport is a `needs-human` note, not a block (may be transient).
   - **Inherited vs caused:** cross-reference every failure against `known_issues` first — a listed one is noted, not blocking.
   - **Cadence-bisect a caused failure.** This check runs at pauses, not per-task, so a regression can
     ride through several committed tasks before it's caught. Don't block the current task — find the culprit:
     1. Start at the last commit where this check passed (last known-clean).
     2. Walk the per-task commits forward, re-running the SAME failing check against each commit's file
        state (`git show <sha>:<path>`, or `git checkout <sha> -- .` then restore `HEAD` — read-only
        inspection, never a rewrite: git is a checkpoint, not the source of truth).
     3. Stop at the first commit where the check fails — that commit's task is the culprit.
     4. Reopen and `block` that task, with a Blockers entry citing the baseline comparison and the
        culprit commit — not whichever task was current when the check ran.
8. **On fail:** fix and re-verify, up to TWO attempts. Still failing → `blocked`, with a Blockers entry
   naming what failed (exact tool output), what you tried, and the decision/input you need; continue
   with the next INDEPENDENT task. Never skip verification, and never use skipValidation/force to bury
   a failure. **Bad change already pushed?** Restore the good local version (`git checkout` the file or
   prior commit) and **re-push** to overwrite the server — git alone doesn't roll the server back; if
   the re-push is refused for drift, `pal_pull`/`pal_merge` then push.

### Mode (full | lite)
- **full:** a §5 behavior shipped without its specced edge-case handling, or any unmet §12 per-feature criterion, is a defect → blocker.
- **lite:** deferred edge cases are expected, not defects — verify the floor + the happy-path criterion per primary action; don't manufacture full-mode rigor.

## Hard rules

- **Build is NOT complete until every workflow touched this build returns `pal_test` VALIDATED (0
  notes) AND pal-review has returned PASS.** A green `pal_validate` alone is not enough — it's an
  offline check; `pal_test` is the real server compile. Never mark the final task `done` or report the
  build finished on unrun or failing verification, no matter how right it looks.
- **Never deploy** — deployment is a human action in PalBuilder.
- **Never touch SPEC.md §11 (the NEVER list), and never create or alter a §8b consumed dataset.**
- **Never invent content** — a missing copy/fact/asset is a blocker, not improvisation.
- **Never silently edit SPEC.md** — a wrong/incomplete spec is a human blocker; when reality forces a
  change mid-build, follow the amendment path (propose, never self-amend).
- **Never leave EXECUTION.md stale** — write every status change to disk immediately; edit the table, don't summarize it.
- **Never weaken a task to make it pass** — `status` may change freely, but a task's name and success
  condition may NOT be edited, removed, or softened to get a failing verification to pass ("victory by
  deletion"). A genuinely wrong criterion is a spec problem → route it through the amendment path (human approval), never a self-edit.
- **Destructive operations** (dataset recreate, lock override, force push) follow their tools' confirmation gates; the loop never auto-confirms them.

## When the spec is wrong (amendment path)

Reality can contradict the spec mid-build (a type that won't create, a missing consumed field, an
inexpressible behavior). You never fix this by editing SPEC.md. Instead: set the task `blocked`, write
an **amendment proposal** in Blockers (which §, the exact build-time fact with tool output pasted, the
minimal change proposed), and continue with the next independent task. The human approves → pal-spec
applies + re-gates → you re-read the amended § and resume.
Invariant: propose → human approve → re-gate → continue; the loop never silently self-amends.
Full protocol: **read `../pal-spec/references/amendment-path.md`**.

## Build complete → hand off to pal-review

"All tasks `done`" ≠ "the build is done": pal-loop verifies it *compiled*; only **pal-review** checks
it's *correct against the spec*. Before reporting a build finished, hand off — never skip it, and never
run pal-review in this same context (fresh eyes are the whole point; shared context defeats it).

Trigger: every task is `done`, or every remaining task is a `blocked`/`needs-frontier`/`needs-human` the human has accepted as parked for this pass.

1. `baseline/` exists → step 7b's regression re-check runs here unconditionally first (even under `end`).
2. **Dispatch pal-review** in a fresh session/subagent with its inputs: `SPEC.md`, `EXECUTION.md`,
   `DESIGN_SYSTEM.md`/`COMPONENTS.md`, `baseline/` (if any), and the pal's identity so it can
   `pal_fetch`/`pal_screenshot`/`pal_test` the real artifacts.
3. **PASS** → the build is genuinely done; report it.
4. **CHANGES-NEEDED** → append each `## Fix tasks` item as a new EXECUTION.md task (next id, `spec ref`
   carried from the finding, `depends` per stated order, `todo`, `tier` default `standard` /
   `frontier` only if it needs new structure); resume the normal task cycle on exactly those tasks.
5. **Re-review** once the fix tasks are `done`; repeat until PASS. A `needs-human` verdict (console eyeball gate, no screenshot capability) is routed like any other `needs-human` task, not a failure.

## Ending a session

Stop when: all tasks `done` **and pal-review returned PASS** (or its fix tasks are done and
re-reviewed); only `blocked`/`needs-frontier`/`needs-human` remain; the user asked; or you're degrading (context pressure, repeated mistakes — be honest).

**Prefer a proactive handoff over grinding to auto-compact.** You can't see your own context fill, so
don't time the end against a token count — use a coarse heuristic: after several completed tasks, or
when the session simply feels large, finish the task you're on, reach a clean EXECUTION.md boundary (no
task `in_progress`), and stop there. Context quality degrades before the hard limit and compaction is
lossy, whereas a fresh session resuming from disk costs nothing. Preference, not a hard stop — don't abandon a task mid-`in_progress` to hand off; finish it, checkpoint, then stop.

Write a session summary at the top of EXECUTION.md's Checkpoints:
```
== session <n> (<date>), mode <full|lite>: <a> done, <b> blocked, <c> needs-frontier, <d> needs-human.
   Next: <task id or "review blockers / clear human gates">.
```
Then report, in order: what shipped (preview URL if web); what's blocked + the exact decision each needs; what needs a frontier model; what's at a HUMAN GATE + the exact action; what's next.

## Resuming

A new session resumes by reading EXECUTION.md — nothing else; trust the file over any memory of prior
sessions. Re-run `pal_status` before the first push (`pal_pull`/`pal_merge` handle a moved server).
`needs-human` tasks stay parked until the person confirms the gate — don't retry them headlessly.

---

## Delegating to subagents?

Farming an EXECUTION.md task out to a subagent (any harness) has its own protocol — handoff brief
template, re-verify-independently rules, recovery on a failed dispatch. **Read `references/delegation.md`
in full before delegating; it's required, not optional background.**
