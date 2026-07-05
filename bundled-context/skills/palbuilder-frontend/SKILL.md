---
name: palbuilder-frontend
description: "Front-end code for a PalBuilder (CloudPiston) pal: page-shell vs fragment, c: tag usage and valid attributes (c:a, c:resource, c:field, c:list, c:fragment, c:debug, and more), fragment architecture, XHTML rules, modal patterns, JS conventions. Trigger when writing pages, HTML fragments, modals, navigation, or any PalBuilder markup; visual styling defers to the design skill."
---

# Front-End Palbuilder Coding Skill

Read this file before writing any Palbuilder page or fragment.

Tag reference: https://secure.cloudpiston.com/cpal/cp-api/console-tags/summary.html

**Scope:** this skill covers **structure and `c:` tag mechanics**. It is intentionally light on CSS
and visual class names — match the pal's existing design system, and defer look-and-feel decisions to
the design skill. The examples here use real classes from real pals only to keep the markup realistic;
don't treat any specific class name as a Palbuilder requirement.

This skill covers the **Console** workflow (authenticated) and the **Web** workflow (open internet).

**This skill is split:** the core rules below are what you always need. Two companion references hold
the exhaustive detail — open them on demand:
- **Full tag reference** (per-tag attributes + examples for every `c:` tag): `references/tag-reference.md`
  — read it when you need a specific tag's attributes.
- **Modal pattern + JavaScript conventions**: `references/js-and-patterns.md` — read it when building a
  modal fragment or writing fragment JS.

---

## Pages vs Fragments — different files, different rules

A **page** is a complete HTML document and the entry point for a workflow's response. A **fragment** is
a partial loaded into a page (via AJAX `ajax-target`, or `<c:fragment>`). They are NOT interchangeable.

**Every new PAGE uses the full shell:** `<html xmlns:c>` / `<head>` (resources) / `<body>` with a
`<div id="cp-root">` that holds `<c:fragment>` slots. A page without `<html>/<head>/<body>` is rejected
by the server ("No body tag found, cannot save without losing content").

```html
<!-- pages/console.html — the page shell (real: GiftHub) -->
<html xmlns:c="contractpal">
    <head>
        <title>GiftHub</title>
        <meta name="viewport" content="minimum-scale=1.0, width=device-width, maximum-scale=0.6667"/>
        <c:resource source="bootstrap" version="5.3.5" name="bootstrap-min.css"/>
        <c:resource source="jquery-core" version="3.4.1" name="jquery-min.js"/>
        <link rel="STYLESHEET" type="text/css" href="../Styles/console.css"/>
        <script language="JavaScript" type="module" src="../Scripts/console-main.js"></script>
    </head>
    <body>
        <div id="cp-root">
            <div id="nav"><c:fragment name="console/navbar"/></div>
            <div id="body"><c:fragment name="${frag}"/></div>     <!-- swappable content area -->
            <c:fragment name="cloudpiston/ui/modalShell"/>         <!-- platform modal shell -->
            <c:debug/>
        </div>
    </body>
</html>
```

A **fragment** holds the namespace on a `<c:ignore xmlns:c="contractpal">` wrapper and contains ONLY its
inner content — no `<html>/<head>/<body>`. (A plain `<div xmlns:c="contractpal">` also works, but
`c:ignore` is preferred: it emits no wrapper element.)

```html
<!-- fragments/lists/newList.html -->
<c:ignore xmlns:c="contractpal">
    <div class="...">
        <!-- inner content only -->
    </div>
</c:ignore>
```

---

## XHTML Rules — Non-Negotiable (element structure only)

Palbuilder parses page **element structure** as XHTML. Malformed markup causes hard errors.

**All void/self-closing tags must be explicitly self-closed:**

```html
<!-- Correct -->
<input type="text" name="foo" />
<img src="logo.png" alt="" />
<br />
<hr />
<col />

<!-- Wrong — will cause parse errors -->
<input type="text" name="foo">
<img src="logo.png" alt="">
```

**Scope of strictness:** this XHTML strictness applies to **elements and attributes** — tags
must be well-formed and void tags must self-close. It does **NOT** extend to the **text content of
`<script>` and `<style>`**, which the server treats as raw text (HTML5 raw-text content model). See
the next section — write CSS and JS naturally in those blocks; do not escape or CDATA-wrap them.

---

## CSS & JavaScript inside `<style>` / `<script>` — write it naturally

Empirically verified by pushing live test pages and reading the stored bytes back: `<style>` and
`<script>` bodies round-trip **byte-for-byte**, including raw `<`, `>`, and `&`. The XHTML parser
re-serializes page *structure* (e.g. `<head>` whitespace) but leaves script/style text untouched.

**Write CSS and JS exactly as you normally would.** No escaping, no CDATA, no workarounds:

```html
<style>
    .menu > .item { color: red; }                 /* raw > child combinator — fine */
    .card { color: #111; &:hover { color: #222; } } /* native nesting, raw & — fine */
</style>
<script>
    for (var i = 0; i < n; i++) { total += i; }   /* raw < — fine */
    if (x < y && y > 0) { go(); }                 /* raw <, >, && — fine */
    var html = "<div class='z'>raw</div>";        /* raw markup in a JS string — fine */
</script>
```

All of the above saved cleanly (server `success: true`) and stored verbatim.

### Anti-patterns — these BREAK content (do not do them)

- **Do NOT wrap script/style content in `<![CDATA[ … ]]>`.** The XML layer recognizes `<![CDATA[`
  as a real marked section and rewrites the boundary, swallowing your comment guard. In testing,
  `/*<![CDATA[*/ … /*]]>*/` came back as `<style><![CDATA[ */ …` — an orphaned `*/` that corrupts
  the CSS. CDATA is harmful here, not protective.
- **Do NOT entity-escape `<` `>` `&` inside script/style.** They are stored **literally** — `i &lt; n`
  comes back as the literal text `i &lt; n`, which is invalid JavaScript at runtime. Escaping only
  makes sense in element/attribute text, never in script/style bodies.

### Two caveats

1. **Avoid `${...}` template literals in inline page `<script>`.** `${}` is PalBuilder's server-side
   EL binding syntax (see *Variable Binding* below) and is resolved at **render** time — a JS template
   literal `` `total is ${total}` `` risks having `${total}` evaluated (and likely blanked) by the
   server before the browser sees it. Prefer string concatenation, or move logic to an **external
   `.js` file** (static script files bypass page EL processing). The source survives the *save*
   intact; the collision is at render.
2. **Native CSS nesting (`&`) and JS `&&` emit cosmetic validation notes.** PalBuilder's CSS linter
   reports `&:hover … not handled` / `Invalid css property` and flags `&&`. These are **non-fatal** —
   the save succeeds (`success: true`) and the content is stored unaltered. Expect the noise; it does
   not block anything or change your code. (The real save/reject signal is the `success` flag, not the
   presence of validation notes.)

---

## Variable Binding

Use EL-style `${variable}` syntax for all server-injected values:

```html
<p>${user.firstName}</p>
<img src="${settings.logoUrl}" alt="Logo" />
<div style="background-color: ${settings.colorHeader};">
```

### EL operators

Used heavily in `test=`, `c:if`, `c:when`, `selected=`. Note **`eq` compares as strings** —
a boolean column reads `${x eq 'true'}`, not `${x}`.

| Operator | Meaning | Real example |
|---|---|---|
| `eq` / `ne` | equals / not-equals (string compare) | `${r.result eq 'FAIL'}`, `${active eq 'clients'}` |
| `empty` | true if null or empty string/list | `${empty audits}` |
| `!empty` | not empty (the most common guard) | `${!empty r.remediationHint}`, `${!empty moneyPages}` |
| `!` | negation | `${!f.isInvited}` |
| `and` / `or` | boolean combine | `${a eq 'x' and b eq 'y'}` |
| `gt` / `lt` / `ge` / `le` | numeric compare | `${count gt 0}` |

```html
<c:if test="${!empty topCritical}"> ... </c:if>
<c:when test="${r.result eq 'PASS'}"> ... </c:when>
<div test="${empty progressError}"> ...still running... </div>
```

Property access is dot-notation (`${a.completedAt}`, `${r.reqId}`); delimited string-mode
lists use `.get('col0')` (see `c:list`). No ternary / arithmetic / formatter calls are
available — do display formatting in the workflow and bind the finished string.

---

## Tag Reference

Every `c:` tag has a fixed set of valid attributes; using any attribute not in the documentation throws
a Palbuilder validation error. The full per-tag reference (attribute lists + examples for `c:a`,
`c:resource`, `c:debug`, `c:upload`, `c:list`, `c:field`, `c:set`, `c:if`, `c:choose`/`c:when`/
`c:otherwise`, `c:fragment`, `c:download`, `c:div`/`c:get`/`c:image`/`c:button`/`c:select`, `c:ignore`)
lives in **`references/tag-reference.md`** — read it when you need a specific tag's attributes.

### Submitting form fields — the one pattern (memorize this)

`<c:a action="saveThing">` submits **every named input / `c:field` in the fragment** along with the
action — no wrapper of any kind. The two ways to get this wrong both look plausible and both break:

```html
<!-- ✓ CORRECT — name/category travel with the request; response swaps into #body -->
<input type="text" name="name" value="${name}" />
<input type="text" name="category" value="${category}" />
<c:a action="saveEquipment" ajax-target="body" class="btn btn-primary">Save</c:a>

<!-- ✗ WRONG — href is a plain navigation link; NO field values are sent, the
     workflow reads every input as null. ${name} in the href is evaluated
     SERVER-SIDE at render time, so it carries the OLD value, never the typed one. -->
<c:a href="?action=saveEquipment&amp;name=${name}">Save</c:a>

<!-- ✗ WRONG — the server REFUSES the save: "Tag form is not allowed" in fragments.
     c:a action= needs no <form>; delete the wrapper, keep the fields. -->
<form><c:a action="saveEquipment">Save</c:a></form>
```

Use `href` only for links that carry nothing beyond their own query string — and even then
`action="doThing?id=${row.id}"` is preferred (it's encrypted; `href` is not).

**Any `c:a` whose action deletes/destroys data carries `confirm="..."`** — the platform renders
a native browser confirm before the request fires. No undo exists on this platform.

```html
<!-- ✓ CORRECT — a stray click can't destroy data -->
<c:a action="deleteEquipment?equipmentId=${row.equipmentId}" ajax-target="body" confirm="Delete this item? This cannot be undone.">Delete</c:a>

<!-- ✗ WRONG — one click, no undo -->
<c:a action="deleteEquipment?equipmentId=${row.equipmentId}" ajax-target="body">Delete</c:a>
```

---

## Fragment Architecture

- Fragments are organized into **feature folders**, often nested:
  `auth/  common/  console/{settings,users,jobs,patches}/  lists/  friends/  exchange/  groups/  …`
  A `common/` folder holds shared fragments (`alert`, `loading`, `error`).
- The page shell has a persistent nav (`<c:fragment name="console/navbar"/>`) and a swappable content
  slot (`<c:fragment name="${frag}"/>`); navigation swaps it via `c:a`.
- Modal content loads into the platform modal shell (`cloudpiston/ui/modalShell`), included once in the
  page shell.
- **NEVER put an inline `<script>` inside a fragment.** The PalBuilder server REJECTS it at save time
  with **"Tag script is not allowed"**, and the rejection fails the whole push. A fragment's JavaScript
  belongs in an **external file under `scripts/`**, loaded once from the PAGE that hosts the fragment
  (`<script src="../Scripts/your-module.js">`); the fragment then calls those functions from `onclick`.
  This is the single most common fragment mistake — fragments are markup only, JS lives in `scripts/`.
- When a fragment's external JS runs after an AJAX load, `DOMContentLoaded` does **not** fire — run init
  code directly (or call an init function from the page), never inside a `DOMContentLoaded` wrapper.
  (Full-page reloads are the exception.)

For the modal fragment pattern and the JavaScript naming/module conventions, see
**`references/js-and-patterns.md`**.

---

## Security

The ClientPal/`fetch` ban and the "why `c:` elements are safe" rationale live in
`palbuilder-core` (Security Baseline). The front-end consequence: reach for a server-rendered
`c:` element (`c:a`, `c:upload`, `c:download`, …) — never `fetch`/ClientPal — for any server call.

---

## Platform facts (learned on live pals — trust these)

1. **New files need pal.json entries.** A file created in `pages/`, `fragments/`, `styles/`,
   `scripts/`, `images/`, or `emails/` is NOT pushed until `pal.json` has a matching entry.
   Copy an existing entry of the same type; set the `string` and `filename` fields. Push warns
   about strays — never ignore that warning.

2. **`<noscript>` wrappers are stripped; inner content is kept.** The server removes the
   `<noscript>` tag but renders everything inside it unconditionally. Never use noscript
   fallbacks — the fallback becomes live content for all users.

3. **`.webp` images are served as `text/html` (broken).** Use JPEG or PNG only.

4. **`<script>` tags are forbidden inside fragments.** The server rejects the push with
   "Tag script is not allowed." Page shells load scripts; fragments call functions via `onclick`.
   (This is already in Fragment Architecture above — treat it as a hard build error, not a lint
   warning.)

5. **`c:a` renders as a `javascript:` href.** Any JS click-interceptor on links MUST guard
   `a.protocol !== "http:" && a.protocol !== "https:"` or it silently breaks all `c:a` actions.

6. **Only these named entities are safe: `&amp;` `&lt;` `&gt;` `&quot;` `&apos;`.** Any other
   named entity (and any non-ASCII byte) triggers a server validation flag. Write arrows as
   `-&gt;`. Keep all markup ASCII.

7. **Never edit markup or CSS with regex or scripts.** Regex surgery has caused orphan `</div>`
   (server rejection) and corrupted a stylesheet twice. Read the target region, replace the
   exact block by hand.

8. **`robots.txt` and `sitemap.xml` must be served from the workflow.** Every path — including
   `/robots.txt` and `/sitemap.xml` — routes through the workflow on both test and production
   instances. The router fallback serves HTML as robots.txt (real incident: 305 parse errors in
   Lighthouse). Intercept these in the action switch and return the raw body directly; see the
   back-end skill for the code pattern.

---

## Common Mistakes

| Wrong | Correct |
|---|---|
| A new page with no `<html>/<head>/<body>` skeleton | Every page uses the full shell + `<div id="cp-root">` + `c:fragment` slots |
| Putting `<html>` skeleton in a fragment | Fragments use `<c:ignore xmlns:c="contractpal">` with inner content only |
| `${row.getValue('name')}` in a `c:list` | Direct EL: `${row.name}` |
| "Use a plain `<input>` instead of `c:field`" | `c:field` is the default for bound inputs / `<select>` options |
| `<c:a onclick="fn()">` | `<button onclick="fn()">` or `<a href="#" onclick="fn(); return false;">` |
| `<c:upload name="x" accept="image/*" />` | `<c:upload action="x" allow="image" />` |
| `<img src="x.png">` | `<img src="x.png" />` |
| `DOMContentLoaded` in an AJAX-loaded fragment | Run JS directly, no wrapper |
| Inline `<script>` inside a fragment (server: "Tag script is not allowed") | Put the JS in an external `scripts/*.js`, loaded from the page |
| `<form>` inside a fragment (server: "Tag form is not allowed") | No wrapper at all — `<c:a action="...">` submits the fragment's named fields by itself |
| `<c:a href="?action=save&amp;name=${name}">` to submit typed values | `<c:a action="save" ajax-target="body">` — `href` sends no fields; EL in an `href` carries stale server-side values |
| Hardcoding a CDN `<script>` for Bootstrap/jQuery/Chart.js | `c:resource source=... version=... name=...` |
| CDATA-wrapping `<script>`/`<style>` (`<![CDATA[ … ]]>`) | Write raw — CDATA gets mangled and corrupts the content |
| Entity-escaping `<` `>` `&` inside `<script>`/`<style>` | Write raw — escapes are stored literally and break JS |
| `` `…${x}…` `` template literal in inline page `<script>` | String concat, or move JS to an external `.js` file (`${}` collides with server EL) |
| Using any undocumented tag attribute | Check the docs first |
| `<c:a action="delete...">` with no `confirm=` | Add `confirm="Delete this item? This cannot be undone."` — no undo exists |

---

*Tag reference: https://secure.cloudpiston.com/cpal/cp-api/console-tags/summary.html*
