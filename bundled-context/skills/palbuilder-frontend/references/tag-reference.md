# PalBuilder `c:` Tag Reference (frontend)

Exhaustive per-tag docs for Palbuilder front-end markup. Open this when you need a specific tag's
valid attributes or a worked example. The core rules (pages vs fragments, XHTML, binding, fragment
architecture) live in the skill's SKILL.md.

Every `c:` tag has a fixed set of valid attributes. Using any attribute not in the documentation throws
a Palbuilder validation error. Check the docs before using an attribute you haven't used before.

Official reference: https://secure.cloudpiston.com/cpal/cp-api/console-tags/summary.html

---

### `c:a` — Navigation & Action Link

The primary tag for all server-triggered actions. Renders as an `<a>` element.

```html
<!-- Navigate to an action (optionally naming the target workflow) -->
<c:a action="getDashboard" workflow="console" class="sidebar-item ${dashboard_active}">Dashboard</c:a>

<!-- Load a fragment into a div via AJAX -->
<c:a action="editLogo" ajax-target="modalContent" class="action-link">Edit</c:a>

<!-- Pass a query string parameter -->
<c:a action="getCampaign?id=${campaign.id}">View</c:a>

<!-- Confirmation dialog before firing -->
<c:a action="deleteCampaign" confirm="Are you sure?">Delete</c:a>

<!-- Run a JS validation function first; must return true/false -->
<c:a action="saveCampaign" validate="validateCampaignForm">Save</c:a>

<!-- Conditional rendering -->
<c:a action="editItem" test="${canEdit}" show="true">Edit</c:a>
```

Navigation idiom: nav links carry `workflow=` and an active-class variable (`${dashboard_active}`,
set via `c:set` in the workflow) so the current item highlights.

**Valid attributes:** `action`, `href`, `name`, `id`, `class`, `style`, `ajax-target`, `validate`,
`confirm`, `test`, `show`, `ajax-handler`, `over-class`, `out-class`, `title`, `plainURL`, `media`,
`type`, `workflow`

**`onclick` is NOT valid on `c:a`.** For JS-only actions, use `<button onclick="fn()">` or
`<a href="#" onclick="fn(); return false;">`.

**`test`** conditionally renders any element, not just `c:` tags:

```html
<div test="${campaign.status eq 'draft'}"><p>This campaign is still a draft.</p></div>
```

---

### `c:resource` — Load a Versioned Platform Library

Loads a platform-hosted CSS/JS library into `<head>` by `source` + `version` + `name`. Used in every
page for Bootstrap, jQuery, Chart.js, icons, etc.

```html
<c:resource source="bootstrap" version="5.3.5" name="bootstrap-min.css"/>
<c:resource source="jquery-core" version="3.4.1" name="jquery-min.js"/>
<c:resource source="bootstrap-icons" name="bootstrap-icons.css" version="1.11.3"/>
<c:resource source="chartjs" name="chart.js" version="4.0.0"/>
```

Project-local CSS/JS still load with plain `<link rel="STYLESHEET" .../>` and
`<script src="../Scripts/...">` (note the `../Styles/` and `../Scripts/` relative paths).

---

### `c:debug` — Debug Panel Marker

A `<c:debug/>` placed in the page body renders the PalBuilder debug panel during development. Commonly
the last child of `cp-root`. (This is a markup tag — distinct from the back-end `c.debug()` method.)

```html
<div id="cp-root">
    ...
    <c:debug/>
</div>
```

---

### `c:upload` — File Upload Control

Renders an upload widget that handles its own submission — do not pair it with a separate Save button.

```html
<c:upload action="saveLogo" allow="image" ajax-target="feedback" />
<c:upload action="processDoc" allow="pdf" limit="300" />
<c:upload action="processUpload" allow="office" validate="preCheck" uploadText="Continue" />
```

**Valid attributes:** `action`, `ajax-handler`, `limit`, `allow` *(required)*, `style`, `class`,
`test`, `silent`, `stylesheet`, `uploadText`, `ajax-target`, `multiple`, `fragment`, `script`,
`validate`, `cancelAction`, `cancelText`, `provider`, `providerSettings`, `head`, `workflow`

**Rules:**
- `allow` is **required**; values are keywords (`image`, `pdf`, `word`, `office`, …), NOT MIME strings.
- `name` and `accept` are NOT valid attributes.
- Only one `c:upload` per page.

---

### `c:list` — Iteration

Iterates a server-provided DataList. Requires `name` + `id`. Access row columns with direct EL property
syntax `${id.columnName}` — **not** `.getValue('...')`.

```html
<!-- real: GiftHub/fragments/exchange/invite.html -->
<c:list name="friends" id="f">
    <c:div test="${!f.isInvited}" data-friendid="${f.friendId}">
        <p>${f.firstName} ${f.lastName}</p>
    </c:div>
</c:list>
```

String-based list (delimited string, not a DataList):

```html
<c:list name="tags" id="tag" list="${tagString}" row-delim="," col-delim="|">
    <span>${tag.get('col0')}</span>
</c:list>
```

**Valid attributes:** `name` *(required)*, `id` *(required)*, `odd`, `even`, `toggle`, `list`,
`query`, `row-delim` *(required if list used)*, `col-delim` *(required if list used)*

---

### `c:field` — Form Inputs (the default for bound inputs and selects)

`c:field` is the standard form element — used heavily in real pals (one enterprise pal uses it 296×).
Use it for text inputs, checkboxes, and especially `type="option"` inside a `<select>`. Written with an
explicit close tag.

```html
<!-- real: Onboarding Express -->
<select name="employmentStatus" class="form-select form-select-lg" required="true">
    <c:field type="option" value="employed" name="Employed" selected="${employmentStatus eq 'employed'}"></c:field>
    <c:field type="option" value="retired" name="Retired" selected="${employmentStatus eq 'retired'}"></c:field>
</select>

<c:field type="text" name="firstName" value="${firstName}" />
<c:field type="checkbox" name="active" value="true" checked="${active eq 'true'}" />
```

Plain `<input />` is fine for purely static, unbound markup, but reach for `c:field` first when a value
is server-bound or it's a `<select>` option.

**Valid attributes:** `name` *(required)*, `type` *(required)*, `id`, `style`, `value`, `checked`,
`class`, `selected`, `test`, `disabled`, `size`, `maxlength`, `rows`, `cols`, `onclick`, `onblur`,
`onchange`, `onfocus`, `readonly`, `placeholder`, `required`, `autocomplete`, `autofocus`, and others.

---

### `c:set` — Set a Variable

```html
<c:set name="display" value="none" />
<c:set name="activeClass" test="${active eq 'dashboard'}" true="active" false="" />
<c:a action="getDashboard" class="sidebar-item ${activeClass}">Dashboard</c:a>
```

**Valid attributes:** `name` *(required)*, `value`, `test`, `true` *(required if test used)*,
`false` *(required if test used)*, `map`

---

### `c:if` — Conditional Block

```html
<c:if test="${campaign.status eq 'draft'}">
    <c:a action="editCampaign" class="action-link">Edit</c:a>
</c:if>
```

**Valid attributes:** `test` *(required)*

---

### `c:choose` / `c:when` / `c:otherwise` — Multi-Branch Conditional

```html
<c:choose>
    <c:when test="${status eq 'sent'}"><span class="badge">Sent</span></c:when>
    <c:when test="${status eq 'draft'}"><span class="badge">Draft</span></c:when>
    <c:otherwise><span class="badge">Scheduled</span></c:otherwise>
</c:choose>
```

---

### `c:fragment` — Insert a Named Fragment

Inserts a named fragment. The server resolves it first from what the workflow set, then from the pal's
files. Names are folder paths (e.g. `console/navbar`).

```html
<c:fragment name="console/navbar" />
<c:fragment name="${frag}" />
<c:fragment name="cloudpiston/ui/modalShell" />
```

**Valid attributes:** `name` *(required)*, `test`

---

### `c:download` — File Download Link

```html
<c:download action="exportContacts">Export CSV</c:download>
<c:download action="getPdf?id=${doc.id}" value="Download PDF" />
```

**Valid attributes:** `action`, `test`, `id`, `style`, `class`, `title`, `value`, `workflow`, `validate`

---

### Other real `c:` tags

- **`c:div`** — a `<div>` that accepts `c:` attributes like `test=` directly:
  `<c:div test="${!f.isInvited}" class="col-6" data-friendid="${f.friendId}">…</c:div>`
- **`c:get`** — emit a server value in markup.
- **`c:image`** / **`c:button`** / **`c:select`** — `c:`-aware variants of `<img>` / `<button>` /
  `<select>` used when the element needs server-side processing.

---

### `c:ignore` — Suppress Wrapper Element

Wraps content without emitting any HTML element. Holds the namespace declaration on fragment files.

```html
<c:ignore xmlns:c="contractpal">
    <div>content here</div>
</c:ignore>
```
