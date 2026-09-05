# Browser JavaScript integrations

Use this reference only for browser-JS architecture or initialization. It describes verified
integration patterns, not a general server transport: PalBuilder server actions still use
`c:a action="..."` or another documented platform action tag. Never use `fetch` or ClientPal as
a substitute for the platform action path.

Browser scripts under `scripts/*.js` are modern browser JavaScript (modules, `let`/`const`,
Promises, and browser APIs). Workflow `.js` remains a separate restricted environment. Load
scripts from a page, never a fragment; fragments reject `<script>`, and AJAX insertion does not
rerun `DOMContentLoaded`.

## Main module and page modules

When an existing pal uses modules, retain its established entry module rather than inventing a
new architecture. A page-context main module can import only the browser modules it needs,
perform page-wide setup, and expose only workflow-callable functions on `window`. ES-module
imports are not global by themselves.

```js
// Scripts/console-main.js
import { listsUI } from "../Scripts/ux/lists.js";

window.listsUI = listsUI;

function init() {
    document.addEventListener("click", function(event) {
        if (event.target.closest("#navSideToggle")) {
            document.getElementById("navSideMenu").classList.toggle("open");
        }
    });
}

init();
window.appIsReady = true;
window.dispatchEvent(new CustomEvent("appReady"));
```

```html
<script type="module" src="../Scripts/console-main.js"></script>
```

A module can expose a compact public object. Keep browser-only DOM work there, and call it from
other modules through imports or from verified workflow-emitted code through the main module's
`window` export.

```js
export const listsUI = { refresh };

function refresh() {
    // Browser-only DOM update.
}
```

For one-time listeners on globals (`window`, `history`, document delegation), use an existing
project guard or an equivalent single-install guard so navigation/reinitialization cannot
duplicate listeners. Do not add a generic AJAX transport while doing so.

## Workflow-emitted browser code

Some existing integrations call browser functions through workflow-generated JavaScript. ES
modules load asynchronously, so such code can run before an exported function exists. If the pal
already needs this special integration, its workflow helper may defer code until the main module
signals readiness:

```js
function runJS(js) {
    payload.addJavascript(
        "if(window.appIsReady){" + js + "}" +
        "else{window.addEventListener('appReady', () => {" + js + "});}"
    );
}
```

This is a synchronization pattern for an existing browser-only integration, not an alternative
to `c:a action=...` for server requests. Keep emitted strings small and use it only after
checking the existing pal's helper and exposed globals.

## After AJAX fragment insertion

A newly inserted fragment does not trigger `DOMContentLoaded`. Put its initialization in a
page-loaded module and invoke its existing exported initializer after the platform action
returns. For example, if the page already loads Bootstrap and a module owns dropdown setup:

```js
export const generalUI = { initDropdowns };

function initDropdowns() {
    document.querySelectorAll('[data-bs-toggle="dropdown"]').forEach((element) => {
        new bootstrap.Dropdown(element);
    });
}
```

Only use this for widgets the existing resource set actually provides. Do not assume Bootstrap,
its globals, or a folder layout is present in every pal.
