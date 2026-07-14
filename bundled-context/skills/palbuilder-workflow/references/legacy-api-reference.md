# PalBuilder back-end API reference

Exhaustive method-level reference for the DataSet / DataView / DataList APIs and the
`ConsoleController` / Payload / Request objects. Open this when you need a specific method signature or
a worked query/write example. The core workflow rules (run() pattern, reserved globals, three-layer
architecture, ES3 syntax limits) live in the skill's SKILL.md.

Console API docs: https://secure.cloudpiston.com/cpal/cp-api/console/index.html
Web API docs: https://secure.cloudpiston.com/cpal/cp-api/web/index.html

---

## DataSets, DataViews & DataLists

Read from a **DataSet** (`pal.getDataSet`) or a **DataView** (`pal.getDataView` — the read-model for
joins/shared rows; real code uses both, datasets far more often). Build a query with a filter, then
shape the resulting **DataList** in memory.

### Reading + filtering

```js
// data/lists.js (real: GiftHub)
var listsDS = pal.getDataSet("lists");
var filter  = listsDS.createFilter();
filter.selectColumns(["listId", "name", "favorited", "userId"]);
filter.addEqual("userId", userId);
filter.sortDescending("favorited");
var myLists = listsDS.getRecords(filter).copy("lists");   // .copy(name) -> a working DataList

// findRecord for a single row
var item = pal.getDataView("listItems").createFilter();
item.selectColumns(["itemId", "name"]);
item.addEqual("itemId", id);
var record = pal.getDataView("listItems").findRecord(item);

// shorthand: findRecord(column, value) — single equality, no filter object needed
var contact = pal.getDataSet("contacts").findRecord("email", email);   // real: EmailDB contacts.js
```

**Boolean grouping** — `(friendId = X AND shareType = editor) OR (friendId = X AND favorited = true)`:

```js
var dv = pal.getDataView("sharedListView");
var g  = dv.createFilter();
g.beginGroup(); g.addEqual("friendId", userId); g.addAnd(); g.addEqual("shareType", "editor"); g.endGroup();
g.addOr();
g.beginGroup(); g.addEqual("friendId", userId); g.addAnd(); g.addEqual("favorited", "true"); g.endGroup();
var shared = dv.getRecords(g).copy("sharedLists");
```

### Shaping & joining DataLists in memory

```js
shared.renameColumn("ownerId", "userId");
myLists.addColumn("shareType");
myLists.setColumnValue("shareType", "owner");
myLists.addDataList("lists", shared);          // append/merge another DataList into this one
```

Common DataList methods: `copy(name)`, `addColumn`, `setColumnValue`, `renameColumn`, `removeColumn`,
`addDataList`. Common filter methods beyond basics: `beginGroup`/`endGroup`/`addAnd`/`addOr`,
`sortDescending`/`sortAscending`, `enablePaging`, `selectColumns`, `addEqual`.

### Writing

```js
var notes  = packet.getDataList("notes");
if (notes == null) { notes = c.createDataList("notes", ["createDate", "createdBy", "note"]); }
var insert = notes.insertRecord();
insert.setDate("createDate", new Date());
insert.set("createdBy", c.getUser().getPersonalProfile().getFullName());
insert.set("note", request.get("note"));
packet.setDataList(notes);
packet.commit();
```

For dataset writes: `insertRecord()` → `set` / `setDate` → `commit`.

---

## ConsoleController — Key Methods (`c.*`)

```js
c.getAction()                          // Current action string
c.getPage("pageName")                  // Returns a Page object
c.getRequest()                         // Returns the Request object
c.getPal()                             // Returns the RuntimePal
c.getUser()                            // Logged-in User (c.getUser().getPersonalProfile().getFullName())
c.getTransaction(txnId)                // Load a transaction packet by id
c.createPayload()                      // Creates a new Payload
c.createDataList(name, [columns])      // Create an in-memory DataList
c.createAjaxResponse(str, renderJexl)  // AJAX response from a string
c.createAjaxResponse(frag, render)     // AJAX response from a fragment
c.getEnterprise()                      // Enterprise object
c.getDateUtil()                        // Date utility (store as: dateUtil)
c.getFormatter()                       // Formatter (store as: formatter)
c.getValidator()                       // Validator (store as: validator)
c.createServiceRequest()               // HTTP client for external APIs
c.createGUID(prefix)                   // Unique ID generator
c.debug(message)                       // Debug log (dev only — remove when done)
c.switchToWorkflow(workflow, action)   // Switch to a different workflow file
```

---

## Payload

Payload passes data to the page/fragment; values become `${variable}` in templates.

```js
payload.set("frag", "dashboard");
payload.setBoolean("isAdmin", true);
payload.setInt("count", 42);

ajax.addPayload(payload);   // AJAX
page.addPayload(payload);   // Full-page
```

### Binding a list to the template — `addDataList`, not `set`

`set/setBoolean/setInt` are **scalars only**. A queried DataList is attached with its own
name via `payload.addDataList(list)`; the template iterates it with
`<c:list name="<thatName>" id="row">`:

```js
payload.addDataList(fetchAllClients());                          // -> <c:list name="clients">
payload.addDataList(ds.getRecords(filter).copy("moneyPages"));   // copy(name) sets the binding name
```

### String-mode `<c:list>` (no DataList)

Build a delimited string and `set` it; the template parses it with `list=` + `row-delim` +
`col-delim` (the consuming side is in `palbuilder-frontend`):

```js
var sb = c.createBuffer();
sb.append(title + "|" + badge + "|" + cssClass);   // cols joined by "|"
sb.append("~");                                     // rows joined by "~"
payload.set("aiReadinessRows", sb.toString());      // <c:list list="${aiReadinessRows}" row-delim="~" col-delim="|">
```

---

## Request

```js
request.isAjax()                               // true if request came via ajax-target
request.get("fieldName")                       // a submitted value (direct accessor)
request.getData()                              // Data object of all submitted values (store as: data)
request.getData().getDefaultValue(f, def, req) // value with default + required flag
request.getUpload()                            // uploaded file (from c:upload)
```
