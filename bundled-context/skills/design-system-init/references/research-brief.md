# Design Research Brief

This is the evidence layer behind Palsync's design rules. It is deliberately short and routed:
use `design-principles.md` for build-time numbers and the checklist below for research tie-breakers.
Do not copy a source's visual skin or install its framework.

## Authority Order

When guidance conflicts, use this order:

1. Palbuilder runtime and markup constraints.
2. WCAG 2.2 and semantic HTML requirements.
3. The user's task, content, audience, existing brand, and observed workflow.
4. Established product patterns from public design systems.
5. Aesthetic references and trends.

An attractive reference never justifies an inaccessible control, broken workflow, invented content,
or unsupported Palbuilder implementation.

## What The Evidence Changes

### Encode decisions; do not prompt for taste

Weak agents do better with a small contract and observable checks than with adjectives such as
"clean," "premium," or "modern." Before styling, require: surface profile, user job, information
priority, spacing/type tokens, component states, and target viewports. Then render and inspect the
result. OpenAI's agent-harness reporting likewise emphasizes repository-legible constraints,
screenshots, local app operation, and iterative review rather than asking the model to "try harder."

### Choose productive or expressive density first

Carbon explicitly separates productive product typography from expressive editorial/marketing
typography. Palsync applies the same distinction:

- **CRUD/admin/console — productive:** optimize scanning, comparison, entry, and repeated action.
  Use modest page titles, 14-16px UI text, 40-44px standard controls, 16-24px group gaps, 24-48px
  section gaps, wide data regions, and persistent workflow context. Tables, filters, status, and
  recovery states outrank decorative hero treatment.
- **Public/marketing — expressive:** optimize comprehension, trust, and one conversion path. Use
  16-18px body text, responsive display type, 24-32px content-group gaps, 64-96px major desktop
  section gaps, readable prose widths, meaningful media, and a clear narrative. More space is not a
  substitute for content, proof, or hierarchy.

Do not blend the profiles accidentally. A CRUD list is not a landing page; a marketing homepage is
not an admin dashboard with larger text.

### Space must communicate relationships

Carbon, GOV.UK, and USWDS all use named spacing scales. The practical lesson is consistency plus
intent: small gaps bind label/control/help; medium gaps separate fields and related groups; large
gaps separate sections. Palsync uses `2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96px` and requires every
gap to come from that scale. Parent layout owns inter-component space through `gap`; components own
their internal padding.

The ratio matters more than a single value. A section gap should normally be at least twice its
internal item gap. When every gap is equal, hierarchy disappears; when gaps are huge, the workflow
fragments.

### Hierarchy is a reading order

NN/g's visual-design principles and mature public systems converge on scale, contrast, alignment,
proximity, and consistency. Convert those into an explicit order: page purpose -> current object or
promise -> supporting evidence/data -> primary action -> secondary actions. Establish that order
with document structure, position, type, and space before adding color, shadows, or motion.

### Forms are conversations, not grids of boxes

GOV.UK, USWDS, and Carbon use persistent visible labels, concise hints, expected-width inputs, and
specific recovery copy. Default to one readable column; only place short, strongly related fields
on the same row. Placeholder text is an example, never the label. On failure, identify what went
wrong and how to fix it next to the field; for multi-field failures, also provide an error summary.

### Tables preserve comparison

USWDS and Carbon reserve tables for structured row/column comparison. Use a caption or equivalent
context, real column headers, row-header semantics where appropriate, predictable alignment,
compact but operable targets, and explicit loading/empty/error states. On narrow screens, keep a
scrollable table when cross-column comparison matters; otherwise transform records into labeled
rows/cards without hiding critical data.

### Responsive means content-led, not device-named

web.dev recommends mobile-first layouts and breakpoints where the content stops working rather than
at brand-specific device widths. WCAG reflow requires ordinary content to work without two-axis
scrolling at 320 CSS px (with exceptions for genuinely two-dimensional content such as data tables).
Test the reading and focus order, not just whether boxes fit.

### Accessibility is part of the visual system

Use WCAG 2.2 AA as the floor: 4.5:1 normal-text contrast, 3:1 large-text contrast, 3:1 meaningful
non-text boundaries/indicators, keyboard operation, visible and unobscured focus, labels and error
identification, reflow, and a 24x24 CSS px minimum pointer target or sufficient spacing under the
criterion's exceptions. Palsync's house default is stronger: 40px controls for desktop workflows
and 44px for coarse pointers, plus a clearly contrasting 2px focus ring. Never use color alone.

## Source Routes

Open only the route needed for the current decision:

- **Normative accessibility:** [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and the
  [W3C Understanding index](https://www.w3.org/WAI/WCAG22/Understanding/) for reflow, contrast,
  focus, target size, labels, errors, and redundant entry.
- **Plain, resilient service UX:** [GOV.UK spacing](https://design-system.service.gov.uk/styles/spacing/),
  [layout](https://design-system.service.gov.uk/styles/layout/),
  [text input](https://design-system.service.gov.uk/components/text-input/),
  [error message](https://design-system.service.gov.uk/components/error-message/), and
  [table](https://design-system.service.gov.uk/components/table/).
- **Accessible public patterns:** [USWDS design principles](https://designsystem.digital.gov/design-principles/),
  [spacing units](https://designsystem.digital.gov/design-tokens/spacing-units/),
  [form](https://designsystem.digital.gov/components/form/), and
  [table](https://designsystem.digital.gov/components/table/).
- **Dense product systems:** [Carbon spacing](https://carbondesignsystem.com/elements/spacing/overview/),
  [typography](https://carbondesignsystem.com/elements/typography/overview/),
  [form](https://carbondesignsystem.com/components/form/usage/), and
  [data table](https://carbondesignsystem.com/components/data-table/usage/).
- **Platform ergonomics:** [Apple HIG layout](https://developer.apple.com/design/human-interface-guidelines/layout),
  [typography](https://developer.apple.com/design/human-interface-guidelines/typography), and
  [accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).
- **Human-factors review:** [NN/g visual-design principles](https://www.nngroup.com/articles/principles-visual-design/)
  and [usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).
- **Responsive implementation:** [web.dev responsive-design basics](https://web.dev/articles/responsive-web-design-basics)
  and [accessible responsive design](https://web.dev/articles/accessible-responsive-design).
- **Agent feedback loops:** [OpenAI harness engineering](https://openai.com/index/harness-engineering/),
  [VISTA](https://arxiv.org/abs/2605.26144), and
  [InteractWeb-Bench](https://arxiv.org/abs/2604.27419). Treat emerging benchmark papers as
  directional evidence for render-and-verify workflows, not as UX standards.

## Required Agent Loop

1. **Contract:** state the user job, productive/expressive profile, content priority, primary action,
   real data/content, target viewports, and accessibility risks.
2. **Foundation:** select tokens and component recipes before page-specific CSS. Use real-length
   names, dates, amounts, errors, and empty states.
3. **First render:** capture the real Palbuilder result at 320, 768, and 1440px widths; add the
   widest expected operational viewport when relevant.
4. **Inspect in order:** clipping/overflow -> reading and focus order -> hierarchy -> grouping and
   alignment -> density -> contrast/states -> decorative polish. Record concrete defects, not
   "looks off."
5. **Exercise:** keyboard-tab the screen and run the primary path, including validation, loading,
   empty/error, success, and destructive confirmation where applicable. Visual fidelity and
   functional correctness are separate checks.
6. **Revise the system:** fix tokens, shared layout, or components first; patch one page only when
   the exception is real. Re-render every width affected by the change.
7. **Stop only at gates:** no unintended horizontal scroll, no overlap/clipping, clear first action,
   consistent rhythm, complete states, operable keyboard path, and no unresolved high-severity
   visual defect.

One screenshot is evidence of an attempt, not evidence of quality. At least one inspect-and-revise
cycle is mandatory for a new or substantially changed surface.

## Anti-Slop Guardrails

Reject these defaults unless product evidence and the project Do/Don't examples justify them:

- giant headings on CRUD pages, tiny gray copy, or whitespace that separates labels from controls;
- a floating pill navbar, gradient/glow blobs, glass panels, or a black rounded CTA on every site;
- "card soup": every paragraph, stat, action, and section in an equal rounded rectangle;
- excessive pills, excessive radii, emoji as interface icons, and shadows used instead of grouping;
- repeated filled primary CTAs in the same viewport (a persistent nav CTA must stay quieter),
  placeholder-only forms, and unlabeled icon actions;
- full-width short inputs, three tiny underlined row actions, and destructive actions beside safe ones;
- generic hero copy, invented testimonials/metrics, fake dashboards, or decorative imagery with no
  content role;
- fixed-height sections that clip real content, desktop-only tables, or hiding essential mobile data;
- animation on every element, auto-playing distraction, or motion without reduced-motion handling.

Aim for one coherent visual thesis and at most one distinctive motif. Modernity comes from clear
structure, disciplined rhythm, good content, and refined states—not from stacking fashionable effects.

## Palbuilder Translation

- A component library means owned recipes, semantic classes, states, and fragments—not React/Vue
  imports or build tooling. Keep `styles/spacing.css` as the stable layout utility layer.
- Markup must be valid XHTML: self-close void elements and SVG children. Use only documented `c:`
  attributes; cross-check `palbuilder-frontend/references/c-tags.md`.
- Put CSS in `styles/*.css` and JS in `scripts/*.js`; fragments contain no inline `<script>`.
- Use `c:a` for server actions and `ajax-target` updates. JS-only controls use plain `<button>`.
  Use `c:list` with direct EL for data rows and `c:field` with the documented label/error pattern
  for bound inputs.
- Inline one consistent SVG icon family. Do not depend on icon fonts, injected sprites, or a JS icon
  replacer; AJAX fragments do not rerun page boot code automatically.
- Fonts are system stacks or Fontshare. A Fontshare `@import`, when used, is the first line of
  `design-system.css`; do not add remote page-head fonts. A console pal with no font specified by
  the user, spec, or references uses the system stack only and no import; marketing/web pals keep
  the Satoshi default. Express body/type tokens in `rem`; spacing, radii, and borders may remain in
  `px`.
- CSS custom properties and semantic `.pb-*` classes hold the system. Simple states stay in CSS.
  Mounted effects use the shipped dependency-free `pb-motion.js` and its documented
  `data-animate`/`data-ticker`/`data-typewriter`/`data-tilt`/`data-spotlight` hooks; its shared
  observers must keep effects working after AJAX swaps. Honor `prefers-reduced-motion`.
