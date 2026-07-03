---
name: pal-init
description: "Onboard an EXISTING pal before changing it: map it into MAP.md, capture a regression baseline, interview scoped to the change, then hand off to pal-spec. Does not build or re-spec the whole pal. Triggers: 'work on an existing pal', 'add X to <pal>', 'fix/change something in <pal>', 'onboard this pal', or a pulled workspace with no MAP.md."
---

# pal-init — map an existing pal, then scope the change

An existing pal inverts pal-spec's blank slate: everything present is potentially load-bearing, so
the dominant risk is **breaking what works**, not building wrong. pal-init makes brownfield work
safe — map, baseline, scope, in that order — then hands the change to the normal pal-spec → pal-loop
→ pal-review pipeline.

**Two hard rules that define this skill:**
- **Map broad and shallow, not deep.** Inventory everything; deep-read only what a change touches —
  reconstructing existing code's full behavior is expensive, lossy, and invites hallucinated intent.
  The map is a shallow index; depth loads just-in-time.
- **Observed fact vs inferred purpose are different.** "This file exists / this dataset has these
  fields" is fact; "this looks like the dashboard" is inference — mark inference as such. What you
  genuinely can't tell from the code goes in Unknowns for the interview. Never invent intent.

---

## Step 1 — Pull & orient
1. Ensure the pal is pulled (`pal_pull` if needed). Run `pal_status` to confirm the local mirror
   matches the server; on drift, pull/merge first — you map the real current state.
2. Read `pal.json` (or the manifest) first — it indexes files, routes, and workflow types, telling
   you what to inventory before opening anything.

## Step 2 — Mine into MAP.md (the durable artifact)
Walk the pulled files and produce `MAP.md` (template below). Stay shallow: one line of purpose per
item, inferred-and-marked. Goal: an index you and every later session can navigate and trust, plus
the "what's dangerous to touch" picture. Do not deep-analyze workflows you won't change.

## Step 3 — Capture the regression baseline
Record what passes RIGHT NOW, before any change — the before-picture every later change is checked
against. Run the checks, then write a STRUCTURED artifact (not MAP.md prose) so pal-loop's regression
gate and pal-review's regression arm read it mechanically:
- `pal_validate` → current error/warning count (ideally 0; if not, note it — you inherited it).
- `pal_test` on the primary workflow(s) → current VALIDATED state.
- Web: `pal_preview`/`pal_fetch` that key pages render; note H1s/landmarks present.
- Visual: `pal_screenshot` the key screens (web, or console if capture succeeds). A viewport that
  times out (e.g. desktop, often an autoplay hero `<video>`) is NOT a baseline failure — record it
  `eyeball_only`, capture whichever viewport(s) DO succeed, and move on.

### `baseline/` — the structured artifact (workspace root, next to MAP.md; untouched by `pal_pull`)
```
baseline/
  baseline.json
  screenshots/<page>-<viewport>.png   # one per successfully captured viewport
```
`baseline.json` — this exact shape (both downstream gates parse it; do not rename fields):
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
Two fields are load-bearing for Phase 3 — get them exact, don't approximate:
- **`mapped`** — the pal's `lastModifiedDate` drift marker at capture: the SAME sql-timestamp string
  (`"yyyy-MM-dd HH:mm:ss.S"`, e.g. `"2026-06-12 17:29:25.0"`) that `pal_status` reports as its
  pull/server marker, NOT a human-readable date. It must diff directly against a live `pal_status`
  (server marker newer → baseline stale). Downstream gates run that check, not this skill — but it's
  useless to them unless it's this exact comparable value.
- **`known_issues`** — the inherited-vs-caused list, NOT empty on day one: seed it from what Step 2
  found broken (dead fragment references, stub/unfinished UI, invalid served markup, orphaned pages,
  any confirmed—not speculative—defect). An open question about INTENT goes in MAP.md's Unknowns
  instead; `known_issues` holds confirmed, observed defects only.

**Baseline-freshness rule (canonical — pal-loop's regression re-check and pal-review's regression
arm both enforce this):** before diffing anything against the baseline, compare `baseline.json`'s
`mapped` marker against a fresh `pal_status`. Server moved since `mapped` → the baseline is STALE:
set `needs-human` ("baseline is stale (server moved since `<mapped>`); re-run pal-init Step 3 to
refresh baseline/") and do NOT produce any pass/fail regression verdict against it. This skill owns
the definition; the downstream gates run the check.

MAP.md's Regression baseline section is just a short pointer to this artifact (template below): the
artifact is the source of truth, the prose a human-skimmable summary.

## Step 4 — Interview, scoped to the change
Do NOT re-interview the whole product. Ask only what's needed to scope THIS change, using the map and
Unknowns to target questions:
- What is the change (one sentence)? Which surfaces/workflows/datasets does it touch?
- What must NOT change / must keep working? (name the load-bearing files from the map)
- For Unknowns the change depends on, ask the user for the real intent — don't guess.
- New data or reuse existing datasets? (default: reuse — consumed/read-only per the map)

## Step 5 — Hand off to pal-spec (change-scoped)
Invoke pal-spec to produce SPEC.md + EXECUTION.md for the CHANGE, feeding it MAP.md as ground truth:
- Scope = the change only — SPEC covers what's changed/added, not the whole pal.
- Datasets the change reads go in §8b (CONSUMED, read-only) from the map — not §8a.
- §6 layout and new UI must MATCH the map's discovered conventions + design reality (reuse before
  building — run design-system-init in EXTRACT mode against the map if no DESIGN_SYSTEM.md exists).
- §11 NEVER list is seeded from the map's Load-bearing/shared files + "must not change" answers.
- §12 acceptance MUST add a REGRESSION criterion: the baseline (Step 3) still passes and untouched UI
  didn't shift — the brownfield addition to the normal acceptance floor.
Then the normal pipeline: pal-spec gate → pal-loop build (brownfield discipline) → pal-review
(regression arm) → PASS.

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
- See `baseline/baseline.json` — validate/test/H1/screenshot state + known_issues, structured for
  pal-loop's regression gate and pal-review's regression arm. Last captured: <date> (marker
  <baseline.json's `mapped`>).
- Summary: <N errors/warnings>, <workflow> <VALIDATED/notes>, <M pages> captured (<K eyeball-only>).

## Unknowns (can't tell from code — ask the user)
- <intent/behavior that isn't inferable> — <why it matters for the change>
```

---

## Freshness & reuse
- MAP.md is **durable, updatable context** — a reference the whole pipeline reads, NOT rebuilt every
  session. Regenerate/update only when `pal_status` shows the server moved since `mapped`, or when a
  build changes the inventory (new page/dataset → update the relevant map rows in the same session).
- Later sessions and pal-loop read MAP.md to know what exists and what's dangerous — same
  progressive-disclosure discipline as skills: the map is the shallow index, files load deep only
  when a task touches them.

## What this skill does NOT do
- Does not reconstruct a full spec of the pal — only maps it and scopes the change. The map is a
  hypothesis about existing behavior, not approved ground truth; the change-spec is.
- Does not build anything — pal-spec specs the change, pal-loop builds it, pal-review verifies
  (including regression).
- Does not invent intent — inferences are marked, genuine gaps go to Unknowns for the human.
- For a brand-new pal, it steps aside: use pal-spec directly.
