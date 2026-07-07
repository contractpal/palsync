# `c:` Tag Reference — Full Attribute Lists

This is the authoritative source for **which attributes each `c:` tag accepts**. Using any
attribute not listed here (or in the official tag reference linked below) throws a validation
error — CLAUDE.md rule 2.

**Official tag reference:** https://secure.cloudpiston.com/cpal/cp-api/console-tags/summary.html

When in doubt, check the official reference too — this file captures the common cases
verified in production pals; the official docs are the source of truth for edge cases and
new attributes added since this reference was written.

---

## `c:debug` — Debug Panel

Placed inside `#cp-root` (typically as the last child). Renders the platform debug panel in
dev builds. No attributes.

```html
<c:debug/>
```

**Distinct from the workflow `c.debug()` method** — this is a template tag; that's a
server-side logging call.

---

## `c:a` — Action / Navigation Link

Renders as an `<a>` element that fires a server action or navigates.

```html
<!-- Basic action -->
<c:a action="getDashboard">Dashboard</c:a>

<!-- Navigate to a specific workflow -->
<c:a action="getDashboard" workflow="console" class="sidebar-item">Dashboard</c:a>

<!-- Load a fragment into a div via AJAX -->
<c:a action="editLogo" ajax-target="modalContent">Edit</c:a>

<!-- Pass a querystring parameter -->
<c:a action="getCampaign?id=${campaign.id}">View</c:a>

<!-- Confirmation dialog before firing -->
<c:a action="deleteCampaign" confirm="Are you sure?">Delete</c:a>

<!-- Run a JS validate function first (must return true/false) -->
<c:a action="saveCampaign" validate="validateCampaignForm">Save</c:a>

<!-- Conditional render -->
<c:a action="editItem" test="${canEdit}">Edit</c:a>
```

**Valid attributes:** `action`, `href`, `name`, `id`, `class`, `style`, `ajax-target`,
`ajax-handler`, `validate`, `confirm`, `test`, `show`, `over-class`, `out-class`, `title`,
`plainURL`, `media`, `type`, `workflow`

**Not valid on `c:a`:**
- **`onclick`** (CLAUDE.md rule 5) — use `<button onclick="fn()">` or
  `<a href="#" onclick="fn(); return false;">` for JS-only behavior

**Navigation caveat:** `c:a` navigation does not reliably update `window.location`. Browser
JS that needs current query/filter state after a `c:a` click must receive that state from
server-rendered values instead of reading `window.location.search`. See
`platform-facts.md`.

**`test` is a universal attribute** — it conditionally renders any element, not just `c:`
tags: `<div test="${status eq 'draft'}">...</div>` works.

---

## `c:resource` — Load a Platform Library

Loads a versioned platform-hosted CSS/JS library into `<head>` by `source` + `version` +
`name`. Used for Bootstrap, jQuery, Chart.js, icons, etc.

```html
<c:resource source="bootstrap" version="5.3.5" name="bootstrap-min.css"/>
<c:resource source="jquery-core" version="3.4.1" name="jquery-min.js"/>
<c:resource source="bootstrap-icons" version="1.11.3" name="bootstrap-icons.css"/>
<c:resource source="chartjs" version="4.0.0" name="chart.js"/>
```

**Valid attributes:** `source` *(required)*, `version` *(required)*, `name` *(required)*

**For project-local CSS/JS**, use plain `<link>` and `<script>` (with `../Styles/` and
`../Scripts/` relative paths) — `c:resource` is only for platform-hosted libraries.

---

## `c:upload` — File Upload Widget

Renders an upload widget that handles its own submission. Do NOT pair with a separate Save
button.

```html
<c:upload action="saveLogo" allow="image" ajax-target="feedback"/>
<c:upload action="processDoc" allow="pdf" limit="300"/>
<c:upload action="processUpload" allow="office" validate="preCheck" uploadText="Continue"/>
```

**Valid attributes:** `action`, `ajax-handler`, `limit`, `allow` *(required)*, `style`,
`class`, `test`, `silent`, `stylesheet`, `uploadText`, `ajax-target`, `multiple`, `fragment`,
`script`, `validate`, `cancelAction`, `cancelText`, `provider`, `providerSettings`, `head`,
`workflow`

**Rules:**
- **`allow` is required.** Values are keywords: `"image"`, `"pdf"`, `"word"`, `"office"`,
  `"document"`, etc. NOT MIME strings like `"image/*"`.
- **`name` and `accept` are NOT valid attributes** on `c:upload`.
- **Only one `c:upload` per page.** Multiple uploads require separate pages or fragments.
- **Styling only passes through via the `stylesheet` attribute.** The widget renders inside
  an iframe — inline `style="..."` and `class="..."` on the tag do not reach the widget's
  internal DOM. Point `stylesheet` at a CSS file that styles the upload UI:

```html
<c:upload action="saveLogo" allow="image" stylesheet="../Styles/upload-theme.css"/>
```

---

## `c:list` — Iteration

Iterates a server-provided DataList. `name` (the DataList's name) and `id` (the loop variable
name) are both required.

### DataList form — direct EL property access

Access row columns with `${loopId.columnName}` — **not** `.getValue('...')`.

```html
<c:list name="friends" id="f">
    <c:div test="${!f.isInvited}" data-friendid="${f.friendId}">
        <p>${f.firstName} ${f.lastName}</p>
    </c:div>
</c:list>
```

### Delimited-string form — `.get('colN')`

For a plain delimited string (not a DataList), `list` + `row-delim` + `col-delim` are
required. Column access uses `.get('col0')`, `.get('col1')`, etc.

```html
<c:list name="tags" id="tag" list="${tagString}" row-delim="," col-delim="|">
    <span>${tag.get('col0')}</span>
</c:list>
```

**Valid attributes:** `name` *(required)*, `id` *(required)*, `odd`, `even`, `toggle`,
`list`, `query`, `row-delim` *(required if `list` used)*, `col-delim` *(required if `list`
used)*

---

## `c:field` — Bound Form Inputs

The standard form-input tag for text, checkbox, and especially `type="option"` inside a
`<select>`. Uses an explicit close tag.

```html
<!-- Text input -->
<c:field type="text" name="firstName" value="${firstName}"/>

<!-- Checkbox — checked binds to a boolean-string comparison -->
<c:field type="checkbox" name="active" value="true" checked="${active eq 'true'}"/>

<!-- Select options -->
<select name="employmentStatus" class="form-select" required="true">
    <c:field type="option" value="employed" name="Employed"
             selected="${employmentStatus eq 'employed'}"></c:field>
    <c:field type="option" value="retired" name="Retired"
             selected="${employmentStatus eq 'retired'}"></c:field>
</select>
```

Plain `<input/>` is fine for purely static, unbound markup. Reach for `c:field` first when a
value is server-bound or you're writing `<select>` options.

**Valid attributes:** `name` *(required)*, `type` *(required)*, `id`, `style`, `value`,
`checked`, `class`, `selected`, `test`, `disabled`, `size`, `maxlength`, `rows`, `cols`,
`onclick`, `onblur`, `onchange`, `onfocus`, `readonly`, `placeholder`, `required`,
`autocomplete`, `autofocus`

(`onclick` and other event attributes are valid on `c:field` — this is the exception. On
`c:a`, `onclick` is NOT valid.)

---

## `c:set` — Set a Template Variable

```html
<c:set name="display" value="none"/>
<c:set name="activeClass" test="${active eq 'dashboard'}" true="active" false=""/>
<c:a action="getDashboard" class="sidebar-item ${activeClass}">Dashboard</c:a>
```

**Valid attributes:** `name` *(required)*, `value`, `test`, `true` *(required if `test`
used)*, `false` *(required if `test` used)*, `map`

Use the `test`/`true`/`false` form for conditional string assignment (a common pattern for
active-class variables).

---

## `c:if` — Conditional Block

```html
<c:if test="${campaign.status eq 'draft'}">
    <c:a action="editCampaign" class="action-link">Edit</c:a>
</c:if>
```

**Valid attributes:** `test` *(required)*

---

## `c:choose` / `c:when` / `c:otherwise` — Multi-Branch Conditional

```html
<c:choose>
    <c:when test="${status eq 'sent'}"><span class="badge">Sent</span></c:when>
    <c:when test="${status eq 'draft'}"><span class="badge">Draft</span></c:when>
    <c:otherwise><span class="badge">Scheduled</span></c:otherwise>
</c:choose>
```

**Valid attributes:**
- `c:choose` — no attributes
- `c:when` — `test` *(required)*
- `c:otherwise` — no attributes

---

## `c:fragment` — Insert a Named Fragment

Inserts a named fragment. The server resolves the name first from what the workflow set,
then from the pal's files. Names are folder paths (`console/navbar`).

```html
<c:fragment name="console/navbar"/>
<c:fragment name="${frag}"/>
<c:fragment name="cloudpiston/ui/modalShell"/>
```

**Valid attributes:** `name` *(required)*, `test`

---

## `c:download` — File-Download Link

```html
<c:download action="exportContacts">Export CSV</c:download>
<c:download action="getPdf?id=${doc.id}" value="Download PDF"/>
```

**Valid attributes:** `action`, `test`, `id`, `style`, `class`, `title`, `value`, `workflow`,
`validate`

The workflow action returns a download response — see
`palbuilder-workflow/references/responses.md` for `createDownloadResponse` and
`setFileContent`.

---

## `c:ignore` — Suppress Wrapper Element

Wraps content without emitting any HTML element in the output. The canonical wrapper for
fragment files — it holds the namespace declaration but doesn't add a `<div>`.

```html
<c:ignore xmlns:c="contractpal">
    <div>Fragment content — my own root element</div>
</c:ignore>
```

**Valid attributes:** `xmlns:c` (the namespace declaration; required on fragment files)

---

## `c:div` — c-aware `<div>`

A `<div>` that accepts `c:` attributes directly. Two uses:

**1. Conditional rendering** (the common case) — no `<c:if>` wrapper needed:

```html
<c:div test="${!f.isInvited}" class="col-6" data-friendid="${f.friendId}">
    <p>${f.firstName}</p>
</c:div>
```

**2. Clickable div** — fires a workflow action when clicked (or on other DOM events). The
`eventType` attribute is REQUIRED when `action` is present — it names the DOM event that
triggers the action:

```html
<!-- Clicking the card fires selectItem?id=... via ajax -->
<c:div action="selectItem?id=${item.id}"
       ajaxTarget="details"
       eventType="onclick"
       class="item-card">
    <h3>${item.name}</h3>
</c:div>

<!-- Multiple events, comma-separated -->
<c:div action="highlight?id=${item.id}"
       eventType="onclick,onmouseover"
       class="hoverable-card">
    ...
</c:div>
```

**Valid attributes:** `test`, `action`, `ajaxTarget`, `eventType` *(required with `action`)*,
`validate`, `confirm`, `workflow`, plus any standard HTML `<div>` attribute (`class`,
`style`, `id`, `data-*`).

`eventType` values are the DOM event names without the "on" prefix stripped — use
`"onclick"`, `"onmouseover"`, `"onmouseout"`, `"ondblclick"`, etc. Comma-separated for
multiple.

---

## `c:tr` — c-aware `<tr>`

A `<tr>` (table row) that accepts `c:` attributes. Most commonly used to make table rows
clickable — same pattern as clickable `c:div`:

```html
<table class="data-table">
    <c:list name="orders" id="o">
        <c:tr action="viewOrder?id=${o.orderId}"
              ajaxTarget="body"
              eventType="onclick"
              class="clickable-row">
            <td>${o.orderId}</td>
            <td>${o.customer}</td>
            <td>${o.total}</td>
        </c:tr>
    </c:list>
</table>
```

**Valid attributes:** `test`, `action`, `ajaxTarget`, `eventType` *(required with `action`)*,
`validate`, `confirm`, `workflow`, plus any standard `<tr>` attribute.

---

## `c:button` — c-aware `<button>`

Same pattern as `c:div` for buttons.

```html
<c:button action="openSocket" value="Open Socket"/>
<c:button action="pingSocket" value="Ping Socket" validate="ping()"/>
```

`validate="fn()"` runs the client-side function before submit; if it returns `false`, the
submit is suppressed (useful for handing off to a WebSocket, chat handler, etc.).

**Valid attributes:** `action`, `value`, `class`, `style`, `id`, `validate`, `test`, plus
standard `<button>` attributes.

---

## `c:select` — c-aware `<select>`

A `<select>` that accepts `c:` attributes. Combines naturally with `c:field type="option"`
for its options. Can fire a workflow action when the selection changes.

```html
<!-- Plain bound select — no action -->
<c:select name="status" class="form-select">
    <c:field type="option" value="draft" name="Draft" selected="${status eq 'draft'}"></c:field>
    <c:field type="option" value="sent" name="Sent" selected="${status eq 'sent'}"></c:field>
</c:select>

<!-- Action on change — filter picker that reloads a fragment -->
<c:select name="statusFilter"
          action="filterOrders"
          ajaxTarget="orderList"
          eventType="onchange"
          class="form-select">
    <c:field type="option" value="all" name="All"></c:field>
    <c:field type="option" value="open" name="Open"></c:field>
    <c:field type="option" value="closed" name="Closed"></c:field>
</c:select>
```

`eventType="onchange"` is the common choice for `c:select` — fires the action when the user
picks a new option. The workflow reads the selected value from the request data using the
select's `name`.

**Valid attributes:** `name`, `class`, `style`, `id`, `test`, `action`, `ajaxTarget`,
`eventType` *(required with `action`)*, `validate`, `workflow`, plus standard `<select>`
attributes (`multiple`, `disabled`, `required`, etc.).

---

## `c:image` — c-aware `<img>`

For server-processed images (versioned resources, dynamic src).

```html
<c:image source="uploads" name="${logo.id}" class="brand-logo"/>
```

Exact attribute set varies by use case — consult the official tag reference for the full
list.

---

## `c:get` — Emit a Server Value

```html
<c:get name="user.firstName"/>
```

Rarely used — direct EL binding (`${user.firstName}`) is nearly always preferred. `c:get`
exists for cases where the emitted value needs specific server-side processing that EL
alone doesn't provide.

---

## Universal attributes

Some attributes appear on nearly every `c:` tag:

- **`test="${expr}"`** — conditional render. If the expression is false, the tag is omitted
  entirely. Works on both `c:` tags and plain HTML elements.
- **`class`** and **`style`** — standard CSS. `class` values interpolate EL:
  `class="badge ${statusClass}"`.
- **`id`** — standard HTML id.

---

## Rule of thumb — check before you use

CLAUDE.md rule 2 is not gentle: **using any attribute not documented for a tag is a build
error**, not a warning. If you're about to type an attribute you haven't verified for that
specific tag, check this reference (or the official docs) first.

If an attribute you need genuinely doesn't exist, look for a different approach — server-side
`c:set` to prepare the value, or an alternative tag — before assuming you can add the
attribute anyway.
