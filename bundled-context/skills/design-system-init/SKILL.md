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
  examples for app/console UI. CSS recipes live in the reference-only `design-system.css`; copy
  only the tokens, base rules, and component rules this pal actually uses into `styles/styles.css`.
  Add `pb-ui.js` / `pb-motion.js` only when selected components need their behavior.

When extracting from the large `design-system.css` or `component-library.md`, use targeted
`rg -n '<selector>' <file>` searches to locate relevant line numbers, then read only those blocks.
Never read or regex-scan either whole file into context.
- `references/marketing-library.md` instead, when the pal (or a page of it) is marketing-oriented:
  hero, bento, pricing, testimonials, logo cloud, CTA band, stats/ticker, mockups, text/glow
  effects. Console-only pals should never need to load this file.
- `references/spacing.css` — the optional spacing/layout utility layer. `references/design-system.css`
  is a catalog, never a pal asset: do not copy, register, link, or load it wholesale. Curate the
  dependencies and recipes actually used into the new pal's authored `styles/styles.css`.
- `references/vision-routing.md` whenever reference photos/screenshots or rendered output must be
  judged visually.

The job is not to theme a generic dashboard. The job is to make a pal feel designed: clear intent,
semantic tokens, complete states, accessible interaction, real responsive behavior, tasteful motion,
excellent SVG icons, and a reusable component vocabulary that works in Palbuilder XHTML and `c:`
tags. The quality target is shadcn/ui-level clarity with Polaris/Carbon-level operational coverage,
translated into Palbuilder-owned CSS and fragments.

Design quality starts before colors. Establish the user's journey, visual hierarchy, grouping,
target sizing, progressive disclosure, and typography rules before choosing decorative treatments.

## Reference precedence

When the user provides reference images, screenshots, apps, or sites, **those references are the
primary design authority — the inspiration above all else.** Everything else in this skill (the
default palette, the six presets, token defaults, density, radius, motion) is the *fallback for when
no reference exists*, not a ceiling on what a reference may specify. The reference wins over any
default aesthetic choice.

Honor references within the platform's runtime constraints:
- Derive palette, type feel, density, radius, and composition **from the reference**, then express
  the required tokens and component rules directly in the new pal's readable `styles/styles.css`.
  Never make the reference catalog a runtime dependency, and never discard what the reference asks
  for just to sit on a default preset.
- Curate for coherence and accessibility (AA contrast, semantic roles), **not** to dilute the
  reference. Curation resolves a system out of the reference's intent; it never overrules the
  reference's mood, composition, or density with a generic default.

If no reference is provided, say so, use the default system below, and state the assumption.

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
     AA contrast, preview in a real UI (Realtime Colors-style), then map the direction onto one of
     the six shipped presets below (or override a handful of tokens on top of the closest one).
   - Which shipped preset fits the vibe: `ink` (default — near-black primary on cool white/light-gray
     surfaces; neutral, professional, works almost anywhere), `indigo` (deep indigo-violet primary;
     confident, techy, SaaS), `emerald` (deep green primary; growth, trust, finance/health), `amber`
     (warm amber-orange primary; energetic, warm, retail/hospitality), `rose` (bold rose-red primary;
     bold, creative, consumer-facing), or `slate-dark` (dark navy surfaces with a periwinkle accent;
     dark-first, technical/ops dashboards)? This sets `data-preset` on `<html>` (omit it entirely for
     `ink`) — it does not require writing any CSS.
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

## Presets

The reference catalog contains a full token set plus six `:root[data-preset="..."]` examples.
Select the closest palette and copy only its required base tokens into `styles.css`; do not copy all
presets just to use one.

- **ink** (default, no attribute needed) — near-black primary on cool white/light-gray surfaces.
  Neutral, crisp, high-contrast; the primary action reads ink, accent color appears only for
  highlights, charts, and product-specific moments. Fits almost any product.
- **indigo** — deep indigo-violet primary. Confident, techy, SaaS.
- **emerald** — deep green primary. Growth, trust, finance/health.
- **amber** — warm amber-orange primary. Energetic, warm, retail/hospitality.
- **rose** — bold rose-red primary. Bold, creative, consumer-facing.
- **slate-dark** — dark navy surfaces with a periwinkle accent. Dark-first, technical/ops
  dashboards.

Set `data-preset="indigo|emerald|amber|rose|slate-dark"` on `<html>` in the page shell; omit the
attribute entirely for `ink`. A brand color that doesn't match any preset is a small set of
`--ds-*` values in `styles.css`, not a copy of every preset. Check `--ds-primary-text` for AA
contrast whenever a primary color changes. The presets are convenient starting points, not a
constraint that overrides the reference.

Dark mode is opt-in: if required, copy the relevant `[data-theme="dark"]` rules and token
dependencies into `styles.css`, and include the theme-toggle portion of `pb-ui.js` only when the UI
offers a toggle. Do not ship unused dark-theme rules.

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

Curate the system. Do not transcribe every color from a screenshot — but when references exist they
are the primary authority (see Reference precedence): distil their mood, composition, and density
into coherent tokens rather than overruling them with a default.

Define:
- Color roles: background, subtle background, surface, raised surface, text, muted text, soft text,
  border, strong border, primary, primary hover, primary soft, primary text, accent, success,
  warning, danger, info.
- Type: UI family, optional display family, scale, weight range, numeric rules. Fonts must be
  system fonts or Fontshare fonts. Palbuilder rejects remote page-head font resources; Fontshare
  loads only through an `@import` kept as line 1 of the pal's `styles.css`. Copy that import from
  the reference only when the chosen Fontshare family is used. Do not default to Google Fonts.
- Iconography: always grab the SVG version; never use icon fonts or JS icon replacers. Use one family
  per pal from Iconoir (default), Heroicons, or Phosphor; see component-library.md Icons.
- Runtime files: create one authored `styles/styles.css`, register it in `pal.json`, and link it
  once. Use `references/design-system.css` only to select the smallest dependency-complete set of
  tokens, base rules, and component recipes used by the pal. Never create/register/link a runtime
  `design-system.css`. Add `references/spacing.css` only if its utility classes are actually used;
  link order is `spacing.css` (if used) → `styles.css`. Add `pb-ui.js` and `pb-motion.js`
  individually only when selected markup uses their documented behaviors; load each selected script
  once as `<script type="module" src="...">`. `spacing.css` is the Bootstrap replacement for
  spacing/layout utilities (container widths, `.row`/`.col-*`, flex/display helpers, gaps, margin,
  padding, width/height, visibility) — do not use Bootstrap for spacing.
- Optional charts: for showcase or chart-heavy pals only, add the platform resource
  `<c:resource source="chartjs" version="4.0.0" name="chart.js" />` and load
  `scripts/pb-charts.js` from `references/pb-charts.js`. This is opt-in and not part of the core
  four-file byte-identity set.
- Radius, border, shadow, elevation: select only the `--ds-radius-*` / `--ds-shadow-*` tokens used
  by copied component rules, then define them once in `styles.css`.
- Motion: `scripts/pb-motion.js` is the only motion layer — `data-animate="fade-up|fade-in|
  fade-left|fade-right|zoom-in|blur-in|scale-in|slide-up-lg|flip-up"` (+ `data-animate-delay`/`-duration`/`-stagger`),
  `data-ticker`, `data-typewriter`, `data-tilt`, `data-spotlight`, `data-scroll-progress`. It is
  data-attribute driven; include the script only when those attributes are present. See
  `references/marketing-library.md` for marketing motion recipes and
  `references/component-library.md`'s load-order note for app pals.
- Density: map the interview answer to tokens and write the numbers into DESIGN_SYSTEM.md — compact: section gap --ds-space-5 (20px), card padding --ds-space-4; balanced (default): section gap --ds-space-6 (24px), card padding --ds-space-5; spacious: section gap --ds-space-8 (32px), card padding --ds-space-6. Define only the selected spacing tokens in `styles.css`.
- UX flow: primary path, hierarchy order, progressive disclosure, Fitts target rules, Gestalt
  grouping, and how complexity is staged.

### 3. Build the component inventory

Use `references/component-library.md` as the canonical Palbuilder-ready library for app/console
components, and `references/marketing-library.md` for marketing sections (hero, bento, pricing,
testimonials, logo cloud, CTA band, stats/ticker, mockups, text effects) — load marketing-library
only when the pal actually has marketing pages. Copy the dependency-complete CSS recipes for the
components actually selected into readable `styles/styles.css`. In
`COMPONENTS.md`, name only the components this pal
needs now plus likely shared primitives, but do not copy CSS for a likely component until markup
uses it. Every component must list variants, states, tokens, and
the Palbuilder implementation pattern.

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
the chosen palette/preset source (or "ink,
no attribute"), fragment naming, c: tag patterns, which recipes from
references/component-library.md (and references/marketing-library.md if the pal has marketing
pages) to use, SVG icon family, and Fontshare/system font choice.]
```

### 6. Write COMPONENTS.md

Use this exact structure:

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

### 7. Confirm

Show the user:
- Intent paragraph.
- Color/type direction.
- Do / Don't list.
- Component inventory headline list.

Ask whether it matches the desired feel. In extract mode, ask whether it matches the live pal's
reality. A correction means re-check references or source files before editing the docs.

## Palbuilder Rules For The Design System

- Every pal owns `styles/styles.css`: a human-readable, dependency-complete selection of only the
  tokens, base rules, and component recipes its markup uses. `references/design-system.css` is a
  catalog only — never copy, register, link, or load the whole file. Add `styles/spacing.css`,
  `scripts/pb-ui.js`, and `scripts/pb-motion.js` only when their utilities/behaviors are used.
- Page shell `<head>` link/script order: optional `styles/spacing.css` → `styles/styles.css`, then
  each selected behavior script exactly once as
  `<script type="module" src="../Scripts/pb-ui.js"></script>` /
  `<script type="module" src="../Scripts/pb-motion.js"></script>`. Set `data-preset="..."` on
  `<html>` (omit for `ink`).
- `spacing.css` replaces Bootstrap for spacing/layout. Only load Bootstrap when a legacy pal already
  depends on Bootstrap behavior or a specific platform resource is explicitly required.
- Fragments use `<c:ignore xmlns:c="contractpal">` and contain no `<html>`, `<head>`, `<body>`,
  or inline `<script>`.
- Server actions use `c:a` / `c:button` / `c:select` with only documented attributes from
  `palbuilder-frontend/references/c-tags.md`.
- `c:list` rows use direct EL: `${row.field}`.
- Use `c:field` for bound inputs, but do not put ARIA attributes on `c:field`; pair it with a
  wrapping `<label>` and sibling `role="alert"` message.
- Inline SVG icons are allowed; self-close SVG children and use one icon family.
- Icon fonts and JS icon replacement libraries are not allowed. Always grab the SVG export and use
  inline SVG from Iconoir, Heroicons, or Phosphor; see component-library.md Icons.
- Use system fonts or Fontshare fonts. Do not introduce a Google Fonts dependency by default.
- Load Fontshare only through an `@import` at the top of `styles.css`; never add remote page-head
  font resources or copy unused font imports.
- When motion is used, it is `scripts/pb-motion.js` data attributes only (`data-animate`, `data-ticker`,
  `data-typewriter`, `data-tilt`, `data-spotlight`, `data-scroll-progress`) — no other animation
  library. It delegates from `document` and rescans AJAX-swapped fragments itself; never add a
  per-fragment `<script>` or re-init call.
- Never place `${...}` inside inline `<script>`. Put browser JS in `scripts/*.js` loaded from the
  page shell.
- Use JPG/PNG for images; avoid WebP in Palbuilder.

## Acceptance Checklist

- [ ] User was asked for palette/brand color and 2-3 reference photos/screenshots; default `ink`
      preset used only when they did not care or could not provide them.
- [ ] Palette workflow used or explicitly skipped: generate options, narrow, refine harmony, check
      WCAG AA, preview on real UI, map onto a shipped preset (or override a few tokens on top).
- [ ] Typography is system-stack or Fontshare; icons are inline SVG from one approved family.
- [ ] `design/refs/` contains durable reference assets and notes.
- [ ] `DESIGN_SYSTEM.md` exists with semantic tokens, density/layout, accessibility, Do / Don't,
      and Palbuilder stack mapping.
- [ ] `styles/styles.css` is present, registered, human-readable, and contains only the tokens,
      bases, and component recipes used by pal markup; `design-system.css` is absent from the pal,
      `pal.json`, and page links.
- [ ] Optional `spacing.css`, `pb-ui.js`, and `pb-motion.js` are present only when used; each selected
      file is registered and loaded exactly once (`type="module"` for scripts).
- [ ] Chosen `data-preset` is set on `<html>` (omitted entirely for `ink`).
- [ ] No unused design-system component families, presets, dark-theme blocks, or behavior scripts
      were copied "just in case"; every included block has a markup/behavior consumer.
- [ ] `COMPONENTS.md` exists with primitives, composites, layout shells, states, and recipe links,
      including `references/marketing-library.md` sections when the pal has marketing pages.
- [ ] Direction was checked against anti-slop fingerprints.
- [ ] Direction was checked against `references/design-principles.md`: user journey, hierarchy,
      grouping, Fitts target sizing, typography, color meaning, consistency, and simplicity.
- [ ] Component choices point to Palbuilder-valid recipes in `references/component-library.md`
      (app/console) or `references/marketing-library.md` (marketing sections) — no invented CSS.
- [ ] Extract mode only: every token cites a real source; inconsistencies are documented, not
      silently normalized.
