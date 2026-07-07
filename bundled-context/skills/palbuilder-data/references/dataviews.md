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
- DataViewRecord — https://secure.cloudpiston.com/cpal/cp-api/web/DataViewRecord.html
- DataViewBuilder — https://secure.cloudpiston.com/cpal/cp-api/web/DataViewBuilder.html

Companion references:
- `datasets.md` — the full filter API, since it's shared
- `analytics.md` — `createAnalyticFilter()` for aggregates, group-by, having, date extraction
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

## Runtime views — `DataViewBuilder`

Not every DataView has to be declared at compile time. `pal.createDataViewBuilder()` builds a
view **at runtime** — include datasets, declare joins, choose columns, then convert to a
queryable DataView with `.toDataView(name)`.

**This is uncommon.** A registered (compile-time) view is clearer, cheaper, and the right
default. Reach for the builder only when the shape genuinely isn't known until runtime — a
join whose participating datasets depend on user input, a union assembled from a variable set
of sources, etc.

**Official API:** https://secure.cloudpiston.com/cpal/cp-api/web/DataViewBuilder.html

### Basic shape

```js
var builder = pal.createDataViewBuilder(true);   // suppressLimit — generally true

builder.includeDataSet("users", "u");           // include a dataset under an alias
builder.includeDataSet("stuff", "s");
builder.leftJoin("u", "userId", "s", "ownerId"); // left join on aliased columns
builder.includeColumns("u");                      // all non-system columns from users
builder.includeColumn("s", "description", "stuffDescription");  // one column, re-aliased

var view = builder.toDataView("userStuffRuntime");   // now query like any DataView

var filter = view.createFilter();
filter.addEqual("userId", userId);
var rows = view.getRecords(filter, "userStuff");
```

The builder methods return the builder (fluent), but per the ES3 workflow rules keep to
explicit statements rather than long chains.

### Key builder methods

| Method | Purpose |
|---|---|
| `includeDataSet(dataSet, alias)` | Add a dataset (by name or DataSet object) under an alias. Must be called before referencing that alias. |
| `innerJoin(lAlias, lCol, rAlias, rCol)` | Inner join — only matching rows from both. |
| `leftJoin(lAlias, lCol, rAlias, rCol)` | Left join — all left rows, matching right rows. |
| `includeColumns(alias)` | Include all non-system columns from a dataset. |
| `includeColumn(alias, column, columnAlias)` | Include one column under a result alias. **System columns must be re-aliased.** |
| `appendColumn(alias, columnAlias, defaultValue)` | Add a runtime column with a default value (max default size 20). |
| `distinct(bool)` | Toggle distinct rows. |
| `union()` / `unionDistinct()` | Union additional datasets — subsequent calls target the union side. Field names must match in order and type across all unioned views. |
| `getCriteria(alias)` | Get the per-dataset criteria object to constrain that side before building. |
| `appendSystem(systemView, sysAlias, joinColumn)` | Join a SystemDataView; access its columns via `rec.get('sysAlias','col')`. Cannot filter on system columns. |
| `toDataView(name)` | Finalize into a queryable DataView. |
| `reset()` | Clear the builder to reuse it for a different view. |

### String concatenation columns

The builder can synthesize a concatenated column from multiple source columns and literal
text — useful for a runtime display name:

```js
builder.startConcat();
builder.concatColumn("u", "firstName");
builder.concatText(" ");
builder.concatColumn("u", "lastName");
builder.endConcat("fullName");                   // result column aliased "fullName"
```

### Gotchas specific to the builder

- **Include before you reference.** A dataset must be added with `includeDataSet` before any
  `join`, `includeColumn`, or `getCriteria` call names its alias.
- **System columns need re-aliasing** in `includeColumn` — you can't include a system column
  under its own name.
- **Union field lists must line up** — same count, order, and types across every unioned
  view, or the union fails.
- **Prefer a registered view** unless the shape is truly dynamic. The builder is the
  exception, not the pattern.

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
