---
name: pal-init
description: "Onboards an existing pal into MAP.md and a regression baseline before handoff to pal-spec. Triggers: 'work on an existing pal', 'add X to <pal>', 'fix/change something in <pal>', 'onboard this pal', or a pulled workspace with no MAP.md. Does not build or re-spec the whole pal."
---

# pal-init — map an existing pal, then scope the change

In an existing pal the dominant risk is **breaking what works**, not building wrong. pal-init
makes brownfield work safe — map, baseline, scope, in that order — then hands the change to the
normal pal-spec → pal-loop → pal-review pipeline.

**Two hard rules:**
- **Map broad and shallow, not deep.** Inventory everything; deep-read only what the change
  touches. The map is a shallow index; depth loads just-in-time.
- **Fact vs inference are different.** "This dataset has these fields" is fact; "this looks
  like the dashboard" is inference — mark inference as such. What you can't tell from the code
  goes in Unknowns for the interview. Never invent intent.

---

## Step 1 — Pull & orient
1. `pal_status`. Server newer than local → `pal_pull` (or `pal_merge`) first — map the real
   current state.
2. Read `pal.json` first — it indexes files, routes, and workflow types, telling you what to
   inventory before opening anything.

## Step 2 — Mine into MAP.md
Walk the pulled files and write `MAP.md` (template below) at the workspace root. One line of
purpose per item, inferences marked. Do not deep-analyze workflows you won't change.

## Step 3 — Capture the regression baseline
Record what passes RIGHT NOW, before any change. Run the checks, then write a STRUCTURED
artifact so `pal_regression` (used by pal-loop and pal-review) can read it mechanically:
- `pal_validate` → current `diagnosticCount` and diagnostics (`ok:false` → note it; you inherited it).
- `pal_test` on the primary workflow(s) → current VALIDATED state.
- Web: `pal_fetch`/`pal_preview` on key pages → note H1s present.
- `pal_screenshot` the key screens (web, or console if capture succeeds). A viewport that
  times out (e.g. desktop with an autoplay hero `<video>`) is NOT a failure — record it
  `eyeball_only`, capture the viewport(s) that DO succeed, move on.

### `baseline/` — the structured artifact (workspace root, next to MAP.md; pull never touches it)
```
baseline/
  baseline.json
  screenshots/<page>-<viewport>.png   # one per successfully captured viewport
```
`baseline.json` — this exact shape (`pal_regression` parses it; do not rename fields):
```json
{
  "mapped": "2026-06-12 17:29:25.0",
  "validate": { "errors": 0, "warnings": 0 },
  "test": { "web": { "status": "VALIDATED", "notes": 0 } },
  "pages": {
    "home.html": {
      "h1s": ["Custom Concrete Coatings in Utah."],
      "viewports": {
        "mobile":  { "captured": true, "screenshot": "screenshots/home.html-mobile.png" },
        "desktop": { "captured": false, "reason": "timeout", "eyeball_only": true }
      }
    }
  },
  "known_issues": [
    "schemas/home.js ships literal // comments inside JSON-LD (invalid, served live)",
    "secondary/color-samples/sample-modal.html is a hardcoded stub, not wired to the clicked sample"
  ]
}
```
Two fields are load-bearing — get them exact:
- **`mapped`** — the SAME sql-timestamp string `pal_status` reports as its pull/server marker
  (`"yyyy-MM-dd HH:mm:ss.S"`), NOT a human-readable date. `pal_regression` diffs it against a
  live `pal_status` to detect a stale baseline.
- **`known_issues`** — confirmed, observed defects found in Step 2 (dead fragment refs, stub
  UI, invalid served markup) — NOT empty on day one, NOT speculation. Open INTENT questions go
  to MAP.md Unknowns instead.

**Baseline-freshness rule (canonical):** before any comparison against the baseline, check
`mapped` against a fresh `pal_status`. Server moved since `mapped` → the baseline is STALE:
set `needs-human` ("baseline is stale; re-run pal-init Step 3 to refresh baseline/") and
produce NO pass/fail regression verdict. `pal_regression` runs this gate automatically and
returns `{stale}`; this skill owns the definition.

## Step 4 — Interview, scoped to the change
Do NOT re-interview the whole product. Using the map and its Unknowns:
- What is the change (one sentence)? Which surfaces/workflows/datasets does it touch?
- What must NOT change / must keep working? (name the load-bearing files from the map)
- For Unknowns the change depends on, ask the user for real intent — don't guess.
- New data or reuse existing datasets? (default: reuse — consumed/read-only per the map)

## Step 5 — Hand off to pal-spec (change-scoped)
Invoke pal-spec to produce SPEC.md + EXECUTION.md for the CHANGE, feeding it MAP.md as ground
truth:
- Scope = the change only, not the whole pal.
- Datasets the change READS go in §8b (CONSUMED, read-only) from the map — not §8a.
- §6 layout and new UI must MATCH the map's discovered conventions (reuse before building —
  run design-system-init in EXTRACT mode against the map if no DESIGN_SYSTEM.md exists).
- §11 NEVER list seeded from the map's Load-bearing files + "must not change" answers.
- §12 acceptance MUST add a REGRESSION criterion: the Step-3 baseline still passes and
  untouched UI didn't shift.

### Existing-pal verification floor (required in EXECUTION.md)
pal-init does not build, but its handoff must force the same gates pal-loop uses. The
change-scoped EXECUTION.md must include verification tasks/criteria for:
- `pal_validate` before push — `ok:true`, or no new diagnostics; inherited warnings/errors stay documented.
- `pal_push` after validation — no force/bypass flags unless the user explicitly approves a
  drift or lock decision.
- `pal_sync_datasets` if the approved change creates or alters dataset definitions (safe sync
  by default; `recreate` is data-destructive and needs typed confirmation).
- `pal_test` for every changed primary workflow — server VALIDATED, with notes triaged.
- Render proof for every touched surface: WEB uses `pal_fetch`/`pal_preview` with `expect`;
  console/transaction uses `pal_screenshot` when available, otherwise the canonical human
  eyeball gate from `../pal-review/references/console-render-verification.md`.
- `pal_exercise` for create/edit/delete/action behavior — assert the new/correct value with
  `expect` and the old/wrong value with `absent` where applicable.
- `pal_regression` against `baseline/baseline.json`; if stale, stop and refresh Step 3 before
  claiming the existing-pal regression result.

Then the normal pipeline: pal-spec gate → pal-loop build → pal-review (regression arm) → PASS.

---

## MAP.md template

```markdown
# MAP — <pal name>
pal: <name> (<web | console>) · guid: <guid>
mapped: <date> · palsync: <version> · source: pulled mirror @ <pull stamp>
freshness: regenerate or update if pal_status shows the server moved since `mapped` above.

## Overview
<1-3 sentences: what this pal appears to be, its primary surfaces. Inferred — mark uncertainty.>

## Inventory (broad + shallow — one line each)
### Pages (page-shells)
| file | route | purpose (inferred) |
### Fragments
| file | renders | loaded by (which pages/fragments) |   <!-- loaded-by = blast radius -->
### Workflows
| name | type (console 7 / web / job 11) | entry actions | purpose (inferred) |
### Datasets (as they exist)
| name | key + fields (with types) | written by | read by |   <!-- the real schema, not a guess -->
### DataLists (datalists/ — JSON passthrough, not a table)
| name | purpose (inferred) | used by |
### DataViews / cubes / cache (if any)
| name | kind | over which datasets | used by |
### Loaded libraries (c:resource)
<bootstrap x.y, jquery, chartjs, ... — only what's actually loaded>

## Conventions (discovered — what new work must match)
- Naming: <file/workflow/dataset naming patterns observed>
- Structure: <how pages/fragments are organized; shared shell pattern>
- CSS: <class conventions in use — reuse these, don't invent>
- Patterns: <error/feedback handling, common idioms seen>

## Load-bearing / shared / high-blast-radius (edit with care)
- <file/dataset> — depended on by <what> — <why touching it is risky>
<!-- this is the "don't break it" map; seeds SPEC.md §11 NEVER -->

## Design reality (observed, for design-system-init extract)
- Fonts / colors / spacing / components actually in use: <...>   <!-- observed, not declared -->

## Regression baseline (before-picture; Step 3)
- See `baseline/baseline.json` — validate/test/H1/screenshot state + known_issues, structured
  for pal_regression. Last captured: <date> (marker <baseline.json's `mapped`>).
- Summary: <N errors/warnings>, <workflow> <VALIDATED/notes>, <M pages> captured (<K eyeball-only>).

## Unknowns (can't tell from code — ask the user)
- <intent/behavior that isn't inferable> — <why it matters for the change>
```

---

## Freshness & reuse
- MAP.md is durable context the whole pipeline reads, NOT rebuilt every session. Regenerate or
  update only when `pal_status` shows the server moved since `mapped`, or when a build changes
  the inventory (new page/dataset → update the relevant rows in the same session).

## What this skill does NOT do
- Does not reconstruct a full spec of the pal — the map is a hypothesis about existing
  behavior; the change-spec is the approved ground truth.
- Does not build anything — pal-spec specs the change, pal-loop builds, pal-review verifies.
- Does not invent intent — inferences are marked; genuine gaps go to Unknowns.
- For a brand-new pal, step aside: use pal-spec directly.
