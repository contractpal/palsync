# Tunnel Workflows (`workflowType: 15`)

Tunnel workflows are the webservice-based communication channel **between pals** — within
an enterprise, across enterprises, or across clouds. Tunnels are CloudPiston's cross-pal
integration mechanism.

Companion:
- `../SKILL.md` — the `run()` pattern (still applies)
- `webservices.md` — external HTTP APIs (5, 12, 14) for non-pal integrations
- `palbuilder-data/references/http-client.md` — for calling out to non-pal services

---

## When to use a tunnel

A tunnel connects **two CloudPiston pals** without involving an external system:

- **Cross-pal data sharing within an enterprise** — one pal publishes data, another
  consumes it, both live in the same enterprise
- **Cross-enterprise integration** — two enterprises exchange data (partnership, supply
  chain, referral program)
- **Cross-cloud** — pals on different CloudPiston deployments

For **non-CloudPiston** external integrations, use a regular webservice type (5 or 12) and
call out via `ServiceRequest` — not a tunnel.

---

## The tunnel model — receiver + caller

A tunnel has two sides:

- **Receiver** — a `workflowType: 15` workflow in the pal that provides data
- **Caller** — a workflow in another pal that invokes the tunnel via
  `pal.getTunnel(connectorName)` and `tunnel.submit(action, payload)`

The `connectorName` is a string that identifies the tunnel relationship — it maps to a
configured connection between the two pals. Configuration lives outside the workflow (in
Pal Manager or equivalent); verify with your enterprise setup.

---

## Receiving side — the tunnel workflow

The receiver's `run()` reads the incoming payload from the request, populates a response
payload, and returns the response. Real example (from GiftHub, called by EmailDB):

```js
var c;
var pal;
var request;
var payload;
var action;
var resp;

function run(controller) {
    c = controller;
    pal = c.getPal();
    request = c.getRequest();
    payload = request.getPayload();          // ← inbound payload from the caller
    action = request.getAction();
    resp = c.getResponse();                  // ← response object to populate

    switch (action) {
        case "sync":
            sync();
            break;
        case "ignore":
            break;
        default:
            break;
    }

    return resp;
}

function sync() {
    var segment = payload.get("segment");
    var usersDS = pal.getDataSet("users");
    var filter = usersDS.createFilter();
    filter.setMaxPageSize();
    filter.selectColumns(["firstName", "lastName", "email"]);

    switch (segment) {
        case "Chris's Accounts":
            filter.addLike("email", "cmartineau0616");
            break;
        case "Just Chris":
            filter.addEqual("email", "cmartineau0616@gmail.com");
            break;
        default:
            break;
    }

    var users = usersDS.getRecords(filter, "contacts");
    var p = resp.getPayload();               // ← get the response payload
    p.addDataList(users);
    resp.setPayload(p);                      // ← attach it back to the response
}
```

**Key shape differences from a browser workflow:**

- **`payload = request.getPayload()`** — the inbound payload comes off the request, not
  from `c.createPayload()`. The caller's payload arrives as-is.
- **`resp = c.getResponse()`** — the response object exists already; get it and populate it.
- **`resp.getPayload()` / `resp.setPayload(p)`** — the response has its own payload that
  the caller will read.
- **No `page` or `ajax`** — tunnels don't render UI; they exchange structured data.
- **`return resp;`** — just return the response object.

---

## Calling side — invoking a tunnel from another pal

The caller obtains a tunnel handle via `pal.getTunnel(connectorName)`, builds a payload,
submits, and reads the result. From EmailDB (calling GiftHub's sync tunnel):

```js
var tunnel = pal.getTunnel(connector);
var p = c.createPayload();
p.set("segment", segment.get("name"));
var resp = tunnel.submit("sync", p);

var freshContacts;
if (resp.isSuccess()) {
    freshContacts = resp.getDataList("contacts");
} else {
    throw new Error("Tunnel Error: " + resp.getError());
}
```

**Key calls:**

- **`pal.getTunnel(connector)`** — get a tunnel handle. `connector` is the configured
  connection name.
- **`c.createPayload()` + `.set(...)`** — build the outbound payload however you'd build
  any payload (see `palbuilder-data/references/payloads.md`).
- **`tunnel.submit(action, payload)`** — send the request; returns a response object.
- **`resp.isSuccess()`** — check whether the call succeeded.
- **`resp.getDataList(name)`** / **`resp.getData(name)`** / **`resp.get(key)`** — read the
  response payload's contents.
- **`resp.getError()`** — the error message if `isSuccess()` returned false.

Error handling by throwing is common — the caller decides how to react. Wrap in try/catch
if the calling workflow should degrade gracefully.

---

## Default workflow registration

Registered in `pal.json`'s `layout` block:

```json
{
  "layout": {
    "tunnelServiceWorkflow": "others/tunnel.js"
  }
}
```

Additional tunnel handlers can be registered as non-default type-15 workflows if the pal
needs multiple tunnel endpoints.

---

## Common gotchas

- **Tunnels are pal-to-pal, not pal-to-external.** For non-CloudPiston integrations, use a
  regular webservice type (5, 12) with `ServiceRequest`.
- **`request.getPayload()` on the receiver side, `c.createPayload()` on the caller side.**
  The receiver reads what the caller sent; the caller builds a fresh payload each time.
- **`resp.setPayload(p)` after mutation.** The response payload isn't automatically updated
  when you add a DataList — call `setPayload` back after `addDataList` or similar mutations
  (or verify against the API whether the reference is live).
- **Connector configuration is out-of-band.** The `connector` string in
  `pal.getTunnel(connector)` refers to a configured connection — if that configuration is
  missing or misnamed, the call will fail before your workflow runs.
- **Return structured data, not pages.** Tunnels don't render UI. The response payload is
  read by another workflow, not a browser.

---

## Testing — no `Test<Type>.do`, a real call instead

Tunnels aren't compile-tested through the `Test<Console|Web|System|Pal>.do` family at all —
there is no `TestTunnel.do`. Instead, `pal_tunnel_test` mints short-lived real credentials via
**`CreateTunnel.do`** (`{ tunnelUrl, tunnelUsername, tunnelPassword }`, password expires in
~5 min) and then calls the tunnel workflow **for real**, over HTTP, exactly as another pal's
caller side would — POSTing to `tunnelUrl` with Basic auth and the `tunnelAction`/
`tunnelWorkflow` headers. It's the one testing surface that returns actual DATA back to the
agent instead of a validation verdict; an empty 200 response means the workflow threw at
runtime (the server swallows the error).