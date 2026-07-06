# Webservice Workflows (`workflowType: 5`, `12`, `14`)

Three workflow types serve **webservice endpoints** — non-browser HTTP APIs consumed via
REST or SOAP. They differ in authentication model and target:

| Type | Name | Auth model | Purpose |
|---|---|---|---|
| **5** | Transaction webservice | Webservice account | Operate on a **specific Transaction Packet** — remote API for packet interaction |
| **12** | Console webservice | Webservice account | General-purpose console-equivalent operations without a browser |
| **14** | User webservice | Tied to a **specific user profile** | Per-user API access (a user's mobile app calling the pal on their behalf) |

Companion:
- `../SKILL.md` — the `run()` pattern (still applies; webservices use `run()` and action switches)
- `palbuilder-data/references/http-client.md` — for calling out to other services; JSONBuffer
  for constructing response bodies
- `transaction.md` — for type 5, which operates on packets

---

## What's common across all three

All three webservice types:

- Have a `run(controller)` entry point and an action switch
- Return responses — but usually **structured data** (JSON) rather than pages or ajax
  fragments
- Are registered as defaults in `pal.json`'s `layout` block:
  - `webServiceWorkflow` for type 5
  - `consoleWebServiceWorkflow` for type 12
  - `userWebServiceWorkflow` for type 14

---

## Response construction — return JSON, not pages

Webservice callers expect JSON. Build the response with `c.createJsonBuffer()` and return
it directly:

```js
function getStatus() {
    var jb = c.createJsonBuffer();
    jb.startObject();
    jb.set("status", "ok");
    jb.set("timestamp", new Date().toString());
    jb.setInt("count", getRecordCount());
    jb.endObject();

    // Return as the workflow response — exact mechanism depends on webservice type
    // Verify against the controller API for your workflow type
    payload.set("responseBody", jb.toString());
}
```

Exact response-return mechanism (whether to set a payload key, return a specific response
type, or use a dedicated JSON response builder) varies by webservice type — check the
controller API for the type you're writing:

- Type 5: https://secure.cloudpiston.com/cpal/cp-api/web/ (transaction webservice controller)
- Types 12, 14: same base, different controller class

---

## Authentication model differences

### Type 5 — Transaction Webservice

Callers authenticate as a **webservice account** (not a user) and target a specific
transaction packet. The controller exposes the packet via the same `tx` global that
type-2 transaction workflows use. See `transaction.md` for packet operations.

### Type 12 — Console Webservice

Callers authenticate as a **webservice account**. There is no user; `c.getUser()` returns
null or a service-account placeholder. Use for API endpoints that don't act on behalf of a
specific person.

### Type 14 — User Webservice

Callers authenticate **as a specific user profile** — typically via a token issued when the
user signed in via a mobile app or client. `c.getUser()` returns that user, and all
per-user data isolation rules apply as they do in a console workflow (see `console.md`).

---

## Choosing the right type

- **Operating on a transaction packet from an external system?** Type 5.
- **A server-to-server API for admin, integration, or system use?** Type 12.
- **A mobile app or third-party client acting on behalf of a specific user?** Type 14.

If none fit — consider whether the caller is actually a browser (use console/web instead) or
a background job (use console-system).

---

## Common patterns

### Reading the request body

Webservice callers may send JSON in the request body. Read and parse with `c.createJsonParser`:

```js
var body = request.getRequestBody();          // exact accessor to verify
var jp = c.createJsonParser(body);
var email = jp.readValue("user.email");
var qty   = parseInt(jp.readValue("order.quantity"), 10);
```

See `palbuilder-data/references/http-client.md` for JSONParser details.

### Returning errors as structured JSON

Webservice errors should be structured, not HTML pages:

```js
function respondError(code, message) {
    var jb = c.createJsonBuffer();
    jb.startObject();
    jb.set("error", message);
    jb.setInt("code", code);
    jb.endObject();
    // set the response body per the type's controller API
}
```

### Setting HTTP status codes

Non-200 statuses (401, 403, 404, 500) may need explicit setting on the response. Check the
controller API for your workflow type — the accessor varies.

---

## Common gotchas

- **Don't return HTML from a webservice.** Callers are expecting JSON (or SOAP XML if that's
  the endpoint style). Returning HTML breaks integrations.
- **Webservice accounts and user profiles are different auth realms.** A token issued for a
  webservice account (types 5, 12) does not identify a user; a user token (type 14) does
  not authorize webservice-account operations.
- **Rate limiting is your responsibility.** CloudPiston may not enforce per-endpoint rate
  limits — if your webservice can be abused, implement throttling (cache-based counters,
  IP tracking) in the workflow.
- **CORS and preflight requests.** Public webservice endpoints called from browsers may hit
  CORS preflight — handling requires configuration outside the workflow. Verify with the
  API docs.

---

## What needs verification

Because webservice types have less production content in the source material for this skill:

- Exact response-return mechanism for each type (setting a body vs returning a response object)
- HTTP status code accessors
- SOAP-specific patterns (if the endpoint uses SOAP rather than REST)
- Authentication token / signature verification helpers

Check the controller API docs before implementing an unfamiliar webservice pattern.
