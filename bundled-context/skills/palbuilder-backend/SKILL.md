---
name: palbuilder-backend
description: "Back-end workflow code for a PalBuilder (CloudPiston) pal: the run() entry point, action-switch handlers, includes, error/validation idioms, splitting into per-feature workflows, and platform routing edge cases (robots.txt/sitemap/404). Trigger when writing workflow .js files, action handlers, AJAX responses, or any server-side request logic. Assumes palbuilder-core (ES3 subset, naming, layers, security) and palbuilder-data (datasets, payloads) are in context."
---

# Back-End Palbuilder Workflow Coding Skill

Read this file before writing any Palbuilder workflow file.

Console API docs: https://secure.cloudpiston.com/cpal/cp-api/console/index.html
Web API docs: https://secure.cloudpiston.com/cpal/cp-api/web/index.html

---

## What a Workflow Is

A workflow is a server-side JavaScript file that runs on every request to a Pal. It receives a
controller, reads the incoming action, executes business logic, and returns a response — a full page or
an AJAX fragment. This skill covers **Console** (authenticated) and **Web** (open internet) workflows.

---

## Workflow JS engine — restricted ES3 subset

Workflow `.js` runs through CloudPiston's restricted server-side engine: no object literals, no
`let`/`const`, no arrow functions. The full ban list, workarounds, and confirmed-safe subset are
owned by **`palbuilder-core`** — see `palbuilder-core/references/es3-cheatsheet.md`. All examples
below stay inside that subset.

---

## Includes

Libraries are included at the top of the file with `@include`. Common platform libraries:

```js
//@include("cloudpiston/ui/v5/lib-ui");   // showModal(), hideModal(), UI helpers
//@include("cloudpiston/ui/lib-paging");
//@include("cloudpiston/ui/lib-job");
//@include("data/lists");                  // this pal's data layer
//@include("lib/console/blogs");           // this pal's service layer
```

`showModal()` / `hideModal()` come from `cloudpiston/ui/v5/lib-ui`. Include paths vary by project —
confirm what a project's includes expose before calling helpers not defined in the file.

---

## Global Variables

Declare the shared objects you need at the top of the file, before `run()`. The reserved global
names (`c`, `pal`, `request`, `data`, `page`, `ajax`, `payload`, …) and their fixed meanings are
owned by **`palbuilder-core`** (Reserved global variable names) — use each only for its defined value.

**Declare only what you actually use.** Real workflows commonly declare just
`c, page, payload, pal, request` (and `ajax` when needed).

---

## The run() Function

Every workflow has a single `run(controller)` entry point:

1. Define the globals you need
2. Common setup
3. Action switch
4. Prepare and return a response

```js
function run(controller) {
    c       = controller;
    page    = c.getPage("console");
    payload = c.createPayload();
    pal     = c.getPal();
    request = c.getRequest();

    // 3. Action switch
    switch (c.getAction()) {
        case "getTxn":
            getTxn();
            break;
        case "getAddAttachment":
            showModal("console/modal/addAttachment");
            payload.set("txnId", request.get("txnId"));
            break;
        case "downloadAttachment":
            return downloadAttachment();          // return straight from the switch
        case "saveDecision":
            saveDecision();
            break;
        default:
            break;
    }

    // 4. Return response
    if (request.isAjax()) {
        if (ajax == null) {
            ajax = frag ? c.createAjaxResponse(pal.getAjaxFragment(frag), true)
                        : c.createAjaxResponse("ignore", false);
        }
        ajax.addPayload(payload);
        return ajax;
    }
    if (frag) { payload.set("main", frag); }
    page.addPayload(payload);
    return page;
}
```

**Key rules (as real pals actually do it):**
- `switch (c.getAction())` is the common form. Storing `action = c.getAction()` and using
  `switch (action)` is equally valid — both appear in real code. Don't force one.
- Each case routes to a **thin handler**. It's normal for a case to do a little inline — open a modal
  and seed its payload (`showModal(...)` + `payload.set(...)`), or `return someDownload()`. Keep it thin;
  push real logic into a handler function.
- The unknown-action fallback is `c.createAjaxResponse("ignore", false)`, never an error message.
- Read submitted values with **either** `request.get("field")` **or** the `data` global
  (`data = request.getData(); data.get("field")`). Both are valid and both appear in real pals — pick one
  and be consistent within a file.

---

## Three-Layer Architecture

The presentation/service/data layer split (and library-workflow rules) is owned by
**`palbuilder-core`** (Three-Layer Architecture). The presentation layer is the `run()` file(s)
this skill is about; it calls the service layer, which calls the data layer. The workflow-specific
scaling pattern below is unique to this skill.

### Splitting into multiple workflows (a scaling pattern, not a default)

A **single `run()` / `main.js` is correct** for a focused pal — don't split for its own sake. But when
a pal grows to **many distinct feature areas**, a large pal splits into **per-feature workflow files**,
each with its own `run(controller)` + globals + action `switch`, plus a **`console` hub** workflow.
Feature workflows delegate any action they don't handle **back to the hub**:

```js
// real: EmailDB campaigns.js — a feature workflow's run() switch
switch (c.getAction()) {
    case "getCampaigns":        getCampaigns();       break;
    case "saveCampaignDraft":   saveCampaignDraft();  break;
    // ... this workflow's own actions ...
    default:
        return c.switchToWorkflow("console", c.getAction());   // hand unknown actions to the hub
}
```

EmailDB does this across `campaigns.js`, `contacts.js`, `segments.js`, `surveys.js`,
`emailTemplates.js`, all hubbed on `console.js`. The three layers above still apply **within** each
workflow — splitting by feature is orthogonal to the presentation/service/data split.

---

## DataSets, DataViews & DataLists

Dataset/dataview reads, writes, filters, payloads, and DataList shaping are owned by
**`palbuilder-data`** — read it for any data access. A back-end-specific `c.*` / Payload / Request
method reference (with worked query/write examples) also lives in this skill's
**`references/api-reference.md`**.

---

## Naming Conventions

Owned by **`palbuilder-core`** (Naming Conventions): camelCase variables, UPPER_SNAKE_CASE constants,
double-quoted strings, plural camelCase datasets with PK = singular name + `"Id"`.

---

## Functions

Single responsibility. As a function grows, ask whether it should split. Library functions shared across
workflows must take everything they need as arguments — no hidden dependence on globals.

---

## DRY

Owned by **`palbuilder-core`** (DRY and Cleanliness): consolidate with functions and loops, but don't
build custom abstractions over what the platform already does cleanly — use the native API directly.

---

## Error Handling & Validation

Real legacy code is light on error handling — **do not copy that as a standard.** Write deliberate
validation and fail with a clear message, using the real platform idioms:

- **Validate required inputs** with `request.getData().getDefaultValue("field", null, true)` (the `true`
  marks it required), and **return early** when invalid:

```js
var note = request.getData().getDefaultValue("note", null, true);
if (note == null)            { getFail("Note is required", "feedback"); return; }
if (note.length > 2000)      { getFail("Note cannot exceed 2000 characters", "feedback"); return; }
```

- `getFail(message, target)` (from the UI include) renders an inline error into a feedback region; pair
  it with a `<span id="feedback">` in the modal/fragment.
- **Null-guard** before dataset operations (`if (userId == null) return null;`) rather than letting a
  null propagate into a query.
- Use `try/catch` around genuinely fallible operations (external service calls, parsing) — not as
  decoration, but where a throw is realistic.

---

## Security

Owned by **`palbuilder-core`** (Security Baseline): don't use ClientPal or `fetch` for server calls —
`c:` elements encrypt the action/querystring server-side; ClientPal/fetch expose everything in devtools.

---

## Platform facts — routing edge cases (learned on live pals)

**`robots.txt` / `sitemap.xml`** — every path hits the workflow on both test and production instances.
Intercept these by href before the action switch and return the raw body with `createAjaxResponse`:

```js
var href = c.getHref();
if (href != null && href.indexOf("robots.txt") >= 0) {
    return c.createAjaxResponse("User-agent: *\nAllow: /", false);
}
if (href != null && href.indexOf("sitemap.xml") >= 0) {
    var body = buildSitemapXml();     // your string-builder function
    return c.createAjaxResponse(body, false);
}
```

`createAjaxResponse(bodyString, false)` returns the raw string — no JEXL rendering, no HTML wrapper.
Put these checks BEFORE the action switch so they intercept the request unconditionally.

**Unknown `.html` hrefs** — route to a 404 page (e.g. `frag = "common/notFound"`).
**Non-`.html` hrefs** (token URLs and other opaque paths also hit the workflow) — fall through to the
home/landing page, NOT a 404. Check `href.endsWith(".html")` to distinguish the two cases.

---

## Debugging

Use `c.debug()`, `c.debugData()`, `c.debugList()` freely during development (they output to the Pal
Builder debugger panel). **Remove all debug calls before finishing** — don't leave `c.debug` in
finished code.

```js
c.debug("******* ACTION: " + c.getAction() + " *******");
c.debugData(someData);
c.debugList(someList);
```

---

## Cleanliness

- Remove commented-out code and comments that don't aid understanding.
- Delete unused files entirely and remove references to them.

---

## API method reference (ConsoleController, Payload, Request)

The exhaustive `c.*` ConsoleController method list, the Payload API (scalars, `addDataList` list
binding, string-mode `<c:list>`), and the Request API (`isAjax`, `get`, `getData`, `getDefaultValue`,
`getUpload`) live in **`references/api-reference.md`** — read it when you need a specific method
signature.

---

*Console API: https://secure.cloudpiston.com/cpal/cp-api/console/index.html*
*Web API: https://secure.cloudpiston.com/cpal/cp-api/web/index.html*
