# Workflow Responses

Every workflow's `run()` returns exactly one response. Four kinds exist: page, ajax,
download, and redirect. The action switch prepares the response (usually by setting the
`payload` global); the common tail attaches the payload and returns the response.

**Official API:**
- DownloadResponse — https://secure.cloudpiston.com/cpal/cp-api/web/DownloadResponse.html

Companion references:
- `palbuilder-data/references/payloads.md` — payload composition (what you attach)
- `errors.md` — error responses and unknown-action fallback

---

## The response types

| Type | Use for | Constructor |
|---|---|---|
| **Page** | Full-page load, first render, navigation | `c.getPage("<name>")` |
| **Ajax** | Fragment swap into a target div in an already-loaded page | `c.createAjaxResponse(...)` |
| **Download** | File returned as a browser download | `c.createDownloadResponse()` |
| **Redirect** | Send the browser elsewhere entirely | `c.redirect(url)` |

---

## Page

The default response for a first-load request. Pages are registered in `pal.json` with a
`palType` matching the workflow context (see
`palbuilder-core/references/pal-structure.md`).

```js
var page = c.getPage("dashboard");          // page name is REQUIRED
page.addPayload(payload);
return page;
```

**Return the page from `c.getPage(name)`, never `pal.getPage(name)`.** They are different
methods returning different classes: `c.getPage` (the controller) returns the runtime page —
a `WorkflowReturn` you can `return` from `run()`. `pal.getPage` returns the *design-model*
page (metadata only, for inspection), which is **not** a returnable response. Returning it
fails validation with `Function run returns unexpected type. Expected WorkflowResponse, found
Render` and throws `Invalid return type` at runtime. `c.getPage(name)` always requires a
name — there is no "default" page.

### Attaching to a fragment slot on the page

Pages often reserve slots for fragment content:

```js
payload.set("main", "dashboard");           // template: <c:fragment name="${main}"/>
page.addPayload(payload);
return page;
```

The page renders `<c:fragment name="${main}"/>` by looking up the fragment named
`"dashboard"` and rendering it. See `palbuilder-frontend` for the fragment side.

---

## Ajax

Ajax responses swap a fragment into a target div without reloading the page. The typical
common-tail pattern:

```js
if (request.isAjax()) {
    if (ajax == null) {
        ajax = c.createAjaxResponse("ignore", false);
    }
    ajax.addPayload(payload);
    return ajax;
}
```

`c.createAjaxResponse` has several forms:

```js
// Ignore — no fragment update, just a payload for JS to read
var ajax = c.createAjaxResponse("ignore", false);

// Named fragment — replace the ajax-target div with this fragment
ajax = c.createAjaxResponse(pal.getAjaxFragment("dashboard"), true);

// Null fragment — same effect as "ignore"
ajax = c.createAjaxResponse(null, false);
```

The **first argument** is the fragment to render (or `"ignore"` / `null` for no swap).
`pal.getAjaxFragment(name)` looks up a fragment by name.

The **second argument** is a boolean — behavior is context-dependent; the common pattern is
`true` for fragment swaps and `false` for ignore/null.

### The "ignore" fallback

`c.createAjaxResponse("ignore", false)` is the unknown-action default. When the action switch
falls through to `default: break;` and no handler sets `ajax`, the common tail creates an
ignore response — no fragment update, just a payload for the browser JS to read (or ignore).

**Never respond with an error string to an unknown action.** Silent ignore is the correct
default. See `errors.md`.

---

## Download

`c.createDownloadResponse()` returns content to the browser as a file download. Two ways to
seed the content:

- **`setFileContent(file)`** — the common case. Pass an existing file (image, PDF, CSV,
  attachment) directly.
- **`setFragmentContent(fragment, filename, ???)`** — render a fragment as the download body
  (HTML → optionally PDF). Rarely used in practice.

### `setFileContent` — file-based download

```js
function downloadInvoice() {
    var download = c.createDownloadResponse();
    var file = pal.getAttachment("invoice-2026-04.pdf");   // or getImage, etc.
    download.setFileContent(file);
    resp = download;
}
```

This is the preferred pattern for any file that already exists in the pal (attachments,
images, generated PDFs saved to storage). Set `resp` and let the common tail return it.

### `setFragmentContent` — render-based download

Because it bypasses the common tail's payload attach, **seed the payload directly on the
download** — otherwise the fragment renders empty:

```js
function exportReport() {
    var download = c.createDownloadResponse();
    download.addPayload(payload);                                  // seed BEFORE returning
    download.setFragmentContent(
        pal.getAjaxFragment("report-pdf"),
        "seo-report.html",                                          // filename
        true                                                        // third-arg semantic to verify
    );
    resp = download;
}
```

For the full DownloadResponse API surface (additional setters, headers, MIME control), see
the official docs: https://secure.cloudpiston.com/cpal/cp-api/web/DownloadResponse.html

---

## Redirect — `c.redirect(url)`

`c.redirect(url)` is the standard redirect — sends the browser to another URL. Works in any
workflow context.

```js
function doRedirect(redirectAction) {
    var url = pal.getSecureWebUrl(redirectAction + ".do");
    resp = c.redirect(url);
}
```

`pal.getSecureWebUrl(action)` builds a URL that points at the pal's own workflow entry for a
given action — the typical pattern for internal navigation. For arbitrary external URLs, pass
the URL directly.

### Ajax-aware redirect (real-world pattern)

Redirecting from an ajax handler doesn't do anything useful — the browser only sees a
payload update, not a navigation. The GiftHub pattern handles both cases:

```js
function doRedirect(redirectAction, forcePageReload, interimFrag, feedbackData) {
    if (interimFrag == null) { interimFrag = "common/loading"; }
    if (forcePageReload == null) { forcePageReload = false; }

    if (request.isAjax()) {
        // Ajax path — show a loading fragment and let client JS do the redirect
        getAjax(interimFrag);
        runJS("historyManager.redirect('" + redirectAction + "', '" + forcePageReload + "');");
        if (feedbackData) {
            feedbackData.addPrefix("feedback", true);
            data.addData(feedbackData);      // message, header, delay
        }
        request.setSessionData("redirect", data);
        return;
    }

    // Non-ajax path — real server redirect
    var url = pal.getSecureWebUrl(redirectAction + ".do");
    resp = c.redirect(url);
}
```

This pattern shows the two halves:
- **Ajax:** render an interim fragment and inject client-side JS that does the redirect via
  the browser's history manager.
- **Non-ajax:** just `c.redirect(url)`.

---

## `c.exitToWeb` — Console webservice integrations only

`c.exitToWeb(url, method)` is **only available in console workflows** and exists primarily
for **integration with console web services**. From the API docs:

> Forces an exit, redirecting the user to the specified URL, optionally sending any data set
> in a Data object associated with this Response object. Any use outside webservice
> integrations is not automatic — the user sees a page with the URL and has to click the
> link.

For anything other than a console-webservice handoff, use `c.redirect(url)` instead — it
performs a proper immediate redirect.

```js
// Console-webservice integration (correct use)
case "exitToWebService":
    return c.exitToWeb(
        c.getEnterprise().getGlobalSetting("exitUrl"),
        "post"
    );

// User-facing "go to another page" — DON'T use exitToWeb here
// Use c.redirect(url) instead
```

---

## The common-tail pattern

Every `run()` ends the same way — pick the response based on request type and return it:

```js
// If a handler set resp (download, redirect, etc.), return it and stop
if (resp != null) {
    return resp;
}

// Ajax path
if (request.isAjax()) {
    if (ajax == null) {
        ajax = c.createAjaxResponse("ignore", false);
    }
    ajax.addPayload(payload);
    return ajax;
}

// Page path (default)
page.addPayload(payload);
return page;
```

**Precedence** — `resp` (set by a handler for special responses) beats ajax beats page. The
first branch that fires returns.

---

## Common gotchas

- **`c.getPage(name)` requires a name.** No empty-string default — always pass the specific
  registered page name.
- **`createDownloadResponse` with `setFragmentContent` bypasses the common tail's
  `addPayload`.** Attach the payload directly on the download object before returning it.
  `setFileContent` does not need a payload — it's file-based.
- **`c.redirect(url)` is the proper redirect.** `c.exitToWeb` is console-only and specialized
  for webservice integrations — using it for normal navigation shows the user a click-through
  page.
- **Redirecting from an ajax handler does nothing** unless you handle it explicitly (see the
  ajax-aware redirect pattern above). Bare `c.redirect(url)` inside an ajax action is
  ignored by the browser.
- **Return a page via `c.getPage(...)`, not `pal.getPage(...)`.** `pal.getPage` returns the
  design-model page (a `PalFile`, for metadata/inspection), which is not a returnable
  response — `return`ing it fails validation (`Expected WorkflowResponse, found Render`) and
  throws `Invalid return type` at runtime. The controller's `c.getPage(...)` returns the
  runtime page (a `WorkflowReturn`) that `run()` can return.
