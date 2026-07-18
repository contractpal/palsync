# COMPONENTS — palsync UX benchmark recipes

Copy recipe CSS verbatim, with values unchanged, from the reference catalog; a re-derived
approximation of a catalogued component is a defect.

These are approved pb-* recipe references. Compose the subset the content needs; do not invent
class names or force every page through the same template. Copy only used recipe rules and their
dependencies into `styles/styles.css`; the full `design-system.css` remains reference-only and is
never loaded. Every class must resolve in runtime `styles/spacing.css` or `styles/styles.css`.

## Shared app/CRUD

- **AppShell** — page owns `<main id="body" class="pb-main">`; feature fragment root is
  `pb-section`. `c:debug` sits outside authored main content.
- **PageHeader** — `pb-page-head`: `pb-title` + optional `pb-subtitle`, with one right-side
  `pb-btn pb-btn-primary` action.
- **DataTable** — `pb-table` inside `pb-table-wrap`; semantic header row; every `td` has
  `data-label`; text left, numeric `pb-num`; responsive mobile record collapse.
- **RowActions** — `pb-row-actions`. One or two frequent safe actions use secondary/ghost buttons.
  Delete is last, `pb-btn-danger`, spatially separated, and carries the exact `confirm=` copy.
- **StatusBadge** — `pb-badge` plus semantic variant; available/open = `pb-badge-success`,
  checkedOut/completed = `pb-badge-neutral`, cancelled = `pb-badge-danger`. Status text remains.
- **FormCard** — `pb-card pb-form-card` containing `pb-stack`; each field is `pb-field-group` with
  visible top `pb-label` and `pb-input`/`pb-select`/`pb-textarea`. `pb-form-actions` holds primary
  Save and ghost Cancel. Controls fill their bounded field group; use `pb-field-group--short` or
  `pb-field-group--medium` when the expected answer is compact. `pb-form-grid` is allowed only for
  short related fields.
- **InlineError** — `pb-field-error` adjacent to its control with `role="alert"`; invalid value
  remains visible for correction.
- **EmptyState** — `pb-state` with `pb-state-title`, optional `pb-state-msg`, and at most one
  relevant action. Never a bare “No data” line.
- **Alert/Feedback** — `pb-alert` semantic variant for task feedback near the affected region.
- **FilterBar** — `pb-filterbar`: labeled search/select controls and one secondary Apply action.
- **DetailPanel** — `pb-detail` / `pb-description-list` for a single record.

## Shared marketing

- **MarketingShell** — one `<main id="main">`, focus-only `pb-skip-link`, full-width
  `pb-navbar pb-navbar--marketing`, and `pb-footer`.
- **MarketingHero** — `pb-hero pb-hero--split`: left `pb-stack` with eyebrow, `pb-hero-title`,
  `pb-hero-sub`, primary + ghost CTA; right `pb-proof-panel` or approved real media. Centered hero
  requires explicit content rationale.
- **OutcomeList** — `pb-outcome-list` containing `pb-outcome` rows with `pb-outcome-index`,
  `pb-outcome-title`, and `pb-outcome-desc`. Prefer this content-led hierarchy to equal cards.
- **EditorialSplit** — `pb-marketing-section` -> `pb-marketing-inner pb-editorial-split`: concise
  section intro beside an OutcomeList, process, comparison, or approved content.
- **ServiceList** — an OutcomeList with approved service names/descriptions; number or letter rows
  to support scanning. No fabricated benefits.
- **ContentSection** — `pb-marketing-section` with readable copy in `pb-stack`; keep prose measure
  bounded and composition distinct from the Home hero.
- **ContactPanel** — bounded `pb-proof-panel` or `pb-card pb-form-card` with the approved contact
  line and one clear CTA; no empty half-screen spacer.
- **CTASection** — `pb-cta-band` on the default light surface. `pb-cta-band--strong` is allowed
  once only when a dark focal band is intentional.
- **FooterNav** — three-column `pb-footer-inner` (brand + two link groups) and compact
  `pb-footer-bottom`; links cover every §3 marketing route.
