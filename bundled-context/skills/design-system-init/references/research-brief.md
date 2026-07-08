# Design Research Brief

This reference translates the requested research set into rules palsync can apply inside
Palbuilder. It is not a link dump. Use it to make decisions when `design-system-init` asks for
foundations or `design-build` needs a tie-breaker.

## Primary Articles

- Component libraries: https://www.designsystemscollective.com/the-ui-component-libraries-that-actually-save-hours-part-1-3-e9503b3d8642
- Color, icons, typography: https://www.designsystemscollective.com/color-tools-and-icon-libraries-that-actually-work-part-2-3-f7b3dd71dd5b
- Design systems and CSS tools: https://mohitphogat.medium.com/design-systems-and-css-tools-worth-bookmarking-part-3-3-6d12a6b9df74
- Design fundamentals: Figma Design Basics and linked articles on hierarchy, UX, UI principles,
  interaction design, Fitts' law, Gestalt, color theory, typography, consistency, simplicity,
  design tokens, and skeuomorphism. Use `design-principles.md` for the actionable distilled rules.

## What To Borrow

### Component systems

- shadcn/ui, Tailwind Plus, Catalyst, v0: prefer owned code over opaque runtime dependencies.
  Palbuilder cannot install React component packages into a pal, so copy the idea: small recipes,
  semantic class names, variants, states, and copyable source the project owns. shadcn's current
  coverage is the minimum competitive bar: accordion, alert/dialog, avatar, badge, breadcrumb,
  button group, calendar/date picker, carousel, chart, checkbox, collapsible, combobox, command,
  context/dropdown menu, data table, drawer/sheet, empty, field/input groups, hover card, kbd,
  menubar/navigation, pagination, popover, progress, radio, resizable, scroll area, select, sidebar,
  skeleton, slider, spinner, switch, table, tabs, textarea, toast/sonner, toggle group, tooltip, and
  typography.
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

### Design fundamentals

- UX precedes UI. Start every screen with the user state, job, entry point, first decision, primary
  action, feedback, and next step.
- Visual hierarchy is a priority order, not a type scale. Use content order, size, spacing, weight,
  contrast, color, and motion to guide attention deliberately.
- Gestalt principles are practical layout rules: proximity groups related controls, similarity
  establishes roles, common regions frame complex groups, continuity helps scanning, and one focal
  point can break the pattern for emphasis.
- Fitts' law belongs in component specs: frequent and primary actions need adequate target size and
  proximity to the user's likely path; destructive actions need separation.
- Simplicity means staged complexity. Use progressive disclosure, drawers, accordions, details,
  filters, and command palettes to keep the default view clear without deleting necessary power.
- Consistency is an affordance. Same role means same placement, state, label pattern, and behavior;
  break consistency only to solve a real user problem.

### Color and palette workflow

- Ask for palette/reference images first. If none, use the default palette in `SKILL.md`.
- The default workflow is:
  1. Generate 20-30 palette directions in a Coolors-style generator.
  2. Pick the strongest 2-3 based on product fit, contrast potential, and distinctiveness.
  3. Refine the chosen palette in an Adobe Color-style harmony pass.
  4. Check contrast before committing roles: WCAG AA 4.5:1 for normal text and 3:1 for large text
     and non-text UI indicators.
  5. Preview on an actual interface in Realtime Colors or an equivalent mockup, not just swatches.
  6. Export semantic CSS variables and document the derivation.
- Use palette tools as thinking aids:
  - Coolors and Adobe Color for exploration, image extraction, and harmony refinement.
  - Realtime Colors for seeing text/background/primary/accent distribution on UI.
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

- Prefer one SVG icon family per pal. The approved default set is Iconoir, Tabler, and Phosphor:
  Iconoir and Tabler for crisp stroke-based product UI, Phosphor when a pal needs broader weights or
  friendlier object metaphors.
- Heroicons is useful as a Tailwind-aesthetic reference, but generated Palbuilder markup should still
  inline the chosen SVG paths. Noun Project is for highly specific concepts only after checking
  license and attribution.
- Inline SVG in Palbuilder fragments. Do not depend on icon fonts, external sprite injection, or JS
  replacers; AJAX fragments do not rerun page boot code automatically.
- Reference photos should influence composition, palette temperature, density, and imagery rules,
  not become copied brand assets.

### Typography

- Prefer one strong UI family and one optional display family. Most console pals should use only the
  UI family.
- Good UI defaults: system UI, Satoshi, General Sans, Switzer, Supreme, or other Fontshare sans
  families selected for the brand.
- Good display accents when the product genuinely needs editorial tone: Cabinet Grotesk, Gambetta,
  Boska, Sentient, Newsreader, or Playfair-like Fontshare alternatives. Use sparingly.
- Fonts must be system-stack or Fontshare. Fontsource-style self-hosting is preferred when build
  tooling exists; in Palbuilder, use the Fontshare CSS link selected for the project when external
  assets are allowed. Do not default to Google Fonts.
- Body text uses `rem`; spacing/radius/borders can stay in `px`.

### CSS and motion

- Palbuilder supports external CSS well; favor CSS custom properties and component classes over a
  build-time framework. Tailwind/Open Props still inform the structure: tokens, scales, responsive
  rules, and small composable classes.
- Every generated pal should include `styles/spacing.css` as the stable spacing/layout utility
  layer. It replaces Bootstrap for containers, rows/columns, display/flex, gaps, margin, padding,
  width/height, and visibility helpers while keeping theme/component CSS project-specific.
- Do not require Tailwind, UnoCSS, React, Vue, Framer Motion, or build tooling inside a pal. Translate
  their ideas into plain CSS and Palbuilder fragments.
- Motion defaults: 120-180ms for hover/press/focus, 180-280ms for panels/modals, 400-700ms only for
  progress/chart changes. Respect `prefers-reduced-motion`.
- GSAP is the standard JavaScript animation library for palsync when scripted motion is needed:
  mounted section reveals, drawer/modal choreography, command palette open/close, chart/count-up
  reveals, reorder/FLIP, and scroll storytelling. Keep simple hover/focus states in CSS. Console and
  workflow pals should use restrained GSAP; public/narrative pals can be more expressive.

## Design System Coverage Target

A Palbuilder design system should be able to cover:

- Page shells: console app frame, public page frame, modal shell, detail drawer/panel.
- Navigation: topbar, sidebar, tabs, breadcrumbs, mobile nav, command palette, menu/overflow.
- Actions: primary/secondary/ghost/destructive buttons, icon buttons, button groups, split actions,
  menus, contextual row actions.
- Forms: text, textarea, input group, select, combobox, checkbox, toggle, radio, choice cards,
  segmented control, slider, date picker, OTP/PIN, field groups, validation, upload.
- Data: tables, responsive record cards, data-grid affordances, filters/search, pagination, bulk
  action bar, status chips, KPI/stat cards, progress bars/rings, charts, metrics panels, kanban.
- States: loading skeletons, empty, error, success toast/alert, disabled, permission-denied,
  read-only.
- Workflow: stepper, review/approval block, activity feed, timeline, attachments, comments/messages,
  schedule/calendar list, settings panels, onboarding checklist.
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
