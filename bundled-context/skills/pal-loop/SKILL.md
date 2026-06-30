---
name: pal-loop
description: "Execute a pal build autonomously from SPEC.md + EXECUTION.md (produced by the pal-spec skill): one task at a time, verify with palsync tools, checkpoint to disk, escalate when blocked. Use this skill when the user says 'run the loop', 'build the spec', 'continue the build', 'resume the build', or when a workspace contains an EXECUTION.md with unfinished tasks. Honors the spec's mode (full|lite), the §13 reality-check gate, and the §9 required-skills manifest. At build completion it hands off to the pal-review skill in a fresh context for an independent verdict, loops fix tasks back through this same task cycle, and repeats until PASS. State lives in files, not in your context — any session can resume."
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
   and `pal: ... (web | console)` — both change how you verify below.
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
3. **Human-gate check.** Console workflow *compile* is now verifiable headlessly (`pal_test`
   runs `TestConsole.do` and returns fresh server validation), so it is NOT a human gate.
   `pal_preview` itself still never renders a console screen for you — it opens it in the
   platform console chrome via a browser, for the user, not you. The *render* may still be
   agent-verifiable via `pal_screenshot` — see step 6 (Verify) below for the captured:true/false
   handling and the human-gate fallback. Continue with independent tasks while a gate is open.
   Web renders are agent-visible (`pal_preview` returns the HTML), so web tasks have no human
   gate.
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
   - **Console screens:** compile is covered by `pal_test` above (do verify it). For the
     *render*, try `pal_screenshot` (Playwright replays the cp-auth redirect chain when Chromium
     is installed) — `captured:true` means it's agent-visible after all; judge it against the §12
     VISUAL criterion and mark `done` on real evidence. `captured:false` (no Chromium, or the
     auth replay failed/timed out) → do not mark `done` on render; do the buildable part, verify
     everything else you can (validate, test, data read-back), then set `needs-human` with a
     Blockers entry prefixed `HUMAN GATE:` naming exactly what to eyeball (open screen X, confirm
     it renders + the happy path). Verify any data effect indirectly: after a write, run the
     read-back action the spec names and confirm the row.
   - `pal_sync_datasets` after pushing a **§8a** dataset definition (never for §8b).
   Note: `pal_preview`/`pal_seo_audit`/`pal_test` all act on the LAST PUSHED version — push before
   verifying your latest edits.
7. **On pass:** set `done`; append one checkpoint line (date, task id, tool-output summary);
   `git add -A && git commit -m "<task id>: <task name>"`. Continue.
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

The spec is the contract, but reality can contradict it mid-build (a type that won't create, a
consumed field that doesn't exist, a behavior the platform can't express). You **never** fix this
by editing SPEC.md yourself. Instead:

1. **Block + propose.** Set the task `blocked` and write an **amendment proposal** in the Blockers
   section: which SPEC.md § is wrong, the exact build-time fact forcing it (paste the tool output /
   name the platform limit), and the **minimal** change you propose. Continue with the next
   independent task.
2. **Human approves** the proposal (or redirects). No approval → it stays blocked; you do not touch
   the spec.
3. **On approval**, the amendment is applied via pal-spec's amendment protocol: the minimal edit,
   `spec version` bumped, a §14 amendment-log entry, and the affected § **re-gated** (reality_check
   re-run for that section). The spec is re-approved at the new version.
4. **Resume.** Re-read the amended § (via the task's `spec ref`) and continue the task against the
   updated contract.

Invariant: propose → human approve → re-gate → continue. The loop never silently self-amends.

## Build complete → hand off to pal-review

"All tasks `done`" is not the same as "the build is done." pal-loop verifies *that it compiled*;
only **pal-review** checks *that it's actually correct against the spec*. Before reporting a build
finished, hand off — never skip this, and never run pal-review in this same context (that defeats
its entire point: fresh eyes, not the bias of the session that wrote the code).

Trigger: every EXECUTION.md task is `done`, or every remaining task is a `blocked` /
`needs-frontier` / `needs-human` the human has explicitly accepted as parked for this pass.

1. **Dispatch pal-review** in a fresh session or subagent with its required inputs: `SPEC.md`,
   `EXECUTION.md`, `DESIGN_SYSTEM.md`/`COMPONENTS.md`, and the pal's identity (guid/name) so it
   can `pal_fetch` / `pal_screenshot` / `pal_test` the real built artifacts itself.
2. **PASS** → the build is genuinely done. Report it.
3. **CHANGES-NEEDED** → take pal-review's `## Fix tasks` list and append each as a new
   EXECUTION.md task: next id in sequence, `spec ref` carried from the finding it addresses,
   `depends` per any stated order, status `todo`, and a `tier` (same definitions as any other
   task — default `standard`; `frontier` only if the fix needs new structure, not just a patch).
   Resume the normal task cycle (verify, mark `done`, checkpoint, commit) on exactly those tasks —
   same rules, same on-fail/blocked handling.
4. **Re-review.** Once the fix tasks are all `done`, hand off to pal-review again. Repeat until
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
