# Frontend Platform Facts

Production-verified gotchas that go beyond CLAUDE.md's golden rules. Each fact here has bitten
someone in a real pal; treat them as build errors, not lint warnings.

---

## `<noscript>` is stripped, but its content is kept

The server removes `<noscript>` wrapper tags but renders everything inside them
unconditionally. This means a `<noscript>` fallback becomes **live content for every user**,
JavaScript-enabled or not.

```html
<!-- ✗ WRONG — the fallback text is shown to EVERYONE -->
<noscript>
    <p>You need JavaScript enabled to use this app.</p>
</noscript>

<!-- Renders to every user as: -->
<p>You need JavaScript enabled to use this app.</p>
```

**Never use `<noscript>` for progressive-enhancement fallbacks.** If you need JS-required
content, either require it upfront (redirect JS-less users elsewhere) or design without
`<noscript>` at all.

---

## `.webp` images are served as `text/html` (broken)

Uploading a `.webp` file to a pal produces an image resource served with the wrong MIME type
— the browser sees HTML and refuses to render it.

**Use JPEG or PNG.** Convert any `.webp` source before adding it to the pal.

---

## `<script>` inside a fragment is a hard rejection

The server rejects any fragment containing `<script>` at save time with **"Tag script is not
allowed"** — and the rejection fails the whole push (not just that file). This is enforced
per-fragment; page shells can (and must) load scripts, but fragments cannot inline them.

Fragment JavaScript belongs in an external file under `scripts/`, loaded from the PAGE:

```html
<!-- page shell -->
<script language="JavaScript" src="../Scripts/dashboard-module.js"></script>
```

The fragment calls exported functions via `onclick` on plain buttons/anchors, or via the
module pattern (see `../SKILL.md`).

---

## `c:a` renders as a `javascript:` href

`<c:a action="...">` outputs an anchor tag whose `href` is a `javascript:` URL — the
platform's client-side dispatcher runs the action from that href.

**Any JavaScript that intercepts anchor clicks must guard on the protocol** or it silently
breaks every `c:a` on the page:

```js
// ✓ CORRECT — respect the platform's javascript: hrefs
document.body.addEventListener("click", function(e) {
    var a = e.target.closest("a");
    if (!a) return;
    if (a.protocol !== "http:" && a.protocol !== "https:") return;   // skip c:a and mailto: etc.
    // ... your custom click logic
});
```

Symptoms of getting this wrong: `c:a` links stop firing actions, no visible error, users
report "buttons don't work." Easy to miss because static clicks on native `<a>` still work.

---

## `c:a` navigation can leave `window.location` stale

Clicking a `c:a` link changes the rendered page, but it does not reliably update the
browser's visible address bar or `window.location`. A live pal hit this with filter
dropdown JS that read `window.location.search` to preserve existing filters; after earlier
`c:a` navigation, the handler kept using stale `action` and query parameters from the last
real redirect.

```js
// Wrong — may read stale params after c:a navigation
function filterChange(paramName, value, token) {
    var params = new URLSearchParams(window.location.search);
    params.set(paramName, value);
    // ...
}
```

Pass the workflow's current, server-known state into the client function instead:

```js
function filterChange(paramName, value, token, current) {
    var merged = {
        category: current.category || "",
        label: current.label || ""
    };
    merged[paramName] = value;
    // ...
}
```

```html
<select onchange="filterChange('category', this.value, '${token}', {
    category: '${categoryParam}',
    label: '${labelParam}'
})">
```

Only a real `c.redirect()` / HTTP 302 reliably updates `window.location`. Any JS that needs
"the current URL" on a page reachable through `c:a` must get current state from the
workflow-rendered payload.

---

## Only five named entities are safe

The server's XML validator accepts only these named entities:

- `&amp;`
- `&lt;`
- `&gt;`
- `&quot;`
- `&apos;`

Any other named entity — `&nbsp;`, `&copy;`, `&mdash;`, `&rarr;`, etc. — triggers a validation
flag. Any non-ASCII byte in markup (raw em-dash, right-arrow, curly quotes) does the same.

**Use numeric entities or ASCII substitutes:**
- `-&gt;` instead of `→` or `&rarr;`
- `&#160;` if you genuinely need a non-breaking space
- Straight quotes `"` `'` instead of curly quotes

**Keep all markup ASCII.** For non-ASCII content that must display (user text, translated
strings), let the server bind it via `${...}` — EL bindings don't go through the entity
validator.

---

## Never edit markup or CSS with regex or scripts

Regex-based edits on Palbuilder markup have repeatedly caused damage:

- **Orphan `</div>`** or unclosed void tags — the server rejects the whole push.
- **Corrupted stylesheets** — nested selectors get mangled by aggressive substitution.
- **Silent XHTML violations** — a regex that "just adds an attribute" can put it in the wrong
  place inside a nested tag.

**Read the target region, hand-edit the exact block.** No `sed`, no `awk`, no
find-and-replace across a file, no regex-based bulk rewrites. This is a stop-the-world rule
learned twice at cost.

---

## `robots.txt` and `sitemap.xml` route through the workflow

Every URL under the pal's public-web domain, including `/robots.txt` and `/sitemap.xml`,
routes through the web workflow first. The default router serves HTML for unmatched paths —
which means an unhandled `/robots.txt` request returns an HTML page rendered as robots.txt.

This has caused real incidents (Lighthouse SEO scores dropping from parse errors on
`robots.txt`).

**Intercept these paths in the workflow action switch** and return the raw file content or
the registered `robotsPage` from `pal.json`. See `palbuilder-workflow/references/web.md`
for the pattern.

---

## Template literals collide with EL in inline page `<script>`

The EL parser processes `<script>` blocks in pages and treats `${...}` as a substitution.
JavaScript template literals `` `${expr}` `` use the same syntax — the EL parser eats them.

Symptoms: silent replacement of the template-literal expression with an empty string, or
mysterious `null` values in what looks like normal JS.

**Options:**
- Use string concatenation: `"Hello, " + name`
- Move the JS to an external `.js` file under `scripts/` — those aren't EL-parsed

Inside `.js` files under `scripts/`, template literals work normally.

---

## `<script>` and `<style>` content is raw text, not XHTML

Despite XHTML strictness on element structure, the **text content** of `<script>` and
`<style>` blocks is treated as raw text (HTML5 content model). This means:

- `<`, `>`, and `&` inside JS or CSS are stored byte-for-byte
- **Do NOT CDATA-wrap** — `<![CDATA[ ... ]]>` gets mangled and corrupts CSS
- **Do NOT entity-escape** — `&lt;` inside a script tag becomes literal `&lt;` in the JS, breaking it

Just write CSS and JS naturally:

```html
<style>
    .highlight { background: #ff0; }
    a:hover > span { color: red; }        /* < and > are fine */
</style>

<script>
    if (a < b && c > d) { doThing(); }    /* < > & are fine */
</script>
```

Two minor edge cases (both cosmetic, non-fatal):
- **Native CSS nesting `&`** — emits a linter note but the CSS saves and works
- **JS `&&`** — same

---

## New files need a `pal.json` entry

A file created in `pages/`, `fragments/`, `styles/`, `scripts/`, `images/`, or `emails/`
does not become part of the pal until `pal.json` has a matching entry. The push tooling
warns about strays — never ignore that warning.

Copy an existing entry of the same type; set `string` and `filename` correctly. See
`palbuilder-core/references/pal-json.md` for entry structure.

---

## Summary — the check before every push

Before finalizing frontend changes:

- All void tags self-closed (`<input .../>`, `<img .../>`, `<br/>`, `<hr/>`, `<col/>`)
- No inline `<script>` in any fragment
- No `<noscript>` wrapping any content
- No `.webp` images
- Only the five safe named entities used; all markup ASCII
- Any JS click interceptor guards on `a.protocol`
- Any `robots.txt` / `sitemap.xml` route is handled in the workflow action switch
- Every new file has a `pal.json` entry
