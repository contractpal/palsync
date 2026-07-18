# Exercise authoring

Contents: flow shape · selectors and data · mutation assertions
Read before the first `pal_exercise` call in a session.

## Flow shape

Before the first call, read the local page/fragment markup and derive every input `name=`, exact
visible click label, and row/card container used by `within`. Do not discover selectors by repeated
exercise calls; a failed call stops at its first failure and later steps do not run.

Batch a create → edit → delete flow into one `steps` call. Web steps use
`{action, params, expect}`; console steps use `{fill:{name:value}, click:"<exact link text>", expect:[...]}`.
A console opens on its list view, so click Add/Create before filling the create form. Split flows longer
than 10 steps. For every spec effect, read the record back and assert every named field, including fields
not rendered by the default fragment.

## Selectors and data

Use unique `{{runId}}` data for every created record and subsequent expectation. Scope repeated row/card
actions through the identifying cell with
`within: 'tr:has([data-label="Name"]:has-text("{{runId}}"))'` or an equivalent unique card selector.
Unscoped duplicate-text clicks, the first matching action, list order, and a shared-name `:has-text()`
scope are ambiguous. Console workflows use fill/click, not web action/page steps.

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
