---
name: qa-report
description: "After a pal-loop build or benchmark/eval run, write a standardized QA report in reports/ using the provided template. Ensures consistent filename, seven required sections, evidence-before-claim, and fix-task format. Triggers: 'write a QA report', 'summarize the run', 'post-run evaluation report', or after a benchmark/eval run."
---

# qa-report — standardized QA report for pal-loop/eval runs

Use this skill after a pal-loop build, a benchmark run, or any QA pass on a spec. It produces
one report in `reports/` that makes cross-run comparisons possible and prevents fabricated
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
- Any prior report on the same spec in `reports/` or `archives/`.

## Filename convention

Save the report as:

```
reports/YYYY-MM-DD_<spec-slug>_<harness>_<model-slug>.md
```

- `YYYY-MM-DD` — the date the run started.
- `<spec-slug>` — the spec identifier (e.g. `equipment-checkout`).
- `<harness>` — the agent/harness name (e.g. `claude-code`, `pi`, `headless`).
- `<model-slug>` — the exact model ID used for the build (e.g. `haiku-4.5`, `sonnet-5`).

Example: `reports/2026-07-14_equipment-checkout_claude-code_haiku-4.5.md`

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
5. **Cost & usage** — `palsync cost` output verbatim, plus model-token/dollar figures when the
   harness exposes them; when it doesn't, say so explicitly, never estimate. If
   `.palsync/session-cost.json` exists, read it here.
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
- **Check for prior reports.** Before writing findings, search `reports/` and `archives/`
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
