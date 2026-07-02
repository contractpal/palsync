---
name: pal-init
description: >
  Onboard palsync into an EXISTING pal before doing any work in it. Mines the pulled codebase into
  a durable MAP.md (what exists, the conventions, the load-bearing files, the datasets as they are,
  the current design), captures a regression baseline (what passes right now), then interviews the
  user SCOPED TO THE CHANGE and hands off to pal-spec to produce a change-scoped SPEC.md +
  EXECUTION.md. Use this when the user says "work on an existing pal", "add X to <existing pal>",
  "fix/change something in <pal>", "onboard this pal", or when a pulled workspace has no MAP.md.
  It does NOT reconstruct a full spec of the whole pal, and it does not build — pal-spec specs the
  change, pal-loop builds it. For brand-new pals from scratch, use pal-spec directly instead.
---

# pal-init — map an existing pal, then scope the change

pal-spec assumes a blank slate. An existing pal is the opposite problem: everything already there
is potentially load-bearing, so the dominant risk is **breaking what works**, not building wrong.
pal-init exists to make brownfield work safe. It does three things, in order — map, baseline,
scope — then hands the actual change to the normal pal-spec → pal-loop → pal-review pipeline.

**Two hard rules that define this skill:**
- **Map broad and shallow, not deep.** Inventory everything; deep-read only what a change touches.
  Reconstructing the full behavior of code someone already wrote is expensive, lossy, and invites
  hallucinated intent. The map is a shallow index; depth is loaded just-in-time at change time.
- **Observed fact vs inferred purpose are different.** "This file exists / this dataset has these
  fields" is fact. "This looks like the dashboard" is inference — mark it as such. Anything you
  genuinely can't tell from the code goes in Unknowns for the interview. Never invent intent.

---

## Step 1 — Pull & orient
1. Ensure the pal is pulled to the workspace (`pal_pull` if needed). `pal_status` to confirm the
   local mirror matches the server; if drift, pull/merge first — you map the real current state.
2. Read `pal.json` (or the pal's manifest) first — it's the index of files, routes, and workflow
   types. It tells you what to inventory before you open anything.

## Step 2 — Mine into MAP.md (the durable artifact)
Walk the pulled files and produce `MAP.md` (template below). Stay shallow: one line of purpose per
item, inferred-and-marked. The goal is an index you (and every later session) can navigate and
trust, plus the "what's dangerous to touch" picture. Do not deep-analyze workflows you won't change.

## Step 3 — Capture the regression baseline
Record what passes RIGHT NOW, before anything changes — this is the before-picture every later
change is checked against. Run the checks, then write the result as a STRUCTURED artifact (not
just MAP.md prose) so pal-loop's regression gate and pal-review's regression arm can read it
mechanically:
- `pal_validate` → current error/warning count (ideally 0; if not, note it — you inherited it).
- `pal_test` on the primary workflow(s) → current VALIDATED state.
- Web: `pal_preview`/`pal_fetch` the key pages render; note the H1s/landmarks present.
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
Two fields load-bearing for Phase 3 (get them exactly right, don't approximate):
- **`mapped`** is the pal's `lastModifiedDate` drift marker at the moment of capture — the SAME
  sql-timestamp string (`"yyyy-MM-dd HH:mm:ss.S"`) `pal_status` reports as the pull marker / server
  marker, e.g. `"2026-06-12 17:29:25.0"`. NOT a human-readable date — it must be diffable directly
  against a live `pal_status` call (server marker newer than this → the baseline is stale; that
  check belongs to the downstream gates, not to this skill, but the field is useless to them if
  it's not this exact comparable value).
- **`known_issues`** is the inherited-vs-caused list, and it is NOT an empty array on day one —
  seed it from whatever Step 2's mining already found broken: dead fragment references, stub/
  unfinished UI, invalid served markup, orphaned pages, anything you'd otherwise have written under
  MAP.md's Load-bearing section as a confirmed (not speculative) defect. A genuinely open question
  about INTENT still goes in MAP.md's Unknowns for the interview — `known_issues` is for confirmed,
  observed defects only.

MAP.md's Regression baseline section becomes a short pointer to this artifact (template below) —
the artifact is the source of truth; the prose is a human-skimmable summary of it.

## Step 4 — Interview, scoped to the change
Do NOT re-interview the whole product. Ask only what's needed to scope THIS change, using the map
and Unknowns to target questions:
- What is the change (one sentence)? Which surfaces/workflows/datasets does it touch?
- What must NOT change / must keep working? (name the load-bearing files from the map)
- For anything in Unknowns that the change depends on, ask the user for the real intent — don't guess.
- New data or reuse existing datasets? (default: reuse — consumed/read-only per the map)

## Step 5 — Hand off to pal-spec (change-scoped)
Invoke pal-spec to produce SPEC.md + EXECUTION.md for the CHANGE, feeding it MAP.md as ground truth:
- The change is the scope — SPEC covers only what's being changed/added, not the whole pal.
- Existing datasets the change reads go in §8b (CONSUMED, read-only) sourced from the map — not §8a.
- §6 layout and any new UI must MATCH the discovered conventions + design reality in the map
  (reuse before building — run design-system-init in EXTRACT mode against the map if a
  DESIGN_SYSTEM.md doesn't already exist).
- §11 NEVER list is seeded from the map's Load-bearing/shared files + "must not change" answers.
- §12 acceptance MUST include a REGRESSION criterion: the baseline (Step 3) still passes and the
  untouched UI didn't shift. This is the brownfield addition to the normal acceptance floor.
Then the normal pipeline runs: pal-spec gate → pal-loop build (brownfield discipline) → pal-review
(with its regression arm) → PASS.

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
- MAP.md is **durable, updatable context** — the brownfield equivalent of a reference the whole
  pipeline reads. It is NOT rebuilt every session. Regenerate/update only when `pal_status` shows
  the server moved since `mapped`, or when a build changes the inventory (a new page/dataset →
  update the relevant map rows in the same session that added them).
- Later sessions and pal-loop read MAP.md to know what exists and what's dangerous — the same
  progressive-disclosure discipline as skills: the map is the shallow index, files are loaded deep
  only when a task touches them.

## What this skill does NOT do
- It does not reconstruct a full spec of the existing pal — only maps it and scopes the change.
  The map is a hypothesis about existing behavior, not approved ground truth; the change-spec is.
- It does not build anything — pal-spec specs the change, pal-loop builds it, pal-review verifies
  (including regression).
- It does not invent intent — inferences are marked, genuine gaps go to Unknowns for the human.
- For a brand-new pal, it steps aside: use pal-spec directly.
