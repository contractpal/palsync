# Errors, Validation, and Fallbacks

Workflow code protects itself from bad input, missing data, and unexpected states. This
reference covers the patterns for defensive handlers, validation, and the unknown-action
fallback.

Companion:
- `responses.md` — the ignore ajax fallback lives at the response layer

---

## Guard early, throw specifically

Handler functions should validate inputs and bail before touching the data layer:

```js
function saveList() {
    var listId = request.get("listId");
    var name   = request.get("name");

    if (listId == null || listId == "") {
        payload.set("error", "Missing listId");
        return;
    }
    if (name == null || name == "") {
        payload.set("error", "Missing name");
        return;
    }

    // … proceed
}
```

**Null-guard before every dataset read.** `pal.getDataSet("x").findRecord("col", value)`
throws if `value` is null. Cheap to check; expensive to debug.

---

## try/catch and error payloads

For handlers that call into external services or complex logic, wrap in try/catch and
surface an error via the payload:

```js
function fetchWeather() {
    try {
        var apiKey = pal.getSettings().get("weatherApiKey");
        var forecast = callWeatherApi(apiKey, zip);
        payload.addDataMap("forecast", forecast);
    } catch (e) {
        payload.set("error", e.message || "Weather lookup failed");
        c.debug(e);                          // log for the developer
    }
}
```

- **Log the raw error** with `c.debug(e)` — the browser gets a clean message, the developer
  gets the full trace.
- **Don't expose internal error text to users** — surface a user-safe message via
  `payload.set("error", ...)` and log the actual exception.
- **Remove `c.debug` before finishing.** CLAUDE.md's checklist enforces this.

---

## Validation via the `validator` global

`c.getValidator()` provides input validators. **Available in every workflow type**, not just
console. Common uses:

```js
validator = c.getValidator();

if (!validator.isEmail(email)) {
    payload.set("emailError", "Not a valid email address");
    return;
}
if (!validator.isNumber(qty) || parseInt(qty, 10) < 1) {
    payload.set("qtyError", "Quantity must be a positive number");
    return;
}
```

Full method list: https://secure.cloudpiston.com/cpal/cp-api/console/Validator.html
(The URL is under `/console/` but the class is available in all workflow contexts.)

---

## Formatter for consistent output

`c.getFormatter()` handles trimming, truncation, date formatting, number formatting.
**Available in every workflow type**, not just console. Prefer it over hand-rolled string
manipulation:

```js
formatter = c.getFormatter();

var clean     = formatter.trim(userInput);
var truncated = formatter.chop(longStr, 500, true);   // (str, maxLen, addEllipsis)
```

Full method list: https://secure.cloudpiston.com/cpal/cp-api/console/Formatter.html
(URL is under `/console/`, class is available in all workflow contexts.)

---

## The unknown-action fallback

The action switch's `default:` branch does nothing — just `break;`. The common tail then
creates an ignore ajax response (or the default page).

```js
switch (action) {
    case "loadData":
        loadData();
        break;
    // ...
    default:
        break;      // NOT: throw an error, NOT: return an error message
}
```

**Rationale:** the browser sometimes fires actions in unexpected orders (double-clicks,
stale pages, prefetch). Responding to unknown actions with errors surfaces false failures.
Silent ignore is the correct default; genuine "you can't do that" cases are handled inside
their specific handler, not at the routing layer.

---

## Common gotchas

- **Never leave `c.debug(e)` in shipped code.** Any error branch that logs should have the
  log call stripped before finishing. CLAUDE.md's checklist catches this.
- **`throw new Error("...")` in a handler propagates out of `run()`** and produces a
  platform error page. Prefer setting `payload.set("error", "...")` and letting the response
  render normally.
- **`validator.isNumber` returns boolean, not the parsed number.** Chain with `parseInt` or
  `parseFloat` if you need the value.
- **`e.message` may be `undefined`** in some engine-thrown errors. Use `e.message || String(e)`
  to always produce a string.
