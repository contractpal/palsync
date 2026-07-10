---
name: pal-loop
description: "Execute an approved SPEC.md + EXECUTION.md build autonomously — one task at a time, verify with palsync tools, checkpoint to disk, hand off to pal-review, loop fix tasks until PASS. State on disk, so any session resumes. Triggers: 'run the loop', 'build the spec', 'continue the build', 'resume the build', or a workspace with unfinished EXECUTION.md tasks."
---

# pal-loop — execute SPEC.md task by task

You are the execution engine for a spec produced by **pal-spec**. The spec holds every
decision: your job is faithful execution plus honest verification. Do not redesign, improve
the copy, or add scope — a wrong or incomplete spec is a blocker for the human, never
something you fix yourself. State lives ON DISK in EXECUTION.md, never only in your context:
write every state change to the file the moment it happens.

**EXECUTION.md edits go through the CLI**: `palsync task list [--ready]`,
`palsync task <id> <status>`, `palsync checkpoint "<line>"`. These are OFFLINE local helpers —
the only `palsync` CLI you run from your shell (they have no MCP equivalent and touch no
server). Everything else (push, pull, validate, test…) uses the `pal_*` MCP tools, never the
CLI. Hand-edit the markdown only if the CLI is unavailable.

---

## Session start (once)

1. **Targeted reads, not the whole spec** (each task re-reads its own SPEC.md § via `spec
   ref`; loading it all now burns tokens). Read:
   - SPEC.md frontmatter — note `mode:` full|lite, `pal:` web|console, `review cadence:`
     each-task|every-N|end (absent = end)
   - SPEC.md **§2 Decisions & open questions** and **§11 Constraints (NEVER)**
   - EXECUTION.md task table, last session summary, Blockers
2. **Gate — spec must be ready:**
   - `status: draft` → STOP: "The spec isn't approved — set status: approved, or run pal-spec."
   - `reality_check: blocked` → STOP. `pass` → proceed. Absent/`not_run` → check §13 for any
     unresolved `HARD FLAG`; found → STOP and list them; no §13 at all → proceed, record a
     caveat in the session summary.
3. Not a git repo → `git init && git add -A && git commit -m "loop start"`. Commit after every
   task. **git is a LOCAL checkpoint only** — the server is the source of truth; `git
   checkout` does NOT undo a pushed change (recovery: "On fail" below). Never push this repo.
4. **Load exactly the skills SPEC.md §9 lists, before coding.** §9 is the manifest — don't
   guess it (it may include palbuilder-workflow, palbuilder-data, or palbuilder-realtime).
   palbuilder-frontend and
   design-build are always in it. pal-restraint is not a §9 skill — it's the default
   discipline on every task.
5. `pal_status`. Server newer than your last pull → `pal_pull` first.
6. **Smoke-test before picking work:** `pal_validate`, plus `pal_test` on the workflow the
   Checkpoints show as last touched — a prior session can leave the workspace broken despite
   what EXECUTION.md says. Either fails → fix that first.

## The task cycle (repeat until done or blocked)

1. **Pick**: `palsync task list --ready` prints the first `todo` task whose `depends` are all
   `done`. None → "Ending a session" below. Read the task's `spec ref` and **re-read those
   SPEC.md section(s) now** — the success condition derives from the requirement.
2. **Tier check.** Task tier `frontier` and you're not frontier-class (test: does it need NEW
   structure, not just following the spec?) → if an advisor capability exists (e.g.
   `/advisor`), call it with full context for the plan; you still execute, verify, commit. No
   advisor → set `needs-frontier`, checkpoint, move to the next eligible task — don't attempt
   it badly. (Orchestrators MAY dispatch tasks to sized subagents — **read
   `references/delegation.md` first; required protocol.**)
3. **Mark** `in_progress`: `palsync task <id> in_progress` — write state now, not later.
4. **Execute exactly as specced:**
   - Scaffold task (T1): apply the matching starter via `palsync scaffold` (offline CLI
     helper) — never hand-generate scaffold files.
   - Copy: **§4**, verbatim — these exact words ship.
   - Layout: **§6** composition, styled via **design-build** (the spec carries no colors/fonts).
   - SEO head values: **§7** (web only).
   - Schemas: **§8a** (CREATE). **§8b** datasets are CONSUMED, read-only — never create or
     alter one; before reading it, confirm its §8b fields exist live (`pal_status`/a read
     action) — a missing field is a blocker.
   - Apply **pal-restraint** on every line: reuse before building, platform before library,
     minimum that works, touch only the files this task names.
5. **Verify** against the success condition with tool outputs, not opinion. Offline first, so
   a bad result never reaches the server. **Batch every edit for the task first, then verify
   once — target ONE `pal_push` per task, never push per-file:**
   1. `pal_push` directly (push policy `checkpoint` → ask the user first). Push runs the FULL
      offline validation as its gate and refuses — with the same lint output — before anything
      reaches the server, so a standalone `pal_validate` right before a push is a wasted turn:
      never do it. Push must show 0 errors. Fix warnings too, or checkpoint why each warning is
      safe for this task before marking it `done`; warnings are allowed to push but never
      silently ignored. Standalone `pal_validate` is for diagnosis between edits only, and
      never twice without an edit in between — same input, same output.
   2. `pal_test` → workflow VALIDATED, 0 notes — the real server compile (console AND web).
      Always run after a workflow change. Read `messages` too (whole-test failures like
      "Pal is not a Web Pal" live there).
   3. WEB page: `pal_fetch` or `pal_preview` with `expect:[the exact strings the success
      condition names]` → all found. (This returns per-string found/missing, not the HTML —
      use `selector`/`maxChars` only when you truly need markup.) Then `pal_seo_audit` → 0
      errors (public pages).
   4. **Any page-level UI task:** call `pal_screenshot` at both `desktop` and `mobile`. Both must
      have `renderError:null`, fully loaded CSS, and `designAudit.errors:0`. Inspect both images
      against design-build's archetype rubric; if either audit/image exposes a failure, fix the
      three highest-impact issues, push, and re-capture the changed viewport. Re-run the task's
      behavior check after the last visual edit. A screenshot file path without pixel critique is
      not review evidence.
   5. CONSOLE screen: `pal_test` proves it compiles; the RENDER needs `pal_screenshot`:
      - `captured:true` + `renderError` non-null → hard FAIL. The workflow compiled but threw
        while rendering. Fix, push, screenshot again — `pal_test` passing does NOT clear it.
      - `captured:true` + `renderError` null → judge the image against §12 VISUAL → `done`.
      - `captured:false` → do NOT guess from HTML: set `needs-human` with a Blockers entry
        prefixed `HUMAN GATE:` naming exactly what to eyeball. Continue with independent
        tasks. (Full rule: `../pal-review/references/console-render-verification.md`.)
   6. ANY write action (create/edit/delete): `pal_exercise` — trigger the action and assert the
      result in the rendered output. **Batch the whole flow into ONE call's `steps` array**
      (e.g. add → edit → delete is one exercise with expects per step), not one call per
      action — each extra call is a full context-window round trip. Web:
      `steps:[{action, params, expect}]`. Console:
      `steps:[{fill:{name:value}, click:"<exact link text>", expect:[...]}]`. After an EDIT, put
      the new value in `expect` AND the old value in `absent` — a surviving old value means the
      edit inserted a duplicate. After a DELETE, put the deleted record's name/value in `absent`
      — never assert empty-state copy or list ordering (other rows may exist; lists sort
      alphabetically, so a shorter list is not proof of the right row leaving). This is the
      read-back check; a failing step is a task failure.
   7. `pal_sync_datasets` after pushing a **§8a** definition (never §8b).
   - `pal_preview`/`pal_fetch`/`pal_exercise`/`pal_seo_audit`/`pal_test` all act on the LAST
     PUSHED version — push before verifying.
6. **On pass:** first confirm there are no unhandled validation warnings from the push output
   (fixed, or each one checkpointed with a concrete reason it is safe). Then `palsync task <id> done`; `palsync checkpoint "<date>, <task id>,
   <tool-output summary>"`; `git add -A && git commit -m "<task id>: <task name>"`; continue.
7. **On fail:** fix and re-verify, up to TWO attempts. Still failing → `palsync task <id>
   blocked` with a Blockers entry naming what failed (exact tool output), what you tried, and
   the decision you need; continue with the next INDEPENDENT task. Never skip verification;
   never use force/bypass flags to bury a failure. **Bad change already pushed?** Restore the
   good local version (`git checkout` the file or prior commit) and **re-push** — git alone
   doesn't roll the server back; re-push refused for drift → `pal_pull`/`pal_merge`, then push.

### Review-cadence pause (SPEC.md `review cadence`; absent = `end`)
- `end`: no pauses — run to completion.
- `each-task`: after each done task, report it (what shipped + step-5 evidence) and **wait for
  the human's go-ahead** — don't self-approve.
- `every-N`: track a counter on the checkpoint line (`since last review: 2/3`); at N, pause
  like `each-task` (report every task since the last pause), reset. Below N, continue.
This is independent of the push `checkpoint` gate (per-push) and the pal-review handoff
(always runs at completion).

### Brownfield regression re-check (only if `baseline/` exists)
Runs at each review-cadence pause and always at the build-completion handoff — NOT per-task
(step 5 already catches immediate breakage).
- **Run `pal_regression`** and act on its structured result. It does the whole mechanical
  check: freshness gate (stale → returns `{stale}`; set `needs-human`, re-run pal-init Step 3),
  validate/`pal_test`/page-`h1s` vs `baseline.json`, `eyeball_only` viewports → `needs_human`,
  inherited (`known_issues`) vs caused split. `caused` empty → pass. `inherited`/`needs_human`
  never block.
- **A `caused` failure → bisect for the culprit** (the break may have ridden through several
  committed tasks):
  1. Start at the last commit where this check passed.
  2. Walk per-task commits forward, re-running the SAME failing check against each commit's
     file state (`git show <sha>:<path>` — read-only inspection, never a rewrite).
  3. First failing commit → that commit's task is the culprit.
  4. Reopen and `block` THAT task, citing the baseline comparison and the culprit commit.

### Mode (full | lite)
- **full:** a §5 behavior shipped without its specced edge-case handling, or any unmet §12
  per-feature criterion, is a defect → blocker.
- **lite:** deferred edge cases are expected, not defects — verify the floor + the happy-path
  criterion per primary action; don't manufacture full-mode rigor.

## Hard rules

- **Build is NOT complete until every workflow touched this build returns `pal_test`
  VALIDATED (0 notes) AND pal-review has returned PASS.** `pal_validate` alone is offline;
  `pal_test` is the real server compile. Never report the build finished on unrun or failing
  verification.
- **Never deploy** — deployment is a human action in PalBuilder.
- **Never touch SPEC.md §11 (the NEVER list); never create or alter a §8b consumed dataset.**
- **Never invent content** — a missing copy/fact/asset is a blocker, not improvisation.
- **Never silently edit SPEC.md** — a wrong/incomplete spec is a human blocker; use the
  amendment path below.
- **Never leave EXECUTION.md stale** — write every status change to disk immediately.
- **Never weaken a task to make it pass** — `status` may change freely, but a task's name and
  success condition may NOT be edited, removed, or softened to get a failing verification to
  pass. A genuinely wrong criterion is a spec problem → amendment path, never a self-edit.
- **Destructive operations** (dataset recreate, lock override, force push) follow their tools'
  confirmation gates; the loop never auto-confirms them.
- **Never end your turn with unchecked EXECUTION.md tasks** unless every remaining task is
  `blocked`/`needs-frontier`/`needs-human` — and say so explicitly, naming each blocker. Going
  quiet mid-task-list is a violation, not a pause.

## When the spec is wrong (amendment path)

Reality can contradict the spec mid-build (a type that won't create, a missing consumed field,
an inexpressible behavior). You never fix this by editing SPEC.md. Instead:
1. Set the task `blocked`.
2. Write an **amendment proposal** in Blockers: which §, the exact build-time fact (tool
   output pasted), the minimal change proposed.
3. Continue with the next independent task.
4. The human approves → pal-spec applies + re-gates → you re-read the amended § and resume.

Invariant: **propose → human approve → re-gate → continue; the loop never silently self-amends.**
Full protocol: `../pal-spec/references/amendment-path.md`.

## Build complete → hand off to pal-review

"All tasks `done`" ≠ "the build is done": pal-loop proves it *compiled*; only **pal-review**
proves it's *correct against the spec*. Never skip it, and never run it in this same context —
fresh eyes are the point.

Trigger: every task `done`, or every remaining task is a `blocked`/`needs-frontier`/
`needs-human` the human accepted as parked.

1. `baseline/` exists → run the regression re-check above, unconditionally.
2. **Dispatch pal-review in a fresh session/subagent** with: SPEC.md, EXECUTION.md,
   DESIGN_SYSTEM.md/COMPONENTS.md, `baseline/` (if any), and the pal's identity so it can
   `pal_fetch`/`pal_screenshot`/`pal_test` the real artifacts.
3. **PASS** → the build is genuinely done; report it.
4. **CHANGES-NEEDED** → append each `## Fix tasks` item as a new EXECUTION.md task (next id,
   `spec ref` from the finding, `depends` per stated order, `todo`, tier `standard` unless it
   needs new structure); resume the task cycle on exactly those tasks.
5. **Re-review** when the fix tasks are `done`; repeat until PASS. A `needs-human` verdict
   (console eyeball gate) routes like any other `needs-human` task, not a failure.

## Ending a session

Stop when: all tasks `done` and pal-review returned PASS; or only `blocked`/`needs-frontier`/
`needs-human` remain; or the user asked; or you're degrading (context pressure, repeated
mistakes — be honest). **Prefer a proactive handoff over grinding to auto-compact:** after
several completed tasks, or when the session feels large, finish the current task, reach a
clean boundary (no task `in_progress`), and stop — a fresh session resuming from disk costs
nothing; a compacted one is lossy.

Write a session summary at the top of EXECUTION.md's Checkpoints:
```
== session <n> (<date>), mode <full|lite>: <a> done, <b> blocked, <c> needs-frontier, <d> needs-human.
   Next: <task id or "review blockers / clear human gates">.
```
Then report, in order: what shipped (preview URL if web); what's blocked + the exact decision
each needs; what needs a frontier model; what's at a HUMAN GATE + the exact action; what's next.

## Resuming

A new session resumes by reading EXECUTION.md — nothing else; trust the file over any memory
of prior sessions. Re-run `pal_status` before the first push (`pal_pull`/`pal_merge` handle a
moved server). `needs-human` tasks stay parked until the person confirms the gate.

## Delegating to subagents?

Farming an EXECUTION.md task to a subagent has its own protocol — handoff brief template,
re-verify-independently rules, recovery on failed dispatch. **Read `references/delegation.md`
in full before delegating; required, not optional.**
