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

The user decides what the icon looks like. Never pick a design for them and push it.

## 1. Ask

Ask one question before drawing. Offer three distinct concepts drawn from the pal's name, purpose
and data, plus two open choices:

> Which console icon? A: <concept> · B: <concept> · C: <concept> · D: describe your own (symbol,
> colors, style) · E: use your own image (logo or any PNG/JPG/SVG — give the path)

Make the concepts genuinely different (a literal object, an action/status mark, initials or a
monogram). Say each in a few concrete words ("clipboard with a checkmark, white on navy"). Also ask
for the label if `consoleSettings.desktopLabel` is empty (suggest the pal's display name).

## 2. Draw candidates

For A–D, write one SVG per candidate to `assets/icon-<letter>.svg` (`viewBox="0 0 48 48"`):

- One dominant symbol; rounded-square tile background unless the user wants otherwise.
- Colors: the user's, else the primary/accent tokens in `DESIGN_SYSTEM.md` or
  `styles/styles.css`, else a deep navy (`#1f3a5f`) with white.
- Legible at 48px: no small text (initials only, ≤ 2 letters), strokes ≥ 3px, no fine detail,
  gradients or shadows.

For E, use the user's file as the candidate as-is; it is scaled to fit and centered.

## 3. Preview and iterate

```bash
palsync icon --preview assets/icon-a.svg assets/icon-b.svg assets/icon-c.svg
```

This writes `assets/console-icon-preview.png` (each candidate enlarged and at actual 48px size)
and registers nothing. Show it to the user (view the image yourself and give them the path) and
ask which one to use or what to change. Revise and preview again until they choose.

## 4. Register the chosen icon

```bash
palsync icon assets/icon-b.svg --label "Project Tracker"
```

Any SVG/PNG/JPG is fitted to an exact 48×48 PNG at `images/48x48.png`. The command adds one
`Image` entry (no duplicates) and sets `consoleSettings.desktopImage`/`desktopLabel`, preserving
other `consoleSettings` keys. Re-running is safe. Do not hand-edit these fields. Then `pal_push`;
the image and `consoleSettings` ship with the normal push.
