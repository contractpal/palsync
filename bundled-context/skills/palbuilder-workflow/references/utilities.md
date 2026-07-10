# Workflow Utilities — DateUtil, EncryptionUtil, Monitor

Three general-purpose utilities are available in **every workflow type**. Each is fetched
from the controller and used inline (only `dateUtil` has a conventional reserved global).

**Official APIs:**
- DateUtil — https://secure.cloudpiston.com/cpal/cp-api/web/DateUtil.html
- EncryptionUtil — https://secure.cloudpiston.com/cpal/cp-api/web/EncryptionUtil.html
- Monitor — https://secure.cloudpiston.com/cpal/cp-api/web/Monitor.html

Companion:
- `references/logging.md` — `Logger` (`c.getLogger()`), a fourth cross-workflow utility with
  its own reference given how much it differs from `c.debug`

---

## DateUtil — dates and times

`c.getDateUtil()` is the platform-provided date/time helper. Reserved as `dateUtil` in the
standard globals table.

**Prefer DateUtil over `new Date()`** throughout workflow code — its parsing and formatting
methods match the platform's storage conventions and handle edge cases (timezones, format
variants, null inputs) that vanilla JS Date does poorly.

### Creating dates

```js
dateUtil = c.getDateUtil();

var now  = dateUtil.createDate();          // preferred over new Date()
```

### Parsing strings

```js
var d1 = dateUtil.parseDate(dateStr);           // date only
var d2 = dateUtil.parseDateTime(dateTimeStr);   // date + time
var d3 = dateUtil.parseComplexDate(str);        // flexible formats
```

Each returns a Date object (or null if unparseable). Null-guard the result before use.

### Common workflow patterns

```js
// Set a date column on a record
rec.setDate("createDate", dateUtil.createDate());

// Filter records by date range
var filter = ds.createFilter();
filter.addGreaterThan("createDate", dateUtil.parseDate("2026-01-01"));

// Compare dates for logic
var expiry = dateUtil.parseDate(record.get("expiryDate"));
if (expiry != null && expiry.getTime() < dateUtil.createDate().getTime()) {
    // expired
}
```

Full method list — additional creation, formatting, arithmetic (add days, diff dates, etc.):
https://secure.cloudpiston.com/cpal/cp-api/web/DateUtil.html

---

## EncryptionUtil — signatures, hashing, encoding

`c.getEncryptionUtil()` handles cryptographic operations:

- RSA and ECDSA signature creation and verification
- Hashing (SHA family)
- Base64 and Base16 (hex) conversion
- Symmetric encryption / decryption

There is no conventional reserved global — fetch it as needed. If you're using it heavily in
one workflow, assign to a local (`var enc = c.getEncryptionUtil();`).

### Common operations

```js
var enc = c.getEncryptionUtil();

// Encrypt / decrypt strings (symmetric)
var cipher = enc.encrypt(plaintext);
var plain  = enc.decrypt(cipher);
```

`encrypt` and `decrypt` are the workhorses — most workflows only need these. For signatures,
hashing, and base64/base16 conversion, see the API reference.

### When to use vs. `pal.getSettings()`

For **storing** secrets (API keys, tokens), use `pal.getSettings()` — encryption at rest is
handled by the platform (see `palbuilder-data/references/http-client.md`).

Use `EncryptionUtil` when you need:
- To encrypt user-supplied data before writing to a dataset (per-user secrets)
- To generate or verify signatures for external integrations
- To hash a value (passwords, cache-key salts, integrity checks)

Full method list: https://secure.cloudpiston.com/cpal/cp-api/web/EncryptionUtil.html

---

## Monitor — timing and timeout

`c.getMonitor()` is the workflow's timing utility:

- Get / set the workflow's execution timeout (in seconds)
- Run a stopwatch that measures elapsed time (in milliseconds)
- Common tool for job time-budget loops (see `palbuilder-realtime` when built)

There is no conventional reserved global — fetch as needed, or assign to a local.

### Measuring how long something takes

```js
var monitor = c.getMonitor();

monitor.startTimer();
var results = fetchExpensiveData();
var elapsedMs = monitor.stopTimer();          // returns milliseconds since startTimer()
c.debug("fetchExpensiveData took " + elapsedMs + "ms");
```

One timer per monitor — `stopTimer()` returns the elapsed time since the last `startTimer()`
call, in milliseconds.

### Managing workflow timeout

```js
monitor.setTimeout(30);                       // set timeout to 30 seconds
monitor.setMaxTimeout();                      // claim the maximum window this workflow allows
var budget    = monitor.getTimeout();         // read the current timeout budget
var remaining = monitor.getRemainingTime();   // how much of the budget is left
```

`setTimeout(int)` takes seconds. `setMaxTimeout()` requests the maximum timeout allowed for
the current workflow context — the platform decides what "max" means per workflow type.
`getTimeout()` and `getRemainingTime()` are the read side; use them instead of assuming a
specific budget.

**Timeouts vary by pal.** Every workflow has a timeout, but the exact budget is set by the
pal's activation key. Some pals get a small window, some a large one. Read the budget with
`getTimeout()` / `getRemainingTime()` rather than hard-coding assumptions.

### Checking time remaining

```js
if (!monitor.isTimeRemaining(7)) {            // fewer than 7 seconds left?
    // bail out of a batch loop before starting another unit of work
    break;
}
```

`isTimeRemaining(seconds)` returns `true` if **at least** that many seconds remain in the
workflow's budget. Used in batch-and-reschedule patterns (background jobs) — see
`palbuilder-realtime/references/jobs.md`.

### Use in background jobs

Background jobs (`workflowType: 11`) use `Monitor` heavily to implement time-budget loops —
process work while there's time in the budget, then reschedule the job if the queue isn't
empty when the budget runs out. That pattern lives in `palbuilder-realtime` (when built);
this reference just documents the utility.

Full method list: https://secure.cloudpiston.com/cpal/cp-api/web/Monitor.html

---

## Common gotchas

- **`new Date()` works but isn't preferred.** DateUtil's `createDate()` handles platform
  conventions better and is more consistent across workflows. If existing code uses
  `new Date()` and it's working, don't chase down every instance — but for new code, prefer
  DateUtil.
- **`parseDate` / `parseDateTime` return null on unparseable input.** Always null-guard the
  return value before calling `.getTime()` or similar.
- **`EncryptionUtil.encrypt/decrypt` isn't a substitute for `pal.getSettings()`.** For
  storing secrets, use pal settings (encrypted at rest by the platform). Use EncryptionUtil
  for at-runtime cryptographic operations.
- **Monitor mixes seconds and milliseconds.** `setTimeout(int)` takes **seconds**;
  `stopTimer()` returns **milliseconds**. Watch the units when comparing timer output to
  timeout budgets.
