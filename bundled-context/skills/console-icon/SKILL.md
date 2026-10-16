---
name: console-icon
description: "Load to create or replace a pal's 48x48 console desktop icon and label (consoleSettings.desktopImage/desktopLabel)."
---

# Console Icon

The console desktop shows each pal as a 48×48 image plus a text label. Both live in the
top-level `consoleSettings` object of `pal.json` (server class `ConsoleSettings`):

```json
"consoleSettings": { "desktopImage": "48x48.png", "desktopLabel": "Project Tracker" }
```

`desktopImage` names a registered `Image` entry (`images/48x48.png`). `desktopLabel` is plain
text — no HTML. This is not `desktopBindings` (a separate, rarely used binding section with
`name`/`icon`) and not a `layout` field.

If `pal.json` already has a `desktopImage` that is a valid 48×48 image, keep it unless the user
asked for a new icon.

## 1. Design the mark

- One dominant symbol from the pal's name and purpose (tracker → checklist, scheduling →
  calendar, inventory → box, invoices → document with a currency mark). Avoid generic gears/stars.
- Colors: use the primary/accent tokens from `DESIGN_SYSTEM.md` or `styles/styles.css` when
  present. Otherwise use a deep neutral or blue (`#1f3a5f`) with white.
- Rounded-square tile background, symbol in a contrasting color, ~6px inner padding.
- No text, no tiny detail, no thin strokes (≥ 3px at 48px), no gradients or shadows.

Write it as an SVG with `viewBox="0 0 48 48"` and `width="48" height="48"` to
`assets/console-icon.svg` (source, not pushed). If your harness has an image generator and the
user wants a raster mark, you may use it instead — pass that PNG to `palsync icon` only if it is
already exactly 48×48; otherwise redraw it as SVG.

## 2. Rasterize and register

```bash
palsync icon assets/console-icon.svg --label "Project Tracker"
```

This renders a transparent 48×48 PNG to `images/48x48.png`, verifies its size, adds one `Image`
entry (no duplicates), and sets `consoleSettings.desktopImage`/`desktopLabel` while preserving
other `consoleSettings` keys. Re-running is safe. Use `palsync icon` with no source to register an
existing `images/48x48.png`. Do not hand-edit these fields.

## 3. Verify

Look at `images/48x48.png` once. Then `pal_push` — the image and `consoleSettings` ship with the
normal push.
