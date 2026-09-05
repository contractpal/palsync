---
name: design-system-init
description: "Load to create/extract DESIGN_SYSTEM.md + COMPONENTS.md before non-trivial new/redesigned UI. Does not build screens."
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
     the six shipped presets below. Directions never replace a shipped preset in the no-reference
     path.
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
   - Font: what font, if any, is named by the user, spec, or references? No font named plus a console
     target means the system font stack only and no Fontshare import.
   - Any platform constraints: Bootstrap already loaded, existing fragment structure, locked
     enterprise branding, old browser concerns?

Stop once you can state the design intent in 2-3 sentences and the user agrees. If the user says
"you decide", use the default palette and component system below.

**Extract mode:** skip external reference questions. Ask only product/user/constraints, then derive
palette and components from the existing pal.

## Presets
**ink** — neutral/high-contrast default; **indigo** — confident SaaS; **emerald** — growth/trust;
**amber** — warm/energetic; **rose** — bold/consumer; **slate-dark** — technical dark-first.
Read `references/presets.md` and apply the chosen preset's full token table.

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

Curate the system. Do not transcribe every color from a screenshot; references remain the primary authority (see Reference precedence). Distil their mood, composition, and density into coherent tokens.

Define:
- Color roles: background, subtle background, surface, raised surface, text, muted text, soft text, border, strong border, primary, primary hover, primary soft, primary text, accent, success, warning, danger, info.
- Type: UI family, optional display family, scale, weight range, numeric rules. Fonts are system or Fontshare; no remote page-head font or Google Fonts default. A used Fontshare import is line 1 of `styles.css`. **Console system font rule:** absent a user/spec/reference choice, use `--ds-font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;` with no Fontshare `@import`; record explicit web-font choices in `DESIGN_SYSTEM.md`.
- Iconography: always grab the SVG version; use one family from Iconoir (default), Heroicons, or Phosphor; never use icon fonts or JS replacers. See component-library.md Icons.
- Runtime files: create/register/link one authored `styles/styles.css`. `references/design-system.css` is reference-only: select only the smallest dependency-complete rules used by the pal; never create/register/link it as runtime CSS. Add `references/spacing.css` only with consumers, before `styles.css`; add `pb-ui.js` and `pb-motion.js` individually only with consumers, once as modules. `spacing.css` replaces Bootstrap for spacing/layout utilities.
- Optional charts: for showcase/chart-heavy pals only, add `<c:resource source="chartjs" version="4.0.0" name="chart.js" />` and `scripts/pb-charts.js` from `references/pb-charts.js`; it is outside the core four-file byte-identity set.
- Radius, border, shadow, elevation: select only the `--ds-radius-*` / `--ds-shadow-*` tokens used
  by copied component rules, then define them once in `styles.css`.
- Motion: `scripts/pb-motion.js` is the only motion layer: `data-animate="fade-up|fade-in|fade-left|fade-right|zoom-in|blur-in|scale-in|slide-up-lg|flip-up"` (+ delay/duration/stagger), `data-ticker`, `data-typewriter`, `data-tilt`, `data-spotlight`, `data-scroll-progress`. Include it only with those attributes; see the marketing recipes and component-library load-order note.
- Density: map the interview answer to tokens and write the numbers into DESIGN_SYSTEM.md — compact: section gap --ds-space-5 (20px), card padding --ds-space-4; balanced (default): section gap --ds-space-6 (24px), card padding --ds-space-5; spacious: section gap --ds-space-8 (32px), card padding --ds-space-6. Define only the selected spacing tokens in `styles.css`.
- UX flow: primary path, hierarchy order, progressive disclosure, Fitts target rules, Gestalt
  grouping, and how complexity is staged.

### 3. Build the component inventory

Use `references/component-library.md` for app/console components and `references/marketing-library.md` for marketing sections; load the latter only for marketing pages. Copy selected dependency-complete recipes verbatim into readable `styles/styles.css`. Custom CSS is page-layout glue; justify recipe changes in `DESIGN_SYSTEM.md`. `COMPONENTS.md` names current components and likely shared primitives, but CSS ships only with a markup consumer. Record variants, states, tokens, and Palbuilder patterns.

Required baseline for most pals:
- Primitives: Button, IconButton, ButtonGroup, Field, Textarea, InputGroup, Select, Checkbox, Toggle, Radio/ChoiceCard, SegmentedControl, Slider, Badge, Alert, Card, Divider, Skeleton, Progress, Avatar/Initial, Tooltip/help text, Kbd, Spinner.
- Data: Table, responsive record list, stat/KPI card, filter bar, pagination, empty/error state, data-grid affordances, row/bulk actions, charts, metrics panel.
- Shells: page shell, topbar/sidebar/nav, toolbar, modal body, drawer/sheet, popover, command palette, responsive mobile nav.
- Domain composites: workflow stepper, activity feed, file upload/attachments, data-detail row, approval actions, CRUD form, review summary, comment thread, kanban/status board, calendar/list schedule, settings page, onboarding checklist.

The inventory maps to Palbuilder fragments/classes, not React components. A primitive may be a CSS
class plus a markup recipe. A composite may be a fragment under `fragments/common/` or a feature
fragment under `fragments/<area>/`.

### 4. Anti-slop check

Check anti-slop fingerprints: gradient-blob hero, uniform pill-everything radius, and generic
Inter/Roboto + gray cards + blue primary. Read `../shared/references/anti-slop.md` for the full list.
If requested, keep the choice intentional; in extract mode, document existing fingerprints.

### 5. Write DESIGN_SYSTEM.md
Copy the `DESIGN_SYSTEM.md` template from `references/output-templates.md` verbatim, then fill it.

### 6. Write COMPONENTS.md
Copy the `COMPONENTS.md` template from `references/output-templates.md` verbatim, then fill it.

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
- Font policy: see "Synthesize foundations" above — console pals = system stack, no Fontshare.
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
- [ ] `design/refs/` contains durable reference assets and notes.
- [ ] `DESIGN_SYSTEM.md` exists with semantic tokens, density/layout, accessibility, Do / Don't,
      and Palbuilder stack mapping.
- [ ] `design-system.css` is reference-only and must never be copied, registered, linked, loaded, or shipped; only needed rules go to `styles/styles.css`.
- [ ] Chosen `data-preset` is set on `<html>` (omitted entirely for `ink`).
- [ ] No unused design-system component families, presets, dark-theme blocks, or behavior scripts
      were copied "just in case"; every included block has a markup/behavior consumer.
- [ ] `COMPONENTS.md` exists with primitives, composites, layout shells, states, and recipe links,
      including `references/marketing-library.md` sections when the pal has marketing pages.
- [ ] Direction was checked against `references/design-principles.md`: user journey, hierarchy,
      grouping, Fitts target sizing, typography, color meaning, consistency, and simplicity.
- [ ] Component choices point to Palbuilder-valid recipes in `references/component-library.md`
      (app/console) or `references/marketing-library.md` (marketing sections) — no invented CSS.
- [ ] Extract mode only: every token cites a real source; inconsistencies are documented, not
      silently normalized.
- [ ] Then run every item in `../shared/references/ui-acceptance.md`.
