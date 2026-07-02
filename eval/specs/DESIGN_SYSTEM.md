# DESIGN_SYSTEM — palsync test suite (minimal stub, shared by all test pals)
status: approved (test-suite stub)

Purpose: satisfy the pal-spec design handoff for benchmark pals. Deliberately minimal —
visual polish is NOT a scored dimension in these tests; correctness and structure are.

## Foundation
- Framework: bootstrap 5.3.5 via c:resource. Icons: bootstrap-icons 1.11.3 (only if needed).
- Layout: single container (`container`, max-width default), page content starts with a
  PageHeader, one primary action per screen.
- Spacing: bootstrap utilities only (`mb-3`, `py-4`); no custom CSS files unless a component
  demands it.
- Color: bootstrap defaults. Primary buttons = `btn-primary`. Status coloring via badges only.
- Typography: bootstrap defaults. One `h1` per screen (the PageHeader title). No decorative fonts.

## Anti-slop rules (checked by visual criteria)
- No emoji in UI text or headings.
- No centered-everything layouts; tables and forms are left-aligned.
- No more than one primary (`btn-primary`) button visible per screen region.
- Empty states use the EmptyState component, never a bare "No data" string.
