---
name: design-system-init
description: "Establish or extract a world-class Palbuilder design system before UI work: asks for intent, palette, and reference photos when available; falls back to a strong default palette; writes DESIGN_SYSTEM.md + COMPONENTS.md + a Palbuilder-ready stack mapping enforced by design-build. Triggers: set up a design system, redesign, visual direction, color palette, reference screenshots, component library, make it look professional, or any non-trivial new pal UI."
---

# Design System Init

Create the project's source of truth for visual language and reusable UI. Outputs:
`DESIGN_SYSTEM.md`, `COMPONENTS.md`, persisted `design/refs/*`, and a Palbuilder stack mapping
that points to the component recipes in `references/component-library.md`.

Read before acting:
- `references/research-brief.md` when choosing foundations or explaining design tradeoffs.
- `references/component-library.md` when defining the component inventory or writing Palbuilder
  examples.
- `references/vision-routing.md` whenever reference photos/screenshots or rendered output must be
  judged visually.

The job is not to theme a generic dashboard. The job is to make a pal feel designed: clear intent,
semantic tokens, complete states, accessible interaction, real responsive behavior, and a reusable
component vocabulary that works in Palbuilder XHTML and `c:` tags.

## Modes

### Declare mode

Default for a new pal or redesign. Ask for user intent, desired palette, and reference photos or
screenshots. If the user has no palette or references, continue with the default system below and
state the assumption.

### Extract mode

Triggers when `MAP.md` exists and no `DESIGN_SYSTEM.md` / `COMPONENTS.md` exists yet. The existing
pal is the reference. Extract from `MAP.md`, live screenshots, `styles/*.css`, `pages/*.html`, and
`fragments/*.html`. Do not invent new tokens in extract mode; cite source files for every token.
Flag inconsistencies in Do / Don't instead of "fixing" them silently.

## Interview

Ask in one compact turn when possible. If interactive elicitation buttons exist, use them.

1. Product and user:
   - What kind of pal is this? Console app, public web page, workflow wizard, internal dashboard,
     document tool, marketing surface, client portal?
   - Who uses it, and what state are they in? Rushed admin, careful reviewer, buyer, applicant,
     executive, field user?
   - What is the one job the interface must do better than anything else?

2. Palette and reference material:
   - Do you have a color palette, brand color, logo, or existing CSS that must be respected?
   - Do you have reference photos, screenshots, apps, or sites? Ask for 2-3. For each, ask what
     specifically to borrow: density, type, color mood, navigation, data display, motion, restraint,
     or a single moment.
   - What should this definitely not feel like?

3. Operating constraints:
   - Density: compact, balanced, or spacious?
   - Motion: none, restrained, or expressive?
   - Theme: light, dark, or both?
   - Target: console pal, public web pal, mobile-heavy, desktop-heavy, printable/document-heavy?
   - Any platform constraints: Bootstrap already loaded, existing fragment structure, locked
     enterprise branding, old browser concerns?

Stop once you can state the design intent in 2-3 sentences and the user agrees. If the user says
"you decide", use the default palette and component system below.

**Extract mode:** skip external reference questions. Ask only product/user/constraints, then derive
palette and components from the existing pal.

## Default Palette

If the user does not care, use this as the starting point. It is neutral enough for most pal
projects, avoids the overused purple-gradient / cream-sage AI fingerprint, and gives operational
screens a calm professional center.

```css
:root {
  --ds-bg: #f6f8f7;
  --ds-bg-subtle: #eef3f1;
  --ds-surface: #ffffff;
  --ds-surface-raised: #fbfcfc;
  --ds-text: #151918;
  --ds-text-muted: #56615e;
  --ds-text-soft: #77817e;
  --ds-border: #d9e2df;
  --ds-border-strong: #b8c7c2;

  --ds-primary: #0f766e;
  --ds-primary-hover: #0b5f59;
  --ds-primary-soft: #d9f0ec;
  --ds-primary-text: #ffffff;
  --ds-accent: #b45309;
  --ds-accent-soft: #fde8cc;

  --ds-success: #2f7d4f;
  --ds-warning: #b7791f;
  --ds-danger: #b42318;
  --ds-info: #2563a9;

  --ds-radius-xs: 4px;
  --ds-radius-sm: 6px;
  --ds-radius-md: 8px;
  --ds-radius-pill: 999px;
  --ds-shadow-sm: 0 1px 2px rgba(21, 25, 24, 0.06);
  --ds-shadow-md: 0 8px 22px rgba(21, 25, 24, 0.10);
  --ds-ease: cubic-bezier(0.2, 0, 0, 1);
}
```

Use one saturated brand/accent family per screen unless status semantics require a small green,
amber, red, or blue cue. The default primary can be replaced by a user brand color, but then
`--ds-primary-text` must be checked for AA contrast.

Dark variant, when the user asks for dark or the existing pal is dark-locked:

```css
:root,
[data-theme="dark"] {
  --ds-bg: #141817;
  --ds-bg-subtle: #1d2422;
  --ds-surface: #202826;
  --ds-surface-raised: #26302d;
  --ds-text: #eef5f2;
  --ds-text-muted: #b6c3bf;
  --ds-text-soft: #879591;
  --ds-border: #35413e;
  --ds-border-strong: #4b5a56;

  --ds-primary: #63d2c6;
  --ds-primary-hover: #8be0d7;
  --ds-primary-soft: #173c39;
  --ds-primary-text: #0b1514;
  --ds-accent: #f2a65a;
  --ds-accent-soft: #442b13;

  --ds-success: #79d69a;
  --ds-warning: #f2c66d;
  --ds-danger: #ff8a7a;
  --ds-info: #8ab9ff;
}
```

On dark, separation comes primarily from surface tone and borders; use shadows only for overlays.

## Process

Run these steps in order.

### 1. Persist references

Create `design/refs/`.

Declare mode:
- Save each provided reference photo/screenshot/URL capture with a descriptive filename.
- Write `design/refs/NOTES.md`: what it is, what the user likes, what not to copy.
- If a URL can be inspected, save raw computed observations in `design/refs/extracted.md`
  as input only: color values, font families, radius, shadow, spacing rhythm, component ideas.

Extract mode:
- Save screenshots of the live pal as `design/refs/ref-<screen>-<viewport>.png`.
- In `design/refs/extracted.md`, cite the actual source for every observed value:
  `styles/main.css`, `pages/*.html`, `fragments/*.html`, and rendered screenshots.

If the executing model cannot see images, read `references/vision-routing.md` and route only the
visual observation step to a vision-capable model.

### 2. Synthesize foundations

Curate the system. Do not transcribe every color from a screenshot.

Define:
- Color roles: background, subtle background, surface, raised surface, text, muted text, soft text,
  border, strong border, primary, primary hover, primary soft, primary text, accent, success,
  warning, danger, info.
- Type: UI family, optional display family, scale, weight range, numeric rules. Use external fonts
  only when the pal can load them reliably; otherwise use system stacks.
- Spacing: 4px base with named steps: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radius: small set only. Cards default to 8px or less unless references require more.
- Border/shadow/elevation: decide whether separation comes from tone, border, shadow, or layout.
- Motion: duration/ease tokens and reduced-motion behavior.
- Density: page rhythm, table/list row height, card padding, mobile collapse behavior.

### 3. Build the component inventory

Use `references/component-library.md` as the canonical Palbuilder-ready library. In
`COMPONENTS.md`, name only the components this pal needs now plus likely shared primitives. Every
component must list variants, states, tokens, and the Palbuilder implementation pattern.

Required baseline for most pals:
- Primitives: Button, IconButton, Field, Select, Checkbox/Toggle, Badge, Alert, Card, Divider,
  Skeleton, Progress, Avatar/Initial, Tooltip/help text.
- Data: Table, responsive record list, stat/KPI card, filter bar, pagination, empty state, error
  state.
- Shells: page shell, topbar/sidebar/nav, toolbar, modal body, drawer/panel if needed.
- Domain composites: workflow stepper, activity feed, file upload, data-detail row, approval
  actions, CRUD form.

The inventory maps to Palbuilder fragments/classes, not React components. A primitive may be a CSS
class plus a markup recipe. A composite may be a fragment under `fragments/common/` or a feature
fragment under `fragments/<area>/`.

### 4. Anti-slop check

Before writing final tokens, call out collisions:
- Purple/blue gradient hero with abstract blobs.
- Cream/sage editorial palette when the product is not editorial.
- Uniform pill-everything radius.
- Three equal feature cards as the only layout idea.
- Too many words, helper paragraphs, and redundant headings.
- Saturated rainbow charts or status fills.
- Generic Inter/Roboto + gray cards + blue primary with no reference rationale.
- Mobile as an afterthought.

If the user explicitly wants one of these, keep the request but make it intentional and constrained.

Extract mode: do not erase live slop. Document it in Do / Don't as observed reality and a future
improvement candidate.

### 5. Write DESIGN_SYSTEM.md

Use this exact structure:

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
### Spacing
[Base and scale.]
### Radius / Border / Shadow / Motion
[Token sets and intent.]

## Density & Layout
[Page rhythm, grid/shell posture, table/list density, mobile behavior.]

## Accessibility
[Contrast target, focus-visible style, keyboard expectations, reduced motion, error announcement.]

## Do / Don't
[Concrete, testable rules. Include anti-slop collisions.]

## Stack Mapping
[Palbuilder XHTML/CSS mapping: style files, page head links, fragment naming, c: tag patterns,
which recipes from references/component-library.md to use.]
```

### 6. Write COMPONENTS.md

Use this exact structure:

```markdown
# Component Inventory - [project]

## Token Contract
[Names of required CSS files and token prefixes, e.g. `Styles/design-system.css`,
`--ds-*`, `.pb-*`.]

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
or `.claude/skills/design-system-init/references/component-library.md`.]
```

### 7. Confirm

Show the user:
- Intent paragraph.
- Color/type direction.
- Do / Don't list.
- Component inventory headline list.

Ask whether it matches the desired feel. In extract mode, ask whether it matches the live pal's
reality. A correction means re-check references or source files before editing the docs.

## Palbuilder Rules For The Design System

- Use external CSS files for the library, normally `styles/design-system.css` or
  `styles/theme.css`; pages link them from `<head>`.
- Fragments use `<c:ignore xmlns:c="contractpal">` and contain no `<html>`, `<head>`, `<body>`,
  or inline `<script>`.
- Server actions use `c:a` / `c:button` / `c:select` with only documented attributes from
  `palbuilder-frontend/references/c-tags.md`.
- `c:list` rows use direct EL: `${row.field}`.
- Use `c:field` for bound inputs, but do not put ARIA attributes on `c:field`; pair it with a
  wrapping `<label>` and sibling `role="alert"` message.
- Inline SVG icons are allowed; self-close SVG children and use one icon family.
- Never place `${...}` inside inline `<script>`. Put browser JS in `scripts/*.js` loaded from the
  page shell.
- Use JPG/PNG for images; avoid WebP in Palbuilder.

## Acceptance Checklist

- [ ] User was asked for palette/brand color and 2-3 reference photos/screenshots; default palette
      used only when they did not care or could not provide them.
- [ ] `design/refs/` contains durable reference assets and notes.
- [ ] `DESIGN_SYSTEM.md` exists with semantic tokens, density/layout, accessibility, Do / Don't,
      and Palbuilder stack mapping.
- [ ] `COMPONENTS.md` exists with primitives, composites, layout shells, states, and recipe links.
- [ ] Direction was checked against anti-slop fingerprints.
- [ ] Component choices point to Palbuilder-valid recipes in `references/component-library.md`.
- [ ] Extract mode only: every token cites a real source; inconsistencies are documented, not
      silently normalized.
