# DataSets — Deep Reference

DataSets are the primary persistence layer. The SKILL.md covers the standard read and write
patterns; this reference covers the full API surface, filter grouping, typed accessors,
record-by-id access, updates, and deletes.

**Official API:** https://secure.cloudpiston.com/cpal/cp-api/web/DataSet.html

Companion references:
- `dataviews.md` — DataView (read-model, joins) — uses the same filter API shape
- `analytics.md` — `createAnalyticFilter()` for aggregates, group-by, having, date extraction
- `payloads.md` — DataList shaping after a read

---

## Access

```js
var ds = pal.getDataSet("<name>");     // by registered dataset name (camelCase, plural)
```

The name matches the dataset entry in `pal.json` (see
`palbuilder-core/references/pal-json.md` for dataset registration).

---

## Column types

A dataset's columns are typed at definition time (in `pal.json`, or via the Pal Manager
schema editor). The type governs storage, validation, and how the platform casts filter
values. The commonly-used types:

**Keys and platform ids**
- **Primary key** — the dataset's own id. Auto-generated, **automatically indexed**. Named
  `<singular>Id` by convention (`users` → `userId`).
- **Transaction id** — stores a transaction (packet) id.
- **Transaction id auto-populate** — same, but auto-fills the current transaction id when a
  row is written inside a transaction workflow.
- **Profile id** — stores a profile id.
- **Profile id auto-populate** — auto-fills the acting profile's id when written in a
  console or transaction workflow. The standard way to stamp "who owns this row".

**Strings**
- **Varchar** — variable-length string, the everyday text column.
- **Char** — fixed-size string.
- **Text** — up to 65 KB.
- **Medium text** — up to 16 MB.

**Numbers**
- **Tiny / Small / Medium / Integer / Big** — integer types of increasing range, each
  **signed or unsigned**. Use unsigned when the value is never negative (ids, counts).
- **Decimal** — fixed-precision. The length is specified as `precision,scale` — e.g. `4,2`
  means 4 total digits with 2 after the decimal point (so up to `99.99`).

**Dates / booleans**
- **Date** — accepts `Date` objects from `dateUtil` (see
  `palbuilder-workflow/references/utilities.md`).
- **DateTime** — same, with time component.
- **Boolean** — stored and compared as the strings `"true"` / `"false"` (see the boolean
  gotcha throughout this reference).

**Encrypted and files**
- **Encrypted** — value encrypted at rest, decrypted on read.
- **File** — a stored file.
- **File encrypted** — a stored file, encrypted at rest.
- **Remote file** / **Remote file encrypted** — a file held in remote storage, optionally
  encrypted.

### Keys, "foreign keys", and the unsigned-integer convention

The platform has **primary keys** but **no foreign-key concept** — there is no enforced
referential constraint between datasets. You still reference other datasets' ids freely; it's
just a plain column with a matching value.

**Convention:** when a column holds another dataset's primary key (a "foreign key" in intent),
type it as an **unsigned integer**. For example, a `stuff` dataset referencing `users.userId`
declares its `ownerId` column as unsigned integer. Nothing enforces the relationship — joins
and cascades are all manual (see "The platform does not cascade" below) — but the convention
keeps referenced-id columns consistent and correctly sized.

---

## Indexes

Beyond the auto-indexed primary key, datasets can carry **additional indexes** on columns
that frequently appear in query conditions — **especially the join columns used by
DataViews**. An unindexed join column forces a full scan on every view query; indexing it is
the single highest-leverage dataset performance change.

An index is defined by:
- A **name**
- **One or more columns, in order of use** — exactly like a conventional compound (composite)
  index. Column order matters: an index on `(palId, profileId)` accelerates queries that
  filter on `palId` alone or `palId` + `profileId`, but not `profileId` alone.

Indexes are declared in the dataset definition (in `pal.json`'s dataset entry — see
`palbuilder-core/references/pal-json.md` — or via the Pal Manager schema editor). Example
from a `users` dataset:

```
Index "email"          → columns: [email]
Index "palAndProfile"  → columns: [palId, profileId]
```

### When to add an index

- **DataView join columns** — the top priority. Every column a view joins on should be
  indexed on both sides.
- **Frequently-filtered columns** — a column hit by `addEqual` / `addGreaterThan` / etc. on
  most reads of a large dataset.
- **Sort columns on large datasets** — a column used in `sortAscending` / `sortDescending`
  where the result set is big.

### When NOT to bother

- Tiny datasets (a few hundred rows) — the scan is already fast; the index is overhead on
  every write for no read benefit.
- Columns rarely used in conditions — an index that's never hit is pure write-time cost.

### Diagnosing index usage

The filter's `explain(true)` method (development-only, output goes to the Pal Manager debug
panel) describes which indexes a query will use. The analytic filter additionally exposes
`useIndex(indexName)` and `forceIndex(indexName)` to influence the choice — see
`analytics.md`. Reach for these only when `explain` shows the planner picking a suboptimal
index.

---

## Reading — the full filter API

Every read starts with `ds.createFilter()`. The filter is a builder; methods return `void`
(mutate in place) and are chainable only by repeated calls, not fluent syntax.

### Column selection

```js
filter.selectColumns(["userId", "email", "createDate"]);
```

**Always call `selectColumns`** — it's faster and makes intent explicit. Omitting it fetches
every column of every matching row.

### Conditions

```js
filter.addEqual("col", value);              // col = value
filter.addNotEqual("col", value);           // col != value
filter.addNotNull("col");                   // col IS NOT NULL
filter.addNull("col");                      // col IS NULL
```

Booleans stored as strings compare as strings:

```js
filter.addEqual("favorited", "true");       // NOT the boolean true
```

### Boolean grouping — `beginGroup` / `endGroup` / `addAnd` / `addOr`

For `(a AND b) OR (c AND d)`:

```js
var sharedListDV = pal.getDataView("sharedListView");
var filter = sharedListDV.createFilter();
filter.beginGroup();
  filter.addEqual("friendId", userId);
  filter.addAnd();
  filter.addEqual("shareType", "editor");
filter.endGroup();
filter.addOr();
filter.beginGroup();
  filter.addEqual("friendId", userId);
  filter.addAnd();
  filter.addEqual("favorited", "true");
filter.endGroup();
```

Without explicit `addAnd`/`addOr`, adjacent conditions AND by default.

### Sorting

```js
filter.sortAscending("createDate");
filter.sortDescending("favorited");         // combine — first sort by favorited desc, then by createDate asc
filter.sortAscending("createDate");
```

Order of sort calls determines sort priority (first call = primary sort).

### Paging

```js
filter.enablePaging(pageNumber, pageSize);   // pageNumber is 0-indexed
```

---

## Fetching

### Multiple rows — `getRecords`

```js
var rows = ds.getRecords(filter);                // DataList named after the dataset
var rows = ds.getRecords(filter, "customName");  // DataList with a custom name
```

Returns a `DataList` — see https://secure.cloudpiston.com/cpal/cp-api/web/DataList.html.
This list is ready to be added to a payload as-is. Structural mutability (adding, removing,
or renaming columns) requires converting to a `PacketDataList` via `.copy(name)`:

```js
var mutable = rows.copy("shapedList");
mutable.addColumn("shareType");
mutable.setColumnValue("shareType", "owner");
```

Only call `.copy()` when you actually need to change the list's shape. See `payloads.md` for
the full mutability distinction and the PacketDataList API
(https://secure.cloudpiston.com/cpal/cp-api/web/PacketDataList.html).

### Single row — `findRecord`

Three overloads:

```js
// (1) Column + value shorthand — one equality, no filter object needed
var contact = ds.findRecord("email", email);

// (2) Built filter object — for multiple conditions
var itemFilter = ds.createFilter();
itemFilter.addEqual("itemId", id);
itemFilter.selectColumns(["itemId", "name"]);
var record = ds.findRecord(itemFilter);

// (3) By primary key id — no filter at all
var user = ds.getRecord(userId);
```

`findRecord` returns `null` if nothing matches — **always null-guard** before reading columns.

---

## Reading columns from a record

```js
var email  = rec.get("email");             // returns String (or null)
var count  = rec.getInt("itemCount");      // typed integer accessor
var id     = rec.getId();                  // primary-key value of this record
```

**Always use `rec.get()`** — `rec.getValue()` exists but is discouraged; `.get()` is
preferred throughout the codebase.

Full DataSetRecord / DataViewRecord APIs:
- https://secure.cloudpiston.com/cpal/cp-api/web/DataSetRecord.html
- https://secure.cloudpiston.com/cpal/cp-api/web/DataViewRecord.html

For iterating a DataList, use its own count and index accessors:

```js
for (var i = 0; i < list.getRecordCount(); i++) {
    var row = list.getRecord(i);            // zero-indexed
    var userId = row.get("userId");
}
```

---

## Writing

### Insert

```js
var rec = ds.createRecord();                // empty record built off the DataSet
rec.set("email", email);
rec.set("firstName", firstName);
rec.setInt("count", 0);                     // typed integer setter
rec.setDate("createDate", dateUtil.createDate());   // prefer DateUtil.createDate() over new Date()
var newId = ds.insertRecord(rec);           // returns the new primary-key id
```

### Update

```js
existing.set("status", "Active");
existing.setInt("count", existing.getInt("count") + 1);
ds.updateRecord(existing);                  // persists edits
```

### Find-or-create (idempotent write pattern)

The safe default — prevents duplicates on re-run:

```js
var f = ds.createFilter();
f.addEqual("url", clean);
var existing = ds.findRecord(f);
if (existing == null) {
    var r = ds.createRecord();
    r.set("url", clean);
    r.set("crawled", "false");
    r.setInt("itemCount", 1);
    ds.insertRecord(r);
} else {
    existing.setInt("itemCount", existing.getInt("itemCount") + 1);
    ds.updateRecord(existing);
}
```

Use this shape whenever a workflow can run more than once with the same input (job retries,
webhook redelivery, user re-submits).

---

## Deleting

**`deleteRecord` takes the primary-key id, not a record object.** This is intentionally
asymmetric with `updateRecord(record)`, which takes the record itself.

```js
// ✗ WRONG — deleteRecord does not accept a DataSetRecord
ds.deleteRecord(record);

// ✓ RIGHT — pass the primary-key id as a String
ds.deleteRecord(equipmentId.toString());
```

Four ways to delete, ordered from targeted to broad:

```js
// (1) One row by id
ds.deleteRecord(id.toString());              // requires a String id

// (2) Delete by column-equality shorthand (parallels findRecord's shorthand)
ds.deleteRecords("column", value);           // removes matching rows

// (3) Bulk-delete by built filter (any filter shape)
var filter = ds.createFilter();
filter.addEqual("userId", userId);
filter.addNotNull("archived");
ds.bulkDelete(filter);

// (4) Bulk-delete by an array of primary-key ids
ds.bulkDelete([id1, id2, id3]);
```

**Prefer `id.toString()` over `"" + id`** whenever you need to coerce a numeric id to a
String — it's the cleaner idiom throughout the codebase.

### The platform does not cascade

CloudPiston has **no automatic cascade delete**. Removing a `users` row does NOT
automatically remove that user's `stuff` rows. Every cascade must be written explicitly in
workflow code:

```js
// Explicit cascade — delete the user's stuff, THEN the user
pal.getDataSet("stuff").deleteRecords("ownerId", userId);
pal.getDataSet("users").deleteRecord(userId.toString());
```

If a "parent" delete could leave orphans in child datasets, hunt down every child dataset
and delete from each before deleting the parent. There is no framework that will do this for
you.

---

## Common gotchas

- **`null` return from `findRecord`** — always null-guard before reading columns. Missing this
  is the #1 workflow crash cause.
- **Booleans stored as strings** — `"true"` / `"false"`. `addEqual("col", true)` will not match
  a row where the column is the string `"true"`.
- **`selectColumns` omission** — pulls every column. Fast to hit, slow to debug when it scales.
- **`enablePaging` is 0-indexed** — page 0 is the first page.
- **`deleteRecord` takes a String id** — use `id.toString()` to coerce.
- **No automatic cascades** — every child-row cleanup must be written explicitly. See the
  Deleting section above.
- **Unindexed join columns are a silent performance cliff.** A DataView that joins on an
  unindexed column scans the whole table on every query. Index both sides of every join.
- **No foreign keys** — referenced-id columns are plain (unsigned integer by convention);
  nothing enforces the relationship. Joins and cascades are all manual.
