# Debugging and Logging — `c.debug` vs `Logger`

The platform has two distinct facilities for getting information out of a running workflow,
and they solve different problems:

- **`c.debug` / `c.debugData` / `c.debugList`** — ephemeral, visible only at runtime (in the
  debug panel, `<c:debug/>`), meant to be removed before shipping.
- **`Logger`** (`c.getLogger()`) — persistent, structured, viewable after the fact in Pal
  Manager, safe to leave in production code.

Reaching for the wrong one is the most common mistake: `c.debug` calls that quietly do
nothing in production (because they were never meant to persist), or `Logger` calls used for
the kind of throwaway "what's in this variable" check that `c.debug` is actually for.

**Official API:**
- Logger — https://secure.cloudpiston.com/cpal/cp-api/console/Logger.html

---

## `c.debug` — runtime-only inspection

Available during development; **remove before finishing** (CLAUDE.md anti-patterns):

- `c.debug(obj)` — accepts a `String`, `Data`, `DataList`, or `Payload`. **Prefer this** over
  the more explicit variants.
- `c.debugData(data)` — dumps a `Data` object (single-argument, no label).
- `c.debugList(dataList)` — dumps a `DataList` (single-argument, no label).

Use these to inspect what a query or handler produced instead of guessing. Output only
appears at runtime (the debug panel — see `palbuilder-frontend/references/c-tags.md`'s
`c:debug` tag) — there's no persistence, no history, and nothing to check after the fact.
Every debug call must be removed before the workflow ships — CLAUDE.md's checklist enforces
this.

---

## `Logger` — persistent, structured logging

`c.getLogger()` returns the workflow's Logger. Unlike `c.debug`, **Logger calls are safe —
expected, even — to leave in production code.** They write to the pal's log history in Pal
Manager rather than to a runtime-only panel, so they're useful for debugging issues that
happen after the fact, not just while you're staring at the page.

```js
var logger = c.getLogger();
```

### Setup — Logger requires a Notification

**A Logger requires a Notification set up and associated with the runtime pal, with log
levels enabled**, configured from **Pal Manager** — not configurable from within the runtime
pal itself. Without a configured Notification, most levels are silently dropped:

- **If no Notification is set up, `logger.error` is always logged regardless.** Every other
  level (`info`, `warn`, `debug`) requires that level to be explicitly enabled on the
  Notification to record anything.

This is the opposite failure mode from `c.debug`: a `Logger` call that appears to do nothing
is very often a Notification/level configuration problem, not a code problem. Check Pal
Manager's notification settings before assuming a logging call is broken.

**Notifications can also alert on their own** — configure a Notification so that a `warn` or
`error` log automatically emails support, turning logging into lightweight alerting.

### The four log levels

```js
logger.debug(obj)     // string, Data, DataList, or Payload
logger.info(obj)
logger.warn(obj)
logger.error(obj)              // OR: logger.error(obj, "message")
```

`debug`, `info`, and `warn` each take a **single object** — a `String`, `Data`, `DataList`,
or `Payload`. `error` is the one exception: it can take just an object like the others, **or**
an object plus a separate message string — `logger.error(someData, "message")`.

### Checking whether a level is enabled

```js
if (logger.isDebugEnabled()) {
    // build/attach something relatively expensive only if it'll actually be recorded
}
```

`isDebugEnabled()` (and its variants for the other levels) let you skip building a payload
for a log call that the current Notification configuration would discard anyway — useful
when the log content itself is non-trivial to assemble.

### Storage behavior

- **All levels except `debug` are stored the moment the method is called.**
- **`debug` events are stored when the workflow thread ends**, not immediately on the call.
- **Every level is capped at 100 events per workflow thread.** Logging heavily inside a
  loop or a batch job can silently lose events past that cap — the platform doesn't queue or
  overflow past 100 per thread.

---

## Choosing between them

| | `c.debug` | `Logger` |
|---|---|---|
| Visibility | Runtime only (debug panel) | Persisted, viewable later in Pal Manager |
| Lifespan in code | Temporary — remove before shipping | Fine to leave in production |
| Setup required | None | A Notification configured in Pal Manager, with levels enabled |
| Alerting | None | Can be wired to auto-email support on `warn`/`error` |
| Per-thread limit | None | 100 events per workflow thread |
| Best for | "What's in this variable, right now, while I'm working on this" | Long-term, after-the-fact debugging; production issue tracking |

If you're investigating something interactively while writing a handler, `c.debug` is the
right tool and should come back out once you're done. If you want visibility into what
happens in production — especially for errors a real user hits when you're not watching —
that's what `Logger` is for, and it's fine for those calls to stay.

---

## Common gotchas

- **`c.debug` calls left in shipped code are a CLAUDE.md violation**, not just clutter —
  they should be removed, not just ignored.
- **A silent `Logger` call is almost always a Notification/level configuration issue**, not
  a broken call — check Pal Manager before debugging the workflow code itself. The one
  exception is `error`, which always logs even with no Notification configured.
- **Notification levels are Pal-Manager-only.** There's no runtime API to enable/disable a
  level from inside the workflow — only to check whether it's currently enabled
  (`isDebugEnabled()` and variants).
- **`debug`-level Logger events persist at thread end, not on call** — if a workflow thread
  is killed or times out before it ends normally, in-flight `debug` events for that thread
  may not be stored. `info`/`warn`/`error` don't have this risk; they store immediately.
- **100 events per workflow thread, per level-agnostic total** — a busy loop calling
  `logger.info` repeatedly can hit the cap well before the loop finishes. Log at meaningful
  checkpoints, not every iteration.
- **`logger.error` is the only level with a two-argument form.** `debug`/`info`/`warn` take
  exactly one object; passing a second argument to those is not part of the API.
