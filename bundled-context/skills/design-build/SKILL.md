---
name: design-build
description: "Load for visible UI implementation or UI review. Enforces an existing design system; use design-system-init first when one is absent."
---

# Design Build

Use for visible UI implementation or review. Do not load for non-visible backend work.
Build from the local design system, not a generic aesthetic. First-pass output is a draft;
structure, states, and visual evidence make it shippable.

## UI task contract

For every visible task:

1. **Classify** the surface: marketing, CRUD/admin, dashboard/data, or form flow.
2. **Brief** in six lines before code: user; primary job; primary action; information order;
   density; one deliberate visual idea. Put this in the task/checkpoint for a tiny edit.
3. **Select recipes, then build.** Marketing communicates audience, outcome, proof, and next
   action; operational UI makes the next decision or action fast. Read `marketing-library.md`
   only for marketing and `component-library.md` for operational UI; do not blend profiles.
4. **Close the loop.** Implement default plus applicable loading, empty, error, and success
   states; run functional checks; render desktop and mobile; inspect pixels and `designAudit`;
   fix the highest-impact failures; rerender every changed viewport; rerun behavior after visual
   edits.
5. **Keep the best checkpoint.** Compare the final render to the last clean render; do not ship a
   visual regression.

Hard completion gates — a visible task is not done unless:

- The primary journey works end to end with no runtime/render error.
- Desktop and mobile have no unintended horizontal overflow.
- Labels, visible keyboard focus, and usable action targets pass the applicable checks.
- Applicable empty, error, success, and destructive states are understandable.
- There is exactly one page-level H1 and one primary action per action group.
- Both screenshots were inspected and `designAudit.errors == 0`.

## Step 0 — Load the system

1. Read `DESIGN_SYSTEM.md` and `COMPONENTS.md`, then inspect visual references in `design/refs/`
   when present. References are the primary design authority: read the images, build toward their
   composition and restraint, and let a reference beat a default choice.
2. If the system is absent for non-trivial work, recommend `design-system-init`. If the user
   proceeds, infer a minimal system from existing code and state the assumptions.
3. Read `../shared/references/css-conventions.md`, then
   `../design-system-init/references/design-principles.md` for hierarchy, grouping, target sizing,
   typography, and responsive/accessibility guidance.
4. Read `../design-system-init/references/component-library.md` for operational UI or
   `../design-system-init/references/marketing-library.md` for marketing. Select a deliberate
   recipe before styling; use the local component inventory before creating a variant.
5. For PalBuilder markup, fragments, JEXL, or unfamiliar `c:` attributes, load
   `../palbuilder-frontend/SKILL.md` and `../palbuilder-frontend/references/c-tags.md`.

`design-system.css` is a **reference-only** parts catalog. Put only the selected, dependency-complete
rules needed by current markup in pal-owned `styles/styles.css`; never copy, register, link, load, or
ship `design-system.css` as runtime code. The libraries own exact recipes, resource/font/icon/motion
rules, and catalog-selection details.

## Vision routing

Steps 0 and 4 require pixels, not filenames or source guesses. If the executing model cannot inspect
images, route reference reading and rendered-output critique to a vision-capable model; follow
`../design-system-init/references/vision-routing.md`.

## Step 1 — Decompose before building

Plan structure before code: map primitives → composites → layout shells to `COMPONENTS.md`; define
interfaces and state ownership; reuse rather than fork near-duplicates. For non-trivial work, state
the component breakdown before producing a wall of code. Read `design-principles.md` for the user
journey, attention order, progressive disclosure, and grouping decisions.

## Step 2 — Build to tokens and recipes

Use semantic tokens; when the system lacks a needed value, add a named token rather than hardcoding
one. Copy the selected library recipe and only its needed dependencies into `styles/styles.css`.
Read the applicable library for component inventory and recipes; read `design-principles.md` for
hierarchy, density, and layout posture.

## Step 3 — Implement applicable states

Implement the full applicable state set for each element, not only resting: focusable controls need
visible `focus-visible`; data and async surfaces need the applicable loading, empty, error, success,
permission, and destructive states. Read `design-principles.md` and the selected library for state,
motion, reduced-motion, accessibility, form, and table details.

## Step 4 — Review gate

Treat the first output as a junior draft. Render first: capture desktop and mobile, inspect
`designAudit`, then inspect pixels. Fix high-impact failures, rerender every changed viewport, and
rerun functional checks. Score the final render with
`../shared/references/visual-rubric.md`; cite screenshot evidence. Fix failures or explicitly state
why they remain, and report changes.

Read, when triggered:

- `../shared/references/console-chrome-exception.md` for platform chrome or platform-injected
  findings outside `#cp-root`; only its evidence-gated exceptions are allowed.
- `../design-system-init/references/design-principles.md` and the selected library for system,
  structure, interaction, responsive, and accessibility review.
- `../shared/references/anti-slop.md` for generic-output fingerprints and their remedies.
- `../palbuilder-frontend/SKILL.md` and `c-tags.md` for PalBuilder markup constraints. For data-table
  action cells, use `.pb-row-actions` and render only actions valid for the row's current state;
  conflicting transitions must be mutually exclusive.

## Polish vocabulary

Turn vague feedback into an operation:

- Density too low → tighten list-item padding to the next spacing step.
- Muted text lacks contrast → move it one text-token step stronger.
- Hierarchy is flat → increase the heading/body size jump before adding weight.
- Motion jars → use the standard duration token and ease-out.
- Spacing rhythm is irregular → snap gaps to the scale.

## Acceptance

Before handoff, confirm the system, component inventory, and visual references were loaded; the
reference catalog was not shipped; the review gate ran with justified exceptions only; and desktop
and mobile captures were rechecked after fixes with `designAudit.errors == 0`. Then run every item in
`../shared/references/ui-acceptance.md`.
