# ChartTool — server-side charts

Verified against the Chart Demo sample pal (console pal). Only the calls below are confirmed;
do not invent others.

## Create a chart

```js
var tool = c.getChartTool();
var chart = tool.createBarChart("test");     // the name is what <c:chart name="..."/> references
```

| Factory | Chart |
|---|---|
| `tool.createPieChart(name)` | pie |
| `tool.createBarChart(name)` | bar (stacked/vertical via settings) |
| `tool.createLineChart(name)` | line |
| `tool.createAreaChart(name)` | area |
| `tool.createScatterPlotChart(name)` | scatter plot |

## Load data from a DataList

```js
chart.setDataList(dl, "series", "category", "value");   // bar, line, area: series + category + value
chart.setDataList(dl, "single-category", "value");      // single-series bar
chart.setDataList(dl, "category", "value");             // pie
chart.setDataListXY(dl, "series", "x", "y");            // line / area / scatter on numeric XY
```

The strings are **column names** in the DataList. Get the list with
`c.getPal().getDataList("name")`.

## Shared settings

```js
var settings = c.getChartTool().getSharedSettings();
settings.setTitle(t);               settings.setShowLegend(bool);
settings.setShowLabels(bool);       settings.setBackgroundColor("#ffffff");
settings.setStacked(bool);          settings.setDrawShapes(bool);
settings.set3D(bool);               settings.setVertical(bool);
settings.setDomainAxisVisible(bool);  settings.setDomainAxisLabel(s);  settings.setDomainAxisColor(s);
settings.setRangeAxisVisible(bool);   settings.setRangeAxisLabel(s);   settings.setRangeAxisColor(s);
settings.explodeSection("categoryName", 20.0);   // pie: pull a slice out by percent
```

Settings are read when the chart is rendered, so set them in the same request that creates the
chart. (The demo calls `processSettings` first, then `createToolChart`.)

## Put the chart somewhere

**On a page**

```js
page.addChartToPage(chart);
```
```html
<c:chart name="test" width="500" height="400" format="${format}"/>
```

**In a PDF** — add the chart to the page that will be printed, then convert (see
`palbuilder-workflow/references/pdf.md`):

```js
page.addPayload(payload);
page.addChartToPage(chart);
var result = c.createDownloadResponse();
result.setFileContent(page.toPdf("pdf.pdf"));
return result;
```

**In an email**

```js
var email = c.createEmail("email");     // an email page containing <c:chart name="test" .../>
email.addChart(chart);
email.sendToAddress(c.getUser().getProfile().getEmailAddress());
```

## Notes

- Use the same chart name in `createXChart(name)` and `<c:chart name=...>`.
- `format="${format}"` is passed through from the demo; its allowed values are **not** confirmed.
- In a PDF the chart is rendered by the platform; do not convert it to an image yourself.
- Charts that `ChartTool` cannot express (custom shapes, annotations): build inline SVG
  instead — see `../SKILL.md`.
