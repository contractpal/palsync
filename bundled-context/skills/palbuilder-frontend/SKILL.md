---
name: palbuilder-frontend
description: Use this skill whenever writing front-end code for a CloudPiston pal — pages, fragments, c: tags, XHTML markup, EL binding, modals, navigation, or browser-side JavaScript in scripts/. Covers the page shell vs fragment distinction, c:ignore fragment wrapper, EL binding syntax (${var}) and operators (empty(), !empty(), eq, ne, gt, lt, and, or, !), formatter access from EL, the most-used c: tags with pointer to the full attribute reference, fragment folder organization, modal shell integration, navigation/active-class idioms, and the ES-module main-file + modules pattern for client JS. Trigger when writing any page, fragment, modal, navigation menu, form, or client-side JS file.
---

# CloudPiston Pal — Frontend

The frontend layer is what the browser sees: pages (full HTML documents), fragments (partial
HTML swapped into pages via AJAX), and the client-side JavaScript in `scripts/` that runs
in the browser. Pages and fragments use CloudPiston's `c:` tag markup on top of XHTML.

CLAUDE.md holds the always-on rules — several apply specifically to frontend:
- **Rule 1** — XHTML strict for element structure, but not for `<script>`/`<style>` content
- **Rule 2** — never use an undocumented `c:` attribute
- **Rule 3** — AJAX fragments do not fire `DOMContentLoaded`
- **Rule 4** — never use `fetch` or ClientPal to call the server
- **Rule 5** — `onclick` is not valid on `c:a`

Tag reference (official): https://secure.cloudpiston.com/cpal/cp-api/console-tags/summary.html

---

## Read [reference].md when

- **`references/c-tags.md`** — Full attribute list for every `c:` tag. Consult this **before
  using any attribute you haven't used before** (per CLAUDE.md rule 2 — undocumented attributes
  are build errors).
- **`references/platform-facts.md`** — Production gotchas beyond CLAUDE.md's rules: `noscript`
  stripping, image format quirks, entity restrictions, the `c:a` `javascript:` href, why
  regex-editing markup breaks things.

---

## Pages vs Fragments — different files, different rules

A **page** is a complete HTML document — the entry point for a workflow response.
A **fragment** is a partial file swapped into a page via AJAX (`ajax-target`) or
`<c:fragment/>`. They have different shapes and are not interchangeable.

### Every page uses the full shell

Pages have `<html>` / `<head>` / `<body>` with a `<div id="cp-root">`. The server rejects a
page without a `<body>` tag ("No body tag found, cannot save without losing content").

```html
<html xmlns:c="contractpal">
    <head>
        <title>Dashboard</title>
        <link rel="STYLESHEET" type="text/css" href="../Styles/spacing.css"/>
        <link rel="STYLESHEET" type="text/css" href="../Styles/design-system.css"/>
        <link rel="STYLESHEET" type="text/css" href="../Styles/main.css"/>
        <script type="module" src="../Scripts/pb-ui.js"></script>
        <script type="module" src="../Scripts/pb-motion.js"></script>
        <script type="module" src="../Scripts/console-main.js"></script>
    </head>
    <body>
        <div id="cp-root">
            <div id="nav"><c:fragment name="console/navbar"/></div>
            <div id="body"><c:fragment name="${frag}"/></div>
            <c:fragment name="cloudpiston/ui/modalShell"/>
            <c:debug/>
        </div>
    </body>
</html>
```

Use `styles/spacing.css` for Bootstrap-like spacing/layout helpers (`.container`, `.row`, `.col-*`,
`.d-flex`, `.gap-*`, `.m-*`, `.p-*`). Do not load Bootstrap just for spacing. Only use
`c:resource source="bootstrap"` when a legacy pal already depends on Bootstrap behavior or the spec
explicitly requires Bootstrap components.

Do not add remote page-head font resources; the server rejects them. If a pal uses Fontshare, it
must load through the first-line `@import` in `styles/design-system.css`.
Chart.js is the exception for charts: use the platform resource
`<c:resource source="chartjs" version="4.0.0" name="chart.js" />` plus an opt-in local
`scripts/pb-charts.js`.

### Fragments hold the namespace on a wrapper

Fragments contain only the inner content — no `<html>`, no `<head>`, no `<body>`. The XML
namespace declaration lives on a wrapper element:

```html
<!-- fragments/lists/newList.html -->
<c:ignore xmlns:c="contractpal">
    <div class="list-container">
        <!-- inner content only -->
    </div>
</c:ignore>
```

`c:ignore` is preferred over a plain `<div xmlns:c="...">` because it emits no wrapper
element in the output — the fragment's own root element becomes the outermost node.

---

## EL binding — `${var}` and operators

Server values bind into markup with EL-style `${...}` syntax:

```html
<p>${user.firstName}</p>
<img src="${settings.logoUrl}" alt="Logo" />
<div class="badge ${statusClass}">${status}</div>
```

Property access is dot-notation. **`c:list` rows use direct EL** (`${row.columnName}`), not
`.getValue(...)`. Delimited-string list rows use `.get('col0')` (see `c-tags.md`).

### EL operators and helpers

Used in `test=`, `c:if`, `c:when`, `selected=`, `checked=`. **`eq` compares as strings** —
a boolean column stored as `"true"` reads `${x eq 'true'}`, not `${x}`.

| Operator | Meaning | Example |
|---|---|---|
| `empty(x)` | true if null or empty string/list | `${empty(audits)}` |
| `!empty(x)` | not empty (the common guard) | `${!empty(topCritical)}` |
| `eq` / `ne` | equals / not-equals (string compare) | `${r.result eq 'FAIL'}` |
| `!` | negation | `${!f.isInvited}` |
| `and` / `or` | boolean combine | `${a eq 'x' and b eq 'y'}` |
| `gt` / `lt` / `ge` / `le` | numeric compare | `${count gt 0}` |

`empty()` takes a value as an argument — `empty(audits)`, not `empty audits`. Same for
`!empty()`.

### `formatter` is available in EL

The `formatter` object is accessible directly from templates. Use it inline for
date/number/string formatting:

```html
<p>Created: ${formatter.formatDateString(createDate, "MMM d, yyyy")}</p>
<p>Total: ${formatter.formatCurrency(total)}</p>
```

Full formatter method list: https://secure.cloudpiston.com/cpal/cp-api/console/Formatter.html

**Not available in EL:** ternary operator, arithmetic, arbitrary method calls. For anything
beyond `formatter.*` and the operators above, prepare the value in the workflow.

---

## The `c:` tags — quick summary

Full attribute lists for every tag: `references/c-tags.md`. **Read that reference before
using any attribute you haven't used before** — undocumented attributes are build errors,
not warnings (CLAUDE.md rule 2).

Most-used tags:

| Tag | Use for |
|---|---|
| `c:a` | Action links, AJAX-target fragments, navigation (never `onclick` — CLAUDE.md rule 5) |
| `c:fragment` | Insert a named fragment (`console/navbar`, `${frag}`) |
| `c:list` | Iterate a DataList — `<c:list name="lists" id="l">${l.name}</c:list>` |
| `c:if` / `c:choose`/`c:when`/`c:otherwise` | Conditional blocks |
| `c:field` | Form inputs, especially `type="option"` inside a `<select>` |
| `c:set` | Set a template variable (`<c:set name="activeClass" test="..." true="active" false=""/>`) |
| `c:ignore` | Fragment wrapper (namespace declaration only) |
| `c:resource` | Load a versioned platform library (Bootstrap, jQuery, etc.) |
| `c:upload` | File upload widget (`allow` is required — keyword like `"image"`, not MIME) |
| `c:download` | File-download link |
| `c:debug` | Debug panel in dev; place inside `#cp-root` |

Also seen in production: `c:div`, `c:get`, `c:image`, `c:button`, `c:select`. All have their
own attribute lists in `c-tags.md`.

**The `test` attribute is universal.** Almost every `c:` tag and many plain HTML elements
accept `test="${expr}"` for conditional rendering — `<div test="${!empty(items)}">...</div>`
works.

---

## Fragment folder architecture

Fragments live under `fragments/` and are organized by feature. Nested folders are common:

```
fragments/
├── common/          shared: alert, loading, error, spinner
├── auth/            sign-in, register, forgot-password
├── console/
│   ├── navbar
│   ├── settings
│   ├── users
│   └── jobs
├── lists/           feature-specific fragments
├── exchange/
└── modal/           modal-body fragments
```

Fragment names in `<c:fragment name="..."/>` are folder paths without the `.html`:
`console/navbar` refers to `fragments/console/navbar.html`.

**A page shell has two fragment slots by convention:**
- A persistent nav slot (`<c:fragment name="console/navbar"/>`)
- A swappable content slot bound to a workflow variable (`<c:fragment name="${frag}"/>`)

Navigation actions set `frag` to the target fragment name; the page re-renders and the
content slot updates.

---

## Modal fragments

The platform's modal shell is included once in the page (`cloudpiston/ui/modalShell`).
Modal content is loaded into it via `ajax-target="modalContent"`.

```html
<c:a action="editProfile" ajax-target="modalContent">Edit</c:a>
```

The modal fragment itself contains `modal-header` / `modal-body` / `modal-footer`. Close
buttons are plain `<button onclick="hideModal()">`; action buttons are `c:a`:

```html
<c:ignore xmlns:c="contractpal">
    <div class="modal-header">
        <p class="mb-0">Add to group</p>
        <button type="button" class="modal-close" onclick="hideModal()">
            <i class="fas fa-times"></i>
        </button>
    </div>
    <div class="modal-body">
        <!-- content -->
    </div>
    <div class="modal-footer">
        <c:a action="doShareList?listId=${activeList.listId}"
             ajax-target="body"
             class="btn btn-primary">Add</c:a>
    </div>
</c:ignore>
```

- **`showModal(path)`** / **`hideModal()`** come from the `cloudpiston/ui/v5/lib-ui`
  include (or equivalent for older Bootstrap versions).
- CSS class names are project-specific — match the pal's design system.

---

## Navigation — active class idiom

Nav links use `workflow=` (when navigating between console workflows) and an active-class
variable set in the workflow (via `c:set` or a payload value):

```html
<c:a action="getDashboard" workflow="console" class="sidebar-item ${dashboard_active}">
    Dashboard
</c:a>
<c:a action="getSettings" workflow="console" class="sidebar-item ${settings_active}">
    Settings
</c:a>
```

The workflow sets `dashboard_active = "active"` (empty string otherwise) so the current
item highlights. `c:set` in the template is one way; setting the value on the payload from
the workflow is the other.

See `palbuilder-workflow/references/console.md` for `switchToWorkflow` /
`switchToConsolePal` when the nav crosses into a different workflow or pal.

---

## Page and fragment JavaScript

Client-side JS runs in the browser and is **not restricted to ES3** — CLAUDE.md rule 6
applies only to workflow `.js` files under `workflows/`. In `scripts/*.js` you have full
modern JS: `let`, `const`, arrow functions, ES modules (`import`/`export`), `setInterval`,
Promises. (Prefer `c:a` for server calls — CLAUDE.md rule 4 still applies.)

### Never put `<script>` inside a fragment

The server rejects any fragment with an inline `<script>` — "Tag script is not allowed". All
client JS lives in `scripts/*.js` files, loaded once from the PAGE.

### AJAX-loaded JS does not fire `DOMContentLoaded`

An AJAX-loaded fragment runs with the DOM already present. If a fragment needs init code, it
lives in a module the page already imported (available immediately when the fragment renders)
or is invoked by workflow-generated JS via `runJS(...)` — see below.

---

## The main-file + modules pattern

Each page loads a **main file** (`app-main.js` for the app, `console-main.js` for the
console, etc.) as an ES module. The main file imports the modules that page needs, exposes
them on `window` so workflow-generated JS can call them, runs any page-wide init, and emits
an `appReady` custom event.

### Main file — `scripts/app-main.js`

```js
import { historyManager } from "../Scripts/history-manager.js";
import { messageManager } from "../Scripts/message-manager.js";
import createToast    from "../Scripts/notification-manager.js";
import { generalUI }  from "../Scripts/ux/general.js";
import { listsUI }    from "../Scripts/ux/lists.js";
import { profileUI }  from "../Scripts/ux/profile.js";

// The main file is a module — its imports live in module scope, not global.
// Expose the modules workflow code needs to call (via addJavascript / onclick).
window.historyManager = historyManager;
window.createToast    = createToast;
window.generalUI      = generalUI;
window.listsUI        = listsUI;
window.profileUI      = profileUI;

function init() {
    document.getElementById("body").scrollTop = 0;
    messageManager.start();

    document.addEventListener("click", function(e) {
        if (e.target.closest("#navbarSideToggle")) {
            document.getElementById("navSideMenu").classList.toggle("open");
        }
    });
}
init();

// Signal to runJS() (see below) that modules are loaded and callable
window.appIsReady = true;
window.dispatchEvent(new CustomEvent("appReady"));
```

Loaded from the page:

```html
<script type="module" src="../Scripts/app-main.js"></script>
```

A pal typically has one main file per page context — `app-main.js` for the web app,
`console-main.js` for the console UI, etc. Each main file imports only the modules that
page uses.

### Individual modules

Each module in `scripts/` exports a named object of its public functions:

```js
// scripts/ux/exchanges.js
export const exchangesUI = {
    selectMember,
    assignGroupCode
};

function selectMember(el) {
    let selected = el.dataset.selected;
    el.classList.toggle("activeMember");
    el.dataset.selected = selected === "true" ? "false" : "true";
}

function assignGroupCode(groupCode) {
    // ... implementation
}
```

Individual functions are declared with `function` (hoisted, so the `export const {...}` can
reference them before they appear textually). Consumers call `exchangesUI.selectMember(el)`
either from another module (via import) or from workflow-generated code (via `window` after
the main file exposes it).

### Module-level setup — guard with a flag

Some modules need one-time browser wiring (event listeners on `window`, `history`, etc.).
Guard the setup with a flag so re-imports don't double-register:

```js
if (!window._popstateListenerAdded) {
    window.addEventListener("popstate", (event) => {
        if (event.state) {
            ClientPal.sendAjaxRequest(event.state.action, ajaxHandler, "?fromBrowserNav=true");
        }
    });
    window._popstateListenerAdded = true;
}
```

---

## Calling client code from a workflow — `runJS`

Workflows push client-side JS to the browser via `payload.addJavascript(...)`. Because the
main file runs asynchronously (ES modules load in parallel), workflow-emitted JS might fire
before the modules are ready — the callable functions on `window` won't exist yet.

The standard workaround is a `runJS(js)` helper in a workflow library that wraps the JS in
an `appReady` check:

```js
// libs/client.js  (or wherever your client-facing workflow helpers live)
function runJS(js) {
    payload.addJavascript(
        "if(window.appIsReady){" + js + "}" +
        "else{window.addEventListener('appReady', () => {" + js + "});}"
    );
}
```

Then in any workflow handler:

```js
runJS("historyManager.add(state, 'getDashboard', false)");
runJS("createToast('Saved successfully')");
runJS("listsUI.refresh()");
```

The wrapper runs the JS immediately if modules are loaded (subsequent handlers after the
first request), or defers until `appReady` fires (the very first request that establishes
the page).

---

## Bootstrap dropdown init after AJAX

Bootstrap dropdowns need explicit initialization on AJAX-loaded fragments. Put this in the
relevant UI module and invoke it via `runJS(...)` after the fragment renders:

```js
// scripts/ux/general.js
export const generalUI = { initDropdowns };

function initDropdowns() {
    document.querySelectorAll('[data-bs-toggle="dropdown"]').forEach((el) => {
        new bootstrap.Dropdown(el);
    });
}
```

From the workflow: `runJS("generalUI.initDropdowns()");`

---

## Common frontend gotchas beyond CLAUDE.md

- **`.webp` images are served as `text/html`** and don't display. Use JPEG or PNG.
- **`<noscript>` wrappers are stripped**, but their inner content is kept and rendered
  unconditionally. Never use `<noscript>` for progressive-enhancement fallbacks.
- **Only 5 named entities are safe:** `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`. Any other
  named entity (or non-ASCII byte) triggers a validation flag. Write arrows as `-&gt;`.
- **`c:a` renders as `javascript:` href** — any JS click-interceptor MUST guard
  `a.protocol !== "http:" && a.protocol !== "https:"` or it silently breaks every `c:a`.
- **`c:a` navigation does not reliably update `window.location`** — if JS needs current
  filter/query state after `c:a` navigation, pass server-rendered state into the function
  instead of reading `window.location.search`.
- **Never edit markup or CSS with regex.** Read the region and hand-edit — regex surgery
  has repeatedly caused orphan closing tags and corrupted stylesheets.

Full details on each of these in `references/platform-facts.md`.
