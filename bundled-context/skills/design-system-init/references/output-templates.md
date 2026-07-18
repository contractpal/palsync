# Output templates

Copy these templates verbatim, then fill every bracketed field.

## DESIGN_SYSTEM.md

```markdown
# Design System - [project]

## Intent
[2-3 sentences: user, feeling, one job, and why the choices fit.]

## References
[Each reference: file/link, what we take, what we avoid.]

## Research Translation
[Brief note on which external systems informed this pal: e.g. shadcn-style owned code,
Radix/Headless-style accessible states, Polaris-style dense tables, Carbon-style data viz.]

## Foundations
### Color
[Semantic role -> value. Include default fallback or brand derivation notes.]
### Type
[Families, loading method, scale, weights, numeric rules.]
Font decision: system (console default) | <font> (source: user/spec/reference)
### Spacing
[State whether `styles/spacing.css` is used and, if so, that it is linked before `styles.css` and
owns the spacing/layout utility scale. State that `styles.css` contains the selected reference
recipes and is the only design-system runtime stylesheet. Note any project values for `--space-unit`,
`--container-*`, or `--gutter-*`.]
### Radius / Border / Shadow / Motion
[List the selected radius/border/shadow tokens in `styles.css`, plus which `pb-motion.js`
data-attributes are used and where (omit the script when none are used).]

## Density & Layout
[Page rhythm, grid/shell posture, table/list density, mobile behavior.]

## UX Flow & Hierarchy
[Primary user path, first decision, primary action placement, feedback/next step, grouping,
progressive disclosure, target sizing, and intentional hierarchy mechanisms.]

## Accessibility
[Contrast target, focus-visible style, keyboard expectations, reduced motion, error announcement.]

## Do / Don't
[Concrete, testable rules. Include anti-slop collisions.]

## Stack Mapping
[Palbuilder XHTML/CSS mapping: selected rules from the reference-only `design-system.css` live in
registered `styles/styles.css`; optional `styles/spacing.css` loads before it only when used; and
`scripts/pb-ui.js` / `scripts/pb-motion.js` load once only when selected behavior needs them. Include
the chosen palette/preset source (or "ink, no attribute"), fragment naming, c: tag patterns, which
recipes from references/component-library.md (and references/marketing-library.md if the pal has
marketing pages) to use, SVG icon family, and Fontshare/system font choice.]
```

## COMPONENTS.md

```markdown
# Component Inventory - [project]

## Token Contract
[Names of runtime CSS files and selected token/class prefixes, e.g. `Styles/styles.css`, `--ds-*`,
`.pb-*`; explicitly state that `design-system.css` is reference-only and not loaded.]

## Primitives
[For each: purpose, variants, states, tokens, Palbuilder markup recipe.]

## Composites
[For each: composed primitives, responsibility, fragment path if shared.]

## Layout Shells
[App shell, page header, nav, toolbars, modal shell, responsive behavior.]

## Data & Workflow States
[Loading, empty, error, success, validation, permissions, async/progress.]

## Naming & Ownership
[CSS class prefix, fragment placement, when to create shared vs feature-specific fragments.]

## Recipe References
[List relevant sections from `.agents/skills/design-system-init/references/component-library.md`
or `.claude/skills/design-system-init/references/component-library.md`, plus
`references/marketing-library.md` sections if the pal has marketing pages.]
```
