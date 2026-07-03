---
name: palbuilder-jobs-http
description: "Work that outlives one request in a PalBuilder (CloudPiston) pal — background Jobs, the per-run Monitor time budget, file-download responses, DOM-less HTML scanning, job-polling progress UI. Companion to palbuilder-backend; ES3 rules from palbuilder-core apply. Server-side HTTP / JSON belong to palbuilder-data. Trigger on workflowType 11 jobs, pal.getJobManager().createJob, c.getJob, the Monitor loop, c.createDownloadResponse, or a self-polling progress fragment."
---

# Background Jobs, HTTP & Long-Running Work — Palbuilder Skill

This skill covers the subsystem a pal uses when a task is too long for one request's
time window: a **background Job** that batches work, reschedules itself, and reports
progress to the browser. It also covers the per-run **Monitor** time budget, DOM-less
HTML scanning, and file-download responses those jobs lean on.

> **The server-side HTTP client, JSON parsing, and string building live in
> `palbuilder-data`** (`references/http-client.md`) — `c.createServiceRequest`,
> `c.createJsonParser`, `c.createBuffer`, `pal.getSettings()`. This skill only notes
> where those intersect the job time budget (see §3).

> **Companion to `palbuilder-backend`.** ES3 workflow-JS rules (no object literals,
> no `let`/`const`, no arrow functions, double-quoted strings, `var` +
> `UPPER_SNAKE_CASE`): see `palbuilder-core`. This skill adds only the job APIs.

> **Verify before trusting.** Workflow JS only truly compiles in the PalBuilder
> builder (the save/push API returns cached validation). Every snippet below is
> verbatim from a production pal, but re-confirm any API you promote to new code
> in the builder itself.

---

## 1. Background Jobs

A task too long for one request's time window runs as a **background Job**: a separate
workflow file the platform invokes on its own, that reschedules itself in batches and
removes itself when done.

### Two workflow files, two `workflowType`s (`pal.json`)

```json
{ "string": "main.js",  "Workflow": { "filename": "main.js",  "workflowType": 7  } }   // normal console hub
{ "string": "crawl.js", "Workflow": { "filename": "crawl.js", "workflowType": 11, "workflowContext": "" } }  // console-system job
```

- `workflowType: 7` — ordinary console workflow (serves pages/ajax for a logged-in user).
- `workflowType: 11` — **console-system job workflow**, invoked by the JobManager, not a
  browser request. Its entry point reads `c.getJob()` instead of `c.getAction()`.

> ⚠️ **A new workflow file is PalBuilder-only to create.** `crawl.js` cannot be made via
> `pal_push` — create it in PalBuilder first (with `workflowType: 11`), then edit on disk.

### Launching a job — `pal.getJobManager().createJob(name, workflowFile, payload)`

Console side. Seed the job with a **Payload** — the only way it receives inputs (a job has
no request / `data`):

```js
var pl = c.createPayload();
pl.set("auditId", ourAuditId);
pl.set("clientId", clientId);
pl.set("rootHost", hostOf(rootUrl));
pal.getJobManager().createJob("seoCrawl", CRAWL_WORKFLOW, pl);   // CRAWL_WORKFLOW = "crawl.js"
```

### Job entry point — `c.getJob()`

A job workflow's `run()` reads the Job, not the action. Always null-guard:

```js
function run(controller) {
    c   = controller;
    pal = c.getPal();
    var job = c.getJob();
    if (job == null) { return; }
    runCrawlChunk(job);
}
```

Read the seed payload back with `job.getPayload().get(...)`. Coerce to string with `"" +`
(values arrive boxed):

```js
var rootHost = "" + job.getPayload().get("rootHost");
var auditId  = "" + job.getPayload().get("auditId");
```

### Job lifecycle — reschedule, commit, remove

More work to do → **reschedule** to a near-future time and **commit**; the platform
re-invokes the workflow then. Fully done → **remove**. `commit()` persists the decision
(without it, the decision is lost).

```js
// more work -> run again in 2-4s (jitter avoids a thundering herd)
job.reschedule(c.getDateUtil().addSeconds(new Date(), 2 + (Math.random() * 2)));
job.commit();

// done -> delete the job
job.remove();
job.commit();
```

> `Math.random()` / `new Date()` are fine **inside workflow JS at runtime** — the
> orchestration-layer ban on them does not apply to pal code.

---

## 2. Monitor — the per-run time budget (critical gotcha)

A console-system job is **NOT** given a long backend window. Measured on a live pal, a
`workflowType: 11` job is **capped at ~10 seconds per invocation — like a browser
workflow**, not the long window a true backend system workflow gets. That cap is the whole
reason the crawler is a batch-and-reschedule loop.

```js
var monitor = c.getMonitor();
monitor.setMaxTimeout();                       // claim the full window up front
// ... one unit of work ...
if (!monitor.isTimeRemaining(7)) { break; }    // only START another unit if >=7s remain
```

**Batch-and-reschedule pattern:**

1. `monitor.setMaxTimeout()` — claim the max window.
2. Loop a batch of units. **Check the clock AFTER each unit, not before** — so a too-small
   remaining window can never leave a run with **zero** progress (which would reschedule
   forever).
3. Inside the loop, `if (!monitor.isTimeRemaining(N)) break;` where `N` ≥ one unit's
   worst-case cost (here 7s: fetch up to ~6s + parse + write), so you never start a unit
   that can't finish.
4. After the loop: work remains → `job.reschedule(...)` + `job.commit()`. Else → finish + remove.

```js
var done = 0;
while (done < CRAWL_BATCH && countCrawled() < MAX_CRAWL_PAGES) {
    var row = nextUncrawled(ds);
    if (row == null) { break; }
    try { crawlOnePage(row.getId(), job); }
    catch (e) { markCrawlError(ds, row.getId()); }   // a broken page must never kill the run
    done = done + 1;
    if (!monitor.isTimeRemaining(7)) { break; }
}
if (nextUncrawled(ds) != null && countCrawled() < MAX_CRAWL_PAGES) {
    job.reschedule(c.getDateUtil().addSeconds(new Date(), 2 + (Math.random() * 2)));
    job.commit();
    return;
}
finishCrawl(job);   // sets audit status, job.remove(), job.commit()
```

---

## 3. Server-side HTTP, JSON & string building — see `palbuilder-data`

The APIs a job uses to fetch and parse external data now live in **`palbuilder-data`**
(`references/http-client.md`): `c.createServiceRequest()` (GET/POST), `c.createJsonParser(str)`
+ `readValue("a.b.c")`, `c.createBuffer()`, and `pal.getSettings()` for API keys. Read that
reference before writing HTTP/JSON code — including the rule never to hardcode keys in
workflow source.

**The one job-specific intersection: timeouts must fit the time budget.** `sr.setTimeout(4, 6)`
(connectSecs, readSecs) is load-bearing inside a `workflowType: 11` job — one slow page must
not eat the ~10s window (§2). Keep the read timeout **below the Monitor guard** (6 < 7) so a
hung fetch still leaves time to write + reschedule.

---

## 4. Advanced patterns — see the reference

Deeper, less-frequent patterns live in **`references/advanced-patterns.md`** — read it when a job needs
one of these specifically:
- **Records by id + typed accessors** (`getRecord(id)`, `getId`, `getInt`/`setInt`, `updateRecord`,
  `deleteRecord`/`deleteRecords`, `getRecordCount`/`getRecord(i)`; find-or-create dedup).
- **Formatter & DateUtil helpers** (`formatter.trim`/`chop`, `dateUtil.addSeconds`).
- **Parsing HTML with no DOM** (split-on-`"<"` scanner, `getAttribute`/`getText`, same-host URL handling).
- **Download response** (`c.createDownloadResponse()` → `setFragmentContent`).
- **Progress-poll loop** (full-stack: status state machine + self-polling hidden `c:a` + browser timer).

---

## Quick API index

| Need | Call |
|---|---|
| Start a background job | `pal.getJobManager().createJob(name, "file.js", payloadObj)` |
| Job entry / inputs | `c.getJob()`, `job.getPayload().get("k")` |
| Job lifecycle | `job.reschedule(date)`, `job.commit()`, `job.remove()` |
| Time budget | `c.getMonitor()`, `monitor.setMaxTimeout()`, `monitor.isTimeRemaining(secs)` |
| HTTP / JSON / string building | **see `palbuilder-data`** (`references/http-client.md`) — `createServiceRequest`, `createJsonParser`, `createBuffer` |
| Row by id | `ds.getRecord(id)`, `row.getId()`, `ds.updateRecord(row)`, `ds.deleteRecord(""+id)`, `ds.deleteRecords(col,val)` |
| Typed fields | `row.getInt/setInt`, `row.getValue` |
| String/date utils | `formatter.trim/chop`, `dateUtil.addSeconds(date, n)` |
| File download | `c.createDownloadResponse()` → `addPayload` → `setFragmentContent(frag, name, inline)` |
| Long-job progress UI | hidden `c:a id="pollLink" ajax-target="body"` + `setInterval(tick,4000)` clicking it |

---

*Console API: https://secure.cloudpiston.com/cpal/cp-api/console/index.html*
