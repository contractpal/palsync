# Console-System Workflows (`workflowType: 11`)

Console-system workflows are the **background job engine**. They are non-user, daemon-based
— accessed through the `JobManager` API by creating and scheduling jobs, not by browser
requests.

**For everything about jobs, read `palbuilder-realtime`** — that skill owns the full
JobManager surface, job lifecycle, the Monitor time-budget loop, and progress-UI patterns.
Duplicating that content here would drift.

---

## Quick facts

- **Entry point is `c.getJob()`, not `c.getAction()`.** Console-system workflows have no
  action switch in the usual sense — the job payload carries what needs to be done.
- **No `page` or `ajax` responses.** A job doesn't render UI — it does work and commits
  results (or reschedules itself). See `palbuilder-realtime` for the response patterns
  jobs actually use.
- **Registered in `pal.json`'s `layout` block** as `consoleSystemWorkflow` for the default
  job workflow; additional job workflows can be registered and invoked by name via
  `JobManager`.

---

## Why type 11 and not type 3?

`workflowType: 3` (transaction system) is deprecated. Use `workflowType: 11` (console
system) instead, even for work that touches a transaction — pass the transaction id in the
job payload and read it explicitly at the top of the job workflow.

See `palbuilder-core/references/pal-json.md` for the full workflowType table.

---

## Read next

- **`palbuilder-realtime`** — the skill that owns jobs, websockets, progress UI, and the
  server-push patterns that combine them.
