# Creating a PDF of a page

Render a pal page to a PDF with `pal.getPage(name).toPdf(filename)`, then return it from a
workflow action as a download response. Verified against a working sample pal (console pal,
`workflowType: 7`).

## Pattern

```js
function downloadPdf()
{
    var pdfPage = pal.getPage("print");          // design-model page — the PDF SOURCE, never returned
    var pdf = pdfPage.toPdf("Sample.pdf");       // PdfFile
    var resp = c.createDownloadResponse();
    resp.setFileContent(pdf);                    // see responses.md (download)
    return resp;                                 // return the download response, not the page
}
```

Route it from the action switch like any other action:

```js
switch (c.getAction()) {
    case "downloadPdf":
        return downloadPdf();
}
```

## Why `pal.getPage`, not `c.getPage`

`c.getPage(name)` returns the runtime page — a `WorkflowReturn` you send to the browser.
`pal.getPage(name)` returns the design-model page, which is exactly what `toPdf` needs. It is
**not** returnable as a response (`Invalid return type`), so it must only ever feed `toPdf`;
the thing you return is the download response. `pal_validate`'s `pageResponseSource` check
flags `pal.getPage(...)` only when its result is returned as the response, so this pattern
passes.

## The source page

The page that gets printed is an ordinary pal page (`pages/print.html`) containing only what
should appear in the PDF — no console chrome, no `c:fragment` slots:

```html
<html xmlns:c="contractpal">
    <head>
        <title>print</title>
    <c:cp-page-head/></head>
    <body><c:cp-page-body-start/>
        <div id="cp-root">
            <p>This is a PDF</p>
        </div><c:cp-page-body-end/>
   </body>
</html>
```

**The PDF renderer supports CSS 2.0 only — CSS3 is not supported.** Design the print page
within CSS 2: block/inline/table/float/position layout, `@page`, `page-break-*`. Do not rely
on flexbox, grid, CSS variables, `calc()`, `border-radius`, shadows, gradients, or
media-query-driven layout. Tables are the dependable way to build a multi-column layout.
Put styles inline or in the page's own `<style>`, and confirm a new construct by rendering the
PDF before building on it.

**Use your layout knowledge here.** Page breaks (`page-break-before`/`-after`/`-inside:
avoid`), repeating table headers across pages (`thead` as `display: table-header-group`),
margins via `@page`, widths in print units, and general professional-looking layout are all
well within what you know — offer them when designing the PDF page, even if the user did not
ask, as long as they stay inside CSS 2. If a technique doesn't render, fall back to a plainer
CSS 2 equivalent and say so.

Keep it separate from the interactive page that links to it; register it in `pal.json` like
any other page.

## Viewing inline vs downloading

- **Download link:** `<c:download action="downloadPdf">Download</c:download>`.
- **Inline viewer:** a fragment with `<c:pdf action="downloadPdf" style="width:8in;height:12in"></c:pdf>`
  (the sample loads it with `page.set("frag", "view")` from a `viewPdf` action and renders it
  through `<c:fragment name="${frag}"/>`). The same `downloadPdf` action serves both.

## Notes

- Name the file in `toPdf("<name>.pdf")`; it becomes the download filename.
- To pass data into the printed page, the sample does not — it prints static markup. Anything
  dynamic is not covered by the sample; verify before assuming payload/EL binding works for
  `toPdf`.
- Converting an uploaded or stored `File` to PDF is a different API (`file.toPdf`, with
  `isPdfConversionSupported()`): see `palbuilder-data/references/files.md`.
