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
**Build usage window:** `<pal_stats build phase row or not available>`
**Review usage window:** `<pal_stats review phase row or not available>`
**Build model:** `<exact model id>` (effort `<reasoning effort>`)
**QA/report model:** `<exact model id>` if different from build model
**Run mode:** `<spec mode>` / `<run mode>`
**Policy:** verification `<fast | standard | thorough>` / final review `<off | ask | auto>`

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
- **Classification:** `<Pal defect | PalSync defect | Evidence/measurement gap>`
- **PalSync recommendation:** `<required only for a systemic PalSync defect or evidence/measurement gap>`

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

Take every number in this section from ONE `pal_stats` read (`palsync stats` outside an MCP
harness), taken after the bounded build/review phase closed — otherwise label the numbers
live/in-progress. Do not open `.palsync/run-usage.json`, `.palsync/session-cost.json`,
`.palsync/pi-usage.jsonl`, `.palsync.usage.json`, or any other telemetry file, and do not run
other reporting commands. Never substitute the current Pi footer or `/info` totals: those are
cumulative across the session and branch history. Whatever `pal_stats` marks unavailable is
`not available` — do not estimate usage, cost, or cache hit rate.

### Model usage — `pal_stats` MODEL USAGE block

Report the `source` and quality label `pal_stats` prints. The session row is the live
whole-session Pi total; the `build`/`review` rows are bounded PalSync phase windows, not the
whole Pi conversation.

**Source/quality label:** `<verbatim pal_stats MODEL USAGE header, e.g. [exact · pi/sessionManager.getEntries (live)] or [unavailable]>`

| Row | Input | Cache read | Output | Cache write | Cost | Scope |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Session total (live) | `<value or not available>` | | | | | `<pal_stats scope label — whole session, not run-bounded>` |
| Build phase | `<pal_stats build row or not available>` | | | | | `<n window(s)>` bounded build |
| Review phase | `<pal_stats review row or not available>` | | | | | `<n window(s)>` bounded review |
| Total measured PalSync run | `<build + review phase rows, or not available>` | | | | | bounded build + review only |

Do not calculate a cache hit rate unless `pal_stats` reports one.

### PalSync mechanics telemetry — `pal_stats` PALSYNC TOOLS and CONTEXT blocks

- **Tools:** `<calls, raw → returned bytes, est. tokens, cache rows, or not available>`
- **Context:** `<eager bytes, stable prefix / dynamic tail, generations, threshold, or not available>`

These are PalSync mechanics telemetry. They are separate from the model usage above and never
replace it.

### `pal_stats` output

```
<paste the single pal_stats report verbatim>
```

## Recommendations for palsync

1. **P0 — `<target file or tool>`** — `<what to change>`
2. **P1 — `<target file or tool>`** — `<what to change>`
3. **P2 — `<target file or tool>`** — `<what to change>`

## Fix tasks

- [ ] `<file>` — `<change>` — success condition: `<tool output or check>`
- [ ] `<file>` — `<change>` — success condition: `<tool output or check>`
