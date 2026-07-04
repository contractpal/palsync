---
name: pal-review
description: "Independently review a completed pal build against its SPEC.md in a FRESH context, never the session that built it: conformance, quality, visual render (or a human eyeball gate if no vision), and regression. Produces a verdict + fix tasks; never edits code or spec. Triggers: 'review the build', 'check it against the spec', 'QA this pal', or pal-loop build completion."
---

# pal-review — fresh-eyes evaluation against the spec

Run in a **fresh session or subagent — never the context that wrote the code.** That session is
biased toward its own output; bias separation is the whole point. Open cold, judge whether the
build meets the contract.

The **eval** layer, distinct from pal-loop's **tests** layer: tests are deterministic (compile /
validate / contains-string — pal_validate, pal_test, pal_fetch); evals are judgment (correct and
good against the spec, often visual). This skill evals and *consumes* test results — with one
exception: `pal_validate` is fast, mechanical, and now checks the contract-checklist wiring below,
so pal-review re-runs it fresh rather than trusting pal-loop's self-report (same reasoning as the
fresh `pal_regression` run in arm 4).

## Inputs (read all, first)
- `SPEC.md` (must be `status: approved`) — the contract, defining "correct": §3 sitemap, §4 copy,
  §5 behavior, §6 layout, §11 constraints, §12 acceptance criteria.
- `EXECUTION.md` — what was built and in what state.
- `DESIGN_SYSTEM.md` / `COMPONENTS.md` — what "on-brand / good" means visually.
- Built artifacts: `pal_fetch` each web page (server-rendered HTML); workflow/fragment files on disk.

## The review arms

### 1. Conformance (text — always runs)
Check the build against the contract:
- Every §4 copy string **verbatim** in the served output — verify with `pal_fetch expect:[strings]`
  (per-string found/missing verdict, no HTML dump), checking real output, not source you hope shipped.
- Every §3 nav link routes to a real page — no dead links.
- Every §12 acceptance criterion **actually met** — full set, not just the global floor;
  same-session verification cheats here, passing the floor while per-feature criteria go unchecked.
- §11 NEVER list not violated; §8b consumed datasets not altered.
- **Contract checklist — run `pal_validate` and paste its verdict line; a review with no
  `pal_validate` run is invalid.** It mechanically checks: (a) each `c:list` `name` matches a
  DataList name the workflow produces and isn't swapped with the `id` alias; (b) each
  `ajax-target` matches a real element id in the page shell; (c) each fragment `action=` has a
  matching workflow case; (d) EL `test=` syntax is real (`${...}` with `eq`/`empty`, no `==`).
  What it can NOT check — that each `${key}` a fragment reads is set by the workflow payload on
  the path that renders it — you verify yourself via the §5 action trace in arm 2.
- Every EXECUTION.md `done` task traces via its `spec ref` column to its SPEC.md § and that
  requirement is satisfied — catching a `done` task with an unmet requirement, not just §12.

Output: per-criterion PASS / FAIL with evidence (string found/missing, tool result, line), citing
each finding's `spec ref` §.

### 2. Quality / behavior (judgment — always runs)
Beyond "it compiled":
- Does each §5 behavior do the **right** thing? `pal_test` confirms a workflow *compiles*, not that
  its logic is correct. For **every** §5 action, trace it hop-by-hop with real `file:line` citations:
  triggering element → action name routed in the workflow → request params read → record operation →
  payload keys set → fragment `EL`/`c:list` refs that consume those exact keys (one row per action,
  table format in the output template). Any hop you cannot point at a real line means that action
  **FAILS** — compiling-but-wrong, and untraceable-but-compiling, are the same verdict.
- Copy on-brand per BRAND_VOICE / DESIGN_SYSTEM intent, not just present?
- §6 layout matches the composition the spec described?

### 3. Visual / UX (capability-gated)
Capture/render mechanics (MCP tool vs `palsync screenshot` CLI, console `captured:true/false`,
human-eyeball fallback) follow the canonical rule: `references/console-render-verification.md`.
- **Can capture AND have a vision-capable model:** judge each screen against DESIGN_SYSTEM.md and a
  short UX rubric — visual hierarchy, spacing rhythm, legibility, responsive behavior if testable,
  plus the AI fingerprints the design skills flag (gradient-blob hero, pill-everything uniform radius,
  three-card-row-as-only-idea, serif-on-cream-with-sage). Report each issue with screenshot + fix.
- **Can't** (no screenshot tool, no vision model, or `captured:false`): do NOT guess from HTML —
  emit the `needs-human` eyeball gate per the canonical rule, naming each screen and what to confirm.

### 4. Regression (brownfield-only — gated on `baseline/` existing)
No `baseline/` (greenfield, or a brownfield pal pal-init never mapped): skip this arm entirely.
Present: confirm SPEC.md's §12 REGRESSION criterion is met for every page/workflow
`baseline/baseline.json` covers.
- **Run `pal_regression` yourself — a FRESH run, not pal-loop's self-report** (fresh eyes = fresh
  run). It does the mechanical half: freshness gate (stale → `needs-human`, no comparison),
  validate/`pal_test`/page-`h1s` vs baseline, `eyeball_only` → `needs_human`, and the caused-vs-
  `known_issues` split. Act on its `caused` list; then add the judgment half below, which it can't do.
- `pal_screenshot` before/after diff for every `captured: true` baseline page: capture now, compare
  against `baseline/screenshots/<page>-<viewport>.png` using arm 3's UX rubric — asking "did anything
  UNTOUCHED shift," not "is it pretty." An untouched page shifting is a finding, same severity as a §12 miss.
- `eyeball_only` baseline pages/viewports get a `needs-human` regression finding (name the screen,
  what to compare against the saved baseline screenshot) — never an assumed pass, same as arm 3's fallback.
- Cross-check every finding against `known_issues` — an already-listed issue is NOT a new finding;
  don't re-report a pal's known defects as caused by this build.

## Output — a verdict, not a fix
Write `REVIEW.md` (or a `## Review` block):
```
# REVIEW — <project> — <date> — reviewer: fresh session
verdict: PASS | CHANGES-NEEDED
pal_validate: <quoted verdict line — required; no line means the review is invalid>
## Conformance
| criterion (§) | result | evidence (must match the required evidence class) |
## §5 action trace (one row per spec action — an incomplete row means that action FAILS)
| action (§5) | trigger (file:line) | routed case (file:line) | params read (file:line) | record op (file:line) | payload keys set (file:line) | fragment refs consuming keys (file:line) | result |
## Quality / behavior
- <finding> — <spec ref> — <why it misses>
## Visual / UX
- <finding> — <screenshot ref or "eyeball gate: screen X"> — <fix>
## Regression [brownfield-only — omit this section entirely when no baseline/ exists]
| baseline item (page/workflow) | result | evidence (baseline vs current) |
- known_issues excluded: <list, so exclusions are auditable, not silent>
## NOT VERIFIED — human gate
- <criterion or action> — <what a human must confirm> — <why it couldn't be verified here>
## Fix tasks (for pal-loop)
- [ ] <task> — addresses <finding> — success condition: <tool + check>
```
Rules:
- **Never edit code or the spec.** Findings become fix tasks routed to pal-loop; a *spec* problem
  (missing/contradictory requirement) is a blocker for the human, not a self-edit.
- Judge only against the spec and design system. "I'd have done it differently" is not a finding;
  "violates §12 criterion 4" is.
- **Evidence rules — PASS requires the matching evidence class, or it's fabrication:**
  rendered-output criteria need `pal_screenshot`/`pal_fetch` evidence taken from a state where the
  criterion is actually observable (a data-effects criterion cannot PASS from an empty-list
  screenshot); behavior criteria need the complete hop-by-hop trace row from arm 2. Anything you
  cannot verify with the tools at hand — `pal_screenshot` unavailable, `captured:false`, a trace
  hop with no real line, a stale-baseline Regression arm, an `eyeball_only` viewport — goes under
  `## NOT VERIFIED — human gate`, never an assumed pass. **Writing PASS without the required
  evidence class is a fabricated result, and a fabricated PASS is worse than an honest
  CHANGES-NEEDED.**
- **Verdict gating — PASS is allowed only when all three hold:** `pal_validate` reports 0 errors
  (quote the line), every §5 action has a complete trace row, and no §12 criterion sits in PASS
  without its evidence class. Any one missing → verdict is CHANGES-NEEDED with fix tasks, never PASS.
- **`pal_test` never outranks `pal_validate`.** pal_test proves the workflow COMPILES, nothing more;
  validate errors describe code that mis-renders or dies at runtime after a clean compile. "pal_test
  showed successful validation" is not a rebuttal to a validate error — the error stands until the
  code changes and validate reports 0.
- **Platform-constraint claims must cite a source.** Any statement of the form "the platform
  can't / requires / rejects X" in a finding or fix task must quote its origin verbatim: a skill or
  reference file line, or an actual tool/server message from THIS session. If the constraint is
  written nowhere, it is your invention — grep `.claude/skills/palbuilder-*` first, and write the
  fix task around what the docs DO prescribe instead. (Real case: a review asserted "c:a action
  requires a form wrapper" — documented nowhere, contradicted by the tag reference — and steered
  the fix loop toward a rewrite instead of a one-line attribute change.)
- A `known_issues`-listed defect is never a Regression finding — list it under "known issues
  excluded" so the exclusion is visible, not silently dropped.
- **Producing `REVIEW.md` is not optional.** A build with no `REVIEW.md` is incomplete — same
  status as a build with an unmet criterion.

## How it fits the loop
pal-loop runs the **tests** as it builds, then at completion hands off to pal-review in a **fresh
context** (new session or subagent) with the inputs above. pal-review returns the verdict; pal-loop
turns CHANGES-NEEDED items into fix tasks and re-reviews until PASS.

## What this skill does NOT do
- Does not compile or write tests — that's pal-loop's build step. It does re-run `pal_validate`
  itself (see the exception above) rather than trust pal-loop's self-report.
- Does not fix anything — produces a verdict and fix tasks only.
- Does not see on its own — visual review needs a screenshot capability; without one it defers to
  the human eyeball gate rather than judging blind.
