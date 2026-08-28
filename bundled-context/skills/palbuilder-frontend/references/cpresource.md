# CPResource — Bundled UI Libraries (lib-ui, lib-paging, validation)

Separate from the third-party libraries loaded via `c:resource` (Bootstrap, Chart.js, D3,
TinyMCE, Font Awesome — see `c-tags.md`), the platform ships its own bundle of "home-made"
building blocks: workflow libraries, client scripts, and fragments for modals, toasts,
inline alerts, loading indicators, form validation, paging, and a searchable datalist
widget. Together these are referred to as **CPResource**. They're built on top of Bootstrap 5.
(Older pals may use an older version based on bootstrap 3, these files are usually outside of the /v5 folder,
some version 3 materials are still compatible with v5)

Unlike `c:resource`, CPResource pieces are pulled in individually, each with its own
mechanism: workflow libraries via `@include`, client behavior via plain `<script>` tags,
presentation via a plain `<link>` stylesheet, markup via `<c:fragment>`. There's no single
tag that loads "all of CPResource" — a pal takes only the pieces it uses.

**This is a snapshot, not a fixed API.** CloudPiston Resource is an ordinary pal on the server
(reached via the pal chain — see `pal-chain.md`) and can change independent of this doc: a
function signature, default, or fragment path documented below may have moved on since this was
last verified. Before depending on a specific function/fragment/file named here, confirm it in
the live extraction at `.resources/<cloudpiston-resource-slug>/` (refresh with `pal_resources` if
it looks stale) rather than trusting this doc alone.

Companion:
- `palbuilder-core/references/pal-chain.md` — what CloudPiston Resource IS (a cloud-wide system
  pal reachable via the pal chain), what else it carries beyond lib-ui/lib-paging (demo pages,
  other fragments/libraries under `cloudpiston/`), where it lands on disk (`.resources/`), and
  when to ask vs infer whether a pal should use it. Read that first if you're new to the concept.
- `palbuilder-workflow/references/libraries.md` — the general `@include` mechanism these
  workflow libraries use
- `SKILL.md` — the main-file + modules pattern and `runJS()`, which is how workflow code
  safely calls the client-side functions below after page load
- `c-tags.md` — `c:resource` for third-party bundled libraries (Bootstrap, Chart.js, etc.)

---

## lib-ui — the core workflow library

Included like any other library workflow:

```js
//@include("cloudpiston/ui/v5/lib-ui");
```

(Older pals may include an equivalent path for Bootstrap 3 — match the version the pal's
markup and client scripts already target.) **lib-ui is used in almost every project** — it's
the standard way to trigger modals, toasts, inline alerts, and loading indicators from
workflow code.

Every function below returns or emits against the **global `ajax`/`payload` variables** —
per CLAUDE.md's reserved-globals convention, these libraries assume `ajax` and `payload`
already exist in the including workflow.

### AJAX response helper

```js
getAjax(name)   // name may be null/"" for an empty ajax response, or a fragment name
```
Builds (and returns) the `ajax` global via `c.createAjaxResponse`, resolving `name` to a
fragment if one is registered. Most of the functions below call this internally — you
usually don't need to call it directly unless you're building a custom ajax response.

### Modals

```js
showModal(content, size, focus, scrollable)
hideModal()
```
- **`content`** *(required)* — path to the modal-body fragment.
- **`size`** — `"sm"` / `"lg"` / `"xl"`, or `null` for default.
- **`focus`** — a jQuery selector (e.g. `"#inputId"`) to focus once shown, or `null`.
- **`scrollable`** — `true` puts the scrollbar on `.modal-body` instead of the page body.

Requires the `cloudpiston/ui/modalShell` fragment in the page shell (see Fragments below)
and the `lib-ui` client script. `hideModal()` pushes the client call via `payload`, not
`ajax` — call it from a handler that isn't already building a modal response.

### Confirmation popup

```js
popConfirm(continueAction, continueAjaxTarget, message, header, cancelAction, cancelAjaxTarget)
```
A pre-built confirm dialog (`continueAction` is the only required parameter; `header`
defaults to `"Confirm"`). Wraps `showModal` with the platform's static confirm-popup
fragment — you don't author your own confirm markup.

### FontAwesome icon shortcuts

```js
loadIcons()
```
Call once at the top of a workflow's `run()` to enable shorthand icon classes in markup:
`<i class="save"></i>`, plus `close`, `check`, `edit`, `delete`, `add`. Reads the pal-level
`cr-icons` DataList (see `palbuilder-data/SKILL.md` for pal-level DataLists) and pushes it
to the client as JSON.

### Toasts

```js
createToast(message, header, delay)
```
- **`message`** *(required)*.
- **`header`** — omitted entirely if not passed.
- **`delay`** — ms before auto-dismiss; default `5000`; `0` disables auto-dismiss (user must
  close it manually — a close button is always shown regardless of what you pass, even if
  you try to suppress it).

Requires the `cloudpiston/ui/static/v5/toastContainer` fragment (or any element with a
`toastContainer` id) present on the page.

### Inline alerts (span-targeted)

```js
getInlineAlert(type, message, target)   // type: 0 = success, 1 = fail
getSuccess(message, target)             // shortcut for getInlineAlert(0, ...)
getFail(message, target)                // shortcut for getInlineAlert(1, ...)
```
Builds an ajax response targeting a `<span>` with a matching id. If `target` is omitted, it
defaults to the current request's ajax target.

### Feedback alerts (add to an existing response)

```js
addFeedback(type, message, wrapper)   // type: 0 = success, 1 = fail
addSuccess(message, wrapper)
addFail(message, wrapper)
```
Unlike `getInlineAlert`, these don't build a new ajax response — they append client JS to
whichever response is already in flight (`ajax` if the request is ajax, `payload`
otherwise). `wrapper` is the id of the span wrapper already on the page.

### Popup alerts (modal-based)

```js
getPopupAlert(type, message, header)   // type: 0 = success, 1 = fail
popSuccess(message, header)
popFail(message, header)
```
Like `getInlineAlert` but rendered as a modal (always targets `modalContent`) instead of an
inline span — for a more prominent success/fail message.

### Form validation errors (workflow side)

```js
showFormErrors(data)
```
`data` is a `Data` object of `fieldName → errorMessage` pairs. Base64-encodes it and pushes
it to the client, where the paired client-side `showFormErrors` (see Client Scripts below)
decodes it and marks the matching inputs invalid. Pass `data.set("CR_VALIDATION_SCROLL",
true)` to have the client scroll to the first invalid field.

### Loading indicator

```js
showLoading(message, container)   // message defaults to "Loading..."
removeLoading()
```
`container` defaults to the current ajax target if the request is ajax, otherwise `"body"`.

### Scroll helpers

```js
crScrollTop(container)     // defaults to "_window" if omitted; scrolls an overflow-y element to its own top
crScrollTo(selector)       // scrolls the main page scrollbar to bring `selector` into view
```

### CR Datalist — searchable dropdown/autocomplete widget

A component for server-driven autocomplete/search-select inputs.

```js
initCrDatalist(dataOrPayload, b64Encoded)
```
Initializes the widget. `dataOrPayload` must set `container`, `name`, and `action` — plus
optional `value`/`labelValue` (pre-load a selection), `customClass` (adds a class to the
component's wrapper div for extra CSS/JS hooks), and `renderFn` (a global client function
`(row, index) => html` for custom option rendering). Use a `Payload` with multiple DataMaps
to initialize several CR datalist components from one call. `b64Encoded` defaults to `true`
— pass `false` only if you've already base64-encoded the data yourself.

```js
showCrDatalistOptions(datalist, label, value, subtext, b64Encoded)
```
Call from the action handler that answers a user query. `label` and `value` name the
DataList columns used as option label/submitted value (both required); `subtext` is
optional. `b64Encoded` here defaults to `false` — opt in explicitly if needed.

```js
showCrDatalistFragment(datalist, fragmentName)
```
Same purpose, but renders your own options fragment instead of the default markup. Each
option must be an `<li class="cr-datalist-option" data-value="..." data-label="...">`.

---

## lib-paging — paging/sorting shortcut

```js
//@include("cloudpiston/ui/lib-paging");
```

```js
buildPaging(dataSet, dataSetFilter, pageSize, pagingAction, ajaxTarget, listName, defaultSort, workflow)
```

Wraps the common "filtered, sorted, paged dataset list" pattern: applies paging/sorting to
`dataSetFilter`, fetches records, computes paging metadata (current/first/last/prev/next
page, a `p1..p4` pagination-control window), persists the active sort in session data keyed
by the paging action, and adds both the resulting DataList and a `paging` DataMap directly
to the global `payload`. Returns the fetched DataList.

- **`pagingAction`** — defaults to the current action if omitted.
- **`ajaxTarget`** — defaults to `"body"`.
- **`workflow`** — defaults to the current workflow name.
- **`defaultSort`** — pass a column name to enable sorting; omit to page without sort
  controls.
- **`listName`** — name the returned DataList; omit to use the dataset's own name (see
  `palbuilder-data/references/datasets.md` on `getRecords` naming).

Requires the `cloudpiston/ui/static/paging` fragment to render the paging controls the
`paging` DataMap describes.

---

## Client scripts and styles

Loaded once from the page, not from a fragment (CLAUDE.md rule: fragments can't contain
`<script>` — see `SKILL.md`):

```html
<script language="JavaScript" defer="defer" src="../Scripts/cloudpiston/ui/v5/lib-ui.js"></script>
<script language="JavaScript" defer="defer" src="../Scripts/cloudpiston/ui/v5/validation.js"></script>
```

**`lib-ui.js`** is the client-facing half of the lib-ui workflow library above —
`showModal`, `hideModal`, `createToast`, `showAlert`, `addFeedback`, `showLoading`,
`removeLoading`, `crScrollTop`, `crScrollTo`, `loadIcons`, `initCrDatalist`,
`showCrDatalistOptions`, `positionCrDatalist`, etc. all live here; the workflow-side
functions above are just typed wrappers that emit calls into this script via
`addJavascript(...)`.

**`validation.js`** provides client-side form validation, meant to be wired to a `c:a` /
`c:button`'s `validate` attribute:

```js
validateForm()                          // call this from validate="validateForm"
radioIsChecked(name)
bindClearEvent(name)
showFormErrors(data)                     // client-side pair of the workflow function above — decodes and displays
showValidationMessage()
crValidationScrollHandler(el)
```

`validateForm()` checks every `[required='true']` field (scoped to the open modal if one is
present), adds `is-invalid` to failing inputs, and shows any matching
`.invalid-feedback[data-feedback-for]` element. Add the feedback markup yourself:

```html
<div class="invalid-feedback">Your error message</div>
<!-- or, decoupled from DOM position: -->
<div class="invalid-feedback" data-feedback-for="fieldName">Your error message</div>
```

Two module-level flags configure behavior pal-wide:

```js
var CR_VALIDATION_SCROLL = false;   // set true (or via showFormErrors' data) to auto-scroll to the first invalid field
var CR_ALLOW_NON_ASCII = false;     // set true to allow non-ASCII input to pass validation
```

`validation.js` also globally limits any input carrying a `data-crmaxlength` attribute,
truncating on the `input` event — no extra JS needed per-field, just add the attribute:

```html
<input type="text" data-crmaxlength="50" .../>
```

### `lib-ui.css` — the accompanying stylesheet

```html
<link rel="STYLESHEET" type="text/css" href="../Styles/cloudpiston/ui/v5/lib-ui.css"/>
```

The third piece of the lib-ui bundle, alongside `lib-ui.js` and `validation.js`. It contains
a Bootstrap override layer plus the styling that the rest of this reference assumes is
already in place — most notably the `is-invalid`/`invalid-feedback` look that
`validateForm()`/`showFormErrors()` toggle, and the modal/toast/alert/loading-indicator
presentation `showModal`, `createToast`, `getInlineAlert`/`getPopupAlert`, and
`showLoading` all render into. Include it in the page `<head>` alongside the two scripts —
without it, the JS-driven behavior above still runs, but the modals, toasts, alerts, and
validation feedback it produces will be unstyled or will clash with the pal's own Bootstrap
theme.

---

## Fragments

```html
<c:fragment name="cloudpiston/ui/modalShell"/>
```
A single modal shell (`id="modalContent"`) that `showModal()` loads content into via ajax.
Include it once in the page shell (see `SKILL.md`'s page-shell example).

Other bundled fragments referenced above:
- `cloudpiston/ui/static/paging` — paging controls consumed by `buildPaging`'s `paging`
  DataMap.
- `cloudpiston/ui/static/v5/toastContainer` — toast container consumed by `createToast`;
  include once per page, same pattern as `modalShell`.
- `cloudpiston/ui/static/v5/confirmPopup` / `cloudpiston/ui/static/v5/alertPopup` — the
  static fragments `popConfirm` / `getPopupAlert` render into the modal shell. You don't
  author these yourself; they're rendered by the helper functions above.

---

## Common gotchas

- **`showFormErrors` exists twice, on purpose** — a workflow-side function (encodes `Data`
  to base64, pushes it) and a client-side function of the same name (decodes it, applies
  `is-invalid`/shows feedback). They're a matched pair, not a collision.
- **`hideModal()` uses `payload`, not `ajax`.** Calling it from code that's mid-way through
  building an `ajax` response won't do what you expect — it targets the next payload flush.
- **`createToast`'s "not dismissable" request is ignored.** A close button always renders;
  passing something meant to suppress it has no effect on purpose.
- **`c:upload` and CPResource's toast/modal system are unrelated** — don't confuse
  `showLoading`/`removeLoading` (a generic loading overlay) with upload-specific progress UI.
- **Both `modalShell` and `toastContainer` must be present in the page shell** before their
  respective helper functions are called — they don't lazily inject themselves.
- **Match Bootstrap major version across `c:resource` and CPResource client scripts.**
  CPResource is built against both Bootstrap 3 and 5; mixing a Bootstrap 5 `c:resource` with
  Bootstrap-3-targeted CPResource markup (or vice versa) breaks modal/dropdown behavior.
- **`initCrDatalist`'s `b64Encoded` defaults to `true`; `showCrDatalistOptions`'s defaults to
  `false`.** The two functions don't share a default — check which one you're calling.
- **`lib-ui.css` isn't optional polish.** The JS toggles classes (`is-invalid`, modal/toast
  show states, etc.) that only look right with `lib-ui.css` loaded — functionality works
  without it, but forgetting the stylesheet reads as a bug (unstyled modals, invisible toast
  positioning, missing invalid-field styling), not a missing feature.
