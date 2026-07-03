---
name: palbuilder-data
description: Use this skill whenever reading, writing, or shaping data in a CloudPiston pal — datasets, dataviews, payloads, DataMaps, DataLists, pal-level data, cache, files/attachments, or server-side HTTP calls to external services. Covers the standard read pattern (getDataSet + createFilter + selectColumns + addEqual + getRecords), the standard write pattern (createRecord + set + insertRecord + updateRecord) with find-or-create idempotency, payload composition (root data + named DataMaps + DataLists), pal.getSettings() for secure config, dataset naming conventions (camelCase plural, PK = singular + "Id"), and pointers to deeper references for the full API surface. Trigger when writing any dataset query, building a payload, joining data in memory, calling an external API from a workflow, or reading pal-level constants and cache values.
---

# CloudPiston Pal — Data Layer

The data layer owns everything that reads from or writes to persistent storage, shapes data
for the response, or fetches external data over HTTP. In the three-layer architecture,
service-layer code calls into this layer via library workflows (usually organized under
`workflows/libs/data/` or similar).

CLAUDE.md holds the always-on rules. `palbuilder-core/references/es3-cheatsheet.md` has the
workflow-JS workarounds you'll need (no object literals, no `.forEach`, etc.). This skill
teaches the data-specific patterns.

---

## Read [reference].md when

- **`references/datasets.md`** — DataSet CRUD, deep filter API (grouping/paging/sorting),
  record-by-id access, typed accessors, updates, deletes (`deleteRecord`, `deleteRecords`,
  `bulkDelete`), and the explicit-cascade rule (the platform does not auto-cascade — you
  must write it).
- **`references/dataviews.md`** — DataView read-model, joins, when to use a view vs a dataset.
- **`references/payloads.md`** — Payload as a container for a root `Data` + named DataMaps +
  DataLists; DataList shaping/joining; `pal.getData(name)` and `pal.getDataList(name)` for
  pal-level constants.
- **`references/cache.md`** — CacheManager (`cm`), the three cache scopes (pal / enterprise /
  cloud), and put/get/deleteItem across strings, `Data`, `DataList`, and `Payload`.
- **`references/files.md`** — Attachments, images, and pal-level file storage.
- **`references/http-client.md`** — ServiceRequest, JSONParser, JSONBuffer, Buffer for
  server-side HTTP and JSON; `pal.getSettings()` for API keys and secrets.

If you're not sure which reference applies, start with `datasets.md` — that's where most
data work lives.

---

## Dataset naming conventions

Applies to every new dataset field and column:

- **Dataset names:** `camelCase`, **plural** — `users`, `inquiries`, `emailTemplates`
- **Primary key:** singular dataset name + `"Id"` — `users` → `userId`,
  `inquiries` → `inquiryId`
- **Column names:** `camelCase` — `firstName`, `createDate`, `assessmentId`
- **Boolean values in String columns** are stored as the strings `"true"` / `"false"` (not
  actual booleans). Compare with `addEqual("col", "true")` — see `datasets.md` for the full
  filter API.

---

## The standard read pattern

Nearly every read follows this shape. Learn it; the rest is variation.

```js
// Get the dataset, build a filter, pick columns, add conditions, sort, fetch.
var listsDS = pal.getDataSet("lists");
var filter  = listsDS.createFilter();
filter.selectColumns(["listId", "name", "favorited", "userId"]);
filter.addEqual("userId", userId);
filter.sortDescending("favorited");
var myLists = listsDS.getRecords(filter);         // DataList named "lists"
```

`getRecords(filter)` returns a **DataList named after the dataset** (`"lists"` here). To give
it a different name, pass a second argument:

```js
var favorites = listsDS.getRecords(filter, "favorites");
```

You usually add the DataList straight to the response payload — no other step is required.
Only convert to a `PacketDataList` (via `.copy(name)`) when you need to modify columns
(add/remove/rename) in memory. See `payloads.md` for the mutability distinction.

### Three shortcuts for single-record reads

```js
// Shorthand — findRecord(column, value) for a single equality, no filter object needed
var contact = pal.getDataSet("contacts").findRecord("email", email);

// Fetch by primary-key id, no filter
var user = pal.getDataSet("users").getRecord(userId);

// findRecord with a built filter object (multi-condition)
var listItemsDV = pal.getDataView("listItems");
var itemFilter  = listItemsDV.createFilter();
itemFilter.selectColumns(["itemId", "name"]);
itemFilter.addEqual("itemId", id);
var record = listItemsDV.findRecord(itemFilter);
```

**Always name the dataset/dataview and filter on their own lines**, and give the filter
variable a name containing `filter` — `filter`, `itemFilter`, `userFilter`. Chaining
`createFilter` inline on `pal.getDataView(...)` reads badly and obscures what's a filter and
what's a source.

**Always `selectColumns([...])`.** Reading only the columns you need is faster and makes the
query intent obvious to future readers. `getRecords(filter)` without `selectColumns` pulls
every column of every matching row.

---

## The standard write pattern

```js
// Find-or-create — the idempotent write pattern. Prefer this over blind insert.
var ds  = pal.getDataSet("contacts");
var rec = ds.findRecord("email", email);
if (rec == null) {
    rec = ds.createRecord();                     // empty record OFF the DataSet — no { }
    rec.set("email", email);                     // .set(col, value) per field
    rec.set("firstName", firstName);
    rec.set("status", "Active");
    rec.setDate("createDate", new Date());       // .setDate() for date columns
    ds.insertRecord(rec);                        // insert; returns new id
} else {
    rec.set("status", "Active");
    ds.updateRecord(rec);                        // updateRecord to persist edits
}
```

**Never build a record from an object literal.** Workflow JS bans them (CLAUDE.md rule 6).
Always `createRecord()` → `set` per field → `insertRecord` / `updateRecord`. For deep API
including deletes, see `datasets.md`.

**The platform does not cascade deletes.** If deleting a `users` row should also delete its
`stuff` rows, write that cleanup explicitly in the workflow. See `datasets.md`.

---

## Payloads — the response transport

A **Payload** is a container for a **root `Data` object** plus **named DataMaps** and
**DataLists**. The `payload` reserved global refers to the payload attached to the response
by `run()`'s common tail — that pattern is extremely common — but payloads can also be used
anywhere else to encapsulate data.

```js
payload = c.createPayload();

// Root Data — payload.set(key, val) writes to the root Data object
payload.set("userName", "Alice");
payload.setInt("count", 42);

// Named Data (DataMap) — attach a whole Data object under a name
var settings = c.createData();
settings.set("theme", "dark");
payload.addDataMap("settings", settings);       // template addresses as ${settings.theme}

// DataLists — attach a whole list; template addresses by the list's own name
payload.addDataList(myLists);                    // template: ${lists.*}
```

Reading back:

```js
var rootData = payload.getData();                // no arg = root Data
var themeMap = payload.getData("settings");      // named DataMap — root values not returned
```

For the full Payload API including `payload.addPayload(p)` (which merges root values, adds
DataMaps, and adds DataLists), see `references/payloads.md`.

---

## DataLists — shape in memory before returning

Basic DataLists are immutable in structure — you can insert rows, but not add/remove/rename
columns. For structural changes you need a **PacketDataList**, obtained via `.copy(name)`:

```js
var packetLists = myLists.copy("lists");        // now mutable in structure
packetLists.addColumn("shareType");
packetLists.setColumnValue("shareType", "owner");
packetLists.renameColumn("ownerId", "userId");
packetLists.addDataList("lists", shared);        // merge another list
```

If you only need to read/iterate/return, `getRecords(filter)` already gives you what you need
— no copy required.

Full method list and PacketDataList details are in `references/payloads.md`.

---

## Pal-level data — constants and static tables

Some data belongs to the pal, not to any user's records:

```js
// Named Data bundle (key/value) — pal.json's "data" section
var config = pal.getData("someData");            // returns Data
var url    = config.get("someURL");

// Pal-level DataList — pal.json's "datalists" section
var icons = pal.getDataList("icons");            // returns DataList
```

Use these for static tables or configuration that only changes at the pal level. GiftHub, for
example, uses a pal-level DataList of selectable icons (name, CSS class, description) for
gift lists — every user sees the same list.

See `references/payloads.md` for details, and `palbuilder-core/references/pal-json.md` for
how these are registered.

---

## Secure config — `pal.getSettings()`

API keys, tokens, and other secrets belong in **pal settings**, which live outside the pal's
code and datasets and support encryption. Read them at runtime:

```js
var settings = pal.getSettings();                // returns Data
var apiKey   = settings.get("googlePsiKey");
```

There is no runtime write API — settings are managed in Pal Manager (**pal → Settings** in
the tree menu).

**This is a newer addition.** Older pals often store secrets in a cache, a dataset, or a pal
`Data` bundle — the pal-`Data` case is **not secure**. When working on such a pal,
recommend migrating those values to pal settings and expect them there going forward.

See `references/http-client.md` for the anti-pattern of hardcoding keys in workflow source
(source is readable and pull-tracked).

---

## External data — never `fetch`, always ServiceRequest

CLAUDE.md rule 4 bans `fetch`/ClientPal for server calls. To hit an external API from a
workflow, use `c.createServiceRequest()` — server-side, no browser exposure of URLs or keys.

```js
var sr = c.createServiceRequest();
sr.setMethod("GET");
sr.setRequestHeader("User-Agent", "MyPal/1.0");
sr.setTimeout(4, 6);                              // (connectSecs, readSecs)
var resp   = sr.submit(url, false, true);
var status = resp.getResponseCode();              // int
var body   = resp.readBody();                     // String — null-guard it
```

For POST, JSON parsing (`c.createJsonParser`), JSON building (`c.createJsonBuffer`),
efficient string building (`c.createBuffer`), and pal-settings integration, see
`references/http-client.md`.

---

## Debug helpers

Available during development; **remove before finishing** (CLAUDE.md anti-patterns):

- `c.debug(obj)` — accepts a `String`, `Data`, `DataList`, or `Payload`. **Prefer this** over
  the more explicit variants below.
- `c.debugData(data)` — dumps a `Data` object (single-argument, no label).
- `c.debugList(dataList)` — dumps a `DataList` (single-argument, no label).

Use these to inspect what a filter actually returned instead of guessing.

---

## Reference documentation

Deep API for every type this skill covers:

- DataSet — https://secure.cloudpiston.com/cpal/cp-api/web/DataSet.html
- DataView — https://secure.cloudpiston.com/cpal/cp-api/web/DataView.html
- DataViewFilter — https://secure.cloudpiston.com/cpal/cp-api/web/DataViewFilter.html
- AnalyticDataViewFilter — https://secure.cloudpiston.com/cpal/cp-api/web/AnalyticDataViewFilter.html
- DataList — https://secure.cloudpiston.com/cpal/cp-api/web/DataList.html
- PacketDataList — https://secure.cloudpiston.com/cpal/cp-api/web/PacketDataList.html
- DataListFilter — https://secure.cloudpiston.com/cpal/cp-api/web/DataListFilter.html
- DataSetRecord — https://secure.cloudpiston.com/cpal/cp-api/web/DataSetRecord.html
- DataViewRecord — https://secure.cloudpiston.com/cpal/cp-api/web/DataViewRecord.html
- Payload — https://secure.cloudpiston.com/cpal/cp-api/web/Payload.html
- Data — https://secure.cloudpiston.com/cpal/cp-api/web/Data.html
- ServiceRequest — https://secure.cloudpiston.com/cpal/cp-api/web/ServiceRequest.html
- JSONParser — https://secure.cloudpiston.com/cpal/cp-api/web/JSONParser.html
- JSONBuffer — https://secure.cloudpiston.com/cpal/cp-api/web/JSONBuffer.html
- Buffer — https://secure.cloudpiston.com/cpal/cp-api/web/Buffer.html
- CacheManager — https://secure.cloudpiston.com/cpal/cp-api/web/CacheManager.html
