# DataViews — Read-Model with Joins

A **DataView** is a read-only join over one or more DataSets, registered in `pal.json` under
`dataviews`. Use a DataView when you need columns from multiple datasets in a single query,
or when the same join shape is used in many places and belongs in the manifest rather than
in code.

DataViews use **the same filter API shape as DataSets** — the source differs, the filter
methods don't. If you know DataSet filters (see `datasets.md`), you know DataView filters.

**Official APIs:**
- DataView — https://secure.cloudpiston.com/cpal/cp-api/web/DataView.html
- DataViewFilter — https://secure.cloudpiston.com/cpal/cp-api/web/DataViewFilter.html
- AnalyticDataViewFilter — https://secure.cloudpiston.com/cpal/cp-api/web/AnalyticDataViewFilter.html
- DataViewRecord — https://secure.cloudpiston.com/cpal/cp-api/web/DataViewRecord.html

Companion references:
- `datasets.md` — the full filter API, since it's shared
- `payloads.md` — DataList shaping after a read

---

## Access

```js
var dv = pal.getDataView("<name>");         // by registered dataview name
```

The name matches the dataview entry in `pal.json`. A dataview registration declares its source
datasets, join relations, and available fields (with aliases). See
`palbuilder-core/references/pal-json.md` for the manifest structure.

Example manifest entry (abbreviated):

```json
{
  "string": "userStuff",
  "Dataview": {
    "name": "userStuff",
    "datasets": { "stuff": "stuff", "users": "users" },
    "relations": [
      {
        "leftDatasetAlias": "users",
        "rightDatasetAlias": "stuff",
        "leftDatasetFieldName": "userId",
        "rightDatasetFieldName": "ownerId",
        "joinType": 1
      }
    ],
    "fields": [
      { "datasetAlias": "users", "datasetFieldName": "email",  "alias": "email"  },
      { "datasetAlias": "stuff", "datasetFieldName": "description", "alias": "description" }
    ]
  }
}
```

In workflow code you reference the view's aliased field names, not the underlying dataset
columns.

---

## Reading — identical API to DataSets

```js
var sharedListDV = pal.getDataView("sharedListView");
var filter = sharedListDV.createFilter();
filter.selectColumns(["listId", "ownerId", "shareType", "favorited"]);
filter.addEqual("friendId", userId);
filter.sortDescending("favorited");
var shared = sharedListDV.getRecords(filter);      // DataList
```

**Name the dataview and the filter on their own lines.** Chaining `createFilter` inline on
`pal.getDataView(...)` reads poorly and obscures which object is which. Give the filter a
name that contains "filter" so its role is unambiguous.

All filter methods from `datasets.md` apply: `selectColumns`, `addEqual`, `addNotNull`,
`beginGroup`/`endGroup`/`addAnd`/`addOr`, `sortAscending`/`sortDescending`, `enablePaging`.

`findRecord(filter)` also works on DataViews. `findRecord("col", val)` shorthand and
`getRecord(id)` **do not apply** — a DataView has no single primary key.

---

## When to use a DataView vs a DataSet

Use a **DataSet** when:
- You need writes (`insertRecord`, `updateRecord`, `deleteRecord`) — DataViews are read-only.
- You only need columns from one table.
- The query is one-off (a DataView is a registered artifact; over-registering clutters the
  manifest).

Use a **DataView** when:
- You need columns from multiple related datasets in one query.
- The same join shape appears in multiple workflows — registering it once keeps the join
  definition consistent.
- Reads are the only operation.

**Do not** try to write to a DataView — it will fail. Writes go against the underlying
DataSets directly.

---

## Joining in memory as an alternative

If a join is used in exactly one place, or if the join columns don't align cleanly, do the
merge in memory using PacketDataList methods (see `payloads.md`):

```js
var mutable = myLists.copy("lists");            // convert to PacketDataList first
mutable.addDataList("lists", shared);            // append/merge another DataList into this one
```

Basic DataLists are structurally immutable — you need `.copy(name)` to get a
`PacketDataList` that supports `addDataList`, `addColumn`, `renameColumn`, etc.

This trades a manifest entry for runtime work. For rarely-hit code paths, in-memory is fine.
For hot paths, a registered DataView is faster and cleaner.

---

## Common gotchas

- **Field names are aliases**, not underlying column names. If the view registers
  `email` as an alias for `users.email`, use `filter.addEqual("email", …)` — not `users.email`.
- **DataViews are read-only.** No `insertRecord` / `updateRecord` / `deleteRecord`.
- **`getRecord(id)` doesn't work** — a view has no single PK. Use `findRecord(filter)` with an
  equality condition on the identifying alias.
- **Registering a view requires the join declarations to be correct.** A misconfigured
  `joinType` or field alignment silently returns wrong rows. If a view returns strange results,
  check the manifest entry.
