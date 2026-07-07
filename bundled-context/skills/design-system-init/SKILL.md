---
name: design-system-init
description: "Establish or extract a world-class Palbuilder design system before UI work: asks for intent, palette, and reference photos when available; falls back to a strong default palette; writes DESIGN_SYSTEM.md + COMPONENTS.md + a Palbuilder-ready stack mapping enforced by design-build. Triggers: set up a design system, redesign, visual direction, color palette, reference screenshots, component library, make it look professional, or any non-trivial new pal UI."
---

# Design System Init

Create the project's source of truth for visual language and reusable UI. Outputs:
`DESIGN_SYSTEM.md`, `COMPONENTS.md`, persisted `design/refs/*`, and a Palbuilder stack mapping
that points to the component recipes in `references/component-library.md`.

Read before acting:
- `references/design-principles.md` when defining UX flow, hierarchy, typography, color, motion,
  grouping, or review criteria.
- `references/research-brief.md` when choosing foundations or explaining design tradeoffs.
- `references/component-library.md` when defining the component inventory or writing Palbuilder
  examples.
- `references/vision-routing.md` whenever reference photos/screenshots or rendered output must be
  judged visually.

The job is not to theme a generic dashboard. The job is to make a pal feel designed: clear intent,
semantic tokens, complete states, accessible interaction, real responsive behavior, tasteful motion,
excellent SVG icons, and a reusable component vocabulary that works in Palbuilder XHTML and `c:`
tags. The quality target is shadcn/ui-level clarity with Polaris/Carbon-level operational coverage,
translated into Palbuilder-owned CSS and fragments.

Design quality starts before colors. Establish the user's journey, visual hierarchy, grouping,
target sizing, progressive disclosure, and typography rules before choosing decorative treatments.

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
   - What is the path through the primary screen? Entry point, first decision, primary action,
     feedback, and next step.

2. Palette and reference material:
   - Do you have a color palette, brand color, logo, or existing CSS that must be respected?
   - Do you have reference photos, screenshots, apps, or sites? Ask for 2-3. For each, ask what
     specifically to borrow: density, type, color mood, navigation, data display, motion, restraint,
     or a single moment.
   - If they do not have a palette, ask whether to run the default workflow: generate 20-30 palette
     directions externally (Coolors-style), narrow to 2-3, refine harmony (Adobe Color-style), check
     AA contrast, preview in a real UI (Realtime Colors-style), then export CSS variables.
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

If the user does not care, use this as the starting point. It is neutral, crisp, and high-contrast
like the best shadcn-style product UI, but avoids the generic blue/gray admin look by keeping color
semantic and sparse. The primary action is ink by default; accent color appears only for highlights,
charts, and product-specific moments.

```css
:root {
  --ds-bg: #f7f8fb;
  --ds-bg-subtle: #f0f2f5;
  --ds-surface: #ffffff;
  --ds-surface-raised: #fcfcfd;
  --ds-text: #101114;
  --ds-text-muted: #5f6673;
  --ds-text-soft: #848b98;
  --ds-border: #e1e5eb;
  --ds-border-strong: #c7ced8;
  --ds-focus: #3b82f6;
  --ds-focus-ring: #dbeafe;

  --ds-primary: #18181b;
  --ds-primary-hover: #27272a;
  --ds-primary-soft: #eceef2;
  --ds-primary-text: #ffffff;
  --ds-accent: #2563eb;
  --ds-accent-soft: #dbeafe;

  --ds-success: #15803d;
  --ds-success-soft: #dcfce7;
  --ds-warning: #b45309;
  --ds-warning-soft: #fef3c7;
  --ds-danger: #b42318;
  --ds-danger-soft: #fee2e2;
  --ds-info: #1d4ed8;
  --ds-info-soft: #dbeafe;

  --ds-radius-xs: 4px;
  --ds-radius-sm: 6px;
  --ds-radius-md: 8px;
  --ds-radius-lg: 12px;
  --ds-radius-pill: 999px;
  --ds-shadow-xs: 0 1px 1px rgba(16, 17, 20, 0.04);
  --ds-shadow-sm: 0 1px 2px rgba(16, 17, 20, 0.08);
  --ds-shadow-md: 0 16px 40px rgba(16, 17, 20, 0.12);
  --ds-shadow-pop: 0 24px 70px rgba(16, 17, 20, 0.18);
  --ds-ease: cubic-bezier(0.2, 0, 0, 1);
  --ds-duration-fast: 120ms;
  --ds-duration-med: 180ms;
  --ds-duration-slow: 280ms;
}
```

Use one saturated brand/accent family per screen unless status semantics require a small green,
amber, red, or blue cue. The default primary can be replaced by a user brand color, but then
`--ds-primary-text` must be checked for AA contrast.

Dark variant, when the user asks for dark or the existing pal is dark-locked:

```css
:root,
[data-theme="dark"] {
  --ds-bg: #0b0d10;
  --ds-bg-subtle: #11151a;
  --ds-surface: #161a20;
  --ds-surface-raised: #1d232b;
  --ds-text: #f6f7f9;
  --ds-text-muted: #b6bdc8;
  --ds-text-soft: #8b94a3;
  --ds-border: #2a3039;
  --ds-border-strong: #3c4654;
  --ds-focus: #60a5fa;
  --ds-focus-ring: #172a45;

  --ds-primary: #f6f7f9;
  --ds-primary-hover: #ffffff;
  --ds-primary-soft: #242a33;
  --ds-primary-text: #0b0d10;
  --ds-accent: #60a5fa;
  --ds-accent-soft: #172a45;

  --ds-success: #4ade80;
  --ds-success-soft: #12351f;
  --ds-warning: #fbbf24;
  --ds-warning-soft: #422b07;
  --ds-danger: #fb7185;
  --ds-danger-soft: #43151c;
  --ds-info: #93c5fd;
  --ds-info-soft: #172a45;
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
  only when the pal can load them reliably; otherwise use system stacks. Fonts must be system fonts
  or Fontshare fonts. If self-hosting is available, install through Fontsource-style packages; if
  not, use the Fontshare CSS link selected for the project. Do not default to Google Fonts.
- Iconography: always inline SVG, never icon fonts or JS icon replacers. Default to Iconoir, Tabler,
  or Phosphor; use one family per pal unless a single domain icon is missing. Heroicons can inform
  Tailwind-like proportions, but the generated Palbuilder output must still be inline SVG.
- Spacing: 4px base with named steps: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radius: small set only. Cards default to 8px or less unless references require more.
- Border/shadow/elevation: decide whether separation comes from tone, border, shadow, or layout.
- Motion: GSAP is the JavaScript animation library for Palbuilder surfaces that need scripted
  animation. Use CSS transitions for simple hover/focus states; use GSAP in `scripts/*.js` for
  mounted sections, overlays, drawers, command palettes, chart reveals, reorder/FLIP, and scroll
  storytelling. Define duration/ease tokens, reduced-motion behavior, and a no-motion fallback.
- Density: page rhythm, table/list row height, card padding, mobile collapse behavior.
- UX flow: primary path, hierarchy order, progressive disclosure, Fitts target rules, Gestalt
  grouping, and how complexity is staged.

### 3. Build the component inventory

Use `references/component-library.md` as the canonical Palbuilder-ready library. In
`COMPONENTS.md`, name only the components this pal needs now plus likely shared primitives. Every
component must list variants, states, tokens, and the Palbuilder implementation pattern.

Required baseline for most pals:
- Primitives: Button, IconButton, ButtonGroup, Field, Textarea, InputGroup, Select, Checkbox,
  Toggle, Radio/ChoiceCard, SegmentedControl, Slider, Badge, Alert, Card, Divider, Skeleton,
  Progress, Avatar/Initial, Tooltip/help text, Kbd, Spinner.
- Data: Table, responsive record list, stat/KPI card, filter bar, pagination, empty state, error
  state, data grid affordances, row actions, bulk action bar, charts, metrics panel.
- Shells: page shell, topbar/sidebar/nav, toolbar, modal body, drawer/sheet, popover, command
  palette, responsive mobile nav.
- Domain composites: workflow stepper, activity feed, file upload, attachment list, data-detail row,
  approval actions, CRUD form, review summary, comment thread, kanban/status board, calendar/list
  schedule, settings page, onboarding checklist.

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
- Flat teal-and-gray admin output with oversized headings, plain cards, no icons, no command/menu
  affordances, and no motion layer.
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

## UX Flow & Hierarchy
[Primary user path, first decision, primary action placement, feedback/next step, grouping,
progressive disclosure, target sizing, and intentional hierarchy mechanisms.]

## Accessibility
[Contrast target, focus-visible style, keyboard expectations, reduced motion, error announcement.]

## Do / Don't
[Concrete, testable rules. Include anti-slop collisions.]

## Stack Mapping
[Palbuilder XHTML/CSS mapping: style files, page head links, fragment naming, c: tag patterns,
which recipes from references/component-library.md to use, GSAP loading strategy, SVG icon family,
and Fontshare/system font choice.]
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
- Icon fonts and JS icon replacement libraries are not allowed. Use inline SVG from Iconoir, Tabler,
  or Phosphor unless the user explicitly chooses another SVG family.
- Use system fonts or Fontshare fonts. Do not introduce a Google Fonts dependency by default.
- Use GSAP for scripted UI animation in `scripts/*.js` when motion is needed. Load GSAP once from a
  local vendor file or approved CDN in the page shell; never put animation scripts in fragments.
- Never place `${...}` inside inline `<script>`. Put browser JS in `scripts/*.js` loaded from the
  page shell.
- Use JPG/PNG for images; avoid WebP in Palbuilder.

## Acceptance Checklist

- [ ] User was asked for palette/brand color and 2-3 reference photos/screenshots; default palette
      used only when they did not care or could not provide them.
- [ ] Palette workflow used or explicitly skipped: generate options, narrow, refine harmony, check
      WCAG AA, preview on real UI, export semantic CSS variables.
- [ ] Typography is system-stack or Fontshare; icons are inline SVG from one approved family; GSAP
      strategy is documented for scripted animation.
- [ ] `design/refs/` contains durable reference assets and notes.
- [ ] `DESIGN_SYSTEM.md` exists with semantic tokens, density/layout, accessibility, Do / Don't,
      and Palbuilder stack mapping.
- [ ] `COMPONENTS.md` exists with primitives, composites, layout shells, states, and recipe links.
- [ ] Direction was checked against anti-slop fingerprints.
- [ ] Direction was checked against `references/design-principles.md`: user journey, hierarchy,
      grouping, Fitts target sizing, typography, color meaning, consistency, and simplicity.
- [ ] Component choices point to Palbuilder-valid recipes in `references/component-library.md`.
- [ ] Extract mode only: every token cites a real source; inconsistencies are documented, not
      silently normalized.
