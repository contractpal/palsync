---
name: palbuilder-workflow
description: Use this skill whenever writing server-side workflow JavaScript for a CloudPiston pal — any workflowType. Covers the run() function pattern, the reserved global variables (c, pal, page, ajax, payload, request, data, action, formatter, validator, cm, dateUtil, resp), action switch routing, the @include mechanism for library composition, response types (page, ajax, download, redirect, exitToWeb), the three-layer architecture (presentation/service/data), c.debug vs. the persistent Logger (c.getLogger, Notification-backed levels), workflow utilities (DateUtil, EncryptionUtil, Monitor), and workflow-type-specific patterns (console, web, transaction packets, background jobs, webservices, tunnel, libraries). Trigger when writing any workflow .js file, adding an action handler, constructing a response, calling into a library, calling c.getEncryptionUtil / c.getMonitor / c.getDateUtil / c.getLogger, or delegating to another workflow via switchToWorkflow.
---

# CloudPiston Pal — Workflow Layer

Server-side workflow JavaScript is the pal's control layer. Every browser request or job
trigger enters a workflow at its `run(controller)` function; the workflow routes the action,
prepares a response, and returns it. All workflows follow the same shape regardless of
`workflowType` — the differences are in the entry-point contract and the available API,
which per-type references cover.

CLAUDE.md holds the always-on rules. `palbuilder-core/references/es3-cheatsheet.md` has the
workflow-JS workarounds (no object literals, no `.forEach`, etc.) that apply throughout.

---

## Read [reference].md when

**Response and error handling:**
- **`references/responses.md`** — page, ajax, download, redirect, `c.exitToWeb`, and the
  common tail pattern that selects between them.
- **`references/errors.md`** — try/catch patterns, validation, unknown-action fallback.

**Composition and shared code:**
- **`references/libraries.md`** — `workflowType: 4` library workflows, the `@include`
  directive, and library `workflowContext` values.

**Cross-workflow utilities:**
- **`references/utilities.md`** — DateUtil (dates/times), EncryptionUtil (crypto, hashing,
  encoding), Monitor (timing, timeouts). Available in every workflow type.
- **`references/logging.md`** — `c.debug`/`debugData`/`debugList` (runtime-only, remove
  before shipping) vs. `Logger` (`c.getLogger()` — persistent, Notification-backed, safe to
  leave in production). Read this when deciding which to use, not just how to call one.

**Per workflow type — read the matching reference for the workflow you're writing:**
- **`references/console.md`** — `workflowType: 7`. Authenticated user, in-platform console UI.
- **`references/web.md`** — `workflowType: 9`. Public web, anonymous users, pal's own domain.
- **`references/transaction.md`** — `workflowType: 2`. Transaction packets, wizards.
- **`references/console-system.md`** — `workflowType: 11`. Background jobs — pointer to
  `palbuilder-realtime` which owns this in depth.
- **`references/webservices.md`** — `workflowType: 5` / `12` / `14`. Webservice endpoints
  (transaction, console, user).
- **`references/tunnel.md`** — `workflowType: 15`. Cross-pal / cross-enterprise / cross-cloud
  communication.

For `workflowType: 3` (transaction system) — avoid it. Use `console-system.md` (type 11) and
pass the transaction id explicitly. See `palbuilder-core/references/pal-json.md` for the
full workflowType table.

---

## The `run()` function

Every workflow file has one `run(controller)` entry point. Structure:

1. **Declare all globals** at the top of the file (only the ones you actually use).
2. **Assign the globals** at the top of `run()`.
3. **Action switch** — each `case` calls exactly one function that owns the work.
4. **Common tail** — pick a response type and return it.

```js
var c;
var pal;
var page;
var ajax;
var request;
var data;
var action;
var payload;

function run(controller) {
    c = controller;
    pal = c.getPal();
    page = c.getPage("dashboard");                   // page name is always required; use c.getPage (NOT pal.getPage)
    request = c.getRequest();
    data = request.getData();
    action = c.getAction();
    payload = c.createPayload();

    switch (action) {
        case "loadDashboard":
            loadDashboard();
            break;
        case "saveSettings":
            saveSettings();
            break;
        default:
            break;
    }

    // Common tail — pick response type
    if (request.isAjax()) {
        if (ajax == null) {
            ajax = c.createAjaxResponse("ignore", false);
        }
        ajax.addPayload(payload);
        return ajax;
    }
    page.addPayload(payload);
    return page;
}

function loadDashboard() {
    // Real work here — usually calls into library workflows (service layer)
}

function saveSettings() {
    // ...
}
```

Two important properties of this shape:

- **Every action `case` calls exactly one function.** The switch is a router, not a place for
  logic. Handlers own their setup, service calls, and response prep.
- **Actions that don't set `ajax` or `resp` explicitly get the common tail's ajax or page.**
  A handler that needs to return a download or redirect can `return` it directly from the
  switch — see `references/responses.md`.

---

## Reserved globals

These variable names have fixed meanings. Use them only for the values described — never
repurpose them.

| Global | Value | Notes |
|---|---|---|
| `c` | `controller` | The entry-point parameter |
| `pal` | `c.getPal()` | This pal. Other pals use their name as the variable |
| `tx` | Transaction | Set only in transaction workflows |
| `request` | `c.getRequest()` | The incoming request |
| `data` | `request.getData()` | Request `Data` (form fields, querystring) |
| `action` | `c.getAction()` | The requested action name |
| `page` | `c.getPage("<name>")` | The page to return; name is always required. Use `c.getPage`, never `pal.getPage` (that returns the design-model page, not a returnable response) |
| `ajax` | `c.createAjaxResponse(...)` | The ajax response, when applicable |
| `resp` | any other response | Download, redirect, `exitToWeb` |
| `payload` | `c.createPayload()` | Main payload attached to the final response |
| `formatter` | `c.getFormatter()` | String / date / number formatting helpers |
| `validator` | `c.getValidator()` | Input validation helpers |
| `cm` | `pal.getCacheManager()` | Pal-level cache — see `palbuilder-data/references/cache.md` |
| `dateUtil` | `c.getDateUtil()` | Date arithmetic helpers |

**Declare only the globals you actually use.** A workflow that never returns ajax doesn't
need `ajax`; a workflow that never touches cache doesn't need `cm`.

---

## The action switch

The action switch is the entry-point router. Every action string maps to one handler
function.

```js
switch (action) {
    case "getDashboard":
        getDashboard();
        break;
    case "saveList":
        saveList();
        break;
    case "deleteItem":
        deleteItem();
        break;
    default:
        break;
}
```

**Rules:**
- **One function per case.** Never inline more than the function call. The handler owns the
  work.
- **No error path in the switch itself.** Handlers throw or set a flag; the common tail
  formats the response.
- **`default: break;`** — silent fallback. Unknown actions produce the ignore ajax response
  in the common tail. See `references/errors.md`.

### Delegating to another workflow — `c.switchToWorkflow`

When a large pal splits into per-feature workflows plus a hub, feature workflows can delegate
unknown actions back to the hub:

```js
default:
    return c.switchToWorkflow("console", action);
```

`switchToWorkflow(name, action)` hands the request over — the target workflow's `run` is
invoked with the same request. Use this for hub/spoke patterns where common actions live in
one place.

---

## `@include` — library composition

Library workflows (`workflowType: 4`) are reusable functions included into other workflows.
The `@include` directive lives at the top of the workflow file, above the global
declarations:

```js
//@include("libs/data/lists");
//@include("libs/data/users");
//@include("libs/dashboard");

var c;
var pal;
// ...
```

The path is relative to the workflow root (matching the library's registered `filename`) and
the syntax is a **line comment with `@include(...)`** — the compiler picks it up. See
`references/libraries.md` for library context matching, argument-passing conventions, and
patterns for splitting service and data layers.

---

## Three-layer architecture

For any non-trivial pal, split workflow code into three layers. Each calls only the layer
below.

### Presentation
The workflow file(s) with `run()`. Handles routing, response prep (page/ajax/payload), and
error handling. **Never touches datasets directly** — always calls into service layer.
Lives at the workflow root (or `defaults/`, `others/`).

### Service
Business logic — number crunching, external requests, data shaping. Lives in `libs/`
library workflows, grouped by feature (`libs/dashboard`, `libs/console/blogs`). Included
into presentation workflows via `@include("libs/...")`. Calls into the data layer for reads
and writes.

### Data
All dataset/dataview reads and writes. Also lives in library workflows, kept separate from
service-layer libs — commonly `libs/data/...`. The distinction is by responsibility, not by
whether the file is technically a library. See `palbuilder-data` for dataset APIs.

### Library-function rules

- **Take everything as arguments.** Library functions may rely on the standard globals (`c`,
  `pal`, `formatter`, `validator`, `dateUtil`, `cm`) since those exist in any workflow — but
  **not** on any other global. Anything workflow-specific (dataset ids, current user, action
  parameters) must be passed in explicitly.
- **Return payloads, DataLists, or scalars** — never mutate `payload` directly from a
  library. That gives the caller control over composition.
- **No response construction in libraries.** Libraries return data; presentation constructs
  responses.

See `references/libraries.md` for depth.

---

## Choosing a response

Every workflow returns one of these:

| Response | Use for | Set by |
|---|---|---|
| `page` | Full page load, first render | Default; from `c.getPage("<name>")` |
| `ajax` | Fragment swap into a target div | `c.createAjaxResponse(...)` |
| Download | File download to the browser | `c.createDownloadResponse()` |
| Redirect | Send the browser elsewhere | `c.redirect(url)` (Console-only: `c.exitToWeb` for webservice integrations) |

The common tail at the end of `run()` handles page vs ajax automatically based on
`request.isAjax()`. Downloads and redirects are returned directly from the action switch —
they bypass the common tail. See `references/responses.md` for details.

---

## Debugging and logging

Two distinct facilities, not interchangeable: `c.debug`/`debugData`/`debugList` are
runtime-only and must be removed before shipping (CLAUDE.md anti-patterns); `Logger`
(`c.getLogger()`) is persistent, viewable later in Pal Manager, and fine to leave in
production. Full comparison, setup requirements (Logger needs a Notification configured in
Pal Manager), log levels, and storage/limits: `references/logging.md`.

---

## Reference documentation

Deep API for controller and workflow response types:

- Controllers vary by workflow context (Console, Web, Transaction, etc.). Start at the
  API index: https://secure.cloudpiston.com/cpal/cp-api/index.html
- Console controller: https://secure.cloudpiston.com/cpal/cp-api/console/index.html
- Web controller: https://secure.cloudpiston.com/cpal/cp-api/web/index.html
