# eval/run.md — palsync benchmark run protocol

**This file is the benchmark protocol linked from `eval/specs/README.md`.** It defines variable
pinning, the one-variable rule, per-run cost capture, and the model matrix.

The benchmark entered UX contract v2 on 2026-07-10: design became scored, all UI scenarios gained
responsive visual-quality criteria, CRUD/marketing §6 gained archetype-specific composition, and
`pal_screenshot` gained `designAudit`.
Scores before this epoch are not directly comparable; record `ux-v2` in new row notes.

The scenarios themselves (`eval/specs/01…05`, `DESIGN_SYSTEM.md`, `COMPONENTS.md`) are frozen at
their recorded version/approval date.
Do not edit spec content — a changed spec invalidates every prior row it would compare against.

**Spec revision v2 (2026-07-11):** specs realigned to template-based foundation and the new
verification discipline. Rows scored against v1 specs are not process-comparable with v2 rows;
outcome scores (§12/scoring.md) remain comparable because acceptance criteria are unchanged.
The v2 validation floor includes `debugTagShipped`, `missingFragment`, `designClassRequired`,
`emptyAction`, `pbMain`, and `pbSection`; console audit exceptions must quote
`[OUTSIDE #cp-root]` sample evidence.

**Spec revision v2.1 (2026-07-14):** §9 skill lists and EXECUTION validation-rule lists
realigned to the post-refactor skill set (pal-restraint/palbuilder-backend retired,
seo-core renamed palbuilder-seo, emptyAction/pbMain/pbSection added to the floor).
Process metadata only — §12 acceptance criteria unchanged, outcome scores remain comparable.

---

## 0. Goal metric

> **Benchmark scores hold or improve at lower token and tool-call counts, across model tiers.**

Capability pass/fail (each spec's §12) is only half the measurement. A run is not "better"
because it passed §12 — it is better because it passed §12 **at equal-or-lower cost**. Every run
therefore records BOTH the §12 score (via `eval/scoring.md`) AND the cost block below.

Two work streams are being measured independently on this same benchmark:
- the **orchestration skills** (pal-init / pal-loop / pal-review / pal-spec / pal-fix …) — the user's refactor;
- the **palbuilder domain skills** (palbuilder-core / -workflow / -data / -frontend / -realtime / -email / -seo) — a teammate's rebuild.

The whole point of the pinning rules below is to keep those two streams separable. A row that
changed both at once measures nothing.

---

## 1. Per-run variable pinning (MANDATORY)

Every run records ALL of the following. **A run missing any field is invalid for comparison** —
discard it, do not "estimate" the gap.

| Field | What to record | Where to get it |
|---|---|---|
| `date` | ISO date of the run | — |
| `scenario` | `01_crud_equipment_checkout` / `02…` / `03…` / `04…` / `05…` | — |
| `harness` | e.g. `Claude Code 0.4.x`, `Cursor`, `headless` | — |
| `model` | **exact model, not the tier** — `claude-sonnet-5`, `claude-opus-4-8`, `claude-haiku-4-5`, `deepseek-v3`, `glm-4-…` | harness model selector |
| `palsync SHA` | short commit of this repo at run time | `git rev-parse --short HEAD` |
| `orch skills` | orchestration-skill set version — `main@<sha>` vs `refactor@<sha>` (branch + commit) | `git rev-parse --short HEAD` of the branch whose `bundled-context/skills` is loaded |
| `palbuilder skills` | palbuilder-skill set version — `legacy@<sha/date>` vs `palbuilder-core@<sha/date>` (record the teammate's skill commit/date) | teammate's skill commit or delivery date |

`palsync SHA` and `orch skills` will often be the same commit today (skills live in this repo).
Record both anyway — they diverge the moment skills are loaded from a branch or an external
drop, and the teammate's palbuilder rebuild may land out-of-repo.

## 2. The one-variable rule (MANDATORY)

Compare only runs that differ in **exactly ONE** of:

    { orchestration skills, palbuilder skills, model }

Never draw a conclusion from a pair that changed two. Examples:
- refactor orchestration vs main orchestration → hold palbuilder skills + model fixed. ✅
- new palbuilder-core vs legacy palbuilder → hold orchestration + model fixed. ✅
- frontier vs cheap model → hold both skill sets fixed. ✅
- "refactor branch on Opus" vs "main on Sonnet" → **two variables, no conclusion.** ❌

This is the discipline that keeps the user's orchestration work separable from the teammate's
domain-skill rebuild. See the sequencing note at the bottom.

---

## 3. Running a scenario

Unchanged from the bundle README, restated for completeness:

1. Set the workspace/cloud URL in the spec's `pal:` header line (replace the `<WORKSPACE — set by evaluator before run>` placeholder). Do this in a working copy — do not commit URLs into `eval/specs`.
2. Copy the scenario's `SPEC.md` + `EXECUTION.md` into the palsync workspace alongside `DESIGN_SYSTEM.md` and `COMPONENTS.md` from `eval/specs/`.
3. Launch palsync in the chosen harness on the chosen model.
4. **Auto / full mode. ZERO mid-run intervention.** No hints, no answering questions, no nudging past a stuck point. If the agent stops to ask in auto mode, that is a hard-rule violation (count it, §4e) — you still do not answer.
5. When the agent finishes, evaluate against the spec's §12 using `eval/scoring.md`. This is the post-hoc human evaluation — done once, at the end, never during.

## 4. Cost capture (per run, MANDATORY)

Fill these from the finished transcript. Record them in `eval/RESULTS.md`.

**(a) Total tool calls**, counted from the transcript, split three ways:
- **mcp** — palsync MCP tool calls (`pal_*`: pal_pull, pal_push, pal_validate, pal_test, pal_preview, pal_screenshot, pal_sync_datasets, pal_seo_audit, pal_status, pal_lock, pal_unlock, …).
  `pal_screenshot` supports `imageless:true` for audit-only re-checks; these calls count as normal mcp tool calls.
- **read** — file reads (Read tool, `cat`/`head`/`tail`, context_search / expand_chunk).
- **other** — everything else (Edit, Write, Bash that isn't a read, etc.).

**(b) Tokens in / out**, if the harness reports them. Per harness:
- **Claude Code** — run `/cost` at end of session; record input + output tokens. (Also visible in the transcript's usage summary.)
- **Cursor / others** — record if surfaced; leave blank if the harness does not expose it. Blank is honest; a guess is not.

**(c) Wall-clock time** — start of run to agent's final message.

**(d) `pal_push` count** — the iteration-loop proxy. More pushes ≈ more build-fix cycles. This is a
subset of the mcp count, tracked separately because it is the single best cheap signal of how
many times the agent had to go around the loop.

**(e) Hard-rule violations observed** — count each occurrence of:
- edited a spec / `DESIGN_SYSTEM.md` / `COMPONENTS.md`;
- skipped verification (pushed without pal_validate / pal_test, or declared done without the §12 checks);
- invented copy (UI text, labels, error messages not in the spec);
- stopped to ask a question despite auto mode.

Violations are a quality axis, not just cost — a run that "wins" on tokens by skipping
verification did not win. Record the count and note what happened in `notes`.

## 5. Model matrix (MANDATORY for any model-agnostic claim)

The bundle README ran Sonnet only. That is not enough to claim an improvement generalizes.

Per scenario, per config, run at minimum two rows:
- **one frontier model** — Sonnet / Opus-class (`claude-sonnet-5`, `claude-opus-4-8`).
- **one cheap model** — Haiku / DeepSeek / GLM-class (`claude-haiku-4-5`, `deepseek-v3`, `glm-4-…`).

A claim of the form "the refactor improves the benchmark" requires **at least the cheap row** in
addition to the frontier row. Frontier models paper over weak orchestration; the cheap row is
where orchestration quality actually shows. A frontier-only win is a single-model win, stated
as such.

## 6. Run A / Run B (unchanged, now precise)

Each comparison is a pair holding two of the three pinning variables fixed (see §2):
- **Run A** — the baseline config.
- **Run B** — the one changed variable.

Record the full §12 checklist (`eval/scoring.md`) AND the §4 cost block for each. The comparison
is A vs B on §12 pass rate first (must hold or improve), then on tokens + tool calls + pushes
(should drop). That ordering is the goal metric.

---

## 7. Reporting the run

After scoring the run with [`eval/scoring.md`](scoring.md), write the narrative report in
`reports/` using the `qa-report` skill (`bundled-context/skills/qa-report/SKILL.md`) and its
`references/report-template.md`. The skill fixes the filename convention and required
sections so benchmark rows stay comparable. Follow its rules: evidence before every claim,
disclose reviewer==builder, and never estimate unavailable cost numbers.

## Sequencing (human steps, informs how rows get produced)

1. **Baseline on current `main`** before merging any orchestration change: 5 scenarios × {frontier, cheap}. These are the canonical Run A rows.
2. When the teammate's **new palbuilder skills** replace the legacy ones, run the matrix once changing ONLY that (orchestration + model held) to isolate its effect, before layering orchestration changes on top.
3. Only then evaluate orchestration-refactor runs, again one variable at a time.
