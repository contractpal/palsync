# COMPONENTS — palsync test suite (minimal stub)

Every §6 layout line in a test SPEC names one of these. Nothing else may be invented.
All classes come from the shipped `styles/design-system.css` / `styles/spacing.css` (pb-*
system). No external CSS framework is loaded; a class that appears in markup but in no
shipped stylesheet is a defect.

- **PageHeader** — `pb-cluster` row: `h1` screen title + optional right-aligned primary
  action (`pb-btn pb-btn-primary`).
- **DataTable** — `pb-table` inside `pb-table-wrap`; header row; one row per record; per-row
  action links (c:a) as `pb-btn pb-btn-secondary` in the actions cell. Wrapped in a fragment
  so it can be an ajax-target. Destructive row actions (Delete) carry `confirm=` and use
  `pb-btn-danger`.
- **FormCard** — `pb-card` containing a vertical form: fields are `pb-field-group`s (a
  `pb-label` wrapping its control — `pb-input`, `pb-select`, or `pb-textarea`), two or more
  fields wrapped in `pb-stack` or `pb-form-grid`; one `pb-btn pb-btn-primary` submit +
  `pb-btn pb-btn-ghost` cancel.
- **StatusBadge** — `pb-badge`; mapping: available/open = `pb-badge-success`,
  checkedOut/completed = `pb-badge-neutral`, cancelled = `pb-badge-danger`.
- **FilterBar** — `pb-filterbar`: one `pb-select` + one Apply `pb-btn pb-btn-secondary`
  above a DataTable.
- **EmptyState** — `pb-state` (`pb-state-title` + `pb-state-msg`) inside the table region:
  exact copy per spec §4.
- **DetailPanel** — `pb-card` of label/value rows (`pb-description-list`) for a single record.
- **MarketingHero** — web landing `pb-hero`: one `pb-hero-title` h1, one `pb-hero-sub`
  paragraph, one primary CTA (`pb-btn pb-btn-primary` in `pb-hero-actions`), and optional
  secondary text/link. Uses shipped spacing utilities; no decorative imagery required.
- **CardGrid** — responsive `pb-grid-2` / `pb-grid-3` of 2-4 simple `pb-card`s. Each card has
  a heading and one approved body sentence from SPEC §4.
- **ContentSection** — constrained readable text `pb-section`; left-aligned.
- **CTASection** — short `pb-cta-band` with one primary link/button and optional support text.
- **FooterNav** — `pb-footer` with brand text and links to every §3 marketing route.
