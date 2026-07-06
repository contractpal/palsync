# ES3-Style Workflow JS — Cheatsheet

Workflow `.js` runs through CloudPiston's restricted server-side compile engine, **not** a browser
and **not** Node. This reference catalogs each banned construct and its workflow-native
replacement.

> **No external validator exists.** Workflow JS is compile-checked only when CloudPiston loads it
> — an edit that saves fine can still fail at compile time. Treat anything not on the
> "confirmed safe" list below as unsupported, and stay strictly within the confirmed subset.

---

## Confirmed Safe (proven in production workflows)

- `var` (no `let`, no `const`)
- Classic `for (var i = 0; i < n; i++)` loops
- `if` / `else` / `switch`
- **Function declarations** — `function name(args) { … }`
- **Array literals of primitives** — `var COLS = ["a", "b"];`
- String concatenation — `"x " + y`
- Array indexing (`a[i]`) and `.length`
- Platform APIs: `pal.getDataSet`, `pal.getDataView`, `c.createData`, `c.createDataList`,
  `c.createPayload`, `c.createBuffer`, `createRecord`, `insertRecord`, `set` / `setDate`,
  `findRecord`, `getRecords`, filter methods, etc.

---

## ❌ Banned Constructs (with workarounds)

### Implicit globals (`c = controller` without `var c`)

Declare workflow variables before assigning them. The platform may save undeclared assignments,
but compile/test can report `Variable <name> not declared` and the misleading follow-on error
`Function run doesn't return value`.

```js
// ✗ WRONG
function run(controller) {
    c = controller;
    page = c.getPage("console");
    payload = c.createPayload();
    return page;
}

// ✓ RIGHT — globals at the top, assignments at the top of run()
var c;
var page;
var payload;

function run(controller) {
    c = controller;
    page = c.getPage("console");
    payload = c.createPayload();
    return page;
}
```

### Object literals `{ }`

Throws `Objects not supported` plus a cascading `Variable <propName> not declared` for every
property name. An array of objects produces dozens of errors at once.

```js
// ✗ WRONG
var CHECKLIST_SEED = [
    { itemId: "title-keyword-first", owner: "sam", sortOrder: 1 },
    { itemId: "desc-unique",         owner: "sam", sortOrder: 2 }
];
```

Object literals appear in code for two reasons — a **map / lookup** or a **set of rows.** Each
has its own workflow-native replacement.

#### Map / lookup → `c.createData()`

`c.createData()` produces a key/value store with `.get(key)` and `.set(key, value)` methods.

```js
// ✓ a map WITHOUT { } (real: EmailDB contacts.js, getSegmentId cache)
var segs = c.createData();
var segmentId = segs.get(name);
if (segmentId == null) {
    segmentId = lookUpSegmentId(name);
    segs.set(name, segmentId);
}
```

#### Rows / records → `DataSet.createRecord()` or `c.createDataList()`

For persistent records, build off the DataSet directly with **find-or-create for idempotency**:

```js
// ✓ Persistent rows without { } (real: EmailDB contacts.js, importFile)
var ds = pal.getDataSet("contacts");
var rec = ds.findRecord("email", email);    // find-or-create: don't duplicate on re-run
if (rec == null) {
    rec = ds.createRecord();                 // empty record off the DataSet — no { }
    rec.set("email", email);                 // .set(col, value) per field
    rec.set("firstName", firstName);
    rec.set("status", "Active");
    rec.setDate("createDate", new Date());   // .setDate() for date columns
    ds.insertRecord(rec);                    // insert; returns the new id
}
```

For an in-memory list to hand to a payload or job:

```js
// ✓ DataList — columns + insertRecord().set() per field (real: EmailDB contacts.js, sendSingle)
var list = c.createDataList("emailIds", ["emailId"]);
list.insertRecord().set("emailId", id);
```

For small fixed constant data, **parallel arrays of primitives** are fine:

```js
var ITEM_IDS = ["title-keyword-first", "desc-unique"];
var OWNERS   = ["sam", "sam"];
```

---

### `let` and `const`

Not available. Use `var`. Signal a constant with `UPPER_SNAKE_CASE`:

```js
// ✗ WRONG
const DAY_IN_MINUTES = 60 * 24;

// ✓ RIGHT
var DAY_IN_MINUTES = 60 * 24;
```

---

### Arrow functions `=>`

Not available. Use function declarations:

```js
// ✗ WRONG
var add = (a, b) => a + b;

// ✓ RIGHT
function add(a, b) {
    return a + b;
}
```

---

### Function expressions `var f = function(){…}`

Not confirmed safe. Use function declarations exclusively:

```js
// ✗ Avoid
var greet = function(name) { return "hi " + name; };

// ✓ RIGHT
function greet(name) {
    return "hi " + name;
}
```

---

### Template literals `` ` ${ } ` ``

Not available. Use string concatenation:

```js
// ✗ WRONG
var msg = `Hello ${name}, you have ${count} items.`;

// ✓ RIGHT
var msg = "Hello " + name + ", you have " + count + " items.";
```

For long multi-line strings, use `c.createBuffer()`:

```js
var sb = c.createBuffer();
sb.append("Hello ");
sb.append(name);
sb.append(", you have ");
sb.append(count);
sb.append(" items.");
var msg = sb.toString();
```

---

### Destructuring

Not available. Assign each variable individually:

```js
// ✗ WRONG
var { firstName, lastName } = userData;
var [first, second] = parts;

// ✓ RIGHT
var firstName = userData.get("firstName");
var lastName  = userData.get("lastName");
var first  = parts[0];
var second = parts[1];
```

---

### `for…of` and `for…in`

Not available. Use classic indexed `for`:

```js
// ✗ WRONG
for (var item of items) { … }

// ✓ RIGHT
for (var i = 0; i < items.length; i++) {
    var item = items[i];
    …
}
```

---

### Array higher-order methods (`.map`, `.filter`, `.forEach`, `.reduce`)

Not confirmed safe — assume they fail. Use a classic `for` loop and accumulate into a new array
or DataList:

```js
// ✗ Avoid
var ids = users.map(function(u) { return u.id; });

// ✓ RIGHT — for primitives, push into an array literal
var ids = [];
for (var i = 0; i < users.length; i++) {
    ids[ids.length] = users[i].id;     // or ids.push(users[i].id) if confirmed safe
}
```

For DataList rows, iterate by record count:

```js
for (var i = 0; i < userList.getRecordCount(); i++) {
    var row = userList.getRecord(i);
    var userId = row.get("userId");
    // …
}
```

---

### JSON parsing — `JSON.parse` into an object

`JSON.parse` itself may work, but the result is an object literal, which the engine can't accept.
For parsing JSON from external services, use `c.createJsonParser()` — its API exposes
`.get(key)` / `.getList(key)` accessors that match `c.createData()`. (Covered in `palbuilder-data`
under `references/http-client.md`.)

---

## Quick Reference Table

| Need | Don't | Do |
|---|---|---|
| Map / lookup | `var m = {};` | `var m = c.createData();` |
| Row / record | `{ col: val }` | `ds.createRecord(); rec.set("col", val);` |
| Set of rows | `[{...}, {...}]` | `c.createDataList(name, cols)` + `insertRecord().set()` |
| Constant | `const X = 1;` | `var X = 1;` (UPPER_SNAKE_CASE) |
| Function | `var f = () => …` | `function f() { … }` |
| String build | `` `a ${b}` `` | `"a " + b` or `c.createBuffer()` |
| Pick fields | `var {a, b} = obj;` | `var a = obj.get("a"); var b = obj.get("b");` |
| Iterate | `for (x of xs)` | `for (var i = 0; i < xs.length; i++)` |
| Map array | `xs.map(fn)` | `for` loop building a new array |
| Parse JSON | `JSON.parse(s)` (returns object) | `c.createJsonParser()` |

---

## When in doubt

If you find yourself wanting a JS feature not on the "confirmed safe" list, **assume it fails**
and use a workflow-native equivalent. Promoting something to "confirmed safe" requires an actual
test run against CloudPiston, not a hopeful guess.
