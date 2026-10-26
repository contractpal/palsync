---
name: palbuilder-charts
description: "Load for any chart, graph, or data visualization in a pal: choosing Chart.js vs d3 vs server-side ChartTool vs hand-written SVG, SVG best practices, and charts inside PDFs/emails."
---

# PalBuilder Charts Skill

> **DRAFT.** Verified against a working sample pal (Chart Demo). Items marked **TO CONFIRM** are
> still unverified; do not treat them as established. Never invent `ChartTool` method names —
> use `references/charttool.md`.

## 1. Choose the tool first

| Need | Use | Notes |
|---|---|---|
| Interactive chart in a browser page (tooltips, hover, live update) | **Chart.js** (preferred, newer), **d3**, or **dimple** (older, d3-based), via `c:resource` | Registered per `palbuilder-frontend/references/c-tags.md` (`chartjs`, `d3`; `dimple` is used by the demo pal). Client-only: they need JavaScript, so not for PDF/email. |
| Static chart on a page or in a PDF, fully custom look | **Inline SVG** built from workflow data | Works client and server, and in PDF with no image step. See rule below. |
| Standard pie/bar/line/area/scatter built server-side from a DataList, for a page, PDF, or email | **`ChartTool`** (`c.getChartTool()`) | Add with `page.addChartToPage` / `email.addChart`; render with `<c:chart>`. See `references/charttool.md`. |
| Tiny inline trend / sparkline | Inline SVG | Pattern already in `design-system-init/references/component-library.md`. |

Pick **ChartTool** for standard chart types that must work in page, PDF and email alike. Pick
**inline SVG** when you need a custom design `ChartTool` can't give you. Pick **Chart.js** (or
d3 for bespoke visuals) only when the chart must be interactive in the browser. Prefer Chart.js
over dimple for new work; dimple is older and layered on d3 (the demo loads d3 3.5.5 with it).

## 2. The rule that keeps being relearned: do not convert SVG to an image

A render engine converts an `<svg>` tag **automatically** when it encounters one — including
when a page is rendered to PDF (`palbuilder-workflow/references/pdf.md`). So:

- **Embed the `<svg>…</svg>` markup directly** in the page being printed.
- **Do not** write server code to turn the SVG into PNG/JPEG and embed that image.
- Do not add image files/datasets for the chart purely to get it into a PDF.

## 3. SVG best practices (outline — fill from verified behavior)

- Always set `viewBox`; size the element with width/height or CSS so it scales. Avoid fixed
  pixel layouts that overflow the PDF page width.
- Compute scales explicitly: data domain → pixel range; leave margins for axes and labels.
  Round tick values to "nice" numbers; draw gridlines under data, labels over it.
- Text: use `<text>` with `text-anchor`/`dominant-baseline`; prefer common fonts
  or generic families (`sans-serif`) since rendering uses the server's fonts.
- Color: take from the pal's design system tokens; ensure contrast and do not rely on color
  alone. (Palette guidance exists in the `dataviz` skill.)
- Accessibility: `role="img"` with `<title>`/`<desc>`, and a data table or summary alternative.
- **Renderer:** server-side SVG rendering is a real SVG engine, separate from the page's CSS 2.0
  HTML renderer, and supports current SVG: shapes, paths, gradients, `<text>`, `transform`,
  `viewBox`. Prefer SVG presentation attributes (`fill`, `stroke`, `font-size`) over CSS for
  anything that must print, and confirm unusual constructs by rendering.
- Generating SVG in workflow JS: build the string with ES3-safe code
  (`palbuilder-core/references/es3-cheatsheet.md`); escape any user data placed into text
  nodes (`& < >`) and attribute values.

## 4. Client-side libraries (Chart.js / d3 / dimple)

- Register with `c:resource` (see `palbuilder-frontend/references/c-tags.md`), e.g.
  `<c:resource name="d3_min.js" source="d3" version="3.5.5"/>` and, for dimple,
  `<c:resource name="dimple_min.js" source="dimple"/>`. **TO CONFIRM:** dimple's valid
  `version` values (the demo omits `version`; c-tags.md lists it as required, and has no
  `dimple` row).
- These render **in the browser only** — the sample pal's own readme says d3 demos work on the
  client, while raw SVG and `ChartTool` work on client and server. Do not use them for a page
  that will be rendered to PDF or email.
- Client JS goes in `scripts/*.js`, never in a fragment `<script>` (CLAUDE.md golden rule 3).
- Feed data from the payload or an ajax action (the demo serves JSON via
  `c.createAjaxResponse(list.toJSON(false), false)`); do not invent a custom endpoint.

## 5. Server-side: `ChartTool`

Full API in `references/charttool.md`. In short: `tool = c.getChartTool()`, create a chart
(`createPieChart`/`createBarChart`/`createLineChart`/`createAreaChart`/
`createScatterPlotChart`) with a name, `chart.setDataList(...)`, then
`page.addChartToPage(chart)` and `<c:chart name="..."/>` in markup. The same chart works in a
page, a PDF (`page.toPdf`), and an email (`email.addChart`).

## 6. Charts in PDFs and emails

- PDFs: build the print page per `palbuilder-workflow/references/pdf.md`; put the chart's
  `<svg>` inline in that page. Respect CSS 2.0 and page-break guidance there.
- Emails: `ChartTool` charts go in via `email.addChart(chart)` and `<c:chart>` in the email
  page (see `palbuilder-email`). **TO CONFIRM:** raw inline SVG in outbound email — the sample
  only emails ChartTool charts.

## Open questions for the owner

1. Installed server fonts, if specific fonts are needed.
2. Are raw SVGs accepted in outbound email through the platform?
3. Valid `dimple` versions for `c:resource`.
4. `ChartTool` details not in the sample: the `format` attribute's allowed values, and chart
   types beyond pie/bar/line/area/scatter.
