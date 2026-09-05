# Exercise authoring

Contents: flow shape · selectors and data · mutation assertions
Read before the first `pal_exercise` call in a session.

## Flow shape

Before the first call, read the local page/fragment markup and derive every input `name=`, exact
visible click label, and row/card container used by `within`. Do not discover selectors by repeated
exercise calls; a failed call stops at its first failure and later steps do not run.

Batch a create → edit → delete flow into one `steps` call. Web steps use
`{action, params, expect}`; console steps use `{fill:{name:value}, click:"<exact link text>", expect:[...]}`
and select their first screen with `initial:{action, params, expect}` — a step-level `action`/`page`
is rejected on a console pal. A console opens on its list view, so click Add/Create before filling
the create form. Split flows longer
than 10 steps. For every spec effect, read the record back and assert every named field, including fields
not rendered by the default fragment.

## Selectors and data

Use unique `{{runId}}` data for every created record and subsequent expectation. Scope repeated row/card
actions through the identifying cell with
`within: 'tr:has([data-label="Name"]:has-text("{{runId}}"))'` or an equivalent unique card selector.
Unscoped duplicate-text clicks, the first matching action, list order, and a shared-name `:has-text()`
scope are ambiguous. Console workflows use fill/click for every screen after the first, and `initial` for the first.

Use full unique edit values such as `Old {{runId}}` and `New {{runId}}`; neither may be a substring of
the other. An input `value` is not visible text, and CSS `text-transform` does not change source casing.

## Mutation assertions

| After action | `expect` | `absent` |
|---|---|---|
| Create | new value | — |
| Edit | complete new value | complete old value |
| Delete | — | unique deleted value |

After an edit, require both the new value and absence of the old value; otherwise a duplicate insert can
pass. After a delete, assert the unique deleted value is absent. Never use global `absent` for a state word
such as “available” or global empty-state copy such as “No equipment yet” on a multi-row list.

## Waiting for asynchronous state

A background job, self-polling fragment, or WebSocket push may update the current page after the
triggering action completes. Add a bounded `waitFor` to the step that should observe that update:

```js
{ click: "Start job", expect: ["Done {{runId}}"], waitFor: { timeoutMs: 15000, intervalMs: 500 } }
```

The step's existing `expect`/`absent` arrays are the completion predicate. Defaults are 15 s timeout
(max 60 s) and 500 ms interval (min 100 ms); invalid or oversized values are refused before any
browser is launched. A waiting WEB step uses browser mode so current visible state is observed.

Safety: each `action`/`click` executes exactly once. The wait loop only re-reads `innerText("body")`
and current markup — it never navigates, reloads, fetches, clicks, or invokes a workflow again while
polling. A render error aborts the wait immediately. A timeout is a behavior failure that retains the
last observed assertion state as evidence. Waiting does not change the pre-mutation retry boundary or
the step-count cap (still 10 steps).

## Failure evidence

A failed or blocked browser run captures bounded evidence and persists failure-only artifacts in a run
directory under `.agent-work-history/` returned by the call: `steps.json` (two distinct arrays —
`requestedSteps`, the steps as called with auth-like fill/params values redacted, and
`executionResults`, the per-step results with any credential-bearing text sanitized),
`browser-events.json` (deduped console errors/warnings, page errors, failed requests, HTTP ≥ 400 —
URLs and messages sanitized), `aria-snapshot.txt` (scoped accessibility snapshot, truncated ~4k, with a
body-snapshot retry before the fallback) or `screen-hints.json` when the snapshot is unavailable,
`failure.jpg` (one bounded JPEG, when captured; password/auth/OTP-like field values are masked before
capture — this is a best-effort control, not full screenshot secrecy), `metadata.json`, and `notes.md`.
The call returns a compact evidence summary with the artifact path; partially failed artifact writes
are reported as an explicit warning.

A successful `pal_exercise` returns a bounded `finalSnapshot` — browser runs expose final visible body text (`source: "visible"`), fetch runs expose server markup with honest `server-markup` provenance. Text is scrubbed and capped (~4k) with an explicit truncation marker; failed/blocked/invalid runs return no snapshot. The snapshot never enters the durable evidence ledger (only the data-minimized summary does) and the human-readable result includes a compact final-snapshot line.

A blocked/failed `pal_exercise` is NOT a PASS — do not mark the pal done. Inspect the artifacts (browser
events, accessibility snapshot, failure screenshot) and derive the fix from them instead of probing
selectors by trial and error. Passing runs write no failure artifacts.
