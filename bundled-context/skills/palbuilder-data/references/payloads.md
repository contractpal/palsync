# Payloads, Data, and DataLists

A **Payload** is a container that holds three things:

1. A **root `Data` object** — accessed via `payload.set(key, val)` and `payload.getData()` (no arg).
2. **Named `Data` objects** (also called DataMaps or DataRecords) — attached via
   `payload.addDataMap(name, data)`, read back via `payload.getData(name)`.
3. **`DataList` objects** — attached via `payload.addDataList(list)`, read back via
   `payload.getDataList(name)`.

Payloads are the standard vehicle for shipping data from a workflow to its template. The
reserved global `payload` refers to the payload attached to the response by `run()`'s common
tail — an extremely common pattern — but payloads can be constructed and used for any
purpose, including caching (`cm.putPayload`), passing data between service-layer functions,
or as build-up containers within a single workflow.

**Official APIs:**
- Payload — https://secure.cloudpiston.com/cpal/cp-api/web/Payload.html
- Data — https://secure.cloudpiston.com/cpal/cp-api/web/Data.html
- DataList — https://secure.cloudpiston.com/cpal/cp-api/web/DataList.html
- PacketDataList — https://secure.cloudpiston.com/cpal/cp-api/web/PacketDataList.html

Companion references:
- `datasets.md` — how reads produce DataLists via `getRecords`
- `cache.md` — storing Data/DataList/Payload in the cache

---

## Payload — the container

### The three attachment types

```js
payload = c.createPayload();

// 1. Root Data — set/get scalars directly on the payload
payload.set("userName", "Alice");
payload.setInt("count", 42);
payload.setBoolean("isAdmin", true);

// 2. Named DataMap — attach a whole Data object under a name
var themeData = c.createData();
themeData.set("mode", "dark");
themeData.set("accent", "blue");
payload.addDataMap("theme", themeData);

// 3. DataList — attach; the list carries its own name
var userLists = pal.getDataSet("lists").getRecords(filter);
payload.addDataList(userLists);
```

### Reading back

```js
var rootData = payload.getData();              // no arg -> root Data object
var userName = rootData.get("userName");

var themeMap = payload.getData("theme");        // named DataMap — NOT root
var mode     = themeMap.get("mode");

var lists    = payload.getDataList("lists");    // by name
```

**`payload.getData()` with a name returns the named DataMap, not root values.** A common
mistake: expecting `payload.getData("userName")` to return the root scalar. It doesn't —
it returns a DataMap named `"userName"` if one exists, or `null` otherwise.

### Merging payloads — `addPayload`

`payload.addPayload(other)` performs a full merge:

- Root values from `other` are merged into this payload's root Data.
- DataMaps in `other` are added to this payload.
- DataLists in `other` are added to this payload.

When keys collide (same root key, same DataMap name, or same DataList name), the incoming
value replaces the existing one.

Useful pattern — a service-layer function returns a payload of its results, and the
presentation layer merges it into the response payload:

```js
function prepareDashboard(userId) {
    var out = c.createPayload();
    out.set("dashboardTitle", "Home");
    out.addDataList(fetchLists(userId));
    return out;
}

// In the presentation workflow
payload.addPayload(prepareDashboard(userId));
```

### Attaching to the response

```js
if (request.isAjax()) {
    ajax.addPayload(payload);
    return ajax;
}
page.addPayload(payload);
return page;
```

---

## Data — key-value maps

`c.createData()` returns a `Data` container:

```js
var settings = c.createData();
settings.set("theme", "dark");
settings.setInt("timeout", 30);
settings.setBoolean("enabled", true);

var theme    = settings.get("theme");
var timeout  = settings.getInt("timeout");
var enabled  = settings.getBoolean("enabled");
```

`Data` is the workflow-native replacement for `{}` object literals (banned — see
`palbuilder-core/references/es3-cheatsheet.md`).

Use `Data` for:
- Small in-workflow caches / lookups
- Anywhere you'd reach for `{ key: value }` and can't
- Attaching as a DataMap on a payload

For tabular data (multiple records with the same columns), use a **DataList** instead.

---

## DataList vs PacketDataList — the mutability distinction

A **DataList** is what `getRecords(filter)` returns — a set of rows with fixed columns. You
can:

- Iterate (`getRecordCount`, `getRecord(i)`)
- Read column values on any row (`row.get("col")`)
- Insert new rows (`list.insertRecord().set(...)`)
- Add the whole list to a payload (`payload.addDataList(list)`)

You **cannot** add/remove/rename columns on a DataList directly. For structural changes,
convert to a `PacketDataList` via `.copy(name)`:

```js
var basic = pal.getDataSet("lists").getRecords(filter);
// basic.addColumn("shareType");   // ← not available on DataList

var packet = basic.copy("lists");
packet.addColumn("shareType");
packet.setColumnValue("shareType", "owner");
packet.renameColumn("ownerId", "userId");
packet.removeColumn("obsoleteCol");
packet.addDataList("lists", shared);    // merge/append another list
```

**Only `.copy()` when you actually need to reshape.** If you're just going to return the
list as-is, skip the copy — one less allocation, one less line of code.

---

## Constructing DataLists from scratch

For tabular data you're building in code (not from a dataset read):

```js
var emails = c.createDataList("emailIds", ["emailId"]);
emails.insertRecord().set("emailId", id1);
emails.insertRecord().set("emailId", id2);
```

`c.createDataList(name, columns)` returns a DataList ready to receive rows. `insertRecord()`
adds an empty row; chain `.set(col, val)` to populate.

---

## DataList iteration

```js
for (var i = 0; i < list.getRecordCount(); i++) {
    var row  = list.getRecord(i);          // zero-indexed
    var id   = row.get("listId");
    var name = row.get("name");
}
```

`.forEach` and other array methods are unavailable — always use a classic indexed `for`
(CLAUDE.md rule 6).

---

## Pal-level data — constants and static tables

Two pal-level types serve as configuration surfaces:

### `pal.getData("name")` — Data bundles

Named `Data` objects registered in `pal.json`'s `data` section (e.g., `someData` with
key/value pairs).

```js
var siteConfig = pal.getData("siteConfig");
var supportUrl = siteConfig.get("supportUrl");
```

Use for:
- Feature flags
- Public config values (URLs, labels, feature toggles)
- **Not** secrets — `pal.getData` is not secure. For API keys, use `pal.getSettings()`
  (see `http-client.md`).

### `pal.getDataList("name")` — pal-level tabular data

Named `DataList` objects registered in `pal.json`'s `datalists` section.

```js
var icons = pal.getDataList("icons");           // returns DataList
for (var i = 0; i < icons.getRecordCount(); i++) {
    var iconClass = icons.getRecord(i).get("value");
    // ...
}
```

**Real example:** GiftHub uses a pal-level DataList of selectable icons for gift lists —
each row has an icon id, a CSS class name, and a description. Every user sees the same list;
adding a new icon means editing the datalist in the manifest, not the workflow code.

Use for:
- Static tabular data that changes only at the pal level (dropdown options, icon libraries,
  reference tables)
- Anything you'd otherwise hardcode into a workflow as a repeated pattern

For manifest structure of these two types, see
`palbuilder-core/references/pal-json.md`.

---

## Common gotchas

- **`payload.getData("name")` returns the named DataMap, NOT the root scalar under that
  key.** For root values, use `payload.getData().get("name")` or read after `payload.set` in
  the same workflow.
- **A DataList without a name won't render.** `getRecords(filter)` names the list after the
  dataset; `getRecords(filter, "custom")` gives it a custom name. Templates address it by
  that name. Mismatches produce empty renders — check the name.
- **Structural mutation requires PacketDataList.** `addColumn` / `renameColumn` /
  `addDataList` on a plain DataList throws. `.copy(name)` first.
- **`addPayload` collisions overwrite.** If both payloads set the same root key, or have
  DataMaps / DataLists with the same name, the incoming payload's value wins. Deliberate for
  layered composition; surprising if two service functions happen to share a name.
- **`pal.getData` is not secure.** Never store API keys or tokens there. Use
  `pal.getSettings()` instead — see `http-client.md`.
