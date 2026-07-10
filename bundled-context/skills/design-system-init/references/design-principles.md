# Applied Design Principles

Use this reference when initializing, building, or reviewing a Palbuilder UI. It condenses the
Figma Design Basics material into rules an agent can actually apply. Do not copy these notes into
project docs verbatim; translate them into product-specific choices.

## Source Set

- Figma Design Basics index: https://www.figma.com/resource-library/design-basics/
- Visual hierarchy: https://www.figma.com/resource-library/what-is-visual-hierarchy/
- Typography and web fonts: https://www.figma.com/resource-library/typography-in-design/ and
  https://www.figma.com/resource-library/best-fonts-for-websites/
- UX and UI/UX: https://www.figma.com/resource-library/what-is-ux-design/ and
  https://www.figma.com/resource-library/difference-between-ui-and-ux/
- UI and interaction principles: https://www.figma.com/resource-library/ui-design-principles/,
  https://www.figma.com/resource-library/interaction-design/,
  https://www.figma.com/resource-library/fitts-law/
- Composition and perception: https://www.figma.com/resource-library/golden-ratio/,
  https://www.figma.com/resource-library/gestalt-principles/,
  https://www.figma.com/resource-library/what-is-skeuomorphism/
- Color and consistency: https://www.figma.com/resource-library/what-is-color-theory/,
  https://www.figma.com/resource-library/consistency-in-design/,
  https://www.figma.com/resource-library/simplicity-design-principles/,
  https://www.figma.com/resource-library/design-tokens/

## The Palbuilder Translation

### 1. Start with the user's journey

Design is not the screen; it is the path through the screen.

- Name the user's state: rushed, careful, anxious, comparing, approving, buying, recovering.
- Name the one job the current screen must make easier.
- Map the path: entry point -> first decision -> primary action -> feedback -> next step.
- Remove or defer anything that does not help that path.
- For data-heavy screens, decide what the user must notice in the first 3 seconds.

SPEC.md implication: page composition must carry the primary path and friction points, not just a
list of sections.

### 2. Build hierarchy before decoration

If everything has equal weight, the user has no path.

Use hierarchy in this order:
1. Content priority: put the most important decision/action where attention naturally starts.
2. Size and spacing: make the primary information physically clearer before adding color.
3. Weight: reserve heavier type for headings, values, and action labels.
4. Contrast and color: use sparingly to clarify state or action.
5. Motion: reveal, confirm, or orient; do not decorate.

Review test: blur your eyes. The page should still reveal its title, main object, primary action,
status, and next step.

### 3. Use progressive disclosure

Simplicity is revealing complexity in digestible layers, not deleting required capability.

- Show the minimum useful default view.
- Put advanced filters, destructive actions, bulk tools, and rare settings behind explicit affordances.
- Use drawers, accordions, tabs, details panels, and command palettes to stage complexity.
- Keep critical feedback visible; do not hide errors, permissions, warnings, or required next steps.

### 4. Apply Gestalt grouping

Users infer relationships from layout before they read labels.

- Proximity: related label/control/help/error elements stay close; unrelated groups need larger gaps.
- Similarity: same role means same visual treatment; different role needs a real distinction.
- Common region: use a bordered/tinted region to group controls only when proximity is not enough.
- Continuity: align edges so the eye can scan down columns and across rows.
- Figure-ground: overlays, drawers, and popovers need clear separation from the page.
- Focal point: one element can break the pattern for emphasis; many breaks become noise.

Avoid "card soup": unrelated cards with equal weight, equal size, and equal spacing.

### 5. Respect Fitts' law

Important targets should be large enough and close enough to the user's next likely action.

- Desktop controls: default to 38-40px minimum height.
- Touch/coarse pointer controls: 44px minimum height.
- Put the primary action near the context it acts on and near the user's likely pointer path.
- Keep paired actions close enough to compare but far enough to avoid mistakes.
- Separate destructive actions visually and spatially from safe actions.
- Row actions and menus should not require tiny pointer travel for common work.

### 6. Typography is a product system

Type communicates priority, tone, and trust.

- Use one UI family and one optional display family. Most console pals need only one family.
- Keep to 2-3 core text styles per surface, plus labels and numeric/stat styles.
- Test with real content, not lorem ipsum. Long names, errors, amounts, and dates must fit.
- Body text usually starts at 16px/1rem. Use smaller text only for labels, metadata, and dense tables.
- Keep readable line length: roughly 45-75 characters for prose; tighter for dashboards.
- Use tabular numbers for currency, counts, dates, and table columns.
- Increase tracking only for short uppercase labels; never use negative letter spacing.
- Do not use decorative/display fonts for body, controls, tables, or validation copy.

### 7. Color carries meaning

Color is not wallpaper. It communicates hierarchy, state, brand, and emotion.

- Define semantic roles first: background, surface, text, muted text, border, primary, accent,
  success, warning, danger, info.
- Check contrast before accepting a palette. Normal text needs AA contrast; focus and status
  indicators must also be visible.
- Use one primary action color per screen; use status colors only for status.
- Do not use color as the only signal. Pair status with text, icon, position, or shape.
- Keep saturation rare in console UI. Dense tools feel calmer when most structure comes from
  spacing, type, border, and surface tone.
- Use color harmony to support mood, but let workflow clarity override palette cleverness.

### 8. Consistency is a user affordance

Consistency lets users reuse what they already learned.

- Same component role, same placement, same states, same copy pattern.
- Same action label means same result. Similar results should use similar labels.
- Break consistency only to create intentional emphasis or solve a real user problem.
- If a page becomes denser or more casual than the surrounding product, document why.
- Keep voice and tone consistent with the product context: enterprise tools should not suddenly
  become jokey; public landing pages should not become database dumps.

### 9. Use familiar paradigms

Originality is not a goal when users are trying to complete work.

- Use established patterns for navigation, forms, pricing, onboarding, search, filters, modals,
  drawers, tables, and settings.
- Borrow the mental model, not the visual skin.
- Prefer native controls when they solve the job: date, select, checkbox, details/summary.
- Use skeuomorphic cues only when a real-world affordance clarifies behavior. Avoid literal
  texture, heavy realism, and performance-costly ornament.

### 10. Use composition ratios as helpers, not religion

The golden ratio can guide asymmetric composition and size relationships, but it is not a token
system.

- Use phi-like proportions when a layout feels mechanically even: 1:1.6 columns, hero/content
  splits, chart/detail regions, or focal image/copy balance.
- Do not force 1.618 into dense forms, tables, or existing design systems.
- Prefer the product's spacing/type scale when it conflicts with a ratio.

### 11. Interaction design must close the loop

Every action needs an understandable before, during, and after.

- Before: affordance is clear; label says what will happen.
- During: hover/focus/active/loading states respond immediately.
- After: success, error, empty, permission, and next-step feedback are visible.
- Errors should say what failed and how to recover.
- Motion should orient the user: where did this panel come from, what changed, what completed?
- Keyboard and screen-reader paths must match the visual path.

### 12. Design tokens are the contract

Principles become repeatable only when they are encoded.

- Convert design decisions into tokens: type scale, spacing, radius, shadow, z-index, motion,
  semantic colors, focus rings.
- Components consume tokens; screens compose components.
- If a new screen needs a one-off value, either name it as a token or reconsider the design.
- Store exceptions in Do / Don't so future agents do not normalize accidental drift.

## AI Design Review Checklist

Use this before calling a UI done:

- Journey: Can I state the user's state, job, first decision, primary action, feedback, next step?
- Hierarchy: Does the screen reveal title, object, status, action, and next step at a glance?
- Grouping: Are related controls visually grouped and unrelated controls separated?
- Targets: Are frequent/primary actions large enough and near the user path?
- Simplicity: Is complexity staged instead of dumped or deleted?
- Typography: Are there too many styles, weak line lengths, poor numeric alignment, or fake content?
- Color: Does every color role mean something, pass contrast, and avoid being the only signal?
- Spacing: page content sits in a container with visible gutters; unrelated blocks are ≥24px apart; every gap comes from the scale, none hand-written.
- Consistency: Does this match the surrounding product's patterns, tone, and density?
- Interaction: Are default/hover/focus/active/disabled/loading/error/empty states covered?
- Accessibility: Can the screen be used by keyboard, with visible focus and reduced motion?
