# DataSets — Deep Reference

DataSets are the primary persistence layer. The SKILL.md covers the standard read and write
patterns; this reference covers the full API surface, filter grouping, typed accessors,
record-by-id access, updates, and deletes.

**Official API:** https://secure.cloudpiston.com/cpal/cp-api/web/DataSet.html

Companion references:
- `dataviews.md` — DataView (read-model, joins) — uses the same filter API shape
- `payloads.md` — DataList shaping after a read

---

## Registering a dataset — the schema lives in `pal.json`

Before you can `getDataSet` a name, the dataset must be registered in `pal.json`'s `datasets`
array. The schema is the **inline `Dataset` object** on that entry — its `fields.DatasetField[]`
array IS the column definition. This is the ONLY place the schema lives; a `datasets/<name>.json`
file on disk is a passthrough copy, not the source of truth.

```json
{ "string": "equipment", "Dataset": { "name": "equipment", "freeform": true, "fields": { "DatasetField": [
  { "fieldName": "equipmentId", "fieldType": "Primary key" },
  { "fieldName": "name",        "fieldType": "String", "fieldSize": 100, "notNull": true, "notEmpty": true },
  { "fieldName": "status",      "fieldType": "String", "fieldSize": 20, "indexed": true },
  { "fieldName": "createdAt",   "fieldType": "Date" }
] }, "indexes": "" } }
```

- **`"freeform": true` is required.** Without it the provisioned table has no per-field columns, so
  `SELECT <fieldName>` throws `Unknown column` at runtime even though the definition saved and the
  workflow compiled. The server defaults it to `false`, so an omitted `freeform` is silently broken.
  (palsync's dataset-sync step defaults it to true for you, but set it explicitly.) The `"Primary key"`
  field is the platform row id (internally `CP_ID`); with `freeform:true` you still read/query it by
  its own `fieldName` (e.g. `equipmentId`).
- `string` and `Dataset.name` are both the dataset name (camelCase, plural).

### Per-field attributes

Every entry in `DatasetField[]` needs `fieldName` + `fieldType`; the rest are optional:

| attribute | meaning |
|---|---|
| `fieldSize` | max length — **String/Char only** (character length); precision/scale for `Decimal`. Other types have a fixed width — omit it. |
| `notNull` | the value must not be null |
| `notEmpty` | a string value must not be empty — the closest thing to a minimum. **There is no min-length attribute**; enforce a longer minimum in the workflow. |
| `indexed` | index the column — set `true` on any column you filter or sort by |
| `defaultValue` | server default applied when an inserted row omits the column (e.g. `"available"` for a status) |
| `description` | free-text note; cosmetic |

Numeric range is chosen by the TYPE, not an attribute — pick `Tiny/Small/Medium integer`, `Number`,
`Big Number` (or the unsigned variants) for the range you need. There is no max-value attribute.
- Every dataset gets ONE `"Primary key"` field named `<name>Id`. Flag an indexed column `"indexed": true`.
- `fieldType` uses EXACT strings — the integer type is `"Number"`, NOT `"Integer"`/`"int"`.
  Valid: `"Primary key"`, `"String"` (+`fieldSize`), `"Char"`, `"Text"`, `"Boolean"`, `"Number"`,
  `"Big Number"`, `"Decimal"`, `"Date"`, `"DateOnly"`, `"File"`, `"Encrypted"`.

**Registering the schema does not create the table** — the definition and the storage are two
separate steps. In a palsync workspace, after adding the entry you MUST run the dataset-sync
step to provision the actual table (see the "Datasets" section of `CLAUDE.palsync.md`); until you
do, `pal.getDataSet("<name>")` reads an empty/absent table and writes silently fail. Full
`pal.json` registration rules: `palbuilder-core/references/pal-json.md`.

---

## Access

```js
var ds = pal.getDataSet("<name>");     // by registered dataset name (camelCase, plural)
```

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
filter.enablePaging(pageSize, pageNumber);   // pageNumber is 0-indexed
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
rec.setDate("createDate", new Date());      // date setter (Date object)
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
