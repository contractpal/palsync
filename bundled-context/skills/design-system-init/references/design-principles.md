# Applied Design Principles

Use this file to initialize, build, and review Palbuilder UI. It is the action layer; evidence and
source links live in `research-brief.md`. Follow the fast route first, then open only the relevant
section. Do not paste these generic rules into project docs—record the product-specific decisions.

## Fast Route For Agents

Do these in order. Do not begin decorative styling before steps 1-4 are explicit.

1. **Name the job:** user, current state, one screen job, first decision, primary action, feedback,
   and next step.
2. **Choose one profile:** productive CRUD/admin/console or expressive public/marketing. Mixed
   products can choose per surface, never per component on a whim.
3. **Write the attention order:** the 3-5 things the eye must notice, in order.
4. **Select tokens:** spacing, type, color roles, radius, border, focus, motion, and width limits.
5. **Compose with real content:** build semantic structure and states before visual effects.
6. **Render, inspect, revise:** test the real Palbuilder result at narrow, middle, and wide widths;
   exercise the primary path and keyboard path; fix shared rules first.

Use this compact contract in working notes:

```text
Surface: productive | expressive
User/job/state:
Attention order:
Primary action and success feedback:
Secondary/rare/destructive actions:
Real-content risks (long/empty/error/permission):
Target widths and input modes:
One visual thesis; one optional motif:
```

## 1. Pick The Right Density

| Decision | Productive CRUD/admin/console | Expressive public/marketing |
| --- | --- | --- |
| Optimize for | Scan, compare, enter, decide, repeat | Understand, trust, explore, convert |
| Body/UI text | 14-16px; 16px for forms and longer copy | 16-18px body; 18-20px lead only |
| Page title | 28-36px, normally one line | `clamp(40px, 6vw, 72px)`, normally <=2 wide-screen lines |
| Control height | 40px standard; 44px coarse pointer | 44-48px primary controls |
| Group / section gap | 16-24px / 32-48px | 24-32px / 64-96px desktop, 48-64px narrow |
| Content width | Use available width for data; cap forms/prose | 1120-1280px shell; prose about 60-70ch |
| Default composition | Toolbar + filters + data/work area + states | Narrative sections + proof + one conversion path |
| Avoid | Hero treatment, huge type, sparse cards around simple fields | Dashboard density, feature-card inventory, repeated CTAs |

These are defaults, not permission to ignore content. A two-field admin form should not stretch
across 1440px; a data grid should not be squeezed into a 720px marketing column.

## 2. Establish Rhythm And Layout

Use this spacing scale only:

`2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96px`

- 2-4px: optical corrections and tightly coupled icon/text details.
- 8px: label-to-control, icon-to-label, or compact inline relationships.
- 12-20px: items within one component or tightly related group.
- 24px: field groups, card internals, toolbar groups, or related content blocks.
- 32-48px: productive page regions and major form groups; use 40px when the relationship lands between tokens.
- 64-96px: expressive major sections on roomy screens only.

Relationship rules:

- A section gap is normally at least 2x its internal item gap.
- Related elements are closer to each other than to the next group.
- Parent layouts own external space with `gap`; components own internal padding. Do not stack
  child margins until the final gap is accidental.
- Use whitespace first, then a subtle divider or surface change. Do not add a card solely to create
  separation.
- Align to a small set of vertical and horizontal edges. A control that is 3px off-grid looks more
  broken than one that is deliberately asymmetric.

Page shell defaults:

- Narrow gutter: 16px. Medium: 24px. Wide: 32-48px. Never let content touch the viewport.
- Use a centered max-width shell for marketing; use a fluid shell with sensible maximum line
  lengths for operational tools.
- Limit prose to roughly 60-70ch. Limit ordinary forms to about 32-40rem unless input content needs
  more. Data tables and timelines may be wider.
- Use CSS grid/flex with `min-width: 0`; let action bars wrap. Avoid fixed heights for content.
- A sparse screen still needs a deliberate content width and vertical rhythm; do not fill the lower
  viewport with arbitrary empty space.

## 3. Build A Visible Attention Order

Write the order before styling. A productive default is page title -> current object/status -> key
data -> primary action -> secondary actions. An expressive default is promise -> explanation ->
evidence -> action.

- Use one `h1` per page and a logical heading sequence. Do not choose heading tags for size.
- Use at most four visibly distinct type sizes on one surface, excluding small labels/metadata.
- Pair size with space and position; do not rely on bold text everywhere.
- Reserve saturated color for the primary action, links, and semantic status. Most hierarchy should
  survive in grayscale.
- Keep heading-to-supporting-copy gaps at 8-16px and heading-to-section-content gaps at 16-24px.
- Make one filled primary action dominant in a decision region. A repeated CTA is acceptable only
  after meaningful scroll or in a separate decision context; a persistent-nav CTA is allowed when
  it is visually quieter than the current section's primary.
- Keep secondary actions visible but quieter. Separate rare/destructive actions spatially and
  visually; never make Delete the neighbor of Save without protection.
- Blur/squint test: the title, current object or promise, primary action, and section boundaries must
  remain apparent. If every card and heading shouts, nothing leads.

Typography rules:

- Use one UI family; add one display family only for an expressive surface with a defined role.
- Use 400 body weight and 600-700 emphasis; avoid ultralight text and excessive bold.
- Body line-height: about 1.45-1.65. Compact labels/table cells: about 1.25-1.4.
- Use tabular numerals for amounts, counts, dates, durations, and aligned metrics.
- Test long names, localization-like expansion, errors, values, and dates. Never approve a layout
  using only short placeholder copy.
- Increase tracking only for short uppercase labels. Do not tighten body copy or control labels.

## 4. Compose Around The User Journey

Every screen must answer: Where am I? What matters now? What can I do? What happened? What next?

- Put the main decision and its context together; proximity is part of usability.
- Show the minimum useful default. Put advanced filters, bulk tools, rare settings, and destructive
  actions behind clear affordances, not behind mystery icons.
- Keep critical status, errors, permissions, and required next steps visible. Progressive disclosure
  stages complexity; it does not hide consequences.
- Same role means same location, treatment, label pattern, and behavior. Document a deliberate
  exception so later agents do not normalize drift.
- Use familiar patterns for navigation, search, filters, forms, tables, dialogs, drawers, settings,
  and pagination. Originality belongs in brand expression, not in basic control behavior.

## 5. Forms

Default to a single-column form. Use two columns only for short, strongly related values such as
city/state or start/end date, and collapse them in logical source order.

- Put a persistent visible label above each field. The accessible name contains the visible label.
- Place concise hint text with the field; placeholders may show an example but never replace labels
  or essential instructions.
- Match width to expected input: short code/ZIP, medium name/email, wider address/description. Do
  not stretch every input to the container.
- Use 40px minimum field/button height for productive desktop use and 44px for coarse pointers.
  Maintain at least 24x24px targets or sufficient target spacing in all cases.
- Use 20-24px between fields and 32-48px between semantic groups. Keep label, hint, control, and
  error visibly closer to each other than to the next field.
- Mark required/optional status consistently. Prefer marking the minority; explain the convention
  once when needed.
- Validate after a meaningful pause or on submit/blur; do not scold while the user is still typing.
  Preserve valid input after failure.
- Error copy identifies the field/problem and gives a recovery step. Pair inline errors with a
  focusable error summary for multi-field submission failures.
- Put form actions after the fields. Primary action first in the reading order; secondary Cancel as
  a quieter action. Confirm or otherwise protect irreversible operations.
- Provide default, hover, focus, filled, disabled, read-only, loading, warning, error, and success
  behavior. Disabled and read-only are not interchangeable.

Palbuilder forms use `c:field` and the documented label/hint/error recipe. Do not bypass the binding
contract to get a prettier wrapper.

## 6. Tables And Repeated Records

Use a table when users compare values across rows or columns. Use a list or record cards when each
item is read independently.

- Give the table a visible title and/or semantic caption. Use real `th` headers with correct scope;
  do not simulate tables with generic divs.
- Put search/filter/sort and result count directly above the data. Show bulk actions only after a
  selection exists.
- Default row height: 44-52px. A 40px compact density is acceptable for pointer-heavy expert tools
  when targets remain operable; do not shrink ordinary text below 14px.
- Left-align text; right-align comparable numbers; align dates consistently; use tabular numerals.
- Status uses text plus color/icon/shape. Chips are for short states, not every value.
- Keep the common row action explicit. Put secondary actions in a labeled overflow menu; separate
  destructive actions and confirm them. Do not render `Edit Check out Delete` as three tiny links.
- Long content wraps or truncates with an accessible way to reveal it. Headers remain understandable
  at every width.
- On narrow screens, keep horizontal scrolling when cross-column comparison is essential. Otherwise
  render labeled record rows/cards in the same source order. Never silently remove critical fields
  or actions.
- Always design loading/skeleton, empty-with-next-step, error-with-retry, permission-denied, and
  populated states. Pagination preserves filters and clearly communicates the current range.

Palbuilder data rows use `c:list` with direct EL. Preserve semantic table markup when the result is
actually tabular.

## 7. Interaction, Feedback, And Motion

Every action has a before, during, and after:

- Before: the label predicts the result and the control looks operable.
- During: hover/focus/active feedback is immediate; prevent accidental duplicate submits.
- After: show success, error, changed state, and the next useful action. Keep AJAX feedback near the
  changed region and announce important updates appropriately.

Use native elements first. Links navigate; buttons act. Do not implement clickable divs or hide
essential information behind hover-only UI.

- Hover/press/focus: 120-180ms. Panels/dialogs: 180-280ms. Longer motion is reserved for meaningful
  progress/data transitions.
- Animate opacity and transforms where possible; avoid layout-thrashing novelty.
- Motion explains origin, change, or completion. It does not make static content look expensive.
- Honor `prefers-reduced-motion`; no auto-playing or repeated attention animation.

Palbuilder server actions use `c:a` with `ajax-target`; JS-only actions use plain `<button>`. Scripts
stay external, and mounted behavior must survive AJAX fragment replacement.

## 8. Responsive And Robust Layout

Start narrow and add a breakpoint only when content, line length, or interaction stops working.
Do not name breakpoints after devices.

- Required evidence: one mobile render at 320-390px and one desktop render at 1280-1440px. Use
  768px as a diagnostic when navigation, grids, or forms change composition there; also inspect
  intermediate widths by resizing until the next failure appears.
- Ordinary content has no horizontal scroll at 320 CSS px. Two-dimensional tables/code may scroll
  inside a clearly bounded region without making the page itself scroll sideways.
- At 200% text zoom, content and controls remain available and do not overlap or clip.
- Source/DOM order is the meaningful reading and focus order. CSS reordering never changes meaning.
- Navigation, toolbars, field rows, button groups, and cards wrap or collapse intentionally. Do not
  merely scale the desktop screen down.
- Fixed/sticky bars must not cover focused controls or error messages. Account for mobile keyboards
  and safe viewport space.
- Media declares dimensions/aspect ratio, scales without distortion, and has useful alternative
  text when informative.
- Test touch, mouse, and keyboard assumptions separately; viewport width does not reveal input mode.

## 9. Accessibility Floor

Target WCAG 2.2 AA; use the stronger house defaults below unless a documented constraint prevents it.

- Contrast: 4.5:1 for normal text, 3:1 for large text, and 3:1 for meaningful control boundaries,
  icons, focus, and state indicators.
- Focus: every interactive element is keyboard reachable in a logical order. Use a visible 2px
  high-contrast `:focus-visible` ring and ensure sticky/overlay content does not obscure it.
- Targets: never below the WCAG 24x24px minimum/spacing rule. Default to 40px product controls and
  44px coarse-pointer controls.
- Semantics: page title, landmarks, one logical heading tree, labels, table headers, button/link
  roles, and useful image alternatives. Prefer native HTML over ARIA repair.
- Feedback: do not use color, position, shape, or motion as the only cue. Errors are identified in
  text and associated with their controls; important dynamic messages are announced.
- Navigation: include a working skip link when repeated navigation precedes content. Do not create
  keyboard traps; dialogs return focus to their trigger.
- Preferences: preserve zoom, text spacing, orientation, and reduced-motion behavior.

Automated checks find only part of this. Keyboard the real path and inspect visible focus, zoom,
reflow, labels, errors, and dynamic state changes manually.

## 10. Visual Personality Without Slop

Choose one product-specific visual thesis, such as "calm field operations" or "precise financial
review," and express it through type, palette, imagery, composition, and one optional motif.

- Use semantic color roles and one icon family. Saturation and shadows are accents, not structure.
- Use a small radius system (for example 6/10/16px). Reserve full pills for tags, statuses, or truly
  pill-shaped controls.
- Marketing imagery must add evidence, context, product understanding, or emotion. Do not invent
  customer logos, testimonials, metrics, or fake product proof.
- Avoid the generic AI bundle: floating pill nav + giant headline + gradient blobs + glass cards +
  repeated black CTAs. Avoid card soup, emoji icons, excessive chips, and empty decorative bands.
- CRUD pages do not get hero sections. Short forms do not get dashboard-width layouts. Marketing
  pages do not become feature inventories with equal cards.
- If removing decoration leaves no hierarchy, the structure is unfinished.

Record justified exceptions in project Do/Don't examples so the next agent preserves intent.

## Mandatory Render-Inspect-Revise Loop

### Pass A — structure

Build the real Palbuilder surface with semantic markup, real-length content, tokens, responsive
layout, and core states. Do not spend the first pass polishing shadows.

### Pass B — inspect

Capture mobile and desktop renders; add a 768px diagnostic when the composition has a middle state.
At each captured width, inspect in this order:

1. **Blocking:** page overflow, clipping, overlap, inaccessible focus, broken navigation/action.
2. **Journey:** location, first decision, primary action, feedback, and next step are obvious.
3. **Hierarchy:** attention order, heading scale, CTA dominance, section boundaries.
4. **Rhythm:** gutters, aligned edges, group ratios, form/table density, orphaned whitespace.
5. **Robustness:** long/empty/error/loading/permission content; keyboard path; 200% text zoom.
6. **Polish:** color balance, border/radius/shadow consistency, icon alignment, purposeful motion.

Write every defect as `severity + element + observable problem + intended rule`, for example:
`P1 / edit form / label and input read as separate columns / stack fields in a <=40rem form`.
"Looks bad" is not an actionable review.

### Pass C — revise and prove

Fix tokens, shared layout, or component recipes before one-off page CSS. Re-render every affected
width and exercise the primary CRUD or conversion path. A screenshot does not prove functionality,
and passing actions do not prove visual quality. New/substantially changed surfaces require at least
one complete inspect-and-revise cycle.

## Exit Checklist

- [ ] The user job, surface profile, attention order, and primary action are explicit.
- [ ] Productive and expressive density are not accidentally mixed.
- [ ] Every gap uses the scale; related items are closer than unrelated groups; edges align.
- [ ] One clear type hierarchy works with real, long, empty, and error content.
- [ ] Forms have visible labels, sensible widths, grouped fields, recoverable errors, and safe actions.
- [ ] Tables preserve comparison, semantics, operable row actions, mobile access, and all states.
- [ ] Required mobile/desktop renders (plus any needed 768px diagnostic) have no unintended page overflow, clipping, overlap, or dead space.
- [ ] Contrast, target size, keyboard order, visible/unobscured focus, zoom, and reduced motion pass.
- [ ] Default/hover/focus/active/disabled/read-only/loading/empty/error/success states are covered.
- [ ] The screen has one coherent visual thesis and none of the unjustified anti-slop defaults.
- [ ] The primary path and its failure/recovery path were exercised after the final visual revision.
