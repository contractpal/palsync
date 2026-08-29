---
name: pal-loop
description: "Executes approved SPEC.md + EXECUTION.md tasks, verifies, checkpoints, and hands off to pal-review until PASS. Triggers: 'run the loop', 'build the spec', 'continue the build', 'resume the build', or a workspace with unfinished EXECUTION.md tasks. Does not change the approved spec."
---

# pal-loop — execute SPEC.md task by task

You are the execution engine for a spec produced by **pal-spec**. The spec holds every
decision: your job is faithful execution plus honest verification. Do not redesign, improve
the copy, or add scope — a wrong or incomplete spec is a blocker for the human, never
something you fix yourself. State lives ON DISK in EXECUTION.md, never only in your context:
write every state change to the file the moment it happens.

**EXECUTION.md edits go through the CLI**: `palsync task list [--ready]`,
`palsync task <id> <status>`, `palsync checkpoint "<line>"`, `palsync session-summary [--mode full|lite] [--next "<text>"]`. Transitions to `blocked`,
`needs-human`, or `needs-frontier` require `--reason "<why>"`; `blocked` and `needs-human` also
require `--tried "<workaround>"`. These are OFFLINE local helpers —
the only `palsync` CLI you run from your shell (they have no MCP equivalent and touch no
server). Everything else (push, pull, validate, test…) uses the `pal_*` MCP tools, never the
CLI. Hand-edit the markdown only if the CLI is unavailable.

---

## Session start (once)

1. **Slim session start — frontmatter only.** Each task's requirement — ticket plus
   spliced SPEC § plus §11 NEVER — comes from `palsync task list --ready`; do not read
   SPEC.md per task, and do not read §2 or §11 at session start — §11 arrives with every ticket and §2 arrives only when a task's `spec ref` names it.
   Read now: SPEC.md frontmatter only (`mode`, `pal`, `review cadence`, `status`,
   `reality_check`, `push policy`) plus SPEC.md §9 skill manifest (once per session, not per task)
   and the EXECUTION.md last session summary line and Blockers (the task table remains
   available for the readiness gate)
2. **Gate — spec must be ready:**
   - `status: draft` → STOP: "The spec isn't approved — set status: approved, or run pal-spec."
   - `reality_check: blocked` → STOP. `pass` → proceed. Absent/`not_run` → check §13 for any
     unresolved `HARD FLAG`; found → STOP and list them; no §13 at all → proceed, record a
     caveat in the session summary.

This step is mandatory and non-skippable: read `references/session-start.md` at session start,
before the first task.

## The task cycle (repeat until done or blocked)

1. **Pick**: `palsync task list --ready` prints the ready ticket — `id`, `status`,
   `tier`, `depends`, `spec ref`, `task`, `success condition` — plus the verbatim body of each SPEC.md section that `spec ref` names and the verbatim body of §11 Constraints (NEVER);
   that print is the requirement, so do not open EXECUTION.md or re-read SPEC.md for it. Surface assumptions: name any ambiguity and reasonable
   interpretations; genuine uncertainty is a blocker, never permission to guess.
   **Done when:** one ready ticket and its exact requirement are identified with no
   hidden assumption. None → "Ending a session" below.
2. **Tier check.** Task tier `frontier` and you're not frontier-class (test: does it need NEW
   structure, not just following the spec?) → if an advisor capability exists (e.g.
   `/advisor`), call it with full context for the plan; you still execute, verify, commit. No
   advisor → run `palsync task <id> needs-frontier --reason "<why a stronger model is required>"`,
   then move to the next eligible task — don't attempt
   it badly. (Orchestrators MAY dispatch tasks to sized subagents — **read
   `references/delegation.md` first; required protocol.**)
3. **Mark** `in_progress`: `palsync task <id> in_progress` — write state now, not later. **Done when:** disk state says `in_progress`.
4. **Execute exactly as specced:**
   - **Before creating the first page, fragment, script, style, workflow, or dataset**, read
     `../palbuilder-core/references/pal-json.md` through its entry examples. This step is
     mandatory and non-skippable: every new file needs both the on-disk file and its typed
     `pal.json` wrapper; flat `{string, filename}` entries ship nothing. For a console fragment:
     ```json
     { "string": "feature/list.html", "Fragment": { "name": "feature/list", "filename": "feature/list.html", "content": "", "contentType": "text/html", "palType": "palTypeConsole", "parseable": false } }
     ```
     For a dataset schema:
     ```json
     { "string": "items", "Dataset": { "name": "items", "fields": { "DatasetField": [ ... ] } } }
     ```
     Leave file-entry `content` empty; `pal_push` fills it from disk. After adding a CREATE
     dataset schema, run `pal_sync_datasets`; never provision §8b consumed datasets.
   - This step is mandatory and non-skippable: read `references/execute.md` before
     executing the task's build procedure (template copy, §4/§6/§7/§8 mapping, restraint
     ladder, and multi-block re-read).
   - **§8b** datasets are CONSUMED, read-only — never create or alter one; before reading a §8b dataset, confirm its §8b fields exist live (`pal_status` or a read action) — a missing field is a blocker.
   - Follow the restraint ladder — reuse before building, platform before hand-rolled,
     minimum that works.
   - **Structural tools — `pal_impact` and `pal_ast`:**
      - `pal_impact` is mandatory before editing an existing page or fragment that
        other files reference; silent for new files.
      - `pal_ast` `mode:"search"` is free — run it whenever the task touches a class,
        attribute, or function that may have other consumers.
      - `pal_ast` `apply:true` is earned and narrow — only when the identical
        mechanical change spans three or more files named by the task's `spec ref`,
        only after a dry-run whose diff is recorded on the checkpoint line, followed
        by one `pal_push`; never use `apply:true` for a copy or design change —
        those are §4/§6 edits, not codemods.
   - **Done when:** the smallest spec-traceable change is present and the changed region was re-read.
5. **Verify** against the success condition with tool outputs, not opinion. Before UI or exercise verification, read `references/verify-ladder.md` for verification mechanics — push diagnosis, WEB `expect`/`selector` guidance, UI rubric and `imageless` re-check, and waiver detail — especially §Exercise authoring before writing steps. Offline first, so
   a bad result never reaches the server. **Batch every edit for the task first, then verify
   once — target ONE `pal_push` per task, never push per-file:**
   1. `pal_push` directly (push policy `checkpoint` → ask the user first). Push gates the files
      changed by this push plus narrow cross-file contracts; it blocks errors the change
      introduces and surfaces advisory warnings. Do not run standalone `pal_validate`
      immediately before this push merely to duplicate that changed-file checkpoint. Push must
      return `ok:true` and `diagnosticCount:0`. Fix warnings too, or checkpoint why each warning
      is safe for this task before marking it `done`; warnings are allowed to push but never
      silently ignored.
   2. `pal_test` once per task, after that task's final push → `ok:true`, `diagnosticCount:0` —
      the real server compile (console AND web). Read `messages` too (whole-test failures like
      "Pal is not a Web Pal" live there).
   3. WEB page: `pal_fetch` or `pal_preview` with `expect:[the exact strings the success
      condition names]` → all found. Then `pal_seo_audit` →
      `ok:true`, `diagnosticCount:0` (public pages).
   4. **UI verification by task type:** UI-only task → one desktop `pal_screenshot`; behavior-only
      task → one `pal_exercise`; a task changing both → one desktop screenshot and one exercise.
      Screenshots must
      have `renderError:null`, fully loaded CSS, and zero pal-content design-audit errors. Console
      screenshots can include platform-chrome outside `#cp-root`; apply only the evidence-gated exceptions in `../shared/references/console-chrome-exception.md`. A screenshot file path without pixel critique is not review evidence.
   5. CONSOLE screen: `pal_test` proves it compiles; the RENDER needs `pal_screenshot`:
      - `captured:true` + `renderError` non-null → hard FAIL.
      This step is mandatory and non-skippable: read `references/verify-ladder.md` (Console render) before handling `captured`/`renderError` branch recovery.
   6. ANY write action (create/edit/delete), when the task includes behavior changes: `pal_exercise` — trigger the action and assert the
      result in the rendered output. For every §5 effect, read the record back and assert
      **every field named by the effect**, including fields the default fragment does not
      render; use a detail/read action that exposes a non-rendered field rather than assuming
      its value from visible state. For example, if check-in sets `status = available` and
      clears `checkedOutAt`, assert both fields after check-in, not only the rendered status.
      This step is mandatory and non-skippable: read `../shared/references/exercise-authoring.md` before writing your FIRST `pal_exercise` call of the session — covering flow shape and step batching, `within:` scoping for ambiguous row/card actions, the `{{runId}}` uniqueness rule, and the create/edit/delete `expect`/`absent` table.
   7. Before marking any UI-touching task `done`, run standalone `pal_validate` against the
      whole workspace. Require 0 diagnostics, or individually waive every remaining warning
      in EXECUTION.md with its `file:line` and a concrete reason. Errors cannot be waived.
   - `pal_preview`/`pal_fetch`/`pal_exercise`/`pal_seo_audit`/`pal_test` all act on the LAST
     PUSHED version — push before verifying.
   - **Done when:** every success-condition clause has current pushed-version evidence and every warning is fixed or explicitly waived.
6. **On pass:** first confirm there are no unhandled validation warnings from the push output
   (fixed, or each one checkpointed with a concrete reason it is safe). Then `palsync task <id> done`; `palsync checkpoint "<date>, <task id>,
   <tool-output summary>, session tasks: <n>/3, since last review: <m>/N"` (a `cheap`-tier task carries the previous `session tasks` value forward unchanged; `since last review` is the existing review-cadence counter); `git add -A && git commit -m "<task id>: <task name>"` (transient PalSync artifacts are excluded from the commit by harness-enforced ignore management); continue.
7. **On fail:** fix and re-verify, up to TWO attempts. Still failing →
   `palsync task <id> blocked --reason "<result and required decision>" --tried "<the two attempts: literal command + error>"`. A BLOCKED exercise means the Pal result is
   unknown, never PASS or done. Do not replay after an action/click may have changed data; inspect
   state first. Continue only with an INDEPENDENT task. Never skip verification or use force/bypass
   flags to bury a failure. **Bad change already pushed?** Restore the
   good local version (`git checkout` the file or prior commit) and **re-push** — git alone
   doesn't roll the server back; re-push refused for drift → `pal_pull`/`pal_merge`, then push.

### Review-cadence pause (SPEC.md `review cadence`; absent = `end`)
- `end`: no pauses — run to completion.
- `each-task`: after each done task, report it (what shipped + step-5 evidence) and **wait for
  the human's go-ahead** — don't self-approve.
- `every-N`: pauses at N — `since last review: <n>/N` counter on the checkpoint line.
This is independent of the push `checkpoint` gate (per-push) and the pal-review handoff
(always runs at completion).

### Brownfield regression re-check (only if `baseline/` exists)
Runs at each review-cadence pause and always at the build-completion handoff — NOT per-task
(step 5 already catches immediate breakage).
- **Run `pal_regression`** and act on its structured result — `caused` empty → pass;
  `inherited`/`needs_human` never block.

### Mode (full | lite)
- **full:** a §5 behavior shipped without its specced edge-case handling, or any unmet §12
  per-feature criterion, is a defect → blocker.
- **lite:** deferred edge cases are expected, not defects — verify the floor + the happy-path
  criterion per primary action; don't manufacture full-mode rigor.

## Hard rules

- Before the first UI task, load `design-build` and checkpoint its six-line design brief; no UI markup/CSS before that brief exists.
- The design checkpoint names one signature idea that makes this pal non-generic; at T-final apply the existing “no zeroes” rubric rule.
- No vision → no rubric score: route per `vision-routing.md` or set a `HUMAN GATE` blocker.
- A pal-review dispatch failure (missing key or unavailable subagent) is a `HUMAN GATE`; a build-session PASS is invalid.
- Before `done`, re-read the success condition verbatim and cite tool output for every clause; a failing or unrun gate is not done.
- One commit per completed task; change task state and checkpoints through the palsync task/checkpoint CLI, not ad-hoc notes.
- Every validation warning is fixed or explicitly waived with a one-line checkpoint reason; silent carry-over violates the loop.
- Surgical diff: every changed line traces to the task's `spec ref` or cleanup made necessary by that change. Do not reformat, refactor, or remove unrelated code.

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

IF the build needs something SPEC.md doesn't say THEN follow
`../pal-spec/references/amendment-path.md` — write an amendment proposal, wait for approval, apply, re-gate.
Invariant: **propose → human approve → re-gate → continue**. Never edit SPEC.md silently.
**Never silently edit SPEC.md**; the loop never silently self-amends.

## Build complete → hand off to pal-review

"All tasks `done`" ≠ "the build is done": pal-loop proves it *compiled*; only **pal-review**
proves it's *correct against the spec*. Never skip it, and never run it in this same context —
fresh eyes are the point.

Trigger: every task `done`, or every remaining task is a `blocked`/`needs-frontier`/
`needs-human` the human accepted as parked.

This step is mandatory and non-skippable: read `references/handoff.md` at build completion,
before dispatching pal-review.

The build session may fix review findings, but it may **never convert its own fixes into PASS**.
Every CHANGES-NEEDED cycle ends with another fresh pal-review dispatch and a new REVIEW.md verdict;
the build-complete handoff is invalid unless REVIEW.md contains the pasted `palsync review check`
output, including its descriptive exercise summary for the current pushed source and final result.
After reviewer dispatch, the builder performs no source, `.palsync.json`, EXECUTION, or
evidence-producing action unless the verdict is CHANGES-NEEDED. Then update state, fix, push, and
start a fresh review cycle. The reviewer runs all evidence-producing tools before its final
`REVIEW.md` write. "the exercises pass now" never permits skipping independent re-review.

## Ending a session — countable handoff

Handoff triggers, whichever comes first — three tasks `done` in this session, any
`frontier`-tier task completing, or a task that consumed both of its verification
retries. `cheap`-tier tasks do not increment the counter. The counter rides the
checkpoint line (`session tasks: 2/3`), like the existing `every-N` review cadence
so the state is on disk and a resumed session inherits it; no new CLI surface.
Handoff = finish the current task, leave nothing `in_progress`, commit, write the
session summary line, then stop and tell the human to start a fresh session. Where
a subagent capability exists, dispatching the next task to a fresh subagent per
`references/delegation.md` satisfies the handoff. Do not auto-continue via the Claude Stop hook or the Pi queue.

Stop also when: all tasks `done` and pal-review returned PASS; or only
`blocked`/`needs-frontier`/`needs-human` remain; or the user asked.

For a handoff, run `palsync session-summary [--mode <full|lite>] [--next "<task-or-prose>"]` before stopping — it derives the session number and `done`/`blocked`/`needs-frontier`/`needs-human` counts from the parsed task table, infers `Next` from the single ready task when unambiguous (otherwise `--next` is required), and appends the canonical summary through the checkpoint validation gate in a single atomic write. Do not hand-calculate counts or format the prose yourself. On the completion path it was already written before reviewer dispatch; do not rewrite it after review. The canonical format is:
```
== session <n> (<date>), mode <full|lite>: <a> done, <b> blocked, <c> needs-frontier, <d> needs-human.
   Next: <task id or "review blockers / clear human gates">.
```
Then report, in order: what shipped (preview URL if web); what's blocked + the exact decision
each needs; what needs a frontier model; what's at a HUMAN GATE + the exact action; what's next.

For a formal QA/eval report, use the `qa-report` skill
(`bundled-context/skills/qa-report/SKILL.md`) and its `references/report-template.md`.

## Resuming

A new session resumes by reading EXECUTION.md — nothing else; trust the file over any memory
of prior sessions. Re-run `pal_status` before the first push (`pal_pull`/`pal_merge` handle a
moved server). `needs-human` tasks stay parked until the person confirms the gate.

## Delegating to subagents?

Farming an EXECUTION.md task to a subagent has its own protocol — handoff brief template,
re-verify-independently rules, recovery on failed dispatch. **Read `references/delegation.md`
in full before delegating; required, not optional.**
