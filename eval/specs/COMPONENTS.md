# COMPONENTS — palsync test suite (minimal stub)

Every §6 layout line in a test SPEC names one of these. Nothing else may be invented.

- **PageHeader** — `h1` screen title + optional right-aligned primary action button.
- **DataTable** — bootstrap `table table-striped`; header row; one row per record; per-row
  action links (c:a). Wrapped in a fragment so it can be an ajax-target.
- **FormCard** — bootstrap `card` containing a vertical form; labels above inputs; one
  `btn-primary` submit + `btn-link` cancel.
- **StatusBadge** — bootstrap `badge`; mapping: available/open = `bg-success`,
  checkedOut/completed = `bg-secondary`, cancelled = `bg-danger`.
- **FilterBar** — inline row of one select + one Apply button above a DataTable.
- **EmptyState** — centered muted paragraph inside the table region: exact copy per spec §4.
- **DetailPanel** — bootstrap `card` of label/value rows for a single record.
