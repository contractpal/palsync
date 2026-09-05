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
   build model (exact ID + effort), review/QA model if different, run mode (spec mode /
   run mode / review cadence).
2. **Executive verdict** — one bolded verdict line (`PASS` / `CHANGES NEEDED` / `BROKEN`) +
   ≤2 paragraphs. State explicitly whether findings were caught by the process or by a human.
3. **Findings** — ordered by severity (High / Medium / Low). Each finding requires: symptom,
   live reproduction evidence (actual tool output, not paraphrase), root cause with
   `file:line`, and a "palsync improvement" line. No finding without evidence.
4. **What worked well** — for balance and to protect features from being "fixed" away.
5. **Cost & usage** — Cost recording — IF harness is claude-code THEN skip `palsync cost record` (agent cannot read its own spend); IF pi THEN run `palsync cost record --model <model> --phase <build|review>` using the user-supplied footer figures. Then paste `palsync cost` output verbatim; never estimate unavailable figures.
6. **Recommendations for palsync** — numbered, prioritized (P0 / P1 / P2), each naming the
   file or tool it targets.
7. **Fix tasks** — checkbox list in pal-loop task format (file, change, success condition) so
   a future `pal-fix` / `pal-loop` run can consume it directly.

## Rules

- **Evidence before claim.** Every finding must quote actual tool output, a screenshot path,
  a `file:line`, or a verbatim transcript line. No paraphrase, no "code looks correct".
- **Disclose reviewer == builder.** If the QA/review session is the same agent or context
  that built the pal, write a self-review caveat at the top of the report and treat the
  verdict as `CHANGES NEEDED` unless an independent fresh reviewer confirmed it.
- **Severity requires user impact.** A severity label must explain what the user sees or
  loses: `High` = spec-violating behavior shipped or data at risk; `Medium` = real friction
  or verification gap; `Low` = cosmetic or efficiency issue.
- **Check for prior reports.** Before writing findings, search `/Users/apple/Documents/palsync/reports/` and `/Users/apple/Documents/palsync/archives/`
  for a prior report on the same spec. Cross-reference converging findings and note
  diverging ones.
- **No invented numbers.** Use only what `palsync cost` or the harness sidecar exposes. If
  a number is unavailable, say "not available" and never estimate.
- **Verdict reflects evidence, not effort.** Do not soften the verdict because the run was
  long or the model is cheap. If the evidence shows a spec violation, the verdict is
  `CHANGES NEEDED` or `BROKEN`.

## Template

Start from `references/report-template.md`, fill every heading, and remove the instructional
comments before saving.
