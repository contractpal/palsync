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
   recovery path under On fail / delegation). Never push this git repo anywhere.
4. **Load the skills SPEC.md §9 lists — exactly those, before coding, once.** Do not guess the
   set; §9 is the manifest (it may include palbuilder-jobs-http or palbuilder-websockets, which
   are easy to forget). palbuilder-frontend and design-build are always present there.
5. Run `pal_status`. If the server is newer than the last pull, `pal_pull` first.

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
   harness supports a model parameter.)
3. **Human-gate check.** Console workflow *compile* is now verifiable headlessly (`pal_test`
   runs `TestConsole.do` and returns fresh server validation), so it is NOT a human gate.
   `pal_preview` itself still never renders a console screen for you — it opens it in the
   platform console chrome via a browser, for the user, not you. But `pal_screenshot` CAN drive an
   authenticated console screen (Playwright replays the cp-auth redirect chain) when Chromium is
   installed and the replay succeeds — try it: a vision-capable model judges the PNG against
   DESIGN_SYSTEM.md exactly like a web render. Only when `pal_screenshot` returns
   `captured:false` (no Chromium, or the auth replay failed/timed out) do you fall back to the
   human gate: do the buildable part, verify everything you can (validate, test, data read-back,
   the screenshot attempt), then set `needs-human` with a Blockers entry prefixed `HUMAN GATE:`
   naming exactly what to eyeball (open screen X, confirm it renders + the happy path). Continue
   with independent tasks. Web renders are agent-visible (`pal_preview` returns the HTML), so web
   tasks have no human gate.
4. **Mark** the task `in_progress` in EXECUTION.md. Write the file now, not later.
5. **Execute** exactly as specced, using v2 SPEC.md sections:
   - Copy: **§4** — verbatim, these exact words ship.
   - Layout: **§6** composition; apply the design system via **design-build**
     (DESIGN_SYSTEM.md / COMPONENTS.md). The spec carries no colors/fonts by design.
   - SEO head values: **§7** (web only).
   - Schemas: **§8a** (datasets to CREATE). **§8b** datasets are CONSUMED, read-only — never
     create or alter them; before any task that reads one, confirm the §8b fields it relies on
     exist in the live dataset (`pal_status` / a read action). A missing §8b field is a blocker.
   Follow the palbuilder / design / seo skills for HOW; the spec is WHAT.
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
     *render*, try `pal_screenshot` — `captured:true` means it's agent-visible after all; judge it
     against the §12 VISUAL criterion and mark `done` on real evidence. `captured:false` (no
     Chromium, or auth replay failed) → do not mark `done` on render; set `needs-human` for the
     §12 eyeball gate instead. Verify any data effect indirectly: after a write, run the read-back
     action the spec names and
     confirm the row.
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

## Delegation protocol (orchestrator → subagents, any harness)

Use this whenever one orchestrator farms tasks out to subagents. It is written against
**capabilities, not tool names**, so it holds on Claude Code, OpenCode / Pi.dev, Cursor, or any
harness that can spawn a subagent. Goal: the same handoff produces the same result every time,
whichever harness or model is underneath. (The palsync `pal_*` tools are the same everywhere —
they are the substrate, not a harness feature.)

### 0. Preconditions — check once before delegating
- **Subagents available?** If the harness cannot spawn one, do NOT simulate it — run the task
  inline via the normal task cycle. Delegation is an optimization, never a requirement.
- **Per-subagent model selectable?** If yes, map tier→model (cheap→small, standard→mid; frontier
  you handle yourself). If no, spawn the default and rely on the task-cycle tier check.
- **Parallel or serial?** Dispatch in parallel ONLY tasks the build plan marked parallel-safe
  AND that share no files. Anything touching a shared file (a fragment, `pal.json`, a dataset) is
  serialized. If two subagents might push at once, `pal_lock` before / `pal_unlock` after, or
  serialize the pushes. Concurrency on shared files is the #1 way a delegated build corrupts
  itself — when in doubt, serialize.

### 1. Governing principles
- **The subagent starts blind.** Assume zero shared context and zero memory of the spec. Every
  thing it needs is in the brief or at an absolute path you tell it to read. A reference it can't
  resolve is a guess you didn't want.
- **One task, bounded.** One EXECUTION.md task per subagent, one verify cycle. It does not pick
  its own work, read other tasks, or expand scope.
- **The orchestrator owns truth.** The subagent's report is a hypothesis you verify with tools.
  A subagent is never the thing that marks a task `done`.

### 2. The handoff brief — fill EVERY slot (same template, every harness)
A brief with an empty slot is invalid. Do not dispatch it.

1. **TASK** — the single task id + one-line goal. Nothing beyond it.
2. **MANDATORY READS (absolute paths, in order)** — SPEC.md; DESIGN_SYSTEM.md + COMPONENTS.md;
   then the sibling file(s) to clone from. Read before writing anything.
3. **COPY IS LAW** — approved copy from SPEC.md §4, quoted verbatim or pointed at by exact
   section. Ships verbatim: no paraphrase, no "improvement."
4. **CLONE TARGET** — the exact existing file whose markup/structure to copy. Point, don't
   describe. No clone target usually means the task is frontier — reconsider delegating it.
5. **HARD RULES** (verbatim, every time):
   - XHTML: all void tags self-closed
   - ASCII only — no named entities except `&amp;` `&lt;` `&gt;` `&quot;` `&apos;`
   - No `<script>` inside fragments
   - `pal.json` entry required for every new file
   - Existing CSS classes only — never invent class names
   - Touch ONLY the files this task names — never the §11 NEVER-list, never a §8b consumed dataset
6. **DONE =** — the task's exact success condition (tool output + exact string/state). The
   subagent self-checks against this before returning.
7. **RETURN CONTRACT** — the subagent returns this and only this:
   - files changed (absolute paths)
   - traceability table: spec item | shipped value | match (y/n)
   - deviations line: "Deviations: none" or each deviation + reason
   - the success-condition self-check it ran, with the tool output

### 3. After the subagent returns — every time, no exceptions
1. **Re-verify independently** — never trust the report. Run the task's tools yourself
   (`pal_validate`, `pal_test`; web → `pal_fetch` + grep the served HTML for the expected
   strings; console → `pal_screenshot` if it captures, else the §12 human-eyeball gate). See
   "Verify independently" below.
2. **Pass** → mark `done`, checkpoint, commit. **Fail or over-claim** → restore the good state:
   `git checkout` the subagent's local changes (clean slate beats half-applied). If the subagent
   had already pushed, re-push the restored local to overwrite the server (`pal_pull`/`pal_merge`
   first if drift-refused) — git checkout fixes only local. Then either re-dispatch ONCE with the
   failure named in the brief, or escalate (`needs-frontier`, `blocked`, or `needs-human`). Two
   failed dispatches on one task = stop delegating it; do it yourself or block it.
3. **Never** let a subagent's "done" stand without your tool verification. That one rule is what
   makes delegation safe across every harness.

---

## Verify independently (non-negotiable)

Never accept a subagent's self-report as truth. After every push:

- `pal_fetch` each touched **web** page and grep the served HTML for the expected H1, heading,
  or CSS class. Not in the fetched HTML = it didn't ship. (Console renders aren't fetchable this
  way — try `pal_screenshot` instead; only fall back to the §12 human-eyeball gate if it returns
  `captured:false`.)
- `pal_validate` before push; read push output for the stray-file warning.
- Open the preview for the human at every pause regardless — `pal_screenshot` gives the agent a
  real check, but final design taste/sign-off on the live product is still the human's call.

**Why:** subagents have over-claimed in practice — reporting elements absent from the served
HTML, misreading pages, marking tasks done when verification wasn't run. The orchestrator owns
truth; the subagent's self-report is a hypothesis, not a result.
