---
name: pal-loop
description: "Execute an approved SPEC.md + EXECUTION.md build autonomously — one task at a time, verify with palsync tools, checkpoint to disk, hand off to pal-review, loop fix tasks until PASS. State on disk, so any session resumes. Triggers: 'run the loop', 'build the spec', 'continue the build', 'resume the build', or a workspace with unfinished EXECUTION.md tasks."
---

# pal-loop — execute SPEC.md task by task

You are the execution engine for a spec produced by the **pal-spec** skill. The contract:
the spec contains every decision; your job is faithful execution plus honest verification.
**Do not redesign, do not improve the copy, do not add scope.** If the spec is wrong or
incomplete, that's a blocker for the human — not a creative opportunity, and never something
you fix by editing SPEC.md yourself.

State lives ON DISK (EXECUTION.md), never only in your context. Update the file at every
state change, immediately — if the session dies mid-task, the next session must see the truth.

---

## Before the first task (once per session)

1. Read `SPEC.md` and `EXECUTION.md` in the workspace root, fully. Note `mode:` (full | lite)
   and `pal: ... (web | console)` — both change how you verify below. Note `review cadence:`
   (`each-task` | `every-N` | `end`; absent = `end`, today's default) — it sets when you pause for
   the human mid-build; see step 7a in the task cycle below.
2. **Gate — spec must be ready:**
   - `status: draft` → STOP: "The spec isn't approved — review it and set status: approved, or
     run the pal-spec interview to finish it."
   - Prefer a structured marker: if SPEC.md frontmatter has `reality_check: pass | blocked |
     not_run`, trust it — `blocked` → STOP, `not_run`/absent → fall through to the text check.
     (pal-spec should set this when the gate clears; it's a harder contract than grepping prose.)
   - Text fallback: read **§13 Reality check**; any `HARD FLAG` line not marked resolved → STOP
     and list them: "Unresolved hard flags — resolve these or re-run the pal-spec reality check."
   - No §13 and no marker (spec predates the gate) → proceed, but record a caveat in the session
     summary that the reality check never ran.
3. If the workspace is not a git repo, `git init && git add -A && git commit -m "loop start"`.
   Commit after every completed task. **git here is a LOCAL checkpoint/history only** — the
   PalBuilder server is the source of truth, so git tracks the local mirror, not server state. A
   `git checkout` reverts your local files; it does NOT undo a change you already pushed (see the
   recovery path under On fail, step 8, below). Never push this git repo anywhere.
4. **Load the skills SPEC.md §9 lists — exactly those, before coding, once.** Do not guess the
   set; §9 is the manifest (it may include palbuilder-jobs-http or palbuilder-websockets, which
   are easy to forget). palbuilder-frontend and design-build are always present there.
   **pal-restraint is not part of §9** — it's a coding-discipline default, not a domain skill to
   select. Applies on every task regardless (full enforcement: step 5 Execute, below).
5. Run `pal_status`. If the server is newer than the last pull, `pal_pull` first.
6. **Smoke-test the current state before picking work.** Run `pal_validate`, and `pal_test` for
   whichever workflow EXECUTION.md's Checkpoints section shows as last touched. A prior session
   (or a lossy compaction mid-session) can leave the workspace broken or undocumented even though
   EXECUTION.md says otherwise. If either fails, fix that first — do not start a new task on top
   of a broken base.

## The task cycle (repeat until done or blocked)

1. **Pick** the first task in EXECUTION.md whose status is `todo` and whose `depends` are all
   `done`. If none, go to "Ending a session." Read its `spec ref` column and **re-read those
   SPEC.md section(s) before building** — that's the requirement the task implements; the success
   condition is derived from it, not invented.
2. **Tier check.** If the task tier is `frontier` and you are not a frontier-class model (when
   unsure: does it require NEW structure rather than following the spec? if yes and you're a
   small model): **if an advisor capability is available** (e.g. `/advisor` — a stronger reviewer
   model reachable from this session), call it with the task's full context (spec ref, clone
   target, hard rules) and have it supply the missing frontier-level judgment/plan; you still
   execute, verify, and commit per the normal cycle — advisor orchestrates the decision, it does
   not replace your verification. **If no advisor capability is available:** set `needs-frontier`,
   log a checkpoint line, move to the next eligible task. Do NOT attempt it badly. (Orchestrators
   MAY instead dispatch by tier to sized subagents — cheap→Haiku, standard→Sonnet — when the
   harness supports a model parameter. **Delegating to a subagent? Read `references/delegation.md`
   first — it's the required protocol, not optional background.**)
3. **Human-gate check.** Console *compile* is verifiable headlessly (`pal_test`), so it is NOT a
   gate; the console *render* may or may not be agent-visible — see step 6 for the
   captured:true/false handling and human-gate fallback (canonical rule:
   `../pal-review/references/console-render-verification.md`). Continue with independent tasks while
   a gate is open. Web renders are agent-visible, so web tasks have no human gate.
4. **Mark** the task `in_progress` in EXECUTION.md. Write the file now, not later.
5. **Execute** exactly as specced, using v2 SPEC.md sections:
   - Copy: **§4** — verbatim, these exact words ship.
   - Layout: **§6** composition; apply the design system via **design-build**
     (DESIGN_SYSTEM.md / COMPONENTS.md). The spec carries no colors/fonts by design.
   - SEO head values: **§7** (web only).
   - Schemas: **§8a** (datasets to CREATE). **§8b** datasets are CONSUMED, read-only — never
     create or alter them; before any task that reads one, confirm the §8b fields it relies on
     exist in the live dataset (`pal_status` / a read action). A missing §8b field is a blocker.
   Follow the palbuilder / design / seo skills for HOW; the spec is WHAT. Apply **pal-restraint**
   on every line you write here: reuse before building, the platform before a library, minimum
   that works, and touch only the files/lines this task names — it runs by default on this step,
   not on request.
6. **Verify** with the task's success condition — tool outputs, not your opinion. Verify offline
   FIRST (`pal_validate`) so a bad result is caught before it ever reaches the server:
   - `pal_validate` → 0 errors (instant offline check; read warnings, fix what's real).
   - `pal_push` (respect push policy: `checkpoint` = ask the user first).
   - `pal_test` → fresh SERVER validation, workflow VALIDATED, 0 notes. This compiles the
     workflow for real — **console AND web** — and is the compile feedback the save API doesn't
     give. Always run it after pushing a workflow change. Read `messages` too (whole-test
     failures like "Pal is not a Web Pal" live there, separate from per-rule results).
   - **Web pages:** `pal_preview` → CHECK the returned server-rendered HTML actually contains the
     exact strings the success condition names (seeing it is the verification); `pal_seo_audit`
     → 0 errors.
   - **Console screens:** compile is covered by `pal_test` above (do verify it). Verify the
     *render* per the canonical rule — `../pal-review/references/console-render-verification.md`:
     `captured:true` → judge against the §12 VISUAL criterion, mark `done` on real evidence;
     `captured:false` → `needs-human` with a `HUMAN GATE:` Blockers entry naming exactly what to
     eyeball. Verify any data effect indirectly: after a write, run the read-back action the spec
     names and confirm the row.
   - `pal_sync_datasets` after pushing a **§8a** dataset definition (never for §8b).
   Note: `pal_preview`/`pal_seo_audit`/`pal_test` all act on the LAST PUSHED version — push before
   verifying your latest edits.
7. **On pass:** set `done`; append one checkpoint line (date, task id, tool-output summary);
   `git add -A && git commit -m "<task id>: <task name>"`. Continue.
7a. **Review-cadence pause.** Check SPEC.md's `review cadence` (absent = `end`):
   - `end` (default): no pause here — continue straight to the next task. Unchanged behavior.
   - `each-task`: pause now. Report the task just completed (what shipped, the verify evidence
     from step 6) and **wait for the human's go-ahead** before picking the next task. Do not
     self-approve and continue.
   - `every-N`: track a running counter on the same checkpoint line, e.g. `since last review:
     2/3`. When the counter hits N, pause exactly as `each-task` does (report every task done
     since the last pause, not just the latest one) and reset the counter to `0/N`. Below N,
     continue without pausing.
   This pause is independent of the push-policy `checkpoint` gate (step 6, per-push) and the
   build-completion pal-review handoff (below, which always runs regardless of cadence) — it is
   a human checkpoint mid-build, not a substitute for either.
7b. **Brownfield regression re-check** — gated on `baseline/` existing next to MAP.md (absent →
   skip this step entirely, today's behavior). Runs at the SAME points 7a pauses (every `each-task`
   pause, every `every-N` pause when the counter hits N) **and unconditionally at the
   build-completion pal-review handoff below**, even under `end` cadence where 7a itself never
   pauses mid-build — under `end`, this check simply only fires once, at completion. It does NOT
   run after every single task; step 6's per-task verify already catches immediate breakage, and
   re-running the whole baseline that often is wasted tool calls.
   - **Freshness check first, before any comparison** — run the baseline-freshness rule (canonical:
     `../pal-init/SKILL.md` Step 3). Stale (server moved since `mapped`) → set `needs-human`, skip
     every comparison below for this cycle; never produce a regression verdict against a stale baseline.
   - `pal_validate` → compare the error/warning count against `baseline.json`'s `validate`.
   - `pal_test` on each workflow `baseline.json` lists → same comparison against `validate: pass`.
   - `pal_preview`/`pal_screenshot` on each page with `captured: true` in its baseline entry —
     confirm the page still renders and the baseline's recorded `h1s` are still present (the same
     string-check pattern step 6 already uses for web pages). Whether the LOOK shifted is left to
     pal-review's regression arm at build completion — this step confirms it still renders and the
     content didn't disappear, nothing more.
   - **Viewport fallback:** a viewport `eyeball_only: true` in the baseline stays `needs-human` for
     regression purposes — never a failure, never silently promoted to "passed" without a human. A
     viewport that WAS `captured: true` before but times out now is a `needs-human` note (something
     about capturability changed), not an automatic block — the timeout may be transient.
   - **Inherited vs caused.** Cross-reference every failure found above against `known_issues`
     before treating it as new. A failure already listed there is noted (still known, still not
     fixed) but does NOT block anything.
   - **Cadence-bisect on a caused failure.** Because this check runs at pauses, not per-task, a
     caused regression can ride through several already-committed tasks before this check catches
     it. Do NOT just block whichever task happens to be current — bisect: walk the per-task commits
     (step 7 commits after every completed task) from the last known-clean point forward, re-running
     the SAME failing check against each commit's file state in turn (`git show <sha>:<path>` or a
     scratch `git checkout <sha> -- .` followed by restoring `HEAD` — read-only inspection of local
     history, never a rewrite: git here is a checkpoint, not the source of truth, per this skill's
     existing rule), until the check first fails. That commit's task is the one to reopen and
     `block`, with a Blockers entry citing the baseline comparison and which commit introduced it —
     not the task that was current when the cadence check happened to run.
8. **On fail:** fix and re-verify, up to TWO attempts. Still failing → `blocked`, with a
   Blockers entry naming: what failed (exact tool output), what you tried, the decision/input
   you need. Continue with the next INDEPENDENT task. Never skip verification to get past a
   failure; never use skipValidation/force to bury one.
   - **If the bad change was already pushed:** restore the good local version (`git checkout` of
     the file, or the prior commit) and **re-push** to overwrite the server — git alone does not
     roll the server back. If the re-push is refused for drift, `pal_pull`/`pal_merge` then push.

### Mode (full | lite)
- **full:** a §5 behavior shipped without its specced edge-case handling, or any §12 per-feature
  criterion unmet, is a defect → blocker.
- **lite:** edge cases listed as deferred are expected, not defects — verify the floor + the
  happy-path criterion per primary action and move on. Don't manufacture full-mode rigor.

## Hard rules

- **Never deploy.** Deployment is a human action in PalBuilder — standing policy.
- **Never touch anything in SPEC.md §11 (the NEVER / out-of-scope list), and never create or
  alter a §8b consumed dataset.**
- **Never invent content.** Missing copy/fact/asset = blocker, not improvisation.
- **Never silently edit SPEC.md.** Spec wrong/incomplete = blocker for the human. When reality
  forces a spec change mid-build (an uncreatable type, a missing consumed field, a behavior the
  platform can't express), follow the **amendment path** below — propose, never self-amend.
- **Never leave EXECUTION.md stale.** Every status change is written to disk the moment it
  happens. Do not summarize the table — edit it.
- **Never weaken a task to make it pass.** A task's success condition is derived from its `spec
  ref` — removing, rewriting, or softening that condition (or the task itself) so a failing
  verification starts passing is "declare victory by deletion," not progress. `status` may change
  freely (`todo`→`in_progress`→`done`/`blocked`); the task's name and success condition may not be
  edited to dodge a failure. A criterion that's genuinely wrong is a spec problem — route it
  through the amendment path below, which requires human approval; you never self-edit your way
  past it.
- **Destructive operations** (dataset recreate, lock override, force push) follow their tools'
  confirmation gates; a loop never auto-confirms them.

## When the spec is wrong (amendment path)

Reality can contradict the spec mid-build (a type that won't create, a missing consumed field, a
behavior the platform can't express). You **never** fix this by editing SPEC.md yourself. Instead:
set the task `blocked`, write an **amendment proposal** in Blockers (which §, the exact build-time
fact forcing it with tool output pasted, the minimal change proposed), and continue with the next
independent task. The human approves → pal-spec applies + re-gates → you re-read the amended § and
resume. Invariant: propose → human approve → re-gate → continue; the loop never silently self-amends.
Full protocol: **read `../pal-spec/references/amendment-path.md`**.

## Build complete → hand off to pal-review

"All tasks `done`" is not the same as "the build is done." pal-loop verifies *that it compiled*;
only **pal-review** checks *that it's actually correct against the spec*. Before reporting a build
finished, hand off — never skip this, and never run pal-review in this same context (that defeats
its entire point: fresh eyes, not the bias of the session that wrote the code).

Trigger: every EXECUTION.md task is `done`, or every remaining task is a `blocked` /
`needs-frontier` / `needs-human` the human has explicitly accepted as parked for this pass.

1. If `baseline/` exists (brownfield), step 7b's regression re-check runs here unconditionally
   before dispatch — even under `end` cadence, where 7b never fired mid-build. Do not hand off
   with a stale or never-run regression check.
2. **Dispatch pal-review** in a fresh session or subagent with its required inputs: `SPEC.md`,
   `EXECUTION.md`, `DESIGN_SYSTEM.md`/`COMPONENTS.md`, `baseline/` (if it exists), and the pal's
   identity (guid/name) so it can `pal_fetch` / `pal_screenshot` / `pal_test` the real built
   artifacts itself.
3. **PASS** → the build is genuinely done. Report it.
4. **CHANGES-NEEDED** → take pal-review's `## Fix tasks` list and append each as a new
   EXECUTION.md task: next id in sequence, `spec ref` carried from the finding it addresses,
   `depends` per any stated order, status `todo`, and a `tier` (same definitions as any other
   task — default `standard`; `frontier` only if the fix needs new structure, not just a patch).
   Resume the normal task cycle (verify, mark `done`, checkpoint, commit) on exactly those tasks —
   same rules, same on-fail/blocked handling.
5. **Re-review.** Once the fix tasks are all `done`, hand off to pal-review again. Repeat until
   PASS. A verdict that comes back `needs-human` (console eyeball gate, or no screenshot
   capability) is not a failure — route it like any other `needs-human` task, same as the build's
   own gates.

## Ending a session

Stop when: all tasks `done` **and pal-review has returned PASS** (or its fix tasks are also done
and re-reviewed); only `blocked` / `needs-frontier` / `needs-human` remain; the user asked you to
stop; or you are degrading (context pressure, repeated mistakes — be honest).

**Prefer a proactive handoff over grinding to auto-compact.** You cannot see your own
context-window fill — there is no token count to check — so don't try to time the end of a
session against one. Instead use a coarse heuristic: once you've completed several tasks this
session, or the session simply feels large (long tool-call history, many files touched), finish
the task you're on, reach a clean EXECUTION.md boundary (no task left `in_progress`), and end the
session there rather than pushing for "just one more task." Reasons: context quality degrades well
before the hard limit, and compaction is lossy — a fresh session that resumes from disk (state
lives in EXECUTION.md + git, per "Resuming" below) avoids both and costs nothing, since nothing is
lost. This is a preference, not a hard stop: don't abandon a task mid-`in_progress` just to hand
off — finish it, checkpoint, then stop.

Write a session summary at the top of EXECUTION.md's Checkpoints section:
```
== session <n> (<date>), mode <full|lite>: <a> done, <b> blocked, <c> needs-frontier, <d> needs-human.
   Next: <task id or "review blockers / clear human gates">.
```
Then report, in order: what shipped (preview URL if web); what's blocked and the exact decision
each needs; what needs a frontier model; what's at a HUMAN GATE and the exact action required;
what's next.

## Resuming

A new session resumes by reading EXECUTION.md — nothing else. Trust the file over any memory of
prior sessions: statuses in the file are the truth. Re-run `pal_status` before the first push of
a resumed session (`pal_pull` / `pal_merge` handle a moved server). `needs-human` tasks stay
parked until the person confirms the gate — don't retry them headlessly.

---

## Delegating to subagents?

Farming an EXECUTION.md task out to a subagent (orchestrator → subagent, any harness) has its
own protocol — handoff brief template, re-verify-independently rules, recovery on a failed
dispatch. **Read `references/delegation.md` in full before delegating; it's required, not
optional background.**
