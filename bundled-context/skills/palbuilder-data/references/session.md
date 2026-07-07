# Session Storage and Cookies

The Request object exposes three per-user storage surfaces: **session values** (small
key/value pairs), **session data** (named `Data` objects), and **cookies** (client-side,
sent with every request). The pal-wide **cache** solves different problems than session
storage — size, cross-session persistence, and access with no session at all — see below
for when to reach for it instead.

**Official API:**
- Request — https://secure.cloudpiston.com/cpal/cp-api/web/Request.html

Companion:
- `cache.md` — full CacheManager reference (put/get across strings, `Data`, `DataList`,
  `Payload`, the three cache scopes)
- `datasets.md` — for anything that needs structured, queryable, permanent storage
- `../SKILL.md` — the storage decision section (session vs. cookie vs. cache vs. dataset
  vs. settings) — read this first if you're not sure which surface fits

---

## Session values — `key/value` pairs

The lightweight surface for short, per-user session state (current filter, active view id,
step counter, a temporary flag).

```js
// Store
request.setSessionValue("activeFilter", "open");
request.setSessionValue("stepIndex", 2);

// Read
var filter = request.getSessionValue("activeFilter");   // returns a String
var step   = request.getSessionValue("stepIndex");      // still a String — coerce if needed
```

**Values are stored as Strings.** For numeric or boolean state, coerce on read
(`parseInt(step, 10)`, `val === "true"`). Prefer session data (below) for structured state
or when typed accessors matter.

**Clearing a single value:**

```js
request.setSessionValue("activeFilter", null);   // clears just this key
```

**Clearing everything:**

```js
request.clearSessionValues();   // removes ALL session values
```

---

## Session data — named `Data` objects

For structured session state that maps naturally to a `Data` object (a small cart, a
partially-filled form, a set of related flags):

```js
var cart = c.createData();
cart.set("itemId", "ABC-123");
cart.setInt("qty", 2);
cart.set("promoCode", "SPRING10");
request.setSessionData("cart", cart);

// Read back — returns a Data object (or null)
var stored = request.getSessionData("cart");
if (stored != null) {
    var itemId = stored.get("itemId");
    var qty    = stored.getInt("qty");
}
```

Session data holds full `Data` objects (see `payloads.md` for the `Data` API — `set`,
`setInt`, `setBoolean`, `setDate`, and their getters).

**Clearing a single name:**

```js
request.setSessionData("cart", null);   // clears just this name
```

**Clearing everything:**

```js
request.clearSessionData();     // removes ALL named session data
```

---

## Cookies — client-side, sent every request

Cookies are server-set, client-stored, and sent back on every request. Use for auth tokens,
"remember me" flags, session identifiers that need to survive a browser restart, and
lightweight preferences that must be readable without a session.

```js
// Set — path first, then name/value
request.setCookie("/", "prefTheme", "dark", true, 60 * 60 * 24 * 30);   // 30 days

// Read
var theme = request.getCookie("prefTheme");        // returns String or null

// Delete — path first, then name (same order as setCookie)
request.deleteCookie("/", "prefTheme");
request.deleteCookies();                           // removes ALL cookies
```

`setCookie(path, name, value, secure, age)`:

| Position | Type | Notes |
|---|---|---|
| `path` | String | Cookie path (usually `"/"`). **Path comes first — not name.** |
| `name` | String | Cookie name. |
| `value` | String | Cookie value. Encode / escape anything that could break a header. |
| `secure` | boolean | If true, cookie only sent over HTTPS. |
| `age` | int | Max age **in seconds, counted from now**. |

**Path comes first in both `setCookie` and `deleteCookie`.** Every browser cookie API you're
used to (document.cookie, Set-Cookie header, Node's res.cookie) puts name first — this API
doesn't. Getting the order wrong on `setCookie` creates a cookie named after your intended
value; getting it wrong on `deleteCookie` fails to delete anything.

**Size limits are strict.** Browsers cap each cookie at 4KB and total per-domain at ~50
cookies. Cookies are sent with every request — big cookies hurt every response. Keep them
small (ids, tokens, short flags), not payloads.

---

## When to reach for cache instead of session

Session values and session data already persist across requests within the same session —
set a value on one request, read it back several requests later, no cache needed for that.
Cache solves different problems:

- **Size.** Session storage is meant for small amounts of data. A large DataList, a big
  export bundle, or anything with real bulk belongs in the cache, not the session.
- **Survives session expiry.** Session data is gone once the session ends. Cache persists
  independently of any session — useful for data that should still be there next time the
  user comes back, without going all the way to a dataset.
- **Shared across users, or accessed with no session at all.** The cache is pal-wide.
  Background jobs and tunnel receivers have no `request`/session to work with, but they can
  still read and write the cache.
- **Permanent storage without a dataset.** Omitting the TTL argument stores the value
  **permanently** — the cache is backed by a platform-managed database in that case, not an
  in-memory or session-scoped store. It's not a cheap dataset substitute for records you'll
  query and filter, but it is a legitimate durable store for schema-less blobs.

```js
// Storing a large DataList against a per-user cache key, expires in 1 day
var userId = c.getUser().getProfile().getId();
cache.putDataList("recentOrders_" + userId, orders, 60 * 24);

// Later reads — including from a request in a DIFFERENT session
var orders = cache.getDataList("recentOrders_" + userId);
if (orders == null) {
    orders = rebuildOrdersList(userId);
    cache.putDataList("recentOrders_" + userId, orders, 60 * 24);
}
```

The cache TTL is in **minutes**. `60 * 24` = one day. **Omitting the TTL argument stores the
value permanently** in the platform-managed cache database — it does not expire on its own
and survives session expiry, redeploys, and time.

**Cache namespacing per-user is manual.** Sessions are automatically per-user; the cache is
pal-wide. Include the user/profile id in the cache key to isolate:

```js
"orderList_" + userId
"prefs_" + profileId
"exportBundle_" + userId + "_" + reportId
```

Without this, one user's cached data can be served to another.

---

## Choosing this surface vs. others

For the full decision tree (session vs. cookie vs. cache vs. dataset vs. settings, by scope,
size, persistence, and sensitivity), see the storage decision section in `../SKILL.md` —
it's worth reading before reaching for any specific storage call, since the four surfaces
overlap in what they *can* do but differ sharply in what they *should* be used for.

---

## Common gotchas

- **Path comes first in `setCookie` AND `deleteCookie`.** Not name-first like typical
  browser cookie APIs. Getting this wrong on `setCookie` names a cookie after your intended
  value; on `deleteCookie` it silently deletes nothing.
- **Cookie `age` is seconds counted from now**, not a fixed expiry date.
- **Session values are Strings.** Even if you set an int, you read a string. Coerce on read.
- **To clear a single session value or session data name, set it to `null`** —
  `request.setSessionValue("key", null)` / `request.setSessionData("name", null)`.
  `clearSessionValues()` / `clearSessionData()` are the bulk versions.
- **Cache is pal-wide by default.** Per-user isolation requires including the user or
  profile id in every cache key — the cache doesn't do this for you.
- **Cache without a TTL is permanent**, backed by a platform-managed database — not
  in-memory, not tied to any session. It survives session expiry and redeploys.
- **Cookies are sent on every request.** Big cookies tax every request/response. Keep them
  small; put payloads in the cache with a cookie-carried key.
- **In a web workflow, `c.getUser()` doesn't exist** (see `palbuilder-workflow/references/web.md`).
  For per-user session/cache keying in web workflows, derive the id from your custom auth
  mechanism (a signed cookie, a session value populated at sign-in).
- **Session storage is per-request-object** — accessed through `request`, not `pal` or `c`
  directly. Background jobs and tunnel receivers have no session at all; use cache or a
  dataset for their state.
