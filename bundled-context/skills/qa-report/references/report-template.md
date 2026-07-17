> Rename this file to `/Users/apple/Documents/palsync/reports/YYYY-MM-DD_<spec-slug>_<harness>_<model-slug>.md` before filling
> it in. Example: `/Users/apple/Documents/palsync/reports/2026-07-14_equipment-checkout_claude-code_haiku-4.5.md`.
> Remove these two reminder lines after renaming.

# Palsync QA Test-Run Report — `<SPEC_NAME>`

## Header metadata block

**Report file:** `/Users/apple/Documents/palsync/reports/YYYY-MM-DD_<spec-slug>_<harness>_<model-slug>.md`
**Workspace:** `<workspace path>`
**Pal:** `<pal name>` (`<pal id>`)
**Run date:** `YYYY-MM-DD` → wall clock `HH:MM:SS – HH:MM:SS`
**Harness:** `<harness name>`
**Build model:** `<exact model id>` (effort `<reasoning effort>`)
**QA/report model:** `<exact model id>` if different from build model
**Run mode:** `<spec mode>` / `<run mode>` / review cadence `<cadence>`

## Executive verdict

**`<PASS | CHANGES NEEDED | BROKEN>`** — one-line summary.

≤2 paragraphs. State explicitly whether findings were caught by the process (tools / review)
or by a human.

## Findings

Ordered by severity: High, then Medium, then Low.

### High

#### 1. `<title>`

- **Symptom:** `<what the user sees>`
- **Live evidence:** `<verbatim tool output, screenshot path, or file:line>`
- **Root cause:** `<file:line>` — `<explanation>`
- **Palsync improvement:** `<what palsync should change>`

### Medium

#### 2. `<title>`

- **Symptom:** ...
- **Live evidence:** ...
- **Root cause:** ...
- **Palsync improvement:** ...

### Low

#### 3. `<title>`

- **Symptom:** ...
- **Live evidence:** ...
- **Root cause:** ...
- **Palsync improvement:** ...

## What worked well

- `<tool or behavior that functioned correctly, with evidence>`
- `<another positive observation>`

## Cost & usage

### `palsync cost` output

> Before running it: if the harness exposes this session's token/cost figures, record them with
> `palsync cost record --model X --provider Y --in N --cached N --out N [--cost N] --phase review`
> so they appear in the phase totals below.

```
<paste palsync cost output verbatim, including the model-token spend section with
build/review phase totals>
```

### Model tokens / dollars

- Build model: `<value or "not available">`
- Review/QA model: `<value or "not available">`
- These come from the sidecar totals in the `palsync cost` output above; if the sidecar is
  absent, state that and do not estimate.

## Recommendations for palsync

1. **P0 — `<target file or tool>`** — `<what to change>`
2. **P1 — `<target file or tool>`** — `<what to change>`
3. **P2 — `<target file or tool>`** — `<what to change>`

## Fix tasks

- [ ] `<file>` — `<change>` — success condition: `<tool output or check>`
- [ ] `<file>` — `<change>` — success condition: `<tool output or check>`
