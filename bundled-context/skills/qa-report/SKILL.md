---
name: qa-report
description: "Load to report evidence from a completed build/eval run. Requires run evidence; not a substitute for pal-review."
---

# qa-report — standardized QA report for pal-loop/eval runs

Use this skill after a pal-loop build, a benchmark run, or any QA pass on a spec. It produces
one report in `/Users/apple/Documents/palsync/reports/` that makes cross-run comparisons possible and prevents fabricated
claims by requiring evidence before every finding.

## When to use

- The agent just finished a pal-loop run and you need a post-run evaluation.
- A benchmark/eval run completed and the result needs to be recorded.
- A human asks for a QA summary of a build.

## Inputs

Read these before writing:

- `SPEC.md` and `EXECUTION.md` for the run.
- `REVIEW.md` if pal-review ran.
- Tool transcripts and the output of `palsync cost`.
- Any prior report on the same spec in `/Users/apple/Documents/palsync/reports/` or `/Users/apple/Documents/palsync/archives/`.

## Filename convention

Use `/Users/apple/Documents/palsync/reports/YYYY-MM-DD_<spec-slug>_<harness>_<model-slug>.md`; field definitions and example: `references/report-template.md`.

## Output — one markdown report with exactly these sections

Use `references/report-template.md` as the skeleton. Fill every heading; if a section has
nothing to say, write "none" and explain why.

1. **Header metadata block** — report path, workspace, pal ID, run date + wall clock, harness,
   PalSync version/commit when available, build model (exact ID + effort), review/QA model if
   different, run mode (spec mode / run mode / review cadence).
2. **Executive verdict** — one bolded verdict line (`PASS` / `CHANGES NEEDED` / `BROKEN`) +
   ≤2 paragraphs. State explicitly whether findings were caught by the process or by a human.
3. **Findings** — ordered by severity (High / Medium / Low). Each finding requires: symptom,
   live reproduction evidence (actual tool output, not paraphrase), root cause with
   `file:line`, and a "palsync improvement" line. No finding without evidence.
4. **Visual evidence** — immediately after Findings. When a screenshot materially supports a
   finding, preserve its original tool path, copy the PNG to
   `reports/assets/YYYY-MM-DD_<spec>_<harness>_<model>/`, and embed that copy with a relative
   Markdown path. Include only failure, wrong-state, important final desktop/mobile, or meaningful
   before/after evidence. A screenshot proves only what is visible; use tool output, transcript,
   or `file:line` evidence for root cause. If copying fails, retain the source path and say image
   copy unavailable; never invent an embedded path.
5. **What worked well** — for balance and to protect features from being "fixed" away.
6. **Run mechanics & PalSync efficiency** — evidence-only telemetry for the completed run:
   - PalSync version/commit used, when available.
   - Tasks attempted / completed / blocked / needs-human / needs-frontier.
   - Skill names actually loaded and extra references actually loaded, especially JIT references
     such as `pal-json.md`, `browser-js.md`, and verification references.
   - Tool friction: failed, duplicate/redundant, retried, or uninformative tool calls.
   - Validation/rework: count and cause of significant validation, push, or test failures that
     required code changes; do not count an intentional diagnostic check as a failure.
   - User interventions: human syntax corrections, clarifications that the spec/context should
     already have made clear, stop/retry requests, or workflow rescues.
   - Routing/context misses: required guidance not loaded, clearly irrelevant large guidance
     loaded, guessed PalBuilder behavior before consulting its owner, or recovery because needed
     guidance was moved too far out of context.
   - Routing/context wins: relevant JIT loading, such as loading `pal-json.md` only when creation
     began or leaving browser-JS detail unloaded for markup-only work.
   - Whether the pal-loop state machine was followed cleanly: Start → Pick → Prepare → Execute →
     Verify → Resolve → Continue/Handoff.
7. **Cost & usage** — Read `.palsync/run-usage.json` when present. Each phase contains immutable
   `windows`; report each useful completed build window and sum only their exact `input`,
   `cacheRead`, `output`, `cacheWrite`, and `cost` deltas for the Build phase. Keep review windows
   separate, then sum completed build and review windows for Total measured PalSync run. Label the
   source as `pi/sessionManager.getEntries`. This is a bounded PalSync build window, not the entire
   Pi conversation. Never replace it with the current Pi footer or `/info` totals: those are
   cumulative across the Pi session/branch history and later turns contaminate them. If no completed
   bounded window exists, say `not available`. Do not estimate usage or cache hit rate. Keep the
   existing `palsync cost` output as separate PalSync mechanics telemetry; do not record footer
   figures manually.
8. **Recommendations for palsync** — numbered, prioritized (P0 / P1 / P2), each naming the
   file or tool it targets.
9. **Fix tasks** — checkbox list in pal-loop task format (file, change, success condition) so
   a future `pal-fix` / `pal-loop` run can consume it directly.

## Rules

- **Evidence before claim.** Every finding must quote actual tool output, a screenshot path,
  a `file:line`, or a verbatim transcript line. No paraphrase, no "code looks correct". For a
  material screenshot, retain its original path and embed a copied relative report asset.
- **Disclose reviewer == builder.** If the QA/review session is the same agent or context
  that built the pal, write a self-review caveat at the top of the report and treat the
  verdict as `CHANGES NEEDED` unless an independent fresh reviewer confirmed it.
- **Severity requires user impact.** A severity label must explain what the user sees or
  loses: `High` = spec-violating behavior shipped or data at risk; `Medium` = real friction
  or verification gap; `Low` = cosmetic or efficiency issue.
- **Check for prior reports.** Before writing findings, search `/Users/apple/Documents/palsync/reports/` and `/Users/apple/Documents/palsync/archives/`
  for a prior report on the same spec. Cross-reference converging findings and note
  diverging ones.
- **No invented numbers.** Use only actual transcript, tool, file, `palsync cost`, or harness
  sidecar evidence. If a number is unavailable, say "not available" and never estimate.
- **Keep efficiency distinct from correctness.** Tool friction, routing/context observations,
  and validation/rework describe efficiency or process only; pal-review remains the correctness
  gate. A reference load is not bad merely because it occurred, and a large skill/reference is
  not itself a finding: judge relevance and timing from evidence.
- **Do not estimate context savings.** Never infer token savings from skill or reference sizes.
- **Verdict reflects evidence, not effort.** Do not soften the verdict because the run was
  long or the model is cheap. If the evidence shows a spec violation, the verdict is
  `CHANGES NEEDED` or `BROKEN`.

## Template

Start from `references/report-template.md`, fill every heading, and remove the instructional
comments before saving.
