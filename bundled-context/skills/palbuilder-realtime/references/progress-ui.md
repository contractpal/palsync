# Progress UI — Long Jobs Talking to the Browser

A background job runs detached from any browser request. When a job has been triggered by a
user action and the user is waiting for progress, you need a way for the job's ongoing state
to reach the still-open page.

Two patterns:

1. **WebSocket push** — the job holds the browser's `socketId` and calls `sendMessage`
   directly. Modern, low-latency, one flow of data. Requires WebSocket setup.
2. **Self-polling fragment** — a progress fragment on the page contains a hidden `c:a` that
   self-clicks every few seconds, re-rendering the fragment with fresh progress values from
   a status column. Works everywhere, no WebSocket infrastructure needed.

Companion:
- `jobs.md` — the job side (Monitor loop, reschedule/remove)
- `websockets.md` — the WebSocket setup for pattern #1

---

## Approach 1: WebSocket push

This is the modern default when the pal already has WebSockets set up.

### Flow

1. **Console workflow (type 7)** — opens the socket, launches the job seeded with the
   `socketId`, returns the progress fragment to the browser.
2. **Job (type 11)** — does work in the Monitor loop. Between units of work,
   `sendMessage(...)` to the socket. On completion, sends a final "done" message.
3. **Browser** — receives progress messages via `ws.onmessage`, updates the UI.

### Console side — bind socket and hand off to job

```js
function startProcessing() {
    var man    = pal.getClientSocketManager();
    var socket = man.createClientSocket("progressReceiver", "progress", true, 30);
    payload.addJavascript("setupProgress('" + socket.getEndpoint() + "')");

    var pl = c.createPayload();
    pl.set("socketId", socket.getId());
    pl.set("clientId", clientId);
    pl.set("workId", startWork(clientId));      // pre-seed a row with status="queued"

    pal.getJobManager().createJob("longWork", "workJob.js", pl);
    frag = "progress";
}
```

### Job side — do work, push progress

```js
var c;
var pal;

function run(controller) {
    c   = controller;
    pal = c.getPal();
    var job = c.getJob();
    if (job == null) { return; }

    var jobData  = job.getPayload();
    var socketId = jobData.get("socketId");
    var man      = pal.getClientSocketManager();
    var socket   = man.getClientSocket(socketId);    // may be null if browser disconnected

    var monitor = c.getMonitor();
    monitor.setMaxTimeout();

    while (hasWork()) {
        processUnit();

        // Push progress if the socket is still alive
        if (socket != null) {
            try {
                socket.sendMessage("progress:" + getPercent());
            } catch (e) {
                // Socket may have closed — swallow and keep processing
            }
        }

        if (!monitor.isTimeRemaining(3)) { break; }
    }

    if (hasWork()) {
        job.reschedule(dateUtil.addSeconds(dateUtil.createDate(), 1));
        job.commit();
        return;
    }

    // Final push
    if (socket != null) {
        try {
            socket.sendMessage("done:" + resultsSummary());
        } catch (e) {
            // ignore
        }
    }
    job.remove();
    job.commit();
}
```

### Browser side

```js
var ws;

function setupProgress(wsUrl) {
    ws = new WebSocket(wsUrl);
    ws.onopen    = () => {
        setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 30000);
    };
    ws.onmessage = (event) => {
        var msg = event.data;
        if (msg.indexOf("progress:") === 0) {
            updateBar(parseInt(msg.split(":")[1], 10));
        } else if (msg.indexOf("done:") === 0) {
            showResults(msg.split(":")[1]);
            ws.close();
        }
    };
}
```

### When to use this

- WebSocket infrastructure already exists in the pal
- Low-latency updates matter (progress bar smoothness, streaming logs)
- The user is watching in real time

---

## Approach 2: Self-polling fragment

Works without WebSockets. Also the right choice when a WebSocket-based flow feels heavy
for what's actually a coarse "queued → running → done" progression.

### Flow

1. **Console action** — starts the job, sets a status column on the work row (`"crawling"`,
   `"running"`, `"complete"`, etc.), returns the progress fragment.
2. **Job (type 11)** — runs, advances the status column at coordinated points.
3. **Progress fragment** — contains a hidden `c:a` element with a fixed `id` that
   re-renders the same fragment.
4. **Browser** — a `setInterval` timer finds the hidden link and clicks it every few
   seconds. Each click re-fires the workflow action, which reads the status column and
   re-renders the fragment (or the final "done" page). When the fragment stops rendering
   the link, the loop self-terminates.

### The status state machine

The status column on the work row is the coordination channel — **never shared memory**,
never in-process variables. Both the job and the poll handler read and advance it.

Example state flow for a crawler+audit:

- **`startCrawl`** (console): seed root crawl row, insert audit `status="crawling"`, create
  the job, show the progress fragment
- **`crawl.js finishCrawl`** (job): only flips `"crawling"` → `"crawled"` (guarded — a stray
  duplicate fire must not reset a status the poll already advanced), records `pagesCrawled`,
  then removes itself
- **`pollAudit`** (console, browser-polled): one step per poll — `crawled` → set `checking`
  + repaint; `checking` → set `scoring` (guard against double-run) + `runChecks` (ends by
  setting `complete`); `complete` → show dashboard

**Rule: flip to a guard status BEFORE the expensive step**, so a concurrent invocation sees
the new status and no-ops.

### Workflow side — re-render the same fragment with fresh vars

```js
function pollAudit() {
    var audit = getAudit(data.get("auditId"));
    var status = audit.get("status");

    // ... one step of the state machine based on status ...

    payload.set("runningAuditId", audit.getId());
    payload.set("crawlClass", "done");                    // CSS class per step the template reads
    payload.set("checkClass", "active");
    payload.set("progressStatus", "Running checks");
    payload.set("progressSub", "Almost there");
    frag = "audit-progress";

    // When status == "complete":  getClientDashboard(); return;   (no poll link → loop stops)
}
```

### Fragment side — hidden `c:a` with a fixed id

Renders only while working (inside `${empty progressError}`); when the workflow returns the
dashboard fragment instead, the link is gone and the browser loop ends.

```html
<c:a id="pollLink"
     action="pollAudit?auditId=${runningAuditId}"
     ajax-target="body"
     class="muted"
     style="display: none;">poll</c:a>
```

### Browser side — click the hidden link once per render

```js
setInterval(tick, 4000);                                  // installed once on DOMContentLoaded

function tick() {
    var link = document.getElementById("pollLink");
    if (link) {
        if (!link.getAttribute("data-clicked")) {
            link.setAttribute("data-clicked", "1");
            link.click();                                 // re-fires the c:a → re-renders body → new pollLink (or dashboard)
        }
        return;
    }
    // No pollLink in the DOM — job finished, nothing to do
}
```

Guard with a `data-clicked` flag so each render fires exactly one request. The next render
brings a fresh, unclicked link.

### Why a hidden `c:a` and not `fetch`

`c:a` is server-rendered — the action and query string are encrypted before HTML reaches
the browser. `fetch` would expose them. This preserves CLAUDE.md rule 4.

### When to use this

- No WebSocket infrastructure and setting one up feels heavy
- The polling interval (~4s) is fine for the UX — coarse progress, not smooth streaming
- Compatible-everywhere is more important than latency

---

## Choosing between the two

| Question | Answer favors |
|---|---|
| Already using WebSockets? | Push (approach 1) |
| Need sub-second update latency? | Push |
| Compatibility with restricted environments? | Poll (approach 2) |
| Only 3–5 progress states, coarse UX? | Poll |
| Both back-end AND browser are yours to modify freely? | Push |

There's no wrong choice for a medium-complexity progress UI — both work. Pick based on what
the surrounding pal already does.

---

## Common gotchas

- **Never coordinate through shared memory.** The job and the poll handler have no shared
  runtime state. Use a status column on the work row.
- **Flip guard statuses BEFORE expensive work.** So a concurrent invocation sees the guard
  and no-ops.
- **The `data-clicked` guard** on the hidden `c:a` is essential — without it, `setInterval`
  fires multiple clicks per render and the workflow runs concurrently on stale state.
- **The WebSocket may be closed by the time the job pushes.** Wrap `sendMessage` in try/catch
  and continue — a disconnected client is not a job failure. The self-polling pattern is
  more resilient here since a lost fragment just means the user missed one update, not that
  state is lost.
- **Test end-of-loop termination.** The most common bug is "progress bar keeps polling
  forever" — verify that the final state (`complete`) stops rendering the `pollLink` and
  the browser loop self-terminates.
