---
name: design-build
description: "Enforce an established design system while building or reviewing UI, and self-critique the result before calling it done — for any frontend construction in a project with a DESIGN_SYSTEM.md. Pairs with design-system-init. Triggers: 'build this screen', 'make this component', 'implement the design', 'review this UI', or any interface work."
---

# Design Build

Build UI that conforms to the design system, decomposes cleanly, defines its interaction states, and passes review before shipping. First-pass AI output is mediocre; quality comes from up-front architecture and end self-critique.

## UI task contract — use this before the long reference material

Weak models do better with a small executable contract than with vague requests to "make it
modern." For every visible task:

1. **Classify** the surface: marketing, CRUD/admin, dashboard/data, or form flow.
2. **Brief** it in six lines before code: user; primary job; primary action; information order;
   density; one deliberate visual idea. This can live in the task/checkpoint; do not create a new
   artifact for a tiny edit.
3. **Select recipes**, then build. Load `marketing-library.md` only for marketing; load
   `component-library.md` for operational UI. Do not blend both visual profiles.
4. **Close the loop**: implement default + applicable loading/empty/error/success states; run the
   functional checks; capture desktop and mobile; inspect pixels plus `designAudit`; fix the three
   highest-impact failures; capture the changed viewport again; re-run behavior after visual edits.
5. **Keep the best checkpoint.** A functional fix can damage layout. Compare the final render to
   the last clean render and do not ship a visual regression.

Hard gates — any failure means the visible task is not done:
- Primary journey works end to end; no runtime/render error.
- No unintended horizontal overflow at desktop or mobile.
- Inputs have visible associated labels; keyboard focus is visible; action targets are usable.
- Applicable empty/error/success/destructive states are present and understandable.
- Exactly one page-level H1 and one primary action per action group.
- Both desktop and mobile screenshots were actually inspected; `designAudit.errors` is zero.

### Archetype profile

| | Marketing | CRUD/admin and data tools |
|---|---|---|
| First job | Communicate audience, outcome, proof, next action | Make the next operational decision/action fast |
| Type scale | Fluid display H1, usually 48-72px desktop | Product H1, usually 28-40px; never hero scale |
| Density | Spacious but every blank area must pace or group content | Productive; controls about 40-44px and rows about 44-52px |
| Composition | Vary by content: split, process, proof, comparison, editorial | Header/action -> filters -> data; bounded single-column forms by default |
| Actions | One clear CTA + quieter secondary | Save primary + Cancel secondary; destructive action separated |
| Avoid | Floating pill nav, giant empty hero, three-card-only page, repeated dark CTA slabs | Bare controls, inline labels, raw action links, giant headings, sparse cards |

## Step 0 — Load the system

- Read `DESIGN_SYSTEM.md` and `COMPONENTS.md`. If absent and the task is non-trivial, recommend `design-system-init` first — building without a system drifts to generic output. If the user proceeds anyway, infer a minimal system from existing code and state your assumptions.
- Look at `design/refs/` if present. Read the images, not just tokens — they encode composition and restraint tokens can't. **When references exist they are the primary design authority — the inspiration above all else.** Build toward how they look and feel; where a reference and a default choice disagree, the reference wins. Honor it within the byte-identity contract below: reference-driven appearance deviations go through readable `styles/styles.css` overrides, with a preset plus `PAL OVERRIDES` tokens where sufficient, never by hand-editing a canonical file or flattening the reference back to a default.
- **Verify the four canonical files are byte-identical to this skill's references** (an append-only
  `PAL OVERRIDES` block at the end of `design-system.css` is the one allowed exception):
  `styles/spacing.css`, `styles/design-system.css` against
  `../design-system-init/references/{spacing.css,design-system.css}`, and `scripts/pb-ui.js`,
  `scripts/pb-motion.js` against `../design-system-init/references/{pb-ui.js,pb-motion.js}`. A diff
  outside the overrides block means the file was hand-edited — restore it from the reference and
  move the intended change into `PAL OVERRIDES` instead.
- Verify page shell `<head>` link/script order matches design-system-init's checklist:
  `styles/spacing.css` → `styles/design-system.css` → `styles/styles.css` for new pals, then
  `scripts/pb-ui.js` and `scripts/pb-motion.js` each loaded exactly
  once as `<script type="module" src="...">`. `spacing.css` is the required Bootstrap replacement
  for spacing/layout utilities; do not add Bootstrap only to get `.container`, `.row`, `.col-*`,
  margin, padding, gap, or flex helpers.
- Fontshare loads through the `@import` at the top of `design-system.css`; never add remote
  page-head font resources.
- For non-trivial UI, read `../design-system-init/references/design-principles.md` before building
  or reviewing. It is the practical checklist for hierarchy, UX flow, Gestalt grouping, Fitts target
  sizing, typography, color meaning, consistency, and simplicity.
- For Palbuilder UI, read `../design-system-init/references/component-library.md` before implementing any non-trivial app/console component, or `../design-system-init/references/marketing-library.md` for marketing sections (hero, bento, pricing, testimonials, logo cloud, CTA, stats, mockups). Both are HTML-only — every class and `data-*` attribute is already implemented in the shipped CSS/JS, there is no component CSS to write. Pair either with `palbuilder-frontend/references/c-tags.md` before using any `c:` attribute you have not verified.
- Enforce the current palsync visual stack unless the project explicitly overrides it: system or Fontshare typography, inline SVG icons from one approved family (Iconoir, Tabler, or Phosphor), and `scripts/pb-motion.js` data attributes for scripted animation — no other motion library.
- Chart.js is optional and only for chart-heavy pals: platform `<c:resource source="chartjs"
  version="4.0.0" name="chart.js" />` plus opt-in `scripts/pb-charts.js`; it is not part of the
  core four-file byte-identity set.

## Vision routing

Reading `design/refs/` (Step 0) and critiquing rendered output (Step 4) require *seeing* pixels; the review gate is only meaningful against a rendered screenshot, not source. If the executing model can't accept images, route those steps to a vision-capable model and act on its findings. Canonical protocol: **read `../design-system-init/references/vision-routing.md`**.

## Step 1 — Decompose before you build

Plan structure first — one giant file is the top driver of AI-looking, unmaintainable UI.

- Break the target into atomic units mapped to `COMPONENTS.md`: primitives (Button, Input, Card...) → composites (form row, list item, nav) → layout shells. Units map to functions, classes, partials, or components — any stack.
- Define each unit's interface before implementing: what it receives, its variants, what it renders. Decide where state lives; keep presentational units free of business logic.
- Reuse before you create — don't fork a near-duplicate (a slop tell).
- For non-trivial work, state the component breakdown before generating a wall of code, so a wrong structure is caught cheaply.

## Step 2 — Build to the tokens

- Consume semantic tokens; never use arbitrary raw values (hex codes, off-scale spacing, one-off font sizes) when a token exists.
- Pull the component recipe you need from the appropriate library. When a reference requires a
  different component look, override it in the new pal's `styles/styles.css` using human-readable
  blocks, comments where useful, and one rule per block; do not edit canonical files. Existing pals
  without `styles.css` are not migrated.
- If the design needs a value the system lacks, add it as a named token, don't hardcode inline — the system stays the source of truth.
- Get hierarchy from the system's stated mechanism — often spacing and size before weight, weight before color. A new accent color for emphasis usually means the spacing is wrong.
- Honor the stated density and layout posture. If the system says airy, generous whitespace is the design; if it says break the grid, do so deliberately — uniform even spacing reads as templated.
- Use the project's component inventory first. If no local component exists, adapt the closest recipe from `component-library.md` and record it in `COMPONENTS.md` when it becomes reusable.
- If the screen needs a common modern primitive, do not improvise it from a bare card. Check for button group, dropdown/menu, drawer, command palette, combobox, accordion, segmented control, date picker, data-grid affordance, kanban, comments, attachments, code block, metrics panel, or review checklist recipes first.
- Build the hierarchy path explicitly: title/object/status/first decision/primary action/feedback/next step. If those are not visible at a glance, fix composition before polishing color or shadows.

## Step 3 — Define every interaction state

Unstated states are where AI output gives itself away — implement the full applicable set per element, not just resting:

- **default, hover, focus-visible, active, disabled** — always, for anything clickable or focusable.
- **loading, error, empty** — wherever data or async work is involved; empty states are routinely skipped and routinely matter.
- Transitions restrained and consistent (one duration scale, purposeful easing), per the system's motion tokens. Respect `prefers-reduced-motion`.
- `focus-visible` is not optional. Keyboard users need a visible focus indicator that meets contrast; never remove outlines without replacing them.

## Step 4 — The review gate (mandatory before "done")

Treat your first output as a junior draft; review it like a demanding senior designer. Fix what fails, then hand off.

**Render first.** Source review catches token violations but misses how it looks — where slop lives.
For page-level work, capture both desktop and mobile. Read `designAudit` before subjective critique;
its overflow, label, heading, target, skip-link, and action-affordance findings are external evidence,
not optional suggestions. Then inspect the pixels. If rendering is genuinely impossible here, say
so, run the code-level checks below, and flag that visual checks were skipped rather than silently
passing them.

Score the render 0-2 on each dimension: primary journey/focal point, spacing/proximity,
typography hierarchy, alignment/grid, action/state clarity, responsive composition, and
context-specific distinctiveness. `0` = broken/unstyled, `1` = competent but visibly weak,
`2` = polished and intentional. No zero may ship; the seven-dimension average must be at least
1.5, and spacing/proximity, primary journey/focal point, and responsive composition must each be
2. Name screenshot evidence for every score; ungrounded "looks good" self-critique does not count.

**Against the design system**
- Does every color, space, size, and radius come from a token? Flag any arbitrary value.
- Is hierarchy created by the system's intended mechanism, or did you reach for color/weight as a shortcut?
- Do density and layout posture match the system's stated intent?

**Against structure**
- Decomposed per `COMPONENTS.md`, or collapsed into a monolith?
- Any near-duplicate components that should be one?
- Page content sits inside the shell's `pb-main`; fragment root is `pb-section`; sibling blocks are separated by layout primitives (`pb-stack`/`pb-cluster`/grid gaps), never touching and never spaced by hand-written margins.
- Do Gestalt grouping rules make relationships obvious: proximity for labels/errors, similarity for
  same-role controls, common regions only where needed, and clear figure-ground for overlays?

**Against interaction**
- Does every interactive element define its full state set, including focus-visible, disabled, loading, error, and empty where relevant?
- Keyboard-operable? Contrast adequate for text and focus indicators?
- Are frequent and primary actions large enough and near the user's likely path? Are destructive
  actions separated enough to avoid accidental activation?
- In every data-table Actions cell, are multiple controls wrapped by `.pb-row-actions` (never
  merely given button classes)? Are state transitions mutually exclusive in the rendered row —
  for example, available shows Check out while checked-out shows Check in, never both together?
- Is complexity staged with progressive disclosure instead of dumped on the default view or removed
  from the workflow?
- Palbuilder-specific: no undocumented `c:` attributes, no inline scripts in fragments, no `onclick` on `c:a`, no ARIA attributes on `c:field`, and direct `${row.field}` access inside `c:list`.

**Against slop** (the fingerprint list below is the authority; this is the backstop)
- Any known fingerprints — generic gradient-blob hero, pill-everything uniform radius, the only layout idea being a three-card row, default "AI editorial" serif-on-cream-with-sage?
- Does it resemble the references in feel, or just in surface palette?
- Would it look credible next to shadcn/ui, Radix/Headless examples, or a mature product system like Polaris, Carbon, or Atlassian? If not, identify whether the failure is coverage, density, type, iconography, spacing, interaction states, or motion.
- Palbuilder-specific modernity: no icon fonts, no Google Fonts default, no Lucide leftover unless the project explicitly chose it, no inline animation scripts, no giant tool-surface headings, and no flat teal-gray admin output without a product rationale.

Report what you changed. If a check fails and you chose not to fix it, say why.

## Polish vocabulary

Use precise, operational language — vague adjectives produce vague edits. Translate "make it better" into specific moves:

- "Information density is too low — tighten padding on list items to the next step down the spacing scale."
- "Muted text is failing contrast — move it up one step toward the text token."
- "Hierarchy is flat — increase the size jump between heading and body rather than bolding more."
- "This transition is jarring — bring it to the standard duration token with ease-out."
- "Spacing rhythm is irregular — snap all gaps to the scale."

Apply the same vocabulary to yourself at the review gate.

## Acceptance checklist
- [ ] DESIGN_SYSTEM.md, COMPONENTS.md, and `design/refs/` loaded before building.
- [ ] All four canonical files (`styles/spacing.css`, `styles/design-system.css`,
      `scripts/pb-ui.js`, `scripts/pb-motion.js`) present, registered in `pal.json`, and
      byte-identical to design-system-init's references outside the `PAL OVERRIDES` block.
- [ ] Page shell `<head>` link/script order matches design-system-init's checklist: `spacing.css` →
      `design-system.css` → `styles.css` for new pals, then both scripts loaded exactly once as
      `<script type="module">`; used for generic spacing/layout instead of Bootstrap. New pals have
      `styles.css` present, registered, and human-readable; existing pals are not retrofitted.
- [ ] Shell owns `<main id="body" class="pb-main">`; every fragment root is `pb-section`; multi-field forms wrap fields in `pb-stack` or `pb-form-grid`.
- [ ] No undefined classes: every `class=` value in pages/fragments resolves to design-system.css,
      spacing.css, styles.css, or COMPONENTS.md-recorded local styles.
- [ ] Every multi-action table cell uses `.pb-row-actions`; only actions valid for the row's current
      state render, and desktop/mobile captures show wrapping without collision or overflow.
- [ ] Applied design-principles review: user journey, hierarchy, grouping, Fitts target sizing,
      progressive disclosure, typography, color meaning, and consistency.
- [ ] `component-library.md` (app/console) or `marketing-library.md` (marketing sections) consulted
      for non-trivial UI and local reusable components recorded back into COMPONENTS.md.
- [ ] Typography, SVG icons, and motion match the stack policy: system/Fontshare fonts, inline
      Iconoir/Tabler/Phosphor-style SVGs, `pb-motion.js` data attributes only for scripted motion.
- [ ] No leftover scripted-animation vendor file or `<script>` reference remains anywhere in the
      pal's own files.
- [ ] Decomposed into atomic units with explicit interfaces; no monolith, no near-duplicates.
- [ ] All values from tokens; any new need added to the system, not hardcoded.
- [ ] Every interactive element defines its full state set, including focus-visible and loading/error/empty where relevant.
- [ ] Review gate run; failures fixed or explicitly justified; changes reported.
- [ ] Desktop and mobile captures inspected; `designAudit.errors` is zero; any changed viewport
      was re-captured after fixes and functional checks still pass.
- [ ] Result resembles the references in feel, not just palette, and trips no anti-slop fingerprints.
