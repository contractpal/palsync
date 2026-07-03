# Cache — CacheManager

CloudPiston exposes three cache scopes in a nested hierarchy:

```
Cloud            (contains ↓)
└── Enterprise   (contains ↓)
    └── Pal
```

The **pal cache** is scoped to a single pal — the default and by far the most common. The
**enterprise cache** is shared across every pal in the enterprise; the **cloud cache** is
shared across every enterprise. Higher scopes exist for cross-pal or cross-enterprise data
sharing.

`pal.getCacheManager()` returns the **pal-level** CacheManager. It's typically bound to the
reserved global `cm`:

```js
cm = pal.getCacheManager();
```

For enterprise and cloud scopes, use the corresponding accessors on the enterprise or cloud
objects (verify names against the API docs). The **API surface is the same** across all
three scopes — only the data lifetime and visibility differ.

**Official API:** https://secure.cloudpiston.com/cpal/cp-api/web/CacheManager.html

---

## When to cache

- **Expensive computed values** that don't change per-request (e.g., a rendered menu, a
  lookup table derived from a dataset).
- **External API results** that are safe to reuse for some TTL (e.g., a weather forecast,
  a stock quote, a config file fetched from a URL).
- **Dataset reads** that are frequent and small enough to keep in memory, and where staleness
  is acceptable within the TTL window.

**Don't cache:**
- Per-user data that would leak between sessions unless the cache key includes the user id.
- Values that change on every write to a dataset the cache doesn't know about.
- Anything write-through where staleness would cause silent corruption.

---

## Writing to the cache

Three typed put methods for object types, one for scalars, plus TTL variants:

```js
// Strings and primitives
cm.put(key, value);                          // no expiration
cm.put(key, value, expires);                 // expires is in MINUTES

// Data objects
cm.putData(key, data);
cm.putData(key, data, expires);

// DataList objects
cm.putDataList(key, dataList);
cm.putDataList(key, dataList, expires);

// Payload objects
cm.putPayload(key, payload);
cm.putPayload(key, payload, expires);
```

Expiration is in **minutes**, not seconds — a common gotcha coming from other caches. Omit
the third argument for a no-expiration entry (persists until explicitly deleted or evicted).

---

## Reading from the cache

Mirror the put methods:

```js
var value    = cm.get(key);                  // scalar/String
var data     = cm.getData(key);              // Data object
var list     = cm.getDataList(key);          // DataList
var payload  = cm.getPayload(key);           // Payload
```

Each returns `null` if the key is missing (or has expired). Always null-guard before use:

```js
var config = cm.getData("siteConfig");
if (config == null) {
    config = buildSiteConfig();
    cm.putData("siteConfig", config, 60);    // cache for an hour
}
```

---

## Deleting from the cache

```js
cm.deleteItem(key);
```

Removes the entry. Safe to call whether or not the key exists.

---

## Cache-key strategy

Keys are strings and namespaced only by the scope (pal / enterprise / cloud). Bake enough
into the key to avoid collisions:

```js
var key = "user_menu_" + userId;                 // per-user cache
var key = "seg_" + segmentType + "_" + tenantId; // multi-dimensional
```

Never use user-supplied strings as raw keys — sanitize or hash first.

If both reading and writing paths construct the same key, keep the key-building logic in a
shared library function so drift is impossible.

---

## Invalidation strategies

Two common approaches:

**(1) TTL-only** — accept staleness for a short window (minutes to hours). Simple; no
invalidation code. Use when: staleness is tolerable, writes are infrequent, or the cache
covers external data you don't control writes to.

**(2) Explicit invalidation** — every workflow that writes the underlying data calls
`cm.deleteItem(key)` for the affected cache entries. Use when: writes are common and users
notice staleness. Requires discipline — one workflow forgetting to invalidate creates a bug
you'll chase for months.

---

## Cross-pal and cross-enterprise caching

Use the **enterprise cache** to share data across pals in the same enterprise (e.g., a shared
lookup table both a customer-facing pal and an admin pal read). Use the **cloud cache** for
data shared across the whole CloudPiston deployment.

Same put/get/deleteItem API; the difference is which CacheManager you're calling. Consult
the API docs (link above) for the exact accessor pattern to reach enterprise or cloud
scopes.

**Prefer the pal cache unless you specifically need a higher scope.** Cross-scope caching
introduces coordination complexity — different pals may not agree on cache-key conventions
or invalidation timing.

---

## Common gotchas

- **`cm` must be set in `run()`** before use. `cm = pal.getCacheManager()` — reads before
  that throw.
- **Expiration is minutes.** Not seconds, not milliseconds. `cm.put("k", v, 60)` caches for
  one hour.
- **Type mismatch on read.** `cm.getData(key)` on a key stored with `cm.put()` (scalar) may
  return null or throw. Use matching put/get pairs.
- **Cache entries carry no schema.** A key that stored a `Data` today can store a `Payload`
  tomorrow. That's a code bug on the writing side, and readers won't get a type error — they
  get null or wrong data. Convention discipline required.
- **Per-user data leaks without user-scoped keys.** `cm.put("preferences", data)` is a
  cross-user smash if two users hit the same path — always include the user id in the key
  for per-user state.
