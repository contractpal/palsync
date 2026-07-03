# Server-Side HTTP Client — ServiceRequest, JSONParser, JSONBuffer, Buffer

Workflow JS has no `fetch` and cannot use `XMLHttpRequest`. For calling external services
from a workflow, use `c.createServiceRequest()`. For parsing JSON responses without object
literals, `c.createJsonParser()`. For building JSON output, `c.createJsonBuffer()`. For
building strings without `+=` bloat, `c.createBuffer()`.

CLAUDE.md golden rule 4 bans `fetch`/ClientPal for server calls — even client-side. The
server-side HTTP client keeps URLs, headers, and API keys out of the browser entirely.

**Official APIs:**
- ServiceRequest — https://secure.cloudpiston.com/cpal/cp-api/web/ServiceRequest.html
- JSONParser — https://secure.cloudpiston.com/cpal/cp-api/web/JSONParser.html
- JSONBuffer — https://secure.cloudpiston.com/cpal/cp-api/web/JSONBuffer.html
- Buffer — https://secure.cloudpiston.com/cpal/cp-api/web/Buffer.html

---

## ServiceRequest — HTTP client

### GET

```js
var sr = c.createServiceRequest();
sr.setMethod("GET");
sr.setRequestHeader("User-Agent", "MyPal/1.0 (+https://example.com/bot)");
sr.setTimeout(4, 6);                        // (connectSeconds, readSeconds)
var resp   = sr.submit(url, false, true);   // (url, followRedirects, ???)
var status = resp.getResponseCode();        // HTTP status int (200, 404, 410, ...)
var body   = resp.readBody();               // full body as String
if (body == null) { body = ""; }            // null-guard always
```

### POST with a JSON body

```js
var sr = c.createServiceRequest();
sr.setMethod("POST");
sr.setContentType("application/json");
sr.setRequestHeader("User-Agent", "MyPal/1.0");
sr.setRequestHeader("Authorization", "Bearer " + tokenFromSettings);
sr.setRequestBody(bodyString);              // setRequestBody only ships for POST/PUT
var resp = sr.submit(url, false, true);
```

### Method reference

| Call | Purpose |
|---|---|
| `sr.setMethod("GET" \| "POST" \| "PUT" \| "DELETE" \| ...)` | HTTP verb |
| `sr.setContentType("application/json")` | Content-Type header shorthand |
| `sr.setRequestHeader(name, value)` | Arbitrary request header |
| `sr.setRequestBody(str)` | Body for POST/PUT (ignored on GET) |
| `sr.setTimeout(connectSecs, readSecs)` | Both timeouts required |
| `sr.submit(url, followRedirects, ???)` | Send the request; returns response |
| `resp.getResponseCode()` | HTTP status code (int) |
| `resp.readBody()` | Response body (String) — null-guard |

### Timeout discipline

`setTimeout` is not optional in practice — an unbounded fetch can freeze the request. Pick
values that fit the surrounding context:

- **In a normal request-cycle workflow:** `sr.setTimeout(4, 6)` is reasonable; the total
  request budget is ~10s.
- **In a background job:** the job's Monitor loop has its own time budget. Keep the read
  timeout below that budget so one slow endpoint doesn't cost the whole run. See
  `palbuilder-realtime` for job time-budget patterns.

### API keys and secrets — use `pal.getSettings()`

API keys, tokens, and other secrets belong in **pal settings** — encrypted storage that
lives outside the pal's code and datasets.

```js
var settings = pal.getSettings();               // returns Data
var apiKey   = settings.get("googlePsiKey");
sr.setRequestHeader("Authorization", "Bearer " + settings.get("apiToken"));
```

There is no runtime write API for settings — they're managed in **Pal Manager → pal →
Settings** (in the tree menu). Point users there when they need to add new secret values.

**❌ Never** hardcode secrets in workflow source:

```js
// NEVER — the source is readable and pull-tracked
var CRAWL_PSI_KEY = "AIza...";
```

**Older pals may not use `pal.getSettings()`** — it's a newer addition. You'll find secrets
stored in:
- A cache (moderately safe, but ephemeral)
- A dataset (persistent but not encrypted at rest by default)
- A pal `Data` bundle via `pal.getData(...)` (**not secure** — visible to anyone with read
  access to the pal)

When you encounter these, recommend migrating the values to pal settings and update the
workflow to expect them there.

---

## JSONParser — read JSON without object literals

`JSON.parse` returns an object literal, which workflow JS can't handle. Use
`c.createJsonParser(str)` and walk the tree by **dot-path**:

```js
var p = c.createJsonParser(resp.readBody());

var lcp = p.readValue("record.metrics.largest_contentful_paint.percentiles.p75");
var cls = p.readValue("record.metrics.cumulative_layout_shift.percentiles.p75");
var origin = p.readValue("record.key.origin");
```

`readValue("a.b.c")`:
- Walks the JSON tree by dot-separated path
- Returns the leaf as a **String** (numeric fields come back stringified — coerce as needed)
- Returns `null` if any path segment is missing

For a numeric leaf that may be missing:

```js
function numOrNull(v) {
    if (v == null) { return null; }
    var n = parseInt(v, 10);
    return isNaN(n) ? null : n;
}
var count = numOrNull(p.readValue("results.count"));
```

### Iterating an array in JSON

`readValue` returns a scalar at the path. To iterate an array, walk it by index in the path:

```js
// e.g., root JSON is { items: [ {id: 1}, {id: 2} ] }
var first  = p.readValue("items.0.id");
var second = p.readValue("items.1.id");
```

For arrays of unknown length, read `items.length` first if available, or walk until
`readValue` returns null.

---

## JSONBuffer — build JSON output

`c.createJsonBuffer()` builds JSON strings imperatively — the workflow-native way to
construct JSON without object literals. Use it for API request bodies and JSON responses from
webservice workflows.

### The building blocks

```js
var jb = c.createJsonBuffer();
jb.startObject();                          // {
jb.set("orderno", "748745375");            //   "orderno": "748745375"
jb.setInt("qty", 3);                       //   "qty": 3
jb.setBoolean("instock", true);            //   "instock": true
jb.setDouble("cost", 37.72);               //   "cost": 37.72
jb.setDate("orderDate", new Date());       //   "orderDate": "<date str>"
jb.endObject();                            // }
var body = jb.toString();
```

Every builder call mutates the buffer. `toString()` returns the final JSON string.

### Objects, arrays, and nesting

```js
// An array of objects
var jb = c.createJsonBuffer();
jb.startArray();
jb.startObject();
jb.set("orderno", "748745375");
jb.setDate("date", new Date());
jb.setBoolean("instock", true);
jb.setInt("qty", 3);
jb.endObject();
jb.endArray();
// -> [{"orderno":"748745375","date":"...","instock":true,"qty":3}]
```

Nest by calling `startObject` / `startArray` inside an outer object or array — they push
onto an internal stack.

### Bulk primitive arrays

For a plain array of one type, skip the object dance:

```js
jb.startArray();
jb.setInts([0, 5, 6, 5, 10]);              // -> [0,5,6,5,10]
jb.endArray();

jb.startArray();
jb.setStrings(["apple", "cherry", "peach"]);   // -> ["apple","cherry","peach"]
jb.endArray();

jb.startArray();
jb.setBooleans([true, true, false]);       // -> [true,true,false]
jb.endArray();

jb.startArray();
jb.setDates([date1, date2]);               // -> ["Wed Jun 30 ...","Sat Jan 10 ..."]
jb.endArray();
```

### Setter reference

| Setter | Produces |
|---|---|
| `set(name, val)` | String value (same as `setString`) |
| `setString(name, val)` / `setStrings(array)` | String / array of strings |
| `setInt(name, val)` / `setInts(array)` | Integer / array of integers |
| `setDouble(name, val)` | Double |
| `setBoolean(name, val)` / `setBooleans(array)` | Boolean / array of booleans |
| `setDate(name, val)` / `setDates(array)` | Date (see gotcha below) |

Every `setXxx(name, val)` variant writes a **key/value pair inside an object** — call between
`startObject()` and `endObject()`. Every `setXxxs(array)` variant writes **array elements** —
call between `startArray()` and `endArray()`.

### `key(name).value(val)` — insert pre-formatted JSON

For nesting a value that's already JSON-formatted (e.g., a `Data` serialized via
`.toJson()`), use the chainable `key/value` pair:

```js
var data = c.createData();
data.set("name", "Bob");

var jb = c.createJsonBuffer();
jb.startObject();
jb.key("data").value(data.toJson());       // -> {"data":{"name":"Bob"}}
jb.endObject();
```

`value(str)` inserts the string **without re-quoting** — treat the input as raw JSON.

### Posting with ServiceRequest

```js
var jb = c.createJsonBuffer();
jb.startObject();
jb.set("email", email);
jb.setInt("age", age);
jb.endObject();

var sr = c.createServiceRequest();
sr.setMethod("POST");
sr.setContentType("application/json");
sr.setRequestBody(jb.toString());
sr.submit(url, false, true);
```

### Gotchas

- **`setDate` emits a Java-style date string**, not ISO 8601 — e.g.,
  `"Wed Jun 30 01:54:23 MDT 2088"`. If the receiving API expects ISO, format the string
  yourself and use `.set(name, isoString)` instead of `.setDate(name, date)`.
- **`value(str)` doesn't quote or escape.** Passing raw user input to `value()` will break
  the JSON. Only use `value()` with output from something that already produces valid JSON
  (`data.toJson()`, another `JSONBuffer.toString()`).
- **Every `startX` needs a matching `endX`.** Mismatched braces don't error at construction
  time — they produce invalid JSON at `toString()`. Structure your calls symmetrically.

---

## Buffer — StringBuilder

`c.createBuffer()` is the workflow's efficient string builder. Use it instead of `s = s + …`
in tight loops:

```js
var sb = c.createBuffer();
sb.append("Hello ");
sb.append(name);
sb.append(", you have ");
sb.append(count);
sb.append(" items.");
var msg = sb.toString();
```

`append` accepts any value (Strings, numbers, dates — the buffer stringifies). `toString()`
returns the concatenated result.

Use `Buffer` for:
- Building request bodies before `sr.setRequestBody`
- Building response strings in loops
- Any multi-line template literal you'd normally reach for (banned in workflow JS)

---

## Common gotchas

- **Missing null-guard on `readBody()`** — an empty or aborted response returns null.
  `body.toLowerCase()` on a null crashes. Always `if (body == null) { body = ""; }`.
- **`sr.submit` third argument is undocumented** in surface code but commonly `true` — the
  reference pattern uses `sr.submit(url, false, true)`. If you see this in production code,
  match it; don't guess.
- **`setTimeout` values that exceed the workflow budget** — a 30-second read timeout in a
  10-second request cycle produces silent failures. Keep timeouts inside the surrounding
  budget.
- **`JSONParser.readValue` returns String, not typed values.** Numbers come back as strings.
  Convert explicitly with `parseInt` / `parseFloat`.
- **Hardcoded API keys** — see the anti-pattern above. Never ship a key in workflow source;
  read it from `pal.getSettings()` at runtime.
