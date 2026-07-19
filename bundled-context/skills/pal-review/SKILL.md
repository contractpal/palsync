---
name: pal-review
description: "Reviews a completed pal against SPEC.md in a fresh context and produces a verdict + fix tasks. Triggers: 'review the build', 'check it against the spec', 'QA this pal', or pal-loop build completion. Does not edit code or spec."
---

# pal-review — fresh-eyes evaluation against the spec

Run in a **fresh session or subagent — never the context that wrote the code**. That session
is biased toward its own output; bias separation is the whole point. Open cold, judge whether
the build meets the contract. pal-loop ran the *tests* (compile/validate); you run the *eval*
(correct and good against the spec). Exception: re-run `pal_validate` yourself — fresh run,
never pal-loop's self-report.

## Inputs (read all, first)
- **Activate the verification tools before anything else.** On lazy-tool harnesses only a core
  set is active; call `pal_tools` with query `"browser runtime screenshot exercise debug"` and
  confirm `pal_screenshot`, `pal_exercise`, and `pal_debug` are active. A review that never
  ATTEMPTED activation may not claim the tools were unavailable — record the activation result
  (or its exact error) in REVIEW.md; a missing attempt caps the verdict at CHANGES-NEEDED.
- Run `palsync review brief` first. Treat its EVIDENCE LEDGER as primary evidence; open source
  files only for criteria listed under `NO EVIDENCE` or for a specific failed/ambiguous proof.
- `SPEC.md` (must be `status: approved`) — the contract: §3 sitemap, §4 copy, §5 behavior,
  §6 layout, §11 constraints, §12 acceptance criteria.
- `EXECUTION.md` — what was built and in what state.
- `DESIGN_SYSTEM.md` / `COMPONENTS.md` — what "on-brand / good" means visually.
- `design-system-init/references/design-principles.md` (from the injected skills folder) —
  applied UX/hierarchy/grouping/target/simplicity rubric for visually significant screens.
- Built artifacts: `pal_fetch` each web page (server-rendered HTML); workflow/fragment files
  on disk.

## The review arms

If fresh-context reviewer dispatch fails, do not silently self-review. Put `BIAS WARNING: review ran in build context (dispatch error: <err>)` at the top of REVIEW.md. Whenever a BIAS WARNING is present, the Verdict section must read `CHANGES-NEEDED`; a PASS verdict heading anywhere in REVIEW.md alongside the warning is itself a defect.

### 1. Conformance (always runs)
- **Run `pal_validate` and paste its verdict line — a review with no `pal_validate` run is
  invalid.** It mechanically checks: (a) each `c:list` `name` matches a DataList the workflow
  produces and isn't swapped with the `id` alias; (b) each `ajax-target` matches a real
  element id; (c) each fragment `action=` has a matching workflow case; (d) `test=` EL syntax
  is real (`${...}` with `eq`/`empty`, no `==`). What it canNOT check — that each `${key}` a
  fragment reads is set by the workflow payload on the rendering path — you verify in arm 2.
- Every §4 copy string **verbatim** in served output — `pal_fetch expect:[strings]`
  (per-string found/missing verdict, no HTML dump). Real output, not source.
- Every §3 nav link routes to a real page — no dead links.
- Every §12 acceptance criterion actually met — the full set, not just the global floor.
- Check new-pal resource ordering against `../shared/references/css-conventions.md`; existing pals are not retrofitted unless the spec says so.
- §11 NEVER list not violated; §8b consumed datasets not altered.
- Every `done` task in EXECUTION.md traces via its `spec ref` to its SPEC.md § and that
  requirement is satisfied.

Output: per-criterion PASS / FAIL with evidence, citing each finding's `spec ref` §. The
evidence cell must name the exact proof artifact (`pal_fetch expect` result, `pal_exercise`
step, `pal_screenshot captured:true`, or file:line trace); vague "code inspection" is not a
proof artifact for rendered output or data effects.

### 2. Quality / behavior (always runs)
- `pal_test` confirms a workflow *compiles*, not that its logic is correct. For **every** §5
  action, trace it hop-by-hop with real `file:line` citations: triggering element → action
  routed in the workflow → request params read → record operation → payload keys set →
  fragment EL/`c:list` refs consuming those exact keys. One row per action (table in the
  output template). **Any hop you cannot point at a real line → that action FAILS** —
  compiling-but-wrong and untraceable-but-compiling are the same verdict.
- Where runnable, ALSO exercise each §5 write action live: `pal_exercise` with the action's
  inputs, `expect` the persisted value, `absent` the pre-edit value (catches duplicate
  insert). A passing exercise is the strongest evidence class for a data-effects criterion;
  a failing one is a finding with the step output as evidence.
- IF authoring exercises THEN read `../shared/references/exercise-authoring.md` first.
- Use unique `{{runId}}` data and assert the complete persisted effect.
- Most common mistakes: unscoped duplicate-text clicks (scope with `within`) and missing `absent:` after delete.
- **Code trace is necessary but not sufficient for write-action PASS.** If `pal_exercise` is
  available and a §5 write action was not exercised, mark that action `NOT VERIFIED` and the
  verdict `CHANGES-NEEDED` with a fix task to run the exercise. Do not convert a plausible
  file:line trace into a data-effects pass.

- Copy on-brand per BRAND_VOICE / DESIGN_SYSTEM intent, not just present?
- §6 layout matches the composition the spec described?
- Tokens in `styles/styles.css` match the shipped preset recorded in `DESIGN_SYSTEM.md`, or a
  documented reference-derived palette. Invented fallback palettes are a finding.
- A console pal with no recorded explicit font decision uses the system font stack and has no
  `@import`; otherwise record a visual finding.

### 3. Visual / UX (capability-gated)
Try `pal_screenshot` (or the `palsync screenshot` CLI on non-MCP harnesses) per screen.
- Review owns the responsive pair: capture the final pushed version at both desktop and mobile;
  pal-loop's per-task mobile capture is intentionally deferred to this final review.
- Capture both desktop and mobile for every page-level screen. `designAudit.errors > 0` is a hard
  visual failure; list each rule and screenshot as evidence. Audit warnings must be fixed or
  individually justified, never silently ignored.
- Apply platform-chrome exceptions outside `#cp-root` only through `../shared/references/console-chrome-exception.md`; quote the required evidence.
- Confirm `pal_validate` is clean for the enforced `pb-section` fragment-root and `pb-main` page-shell structural checks; review only documented exceptions.
- IF a shell wrapper class is absent from `styles/design-system.css`, `styles/spacing.css`, and COMPONENTS.md, THEN fail it as undefined.
- IF `for f in fragments/*; do [ "$(rg -o 'pb-field-group' "$f" | wc -l)" -lt 2 ] || rg -q 'pb-stack|pb-form-grid' "$f" || echo "$f"; done` prints a fragment, THEN fail it. Two or more field groups require `pb-stack` or `pb-form-grid`.
- IF `for t in $(rg -oN 'class="[^"]*"' fragments/ pages/ | sed -E 's/.*class="//; s/"$//' | tr ' ' '\n' | grep -v '\$' | sort -u); do rg -q "\\.$t\\b" styles/ || echo "$t"; done` prints a class token, THEN fail each printed token as undefined — it appears in markup but no shipped stylesheet defines it, so that element renders unstyled. Usual offenders: Bootstrap muscle-memory names (`btn`, `btn-primary`, `form-control`, `badge`, `alert-danger`) and invented pb-* names (`pb-card-header` — real name `pb-card-head`; `pb-empty-state` — real name `pb-state`). The fix is the exact pb-* class from COMPONENTS.md / the shipped stylesheets; a new-pal override belongs in readable `styles/styles.css`.
- IF an Actions `td` contains two or more controls without a `.pb-row-actions` wrapper, fail it.
  Button variants alone do not provide grouping or mobile wrapping. If mutually exclusive state
  transitions (such as Check out and Check in) render together for one row, fail action/state
  clarity and require conditional rendering plus exercises of both states.
- **`captured:true`:** first check `renderError` — non-null = hard FAIL (compiled but threw at
  render). Null → judge each screen against DESIGN_SYSTEM.md and a short UX rubric: visual
  hierarchy, primary journey, Gestalt grouping, Fitts target sizing/proximity, progressive
  disclosure, spacing rhythm, legibility, color meaning/contrast, consistency, responsive behavior
  if testable, presence/use of the required spacing utility layer, plus anti-slop fingerprints:
  gradient-blob hero, pill-everything uniform radius, and serif-on-cream-with-sage. Read
  `../shared/references/anti-slop.md` for the full list. Report each issue with screenshot + fix.
  Apply the complete ship gate in `../shared/references/visual-rubric.md`; every score cites visible evidence.
- **`captured:false` / no screenshot tool / no vision:** do NOT guess from HTML — emit a
  `needs-human` eyeball gate naming each screen and what to confirm.
  (Full rule: `references/console-render-verification.md`.)

### 4. Regression (only if `baseline/` exists — else skip this arm entirely)
- **Run `pal_regression` yourself — a FRESH run, not pal-loop's self-report.** It does the
  mechanical half: freshness gate (stale → `needs-human`, no comparison), validate/`pal_test`/
  page-`h1s` vs baseline, `eyeball_only` → `needs_human`, caused-vs-`known_issues` split. Act
  on its `caused` list.
- Then the judgment half it can't do: `pal_screenshot` before/after diff for every
  `captured:true` baseline page — compare against `baseline/screenshots/<page>-<viewport>.png`
  asking "did anything UNTOUCHED shift," not "is it pretty." An untouched page shifting is a
  finding, same severity as a §12 miss.
- `eyeball_only` baseline pages get a `needs-human` regression finding (name the screen, what
  to compare) — never an assumed pass.
- Cross-check every finding against `known_issues` — an already-listed defect is NOT a new
  finding; list it under "known issues excluded" so the exclusion is auditable.

## Output — a verdict, not a fix
Write `REVIEW.md` (or a `## Review` block). **Producing it is not optional** — a build with no
REVIEW.md is incomplete. Every pass, including a re-review after fixes, overwrites REVIEW.md with
the new verdict, fresh evidence, and that pass's own complete `palsync review check` output;
chat-only verdicts are invalid.
```
# REVIEW — <project> — <date> — reviewer: fresh session
verdict: PASS | CHANGES-NEEDED
pal_validate: <quote `ok` and `diagnosticCount` — required; missing fields make the review invalid>
## Proof ledger
| proof id | tool/file evidence | proves |
## Conformance
| criterion (§) | result | evidence (must match the required evidence class) |
## §5 action trace (one row per spec action — an incomplete row means that action FAILS)
| action (§5) | trigger (file:line) | routed case (file:line) | params read (file:line) | record op (file:line) | payload keys set (file:line) | fragment refs consuming keys (file:line) | result |
## Quality / behavior
- <finding> — <spec ref> — <why it misses>
## Visual / UX
- <finding> — <screenshot ref or "eyeball gate: screen X"> — <fix>
## Regression [omit entirely when no baseline/ exists]
| baseline item (page/workflow) | result | evidence (baseline vs current) |
- known_issues excluded: <list>
## NOT VERIFIED — human gate
- <criterion or action> — <what a human must confirm> — <why it couldn't be verified here>
## Fix tasks (for pal-loop)
- [ ] <task> — addresses <finding> — success condition: <tool + check>
```

Cost recording — IF harness is claude-code THEN skip `palsync cost record` (agent cannot read its own spend); IF pi THEN run `palsync cost record --model <model> --phase <build|review>` using the user-supplied footer figures.
Then run `palsync review check` from the pal workspace and paste
its complete output into REVIEW.md. Run it only after the latest push, task-state update, and
review tool evidence: it rejects a missing or stale REVIEW.md. Any flag, stale-review failure,
or verdict cap forces `CHANGES-NEEDED`; do not write PASS until the check reports `result: PASS`.
The build session must run the same command before declaring PASS/done; this gate is identical in
Claude Code, Pi, and OpenCode.

## Rules
- **Never edit code or the spec.** Findings become fix tasks for pal-loop; a *spec* problem
  (missing/contradictory requirement) is a human blocker, not a self-edit.
- Judge only against the spec and design system. "I'd have done it differently" is not a
  finding; "violates §12 criterion 4" is.
- **Evidence classes — PASS requires the matching evidence, or it's fabrication:**
  rendered-output criteria need `pal_screenshot`/`pal_fetch` evidence taken from a state where
  the criterion is observable (a data-effects criterion cannot PASS from an empty-list
  screenshot); behavior criteria need the complete hop-by-hop trace row; write/data-effect
  criteria need live `pal_exercise` evidence when the tool is available. Anything you cannot
  verify with the tools at hand goes under `## NOT VERIFIED — human gate`, never an assumed
  pass. **A fabricated PASS is worse than an honest CHANGES-NEEDED.**
- **Proof ledger required.** Every PASS row must cite a proof id from `## Proof ledger`. Tool
  proofs name the tool and the relevant result (`pal_exercise step 2 PASS`,
  `pal_fetch expect all found`, `pal_screenshot captured:true renderError:null`). File proofs
  name exact `file:line`. A row with no proof id is not reviewed.
- **Verdict gating — PASS only when all four hold:** `pal_validate` returns `ok:true` and
  `diagnosticCount:0` (quote both fields); every §5 action has a complete trace row; every runnable write/data-effect action
  has passing `pal_exercise` evidence; no §12 criterion sits in PASS without its evidence
  class. Any one missing → CHANGES-NEEDED with fix tasks.
- **`pal_test` never outranks `pal_validate`.** pal_test proves the workflow COMPILES, nothing
  more; validate errors describe code that mis-renders or dies at runtime after a clean
  compile. "pal_test showed successful validation" is not a rebuttal to a validate error — the
  error stands until the code changes and validate reports 0.
- **Platform-constraint claims must cite a source.** Any "the platform can't / requires /
  rejects X" in a finding or fix task must quote its origin verbatim: a skill/reference file
  line, or an actual tool/server message from THIS session. Written nowhere → it is your
  invention; grep `.claude/skills/palbuilder-*` first and write the fix task around what the
  docs DO prescribe. (Real case: a review asserted "c:a action requires a form wrapper" —
  documented nowhere, contradicted by the tag reference — and steered the fix loop toward a
  rewrite instead of a one-line change.)

## How it fits the loop
pal-loop builds and tests, then hands off here in a fresh context. You return the verdict;
pal-loop turns CHANGES-NEEDED items into fix tasks and re-reviews until PASS.

## What this skill does NOT do
- Does not build or fix anything — verdict and fix tasks only.
- Does not see on its own — no screenshot capability means the human eyeball gate, never
  judging blind.
