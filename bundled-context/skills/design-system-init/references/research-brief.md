# Design Research Brief

This reference translates the requested research set into rules palsync can apply inside
Palbuilder. It is not a link dump. Use it to make decisions when `design-system-init` asks for
foundations or `design-build` needs a tie-breaker.

## Primary Articles

- Component libraries: https://www.designsystemscollective.com/the-ui-component-libraries-that-actually-save-hours-part-1-3-e9503b3d8642
- Color, icons, typography: https://www.designsystemscollective.com/color-tools-and-icon-libraries-that-actually-work-part-2-3-f7b3dd71dd5b
- Design systems and CSS tools: https://mohitphogat.medium.com/design-systems-and-css-tools-worth-bookmarking-part-3-3-6d12a6b9df74

## What To Borrow

### Component systems

- shadcn/ui, Tailwind Plus, Catalyst, v0: prefer owned code over opaque runtime dependencies.
  Palbuilder cannot install React component packages into a pal, so copy the idea: small recipes,
  semantic class names, variants, and states the project owns.
- Headless UI and Radix: separate behavior/anatomy from styling. For Palbuilder, that means
  documenting component states and keyboard/focus expectations even when the implementation is
  plain XHTML plus `c:` tags.
- MUI and Chakra: component coverage matters. A design system is not finished if it has a button
  and card but no table, loading state, error state, modal, filters, or forms.
- Nuxt UI and daisyUI: semantic tokens and semantic class names help agents move fast. Use
  `--ds-primary`, `--ds-surface`, `.pb-btn`, `.pb-card`, `.pb-table`; do not scatter raw hex values
  and one-off utilities.
- Polaris, Atlassian, Carbon: complex product UI needs dense data patterns, permissions/actions,
  filtering, bulk actions, activity, and data visualization rules. These matter more to console pals
  than marketing hero polish.
- Magic UI and Aceternity: motion and visual personality can help public/marketing surfaces, but
  for Palbuilder they must be restrained, CSS/external-JS based, and never block core workflows.

### Color and palette workflow

- Ask for palette/reference images first. If none, use the default palette in `SKILL.md`.
- Use palette tools as thinking aids:
  - Coolors and Adobe Color for exploration, image extraction, and contrast checking.
  - Realtime Colors for seeing text/background/primary/accent distribution on UI, not in swatches.
  - Paletton when color harmony or color-vision simulation matters.
  - Khroma when the user has taste references but no palette.
  - ColorSpace when the user has one brand hex and needs supporting tones.
- Commit semantic roles, not raw swatches: background, surface, text, muted text, border, primary,
  primary text, accent, success, warning, danger, info.
- Keep saturated colors rare. Most hierarchy should come from type, spacing, borders, and surface
  tone.
- Verify text contrast: normal text at least WCAG AA 4.5:1, large text at least 3:1, focus rings
  visible against both surface and page background.

### Icons and imagery

- Prefer one stroke icon family. Lucide is the default for palsync because it is consistent,
  lightweight, customizable SVG, and broad enough for product UI.
- Heroicons is a good fallback for Tailwind-like UI. Tabler and Phosphor are useful when Lucide lacks
  a specific domain concept. Noun Project is for highly specific concepts, but check license and
  attribution before use.
- Inline SVG in Palbuilder fragments. Do not depend on icon fonts or JS replacers; AJAX fragments do
  not rerun page boot code automatically.
- Reference photos should influence composition, palette temperature, density, and imagery rules,
  not become copied brand assets.

### Typography

- Prefer one strong UI family and one optional display family. Most console pals should use only the
  UI family.
- Good UI defaults: Manrope, Source Sans 3, IBM Plex Sans, Plus Jakarta Sans, or system UI.
- Good display accents when the product genuinely needs editorial tone: Source Serif 4, Newsreader,
  Playfair Display. Use sparingly.
- Fontsource is best when the stack can self-host. In Palbuilder, a Google Fonts `<link>` in the page
  head is acceptable when the environment allows external assets; otherwise use system stacks.
- Body text uses `rem`; spacing/radius/borders can stay in `px`.

### CSS and motion

- Palbuilder supports external CSS well; favor CSS custom properties and component classes over a
  build-time framework. Tailwind/Open Props still inform the structure: tokens, scales, responsive
  rules, and small composable classes.
- Do not require Tailwind, UnoCSS, React, Vue, Framer Motion, or build tooling inside a pal. Translate
  their ideas into plain CSS and Palbuilder fragments.
- Motion defaults: 120-180ms for hover/press/focus, 180-240ms for panels/modals, 400-700ms only for
  progress/chart changes. Respect `prefers-reduced-motion`.
- GSAP/Lottie are reserved for public marketing or narrative surfaces with explicit need. Console and
  workflow pals should stay CSS-first.

## Design System Coverage Target

A Palbuilder design system should be able to cover:

- Page shells: console app frame, public page frame, modal shell, detail drawer/panel.
- Navigation: topbar, sidebar, tabs, breadcrumbs, mobile nav.
- Actions: primary/secondary/ghost/destructive buttons, icon buttons, split/overflow action areas.
- Forms: text, textarea, select, checkbox, toggle, radio-like choice, field groups, validation,
  upload.
- Data: tables, responsive record cards, filters/search, pagination, bulk action bar, status chips,
  KPI/stat cards, progress bars/rings, simple charts.
- States: loading skeletons, empty, error, success toast/alert, disabled, permission-denied,
  read-only.
- Workflow: stepper, review/approval block, activity feed, timeline, attachments.
- Content: hero/marketing section only when the pal is public-facing; no landing-page theater for
  dense operational tools.

## Palbuilder Translation Rules

- Component library means recipes, CSS classes, and fragments. Do not imply React/Vue imports.
- Every recipe must be valid XHTML: self-close void elements and SVG children.
- Use only documented `c:` tag attributes. Cross-check `palbuilder-frontend/references/c-tags.md`.
- Keep CSS in `styles/*.css`; keep JS in `scripts/*.js`; fragments have no inline `<script>`.
- Use `c:a` for server actions and `ajax-target` updates. JS-only controls use plain `<button>`.
- For data rows, use `c:list` with direct EL.
- For bound form inputs, use `c:field` and the label/error pattern from the component library.

## Decision Heuristics

- Dense console UI: borrow from Polaris/Atlassian/Carbon. Prioritize table density, filters,
  keyboard focus, status clarity, and compact action bars.
- Public web/marketing UI: borrow from Tailwind Plus/Magic/Aceternity only after content is real.
  Use visual assets, but avoid generic gradients and card-heavy hero sections.
- CRUD/admin UI: borrow from MUI/Chakra/Nuxt for full component coverage and semantic variants.
- Custom component behavior: borrow from Radix/Headless anatomy, then implement in Palbuilder-valid
  markup and external JS only if required.
- Fast prototyping: borrow daisyUI's semantic class idea, not its dependency.
