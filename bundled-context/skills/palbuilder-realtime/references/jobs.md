# Background Jobs (`workflowType: 11`)

A **background Job** is a workflow the platform invokes on its own — separate from any
browser request. Jobs are used for work too long to fit in one request window, work that
should continue after the user navigates away, or work on a schedule.

Companion:
- `../SKILL.md` — when to use jobs vs alternatives
- `palbuilder-workflow/SKILL.md` — the base `run()` pattern (jobs use a variant)
- `palbuilder-workflow/references/utilities.md` — Monitor API
- `websockets.md` — pushing job progress live to the browser
- `progress-ui.md` — combining a job with a progress UI

---

## Registering the job workflow

Job workflows are `workflowType: 11`. Register in `pal.json` like any other workflow:

```json
{
  "string": "crawl.js",
  "Workflow": {
    "filename": "crawl.js",
    "workflowType": 11,
    "workflowContext": ""
  }
}
```

`workflowContext` is empty for job workflows (they're not libraries). See
`palbuilder-core/references/pal-json.md` for the full manifest structure.

The pal usually also has a "hub" console workflow (`workflowType: 7`) that user actions hit;
the hub is what launches the job. The `layout` block's `consoleSystemWorkflow` entry can
name a default type-11 workflow if you want one — but non-default jobs are launched by name,
so registration in `layout` is optional.

---

## Launching a job — `createJob(name, workflowFile, payload)`

From any workflow (usually a console hub action), seed the job with a payload and hand it
to the JobManager:

```js
var CRAWL_WORKFLOW = "crawl.js";

var pl = c.createPayload();
pl.set("auditId", ourAuditId);
pl.set("clientId", clientId);
pl.set("rootHost", hostOf(rootUrl));

pal.getJobManager().createJob("seoCrawl", CRAWL_WORKFLOW, pl);
```

Arguments:

| Position | Purpose |
|---|---|
| Name (String) | Human-readable label for the job (shows in job listings and logs) |
| Workflow filename (String) | The `.js` file to invoke — must be registered as `workflowType: 11` |
| Payload | The **only** way inputs reach the job — a job has no `request` / `data` |

The delayed-schedule form takes an additional date argument (see below) — used when you want
the job to run in the future, not immediately.

---

## The job entry point — `c.getJob()`

A job workflow's `run(controller)` reads the **Job**, not the action. There is no
`c.getAction()` — the switch pattern doesn't apply.

```js
function run(controller) {
    c   = controller;
    pal = c.getPal();
    var job = c.getJob();
    if (job == null) { return; }             // always null-guard
    runCrawlChunk(job);
}
```

Read the seed payload back with `job.getPayload()`:

```js
var payload  = job.getPayload();
var rootHost = payload.get("rootHost");          // .get() returns a String
var auditId  = payload.get("auditId");
var pageSize = payload.getInt("pageSize");       // .getInt() for typed integer access
```

**`payload.get(key)` returns a String regardless of the stored type.** For typed access, use
`payload.getInt(key)`, `payload.getBoolean(key)`, `payload.getDate(key)`, etc. Don't reach
for `"" + payload.get(...)` — the value is already a String.

---

## Job timeouts — measure, don't assume

A `workflowType: 11` job has a timeout budget like any workflow. The specific budget is set
by the pal's activation key and varies from pal to pal — some are minutes, some are much
shorter. **Never hard-code an assumption about what the budget is.**

Read the actual value:

```js
var monitor   = c.getMonitor();
var budget    = monitor.getTimeout();          // total budget for this invocation
var remaining = monitor.getRemainingTime();    // how much of it is left
```

Regardless of the specific budget, jobs doing substantial work need the batch-and-reschedule
pattern below — that's how a job doing 10 minutes of work still fits inside whatever the
budget happens to be.

---

## The Monitor batch-and-reschedule pattern

The core pattern for any job doing more than a few seconds of work:

```js
function runCrawlChunk(job) {
    var monitor = c.getMonitor();
    monitor.setMaxTimeout();                                 // claim the max window up front

    var done = 0;
    while (done < CRAWL_BATCH && countCrawled() < MAX_CRAWL_PAGES) {
        var row = nextUncrawled(ds);
        if (row == null) { break; }                          // no more work — finish
        try {
            crawlOnePage(row.getId(), job);
        } catch (e) {
            markCrawlError(ds, row.getId());                 // a broken unit must never kill the run
        }
        done = done + 1;
        if (!monitor.isTimeRemaining(7)) { break; }          // stop before we can't finish another unit
    }

    if (nextUncrawled(ds) != null && countCrawled() < MAX_CRAWL_PAGES) {
        // Still work to do — reschedule with jitter
        job.reschedule(dateUtil.addSeconds(dateUtil.createDate(), 2 + (Math.random() * 2)));
        job.commit();
        return;
    }

    // All done
    finishCrawl(job);        // sets final status, calls job.remove(), job.commit()
}
```

### Why the pattern looks this way

1. **`monitor.setMaxTimeout()` at the top.** Ask for the maximum budget the platform will
   give this invocation.
2. **Check the clock AFTER each unit, not before.** If you check before the first unit and
   the remaining budget is tight, you'd break out of the loop having done zero work — which
   reschedules forever. Doing at least one unit per invocation guarantees progress.
3. **`isTimeRemaining(N)` where N ≥ one unit's worst-case cost.** In this example, one unit
   is fetch (up to ~6s) + parse + write — so 7s. Never start a unit that can't finish inside
   the remaining budget.
4. **Reschedule with jitter.** `2 + Math.random() * 2` avoids a thundering herd if many
   jobs finish their batch at the same moment.
5. **Errors on a single unit must not kill the run.** Wrap in try/catch and mark the failure
   on the row — the loop moves on.

---

## Job lifecycle — `reschedule`, `commit`, `remove`

Three lifecycle methods on the Job:

```js
// More work to do → run again shortly
job.reschedule(dateUtil.addSeconds(dateUtil.createDate(), 2 + (Math.random() * 2)));
job.commit();                                                // PERSISTS the reschedule decision

// Fully done → delete the job
job.remove();
job.commit();                                                // PERSISTS the removal
```

**`job.commit()` is REQUIRED after `reschedule` or `remove`.** Without it, the lifecycle
decision is not persisted — the platform doesn't know whether to re-invoke or clean up.

**Failing to reschedule AND failing to remove** means the job is neither cleaned up nor
scheduled to re-run — a leaked state that's hard to notice. Every code path in a job should
end in either a reschedule+commit or a remove+commit.

---

## Delayed scheduling — running later, not now

`createJob` also has a form that accepts a date, running the job at that time (not
immediately):

```js
// From the WebSocket receiver — hand off to a delayed pusher 15 seconds from now
var payload = c.getJob().getPayload();       // forward the same payload (keeps socketId)
payload.set("message", "Hi from the Universe");

pal.getJobManager().createJob(
    "Other",                                                       // job name
    "otherJob",                                                    // job workflow file
    dateUtil.addSeconds(dateUtil.createDate(), 15),                // when to run
    payload
);
```

Use for retries with backoff, scheduled followups, or handing off async work that shouldn't
block the current invocation.

---

## Reading and writing the job payload

The **payload is the job's inputs and its persistent scratchpad**. Read at the top:

```js
var payload  = job.getPayload();
var auditId  = payload.get("auditId");
var progress = payload.getInt("progress");
```

Mutate before rescheduling to preserve state across invocations:

```js
payload.setInt("progress", newProgress);
job.reschedule(dateUtil.addSeconds(dateUtil.createDate(), 3));
job.commit();
```

The payload roundtrips — the next invocation of the same job reads what this one wrote. Use
sparingly (small state); for anything substantial, write to a dataset and just carry the
row id in the payload.

---

## Coordinating with the browser (state on the work row)

A running job can't easily notify the browser — the browser opened a request that already
completed. Two ways to close the loop:

1. **A `status` column on a work row (e.g., an `audits` row).** The browser polls (or
   receives a WebSocket push) that reads this column and advances a state machine. Full
   pattern in `progress-ui.md`.
2. **A WebSocket** — the job holds the browser's `socketId` in its payload and pushes
   messages. See `websockets.md`.

**Never coordinate through shared memory** — jobs run in their own execution context; there
is no global state that survives between the job and the console workflow beyond datasets,
cache, and payloads.

---

## Job creation from the API push

A `.js` file with `workflowType: 11` can be created via a manifest edit and file push — no
special IDE step needed. Verify that `workflowType` is set correctly in `pal.json` (a
missing or wrong type produces a workflow the runtime can't invoke as a job). See
`palbuilder-core/references/pal-json.md`.

---

## Common gotchas

- **Forgetting `job.commit()`** after `reschedule` or `remove` — the lifecycle decision is
  lost, and the job either leaks or re-invokes forever.
- **Checking `isTimeRemaining` before the first unit** — can leave a run with zero progress
  and reschedule forever. Check AFTER each unit.
- **`isTimeRemaining(N)` with too-small N** — starting a unit that can't finish means partial
  writes and messy retry semantics. Set N to one unit's worst-case cost.
- **Uncaught exceptions inside the batch loop** — kill the whole invocation. Wrap per-unit
  work in try/catch and record the failure on the row instead.
- **Job payload growth** — every reschedule roundtrips the payload. Don't stuff a DataList
  of thousands of records into it; carry an id and re-read from the dataset each invocation.
- **`c.getAction()` in a job workflow returns null** (there's no action). Use `c.getJob()`
  as the entry.
- **Multiple invocations of the same job can run concurrently** if you reschedule sloppily
  or the platform retries a run. Guard critical writes with a status column set BEFORE the
  expensive work, so a duplicate invocation sees the guard and no-ops.
