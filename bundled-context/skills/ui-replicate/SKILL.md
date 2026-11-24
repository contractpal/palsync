---
name: ui-replicate
description: "Load when the user gives a mockup, screenshot, or design image to build or match. Closed loop: extract the spec, build, push, screenshot desktop+mobile, diff, iterate (max 4 rounds)."
---

# ui-replicate — build a pal screen that matches a mockup

Use this skill when the user supplies a mockup image (or a screenshot of a site) and asks you to
build or match it. Load `palbuilder-frontend` with it. The loop below is closed: you do not
report a match until the live render was captured and compared with the mockup.

## 1. Extract the spec BEFORE you write code

Open the image and write the spec to `.palsync/ui-replicate/spec.md` (local, never pushed).
Measure from the image; mark each estimate with `~`. Record:

- **Layout:** the regions top to bottom (header, hero, sections, footer), the container max width,
  the column count and gutters per region, alignment, and sticky/fixed parts.
- **Spacing:** the vertical gap between sections, the card/inner padding, and the gap between
  items. Snap them to one scale (for example 4/8/12/16/24/32/48/64 px).
- **Color:** hex values for the page background, surfaces, primary text, muted text, accent,
  borders, and button states. Sample flat areas, not anti-aliased edges.
- **Typography:** the family (or the nearest web-safe/Google font), and size, weight,
  line height, and letter spacing for each role (h1, h2, body, small, button, nav).
- **Details:** radii, shadows, borders, icon style, and image crops/aspect ratios.
- **Copy:** every visible string, verbatim.
- **Mobile:** what the mockup shows at narrow width. If it shows only desktop, write the
  stacking you will use and tell the user it is your choice.

If a `DESIGN_SYSTEM.md` exists, map each value to its nearest token and list values that
have no token. The mockup wins for this screen unless the user says otherwise.

## 2. Build and push

Implement the screen from the spec, not from memory of the image. Use `pal_validate` between
edits to fix findings, then `pal_push` (push runs the same validation as its gate). The render
tools show only the last pushed version.

## 3. Capture desktop and mobile

Capture the LIVE render at two viewports: **desktop 1280×800** and **mobile 375×812**.

- **WEB pal, Playwright MCP present** (Pi registers it as `playwright`): get a fresh URL from
  `pal_preview` (`url` field; the token can expire, so get a new one each round). Then call
  `browser_resize` (1280×800), `browser_navigate`, `browser_take_screenshot` with
  `fullPage:true`, and repeat at 375×812. On Pi, chain these in ONE `codemode` script and return
  only the two images (`image(...)`) plus any console errors.
- **Console/transaction pal, or no Playwright MCP:** the screen needs the authenticated session,
  so use `pal_screenshot` with `viewport:"desktop"` and `viewport:"mobile"` (`fullPage:true`,
  `expect:[...]` with visible strings). Fix every `designAudit` error and any `renderError`.

A capture that failed or is unavailable is not a pass. Report it and stop the loop.

## 4. Compare, list diffs, iterate

Put the mockup beside each capture and write a numbered diff list. Each item names the region,
the property, the mockup value, and the live value, for example:
`2. Hero h1: size 56px → live ~40px; weight 800 → 600`.

Check, in this order: layout and alignment, spacing, color, typography, details, copy, mobile
overflow (no horizontal scroll at 375px, tap targets ≥ 44px).

Fix the list, push, capture again, compare again. Stop when the list has no visible diffs, or
after **4 rounds**. After round 4, report each diff that remains and why (platform limit, font
not available, user decision needed). Do not claim a pixel match; say "matches the mockup
within the listed differences".
