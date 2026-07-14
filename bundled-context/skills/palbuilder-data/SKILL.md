---
name: palbuilder-data
description: Use for CloudPiston datasets, DataViews/DataLists, payloads, schema/index work, storage, cache/session/cookies/files, or server-side HTTP. Load before querying, mutating, joining, or choosing where pal data belongs.
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

- **`references/datasets.md`** — DataSet CRUD, column types (varchar/text/decimal/encrypted/
  file/profile id/transaction id, signed/unsigned ints), indexes (compound, join-driven),
  deep filter API (grouping/paging/sorting), record-by-id access, typed accessors, updates,
  deletes (`deleteRecord`, `deleteRecords`, `bulkDelete`), and the explicit-cascade rule (the
  platform does not auto-cascade — you must write it).
- **`references/dataviews.md`** — DataView read-model, joins, when to use a view vs a dataset,
  and the runtime `DataViewBuilder` (`pal.createDataViewBuilder()`).
- **`references/analytics.md`** — `createAnalyticFilter()` on datasets and views: aggregates
  (sum/avg/count/min/max), group-by, having, distinct count, date-part extraction, and
  date/time diffs. Reach here when the database should compute the answer, not return rows.
- **`references/payloads.md`** — Payload as a container for a root `Data` + named DataMaps +
  DataLists; DataList shaping/joining; `pal.getData(name)` and `pal.getDataList(name)` for
  pal-level constants.
- **`references/cache.md`** — CacheManager (`cm`), the three cache scopes (pal / enterprise /
  cloud), put/get/deleteItem across strings, `Data`, `DataList`, and `Payload`, and
  **chunks** — pre-rendered, cached HTML fragments (`cache.createChunk`) for content like
  blog posts or reports that's rendered once and served to many requests.
- **`references/session.md`** — Request-based session values, session data, cookies, and
  when to pair session with cache for large or long-lived per-user state.
- **`references/files.md`** — The File/Upload API (readFile, toData, toImage, toPdf, etc.),
  attaching a file to a payload via `toData()` + `addDataMap`, rendering by extension,
  `<c:upload>` for accepting files, file/CDN storage (file column types, storage providers),
  pal-bundled attachments/images (`pal.getAttachment()`, `pal.getImage()`), and storing small
  images as base64 directly in a text column.
- **`references/http-client.md`** — ServiceRequest, JSONParser, JSONBuffer, Buffer for
  server-side HTTP and JSON; `pal.getSettings()` for API keys and secrets.

If you're not sure which reference applies, start with `datasets.md` — that's where most
data work lives.

---

## The storage decision — which surface for what data

Before reaching for a specific API, decide **where the data belongs**. CloudPiston gives you
five storage surfaces and they overlap in what they *can* do — the decision is about what
each *should* be used for.

| Kind of data | Best storage |
|---|---|
| Auth token / session id | Cookie |
| "Remember me" flag | Cookie |
| User's current filter, sort, page — same session | Session value |
| Wizard step index / draft state — same session | Session data |
| Small in-progress cart — same session | Session data |
| Large draft, big filter result set, anything that should survive session expiry | Cache, keyed by user id |
| Frequently-read reference data (shared across users) | Cache |
| Permanent schema-less blob, no query/filter needed | Cache (omit the TTL) |
| Long-lived, queryable, per-user or shared records | Dataset |
| Secrets / API keys / connection strings | `pal.getSettings()` (see `http-client.md`) |
| Cross-pal / cross-enterprise config | Enterprise settings (see `palbuilder-workflow/references/console.md`) |

### Rule-of-thumb axes

**Scope**
- Same user, same session, gone when the session ends → session value/data
- Same user, needs to survive session expiry or be reachable with no session (a job, a
  tunnel receiver) → cache, keyed by user/profile id
- Same pal, shared across all users → cache (pal-wide by default — no keying needed for
  truly shared data)
- Same enterprise, across every pal → enterprise settings

**Size**
- Tiny (a token, an id, a flag) → cookie or session value
- Small (a few fields) → session data
- Large (a DataList, an export bundle, a big blob) → cache
- Structured and something you'll filter/sort/query → dataset, not cache

**Persistence**
- Until the session ends → session value/data
- A fixed duration → cookie (`age` in seconds) or cache (TTL in minutes)
- Permanent, no query needed → cache with the TTL argument omitted (backed by a
  platform-managed database — this is real durable storage, not a session shim)
- Permanent AND queryable/filterable → dataset

**Sensitivity**
- Never expose to the browser → cache, session, dataset, settings
- Small and safe for the browser to hold → cookie
- Anything treated as a secret (API key, connection string) → `pal.getSettings()`, **never**
  a cookie or session value

Full session/cookie API and cache-pairing patterns: `references/session.md`. Full cache API
and scopes: `references/cache.md`.

**Serving the same rendered HTML to many requests?** That's not a data-storage decision —
it's a rendering one. If a fragment's *output* (not just its underlying data) is expensive or
frequent enough to cache, look at **chunks** in `references/cache.md` rather than just
caching the data and re-rendering every time.

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
    rec.setDate("createDate", c.getDateUtil().createDate()); // inline when used only here
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

Debug helpers (`c.debug`, `c.debugData`, `c.debugList`) apply to all workflow code, not just
data-layer work. Full detail lives in `palbuilder-workflow/SKILL.md`; the short version:

- `c.debug(obj)` — accepts `String`, `Data`, `DataList`, or `Payload`. **Preferred.**
- `c.debugData(data)` — `Data`-only, single-argument.
- `c.debugList(dataList)` — `DataList`-only, single-argument.

**Remove before finishing** (CLAUDE.md anti-patterns).

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
- Chunk — https://secure.cloudpiston.com/cpal/cp-api/web/Chunk.html
