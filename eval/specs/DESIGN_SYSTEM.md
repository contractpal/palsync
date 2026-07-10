# DESIGN_SYSTEM — palsync test suite (minimal stub, shared by all test pals)
status: approved (test-suite stub)

Purpose: satisfy the pal-spec design handoff for benchmark pals. Deliberately minimal —
visual polish is NOT a scored dimension in these tests; correctness and structure are.

## Reference precedence
Provided reference images are the primary design authority — the inspiration above all else — and
outrank this stub whenever an evaluator supplies them for a run. These benchmark pals ship NO
reference images, so this default stub is authoritative here; the fallback path is the one under
test. (Matches the design-system-init / design-build reference-precedence rule.)

## Foundation
- Framework: use the shipped `spacing.css`, `design-system.css`, `pb-ui.js`, and `pb-motion.js`.
- Layout: the page shell owns `<main id="body" class="pb-main">`. Every fragment root is
  `<div class="pb-section">`. Use one `h1` and one primary action per screen.
- Spacing: use `pb-section`, `pb-stack`, `pb-cluster`, `pb-grid-2`, `pb-grid-3`, and
  `pb-form-grid`. Never hand-write margins. Wrap multi-field forms in `pb-stack` or `pb-form-grid`.
- Components: use `pb-*` components. Empty states use `pb-state`; notices use `pb-alert`.
- Color and type: use shipped design-system tokens. No decorative fonts.

## Anti-slop rules (checked by visual criteria)
- No emoji in UI text or headings.
- No centered-everything layouts; tables and forms are left-aligned.
- No more than one primary (`pb-btn-primary`) button visible per screen region.
- Empty states use `pb-state`, never a bare "No data" string.
