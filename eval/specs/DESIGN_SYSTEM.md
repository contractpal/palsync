# DESIGN_SYSTEM — palsync UX benchmark contract
status: approved (benchmark contract v2)

Purpose: test whether Palsync helps weak agents produce usable, polished, responsive UI. Visual
quality is a scored requirement, not decoration. Functional correctness cannot compensate for an
unstyled or poorly composed screen, and visual polish cannot compensate for broken behavior.

## Reference precedence

Evaluator-supplied references are the primary visual authority. These benchmark scenarios ship no
reference images, so the content-led fallback below is authoritative. Never invent screenshots,
logos, customers, testimonials, metrics, awards, or other proof to fill the visual layer.

## Mandatory build loop

1. Classify the surface as marketing or CRUD/admin before coding.
2. Write a six-line brief: user, job, primary action, information order, density, signature idea.
3. Apply the matching COMPONENTS.md recipes, copying only used CSS recipes and dependencies into
   the pal-owned `styles/styles.css`; never load the full `design-system.css` reference.
4. Verify behavior, then capture desktop and mobile screenshots.
5. Read `designAudit`, inspect the actual pixels, fix the three highest-impact failures, and
   re-capture every changed viewport. `designAudit.errors` must be zero.
6. Score focal point, spacing, type, grid, action/state clarity, responsive composition, and
   distinctiveness 0-2. Average at least 1.5; focal point/spacing/responsive must be 2; no 0.

## Foundation

- Stack: optional `spacing.css` -> pal-owned `styles/styles.css`, then only the behavior scripts
  actually used. `design-system.css` is reference-only and must not be copied, registered, linked,
  or loaded into the pal.
- Shell: console page owns `<main id="body" class="pb-main">`; content fragments root in
  `pb-section`. Marketing pages use one visible main landmark and a focus-only `pb-skip-link`.
- Spacing: use the 2/4/8/12/16/20/24/32/40/48/64/80/96 scale. Label-to-control < field-to-field <
  group-to-group < section-to-section. Whitespace must group, pace, or emphasize real content;
  an unexplained blank band is a defect.
- Type: one UI family by default; 2-3 obvious hierarchy levels per region; body copy at least
  16px and constrained to roughly 60-75 characters. Sentence case. One visible H1.
- Surfaces: use a border/background/radius/shadow only for real grouping, selection, or elevation.
  Cards are not the default wrapper for every section. Pills are for badges/statuses, not shells.
- Actions: one primary action per group. Buttons perform actions; links navigate. Destructive
  actions are visually and spatially separated from safe actions.

## CRUD/admin profile

- Productive density. Page title 28-40px, not hero scale. Header/action -> data or bounded form.
- Labels above controls. Default forms to one column and at most 720px; two columns only for short,
  strongly related fields. Save and Cancel stay together at the end.
- Tables use semantic headers, responsive `data-label` cells, status text plus color, and grouped
  row actions. Common safe actions first; Delete last and dangerous.
- Required applicable states: empty, validation error, success/feedback, disabled/permission.

## Marketing profile

- Hero communicates audience/problem, outcome, and next action. Use one primary CTA and a quieter
  secondary. H1 is fluid but must not consume most of the first viewport.
- First viewport includes proposition plus proof/context or the start of the next useful section.
- Vary composition by content: split, editorial, process, proof, comparison, outcome list. Do not
  clone one card grid across every page or use three equal cards as the only layout idea.
- Navigation follows familiar full-width conventions. A persistent nav CTA stays quieter than the
  current section's primary action. Skip link is invisible until focused.
- Without approved media, use strong type, honest outcome/process structure, and whitespace with a
  purpose. Do not fabricate visual evidence.

## Accessibility and responsive floor

- WCAG 2.2 AA contrast; color never carries status alone; visible keyboard focus.
- Every control has an associated visible label/accessibility name. Errors identify the field in
  text and explain recovery.
- Targets meet the 24x24 CSS-pixel WCAG minimum; aim for 40-44px on primary/touch controls.
- Reflow at 320px with no page-level horizontal overflow. A data table may own an explicit scroll
  region or use the shipped mobile record collapse; critical information is never silently hidden.

## Anti-slop defaults

- No emoji UI icons, floating pill navbar, giant empty hero, gradient blobs, glass everywhere,
  uniform rounded rectangles, repeated dark CTA slabs, or decorative motion without rationale.
- No browser-default form controls, inline form labels, raw CRUD action links, oversized utility
  headings, or low-density admin card theater.
- No more than one signature visual idea per page. Specific content and hierarchy beat effects.
