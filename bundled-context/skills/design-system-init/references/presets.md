# Presets

The reference catalog contains a full token set plus six `:root[data-preset="..."]` examples.
Select the closest palette and copy only its required base tokens into `styles.css`; do not copy all
presets just to use one.

When no user-provided design system or reference photos exist, pick exactly one shipped preset
(`ink`, `indigo`, `emerald`, `amber`, `rose`, or `slate-dark`) and copy its
`:root[data-preset=...]` token block verbatim from `design-system.css`. Do not invent palettes or
hand-write token values. Record the chosen preset in `DESIGN_SYSTEM.md`. Reference-derived systems
retain precedence over this fallback.

- **ink** (default, no attribute needed) — near-black primary on cool white/light-gray surfaces.
  Neutral, crisp, high-contrast; the primary action reads ink, accent color appears only for
  highlights, charts, and product-specific moments. Fits almost any product.
- **indigo** — deep indigo-violet primary. Confident, techy, SaaS.
- **emerald** — deep green primary. Growth, trust, finance/health.
- **amber** — warm amber-orange primary. Energetic, warm, retail/hospitality.
- **rose** — bold rose-red primary. Bold, creative, consumer-facing.
- **slate-dark** — dark navy surfaces with a periwinkle accent. Dark-first, technical/ops
  dashboards.

Set `data-preset="indigo|emerald|amber|rose|slate-dark"` on `<html>` in the page shell; omit the
attribute entirely for `ink`. A brand color that doesn't match any preset is a small set of
`--ds-*` values in `styles.css`, not a copy of every preset. Check `--ds-primary-text` for AA
contrast whenever a primary color changes. The presets are convenient starting points, not a
constraint that overrides the reference.

Dark mode is opt-in: if required, copy the relevant `[data-theme="dark"]` rules and token
dependencies into `styles.css`, and include the theme-toggle portion of `pb-ui.js` only when the UI
offers a toggle. Do not ship unused dark-theme rules.
