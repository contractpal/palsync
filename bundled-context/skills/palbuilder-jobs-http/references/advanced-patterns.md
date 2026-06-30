# Jobs/HTTP — advanced patterns reference

Deeper, less-frequent patterns that build on the core job/HTTP machinery in the skill's SKILL.md: row
access by id + typed accessors, Formatter/DateUtil helpers, DOM-less HTML parsing, file-download
responses, and the full-stack progress-poll loop. Open this when a job needs one of these specifically.

All workflow JS here obeys the ES3 rules from `palbuilder-backend` (no object literals, no `let`/`const`,
no arrow functions).

---

## Records by id + typed accessors (beyond the base skill)

`palbuilder-backend` covers filter→`getRecords`/`findRecord(col,val)`→`copy`, and insert via
`insertRecord()`+`set`/`setDate`+`commit`. Job/crawl code adds:

| Call | Purpose |
|---|---|
| `ds.getRecord(id)` | Fetch one row by **primary-key id** (no filter). |
| `ds.findRecord(filterObj)` | `findRecord` also takes a **built filter object**, not just `(col, val)`. |
| `row.getId()` | The row's primary-key value. |
| `row.getInt("col")` / `row.setInt("col", n)` | Typed integer get/set. |
| `row.getValue("col")` / `row.get("col")` | Read a column (both seen; `getValue` common for status reads). |
| `ds.updateRecord(row)` | Persist edits to an existing row (the update counterpart to `insertRecord`). |
| `ds.deleteRecord("" + id)` | Delete one row by **stringified id**. |
| `ds.deleteRecords("col", value)` | Bulk-delete every row matching a column (cascade deletes). |
| `list.getRecordCount()` | Row count of a DataList. |
| `list.getRecord(i)` | Zero-indexed row access for iterating a DataList. |

Update-in-place + find-or-create dedup (queue insert):

```js
var f = ds.createFilter();
f.addEqual("url", clean);
var existing = ds.findRecord(f);
if (existing == null) {
    var r = ds.createRecord();
    r.set("url", clean);
    r.set("crawled", "false");
    r.setInt("itemCount", 1);
    ds.insertRecord(r);
} else {
    existing.setInt("itemCount", existing.getInt("itemCount") + 1);
    ds.updateRecord(existing);
}
```

---

## Formatter & DateUtil helpers

```js
c.getFormatter().trim(str);                  // trim whitespace
c.getFormatter().chop(url, 1000, false);     // truncate to max length (third arg: add-ellipsis flag)
c.getDateUtil().addSeconds(new Date(), 3);   // Date + N seconds (used for job.reschedule)
```

---

## Parsing HTML with no DOM

Workflow JS has **no DOM parser**. Scan raw HTML by splitting the body on `"<"`, so each
fragment starts with its tag name. Cheap, ES3-safe, enough for SEO signals:

```js
var parts = body.split("<");
for (var i = 0; i < parts.length; i++) {
    var line = parts[i];
    if (line.indexOf("/") == 0)  { continue; }   // closing tag
    if (line.indexOf(">") == -1) { continue; }   // not a real tag
    if (line.indexOf("a ") == 0)        { /* anchor: getHref(line, ...) */ }
    else if (line.indexOf("img ") == 0) { /* getAttribute("alt", line) */ }
    else if (line.indexOf("title") == 0){ /* getText(line) */ }
    else if (line.indexOf("meta ") == 0){ /* getAttribute("content", line) by keyword */ }
    // h1..h6, link[rel=canonical], html[lang], viewport, robots ...
}
```

Two reusable helpers worth writing:
- **`getAttribute(attrib, line)`** — find the attr name, then a hand-rolled quote scanner
  (`charAt` + a `Buffer`) reads the value between the first matching `"` or `'`, bounded to
  before `">"`.
- **`getText(line)`** — text after the first `">"` (for `<title>...`).

URL handling (`getHref` / `resolveRelative` / `hostOf`): drop `#frag` / `mailto:` / `tel:` /
`javascript:`, expand `//host`, `/path`, and relative `about.html` against the current URL,
keep only **same-host** links (`host == rootHost`) on the queue. Substring scans on
`body.toLowerCase()` detect analytics (`gtag(`, `googletagmanager.com`) and JSON-LD
(`application/ld+json`).

---

## Download response — render a fragment to a file

`c.createDownloadResponse()` returns a rendered fragment as a downloadable file (HTML/PDF
report). **Return it straight from the switch** — it bypasses `run()`'s end-of-request
payload attach, so seed the download itself or the fragment renders empty:

```js
var download = c.createDownloadResponse();
download.addPayload(payload);                                  // seed BEFORE returning
download.setFragmentContent(pal.getAjaxFragment("report-pdf"), "seo-report.html", true);
return download;                                               // setFragmentContent(frag, filename, inlineFlag)
```

---

## Progress-poll loop — showing a long job to the browser (FULL-STACK)

A background job runs detached, so the page can't just wait. Pattern: render a **progress
fragment that polls itself** every few seconds via a hidden `c:a`; each poll re-runs a
workflow action that advances a **status state machine** and re-renders the same fragment —
until done, when the action returns the finished page instead and the loop self-terminates.

> This recipe spans back-end (the workflow action + fragment) and front-end (the browser
> timer). The EL operators it uses (`empty`, `eq`, …) are documented in `palbuilder-frontend`.

### Status state machine (job ↔ console coordination)

Coordinate through a `status` column on the work row (e.g. an `audits` row) — never shared
memory. Guards against duplicate job fires and overlapping polls re-running expensive work.

- **`startCrawl`** (console): seed root crawl row, insert audit `status="crawling"`, create
  the job, show the progress fragment.
- **`crawl.js finishCrawl`** (job): only flips `"crawling"` → `"crawled"` (guarded — a stray
  duplicate fire must not reset a status the poll already advanced), records `pagesCrawled`,
  then removes itself.
- **`pollCrawl`** (console, browser-polled): one step per poll — `crawled` → set `checking`
  + repaint; `checking` → set `scoring` (guard against double-run) + `runChecks` (ends by
  setting `complete`); `complete` → show dashboard.

**Rule: flip to a guard status BEFORE the expensive step**, so a concurrent invocation sees
the new status and no-ops.

### Workflow side — re-render the SAME fragment with fresh progress vars

```js
payload.set("runningAuditId", ourAuditId);
payload.set("runningEngineId", "inpal");
payload.set("crawlClass", "done");          // CSS class per step the template reads
payload.set("checkClass", "active");
payload.set("progressStatus", "Running checks");
payload.set("progressSub", "Almost there");
frag = "audit-progress";
// when status == "complete":  getClientDashboard(); return;   (no poll link -> loop stops)
```

### Fragment side — hidden `c:a` with a fixed id

Renders only while working (inside `${empty progressError}`); when the workflow returns the
dashboard instead, the link is gone and the browser loop ends.

```html
<c:a id="pollLink"
     action="pollAudit?auditId=${runningAuditId}&amp;engineId=${runningEngineId}&amp;clientId=${clientId}"
     ajax-target="body" class="muted" style="display: none;">poll</c:a>
```

### Browser side (`scripts/app.js`) — one timer clicks the hidden link once per render

Guard with a `data-clicked` flag so each render fires exactly one request (the next render
brings a fresh, unclicked link).

```js
setInterval(tick, 4000);                       // installed once on DOMContentLoaded
function tick() {
    var link = document.getElementById("pollLink");
    if (link) {
        if (typeof hideModal === "function") { hideModal(); }
        if (!link.getAttribute("data-clicked")) {
            link.setAttribute("data-clicked", "1");
            link.click();                      // re-fires the c:a -> re-renders body -> new pollLink or dashboard
        }
        return;
    }
    // no pollLink in the DOM -> job finished
}
```

> **Why a hidden `c:a` and not `fetch`:** `c:a` is server-rendered and encrypts the
> action/querystring; `fetch` would expose it. Don't reach for `setInterval`-of-`fetch` here.
