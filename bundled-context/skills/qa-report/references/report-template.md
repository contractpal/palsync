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
**PalSync revision:** `<commit/version or not available>`
**Build usage window:** `<.palsync/run-usage.json build delta or not available>`
**Review usage window:** `<.palsync/run-usage.json review delta or not available>`
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

## Visual evidence

Include only screenshots that materially support a finding or important final desktop/mobile
state. Keep the original tool artifact path even when the copied report asset is available.

### `<finding / screen>`

**Source:** `.agent-work-history/pal_screenshot/<artifact>.png`

![`<specific visible state>`](assets/YYYY-MM-DD_<spec>_<harness>_<model>/<meaningful-name>.png)

**Demonstrates:** `<only the visibly supported claim>`

If the image cannot be copied, write `Image copy unavailable` and retain the Source; do not add
an invented image link.

## What worked well

- `<tool or behavior that functioned correctly, with evidence>`
- `<another positive observation>`

## Run mechanics & PalSync efficiency

**PalSync revision:** `<commit/version or not available>`

| Metric | Result | Evidence / notes |
| --- | ---: | --- |
| Tasks attempted | `<n>` | `<EXECUTION/transcript>` |
| Tasks completed | `<n>` | |
| Blocked / needs-human / needs-frontier | `<n / n / n>` | |
| Skills loaded | `<names>` | `<transcript>` |
| Extra references loaded | `<names or none>` | |
| Significant tool failures/retries | `<n>` | `<tool + reason>` |
| User interventions | `<n>` | `<what required intervention>` |
| Routing/context misses | `<n>` | `<what was missing/wrong>` |
| Routing/context wins | `<n>` | `<what stayed JIT / avoided unnecessary context>` |

**Validation/rework:** `<count and cause of significant validation/push/test failures requiring code changes, or not available>`

**State-machine adherence:** `<clean | deviations>` — `<evidence>`

**Context-quality note:** `<Did compressed/JIT guidance appear sufficient? Cite evidence; do not speculate.>`

## Cost & usage

### Run-bounded Pi usage

Read `.palsync/run-usage.json`; use only completed `phases.<phase>.windows` records (`start`,
`end`, and `delta`). Each is a bounded PalSync build/review window, not the entire Pi conversation.
Do not use the current Pi footer or `/info` totals, which are cumulative session/branch history.

| Window | Input | Cache read | Output | Cache write | Cost | Evidence |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Build window 1 | `<delta or not available>` | | | | | `pi/sessionManager.getEntries` |
| Build window 2+ | `<delta or not available>` | | | | | `<one row per additional completed window>` |
| Build phase total | `<sum completed build windows>` | | | | | `<build windows only>` |
| Review phase | `<sum completed review windows or not available>` | | | | | `<review windows only>` |
| Total measured PalSync run | `<build + review completed deltas or not available>` | | | | | `<no open windows>` |

Do not calculate a cache hit rate unless Pi provides an applicable run-bounded rate. Do not
estimate missing values.

### `palsync cost` output

```
<paste `palsync cost` output verbatim; it is PalSync mechanics telemetry, not a replacement for
the bounded Pi usage window above>
```

## Recommendations for palsync

1. **P0 — `<target file or tool>`** — `<what to change>`
2. **P1 — `<target file or tool>`** — `<what to change>`
3. **P2 — `<target file or tool>`** — `<what to change>`

## Fix tasks

- [ ] `<file>` — `<change>` — success condition: `<tool output or check>`
- [ ] `<file>` — `<change>` — success condition: `<tool output or check>`
