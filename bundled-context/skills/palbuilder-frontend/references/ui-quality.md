# UI quality bar

Apply this to any visible page, fragment, or console view. Check each item against the rendered
result (`pal_screenshot`, desktop and 375px), not just the markup.

## Hierarchy and layout

- Decide the attention order first: page title, current object or status, key data, primary action,
  secondary actions. The eye should land on them in that order.
- Give each decision area one dominant primary action; secondary actions are visibly quieter, and
  destructive actions sit apart from Save with a confirmation.
- Use one `h1` per page and a logical heading sequence; pick heading tags for structure, size
  comes from CSS.
- Keep related items closer together than to the next group; section gaps are at least twice the
  gap between items inside a group.
- Pick one spacing scale (for example 4, 8, 12, 16, 24, 32, 48) and use only those values.
- Align content to a few shared edges. Let parents own the gaps between children.
- Cap prose near 65 characters per line and ordinary forms near 36rem; data tables use the full
  width.

## Type and color

- Use at most two font families and a short type scale (about four sizes plus small metadata).
- Body text is 16px with line-height near 1.5; use tabular numerals for amounts, counts, and dates.
- Keep text and control contrast at WCAG AA: 4.5:1 for body text, 3:1 for large text and UI borders.
- Save saturated color for the primary action, links, and status; the layout should still read in
  grayscale.

## Forms and controls

- Single-column forms with a visible label above each field; hints sit next to the field.
- Size inputs to their content (short for codes, wider for descriptions).
- Validate on blur or submit, state the problem and the fix in the error text, and keep what the
  user already typed.
- Touch targets are at least 44px tall on mobile.
- The same component handles the same job everywhere: one button style per role, one table pattern,
  one empty-state pattern.

## States and feedback

- Design every state: empty (with a next step), loading, error (with a retry), success, hover,
  keyboard focus (visible), and disabled.
- Every action answers back: a saved confirmation, an inline error, a changed row, or a navigation.
- Test with realistic content: long names, many rows, no rows, and failure responses.

## Responsive

- At 375px width the page has no horizontal scroll, content stays inside the gutter (16px), and
  action bars wrap.
- Use flexible layout (grid or flex, `min-width: 0`) instead of fixed heights and widths.
