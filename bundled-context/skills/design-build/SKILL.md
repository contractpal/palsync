---
name: design-build
description: "Load for visible UI implementation or UI review. Enforces an existing design system; use design-system-init first when one is absent."
---

# Design Build

Use for visible UI implementation or review, not non-visible backend work. Build from the local
design system, not a generic aesthetic. The first pass is a draft: make the first design decision
from the user job and, for a meaningful new surface, a small targeted UX lookup; then prove it in
the existing render-and-revise loop. Verification breadth comes from
`../shared/references/verification.md`; this skill does not add a proof ladder.

## Workflow

1. **Understand and classify.** Before code, name the user, current state, screen job, primary
action, information order, density, and one deliberate visual idea. Classify the surface as
marketing, CRUD/admin, dashboard/data, or form flow. Marketing communicates audience, outcome,
proof, and next action; operational UI makes the next decision or action fast. Do not blend them.

2. **Research only a new or substantially changed surface.** Before its first markup or CSS, read
`../design-system-init/references/research-brief.md` only at **Light Targeted UX Lookup** and follow it:
perform exactly one targeted UX research/search pass derived from this interface, then checkpoint
only 3–5 practical findings. Skip it for a routine visual/UI edit. Do not research again for the
same surface unless its job or interface type materially changes.

3. **Load the local authority and recipes.** Read `DESIGN_SYSTEM.md`, `COMPONENTS.md`, and
`design/refs/` when present; they are the project design authority. If no system exists for
non-trivial work, recommend `design-system-init`; if work proceeds, record minimal assumptions.
Read `../shared/references/css-conventions.md`, then
`../design-system-init/references/design-principles.md`. Select the relevant recipe from
`component-library.md` for operational UI or `marketing-library.md` for marketing before styling;
use the local inventory before creating a variant. For PalBuilder markup, fragments, JEXL, or
unfamiliar `c:` attributes, also load `../palbuilder-frontend/SKILL.md` and
`../palbuilder-frontend/references/c-tags.md`.

4. **Structure, then build.** Map primitives, composites, and layout shells to `COMPONENTS.md`;
reuse rather than fork near-duplicates. For non-trivial work, state the component breakdown before
a wall of code. Use the selected recipe, semantic tokens, and real-length content. Implement default
plus applicable loading, empty, error, success, permission, and destructive states; preserve responsive
and accessible behavior from `design-principles.md`.

5. **Render, inspect, revise.** Treat the first output as a junior draft. Run functional checks when
behavior changed. Render only the viewport(s) the active verification policy calls for; inspect
pixels and `designAudit`; fix the highest-impact failures; rerender a changed viewport after
changing it and rerun behavior after functional edits. Keep the best checkpoint: do not ship a
visual regression. Score rendered work with `../shared/references/visual-rubric.md`, and run
`../shared/references/ui-acceptance.md` before handoff.

`design-system.css` is a **reference-only** parts catalog. Extract only needed rules for current
markup into pal-owned `styles/styles.css`; never copy,
register, link, load, or ship `design-system.css` as runtime code.

## Vision and review contracts

Reference study and render critique require pixels, not filenames or source guesses. If the
executing model cannot inspect images, route only those steps to a vision-capable model under
`../design-system-init/references/vision-routing.md`.

At review, use `design-principles.md`, the selected recipe, and
`../shared/references/anti-slop.md` for hierarchy, grouping, states, responsive/accessibility, and
anti-slop checks. Use `../shared/references/console-chrome-exception.md` only for evidence-gated
platform chrome or platform-injected findings outside `#cp-root`. For data-table action cells, use
`.pb-row-actions`, render only actions valid for the row's current state, and make conflicting
transitions mutually exclusive.

## Completion

A visible task is complete only when the changed primary journey works without runtime/render error;
required viewports have no unintended horizontal overflow; labels, keyboard focus, action targets,
and applicable states are understandable; there is one page-level H1 and one primary action per
action group; every required screenshot was inspected with
`designAudit.errors == 0`; and the visual-rubric gate is met. Confirm the system, inventory, and
visual references were loaded, and the reference catalog was not shipped.
