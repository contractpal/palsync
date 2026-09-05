---
name: palbuilder-realtime
description: "Load for background jobs/workflowType 11, WebSockets, progress updates, or long-running work."
---

# CloudPiston Pal — Realtime (Jobs & WebSockets)

Two mechanisms let a pal do work that outlives a single request or push state to the browser
without polling:

- **Background Jobs** (`workflowType: 11`) — the platform invokes a workflow separately from
  any browser request, and the workflow can reschedule itself in batches. Use when a task is
  too long for a single request window.
- **WebSockets** — `ClientSocket` opens a live server-to-browser channel; server-side code
  (a workflow, a receiver workflow, or a delayed job) pushes messages the browser receives
  via native `WebSocket.onmessage`. Use when the server needs to speak to the browser
  without the browser asking.

The two combine cleanly: a long job pushes progress into a WebSocket the browser opened.

CLAUDE.md holds the always-on rules. `palbuilder-workflow` teaches the base `run()` pattern.
This skill teaches the realtime-specific patterns.

---

## Read [reference].md when

- **`references/jobs.md`** — writing a background job (`workflowType: 11`). Covers
  registering the job workflow, launching one with `createJob`, the `c.getJob()` entry
  contract, seeding and reading job payloads, the Monitor batch-and-reschedule loop, and
  reschedule/commit/remove.
- **`references/websockets.md`** — opening a live server-push channel. Covers
  `createClientSocket`, the browser Script that connects, the per-message receiver
  workflow, pushing from a detached job by `socketId`, and broadcasting to a channel.
- **`references/progress-ui.md`** — showing job progress to the user. Two approaches: push
  via WebSocket (the modern default) or the self-polling fragment (works everywhere, no
  socket setup). Includes the status state-machine pattern for coordinating job and browser.

---

## When to use what

### Do I need a job?

**Yes** if the work:
- Might exceed the workflow's timeout budget (the budget varies by pal; jobs get to
  reschedule themselves for another slice)
- Should continue after the user navigates away
- Runs on a schedule (nightly, hourly)
- Needs retry semantics (failure → reschedule → try again)

**No** if the work fits in one request. Not every "slow" operation needs a job — some just
need `monitor.setMaxTimeout()` to claim the full budget.

### Do I need a WebSocket?

**Yes** if the server needs to speak to the browser **on its own initiative** — chat, live
notifications, streaming progress from a job, multi-user broadcast.

**No** if the browser only needs updates when the user does something. A `c:a`
action-and-refresh is simpler.

### Do I need both?

The classic use case: a background job runs and periodically pushes progress to a live
WebSocket the browser opened. See `progress-ui.md` for the pattern.

The alternative — **self-polling fragment** — works without WebSockets: a hidden `c:a` in
the progress fragment self-clicks every few seconds, re-rendering the fragment with fresh
progress data. Also in `progress-ui.md`. Use when you don't want the WebSocket infrastructure
or the browser environment can't sustain a socket (older embedded WebViews).

---

## What this skill relies on

- **`palbuilder-workflow`** — the `run()` shape, reserved globals, and general workflow
  patterns. Job workflows follow the same `run(controller)` contract with a different
  entry point (`c.getJob()` instead of `c.getAction()`).
- **`palbuilder-workflow/references/utilities.md`** — Monitor API (`setMaxTimeout`,
  `isTimeRemaining`, `startTimer`, `stopTimer`). Batch-and-reschedule loops depend on it.
- **`palbuilder-workflow/references/console-system.md`** — the workflowType 11 stub that
  points at this skill.
- **`palbuilder-data`** — payloads, DataLists, and the HTTP client. Jobs commonly hit
  external services (see `palbuilder-data/references/http-client.md`).

---

## The one gotcha to memorize now

**Jobs have a timeout budget — measure it, don't assume it.** A `workflowType: 11` job runs
against a timeout like any workflow, but the specific budget is set by the pal's activation
key and varies from pal to pal. Read the actual value with `monitor.getTimeout()` or check
remaining time with `monitor.getRemainingTime()`.

For any job doing substantial work — which is nearly all of them — use the batch-and-
reschedule pattern:

1. `monitor.setMaxTimeout()` at the top to claim the max window this pal allows
2. Process work in a loop, checking `monitor.isTimeRemaining(N)` after each unit (where N ≥
   one unit's worst-case cost)
3. If work remains and time doesn't, `job.reschedule(...)` + `job.commit()` and return
4. If work is complete, `job.remove()` + `job.commit()`

Full pattern in `jobs.md`. Getting this wrong yields a job that runs once, times out with
work still pending, and either disappears or loops forever depending on which lifecycle
call you missed.
