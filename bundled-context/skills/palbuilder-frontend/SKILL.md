---
name: palbuilder-frontend
description: "Load before pages/fragments/browser scripts or c: tags, XHTML/EL, forms, navigation, or modals."
---

# CloudPiston Pal — Frontend

## PalBuilder frontend contract

**PalBuilder frontend is XHTML + platform `c:` tags + EL bindings.** `c:` markup is
platform behavior, not a cosmetic convenience or an optional helper layer. Use plain HTML for
ordinary document structure and genuinely browser-only behavior, but use the documented
platform tag when rendering server data, inserting fragments, submitting a server action, or
using another PalBuilder capability. Do not replace applicable `c:` behavior with generic
HTML, query-string navigation, `fetch`, ClientPal, or invented client rendering.

### Pages and fragments

A **page** is a complete PalBuilder document with `<html>`, `<head>`, `<body>`, and a
`<div id="cp-root">` content root. A **fragment** is partial PalBuilder markup rendered into a
page by the platform. Fragments cannot contain a `<script>` and contain no `<html>`, `<head>`,
or `<body>`; their normal namespace wrapper is `<c:ignore xmlns:c="contractpal">`. `c:ignore` emits no wrapper
markup. Insert a registered fragment with `<c:fragment name="..."/>`; do not invent includes,
client loading, or generic template behavior.

```html
<!-- page -->
<html xmlns:c="contractpal"><head><title>Title</title></head><body>
    <div id="cp-root"><c:fragment name="${frag}"/></div>
</body></html>

<!-- fragments/profile.html -->
<c:ignore xmlns:c="contractpal"><div>Profile</div></c:ignore>
```

### XHTML

Element structure is strict XHTML: close elements, self-close void elements (`<img .../>`,
`<input .../>`, `<br/>`), and preserve valid nesting. Do not silently normalize PalBuilder
markup into permissive HTML. This structural rule does not require escaping normal raw text
inside page `<script>` or `<style>` blocks; see `platform-facts.md` for that boundary. Authored
PalBuilder markup also has strict entity/character constraints: avoid unsupported named entities
and non-ASCII authored markup; read `platform-facts.md` for the exact rule.

### Core `c:` tag model

Use this map to choose the platform primitive. Read `references/c-tags.md` for exact attributes
before using an unfamiliar tag or **any** unfamiliar attribute — unsupported attributes are build
errors.

| Tag | Platform purpose |
|---|---|
| `c:a` | Server action, AJAX target, or PalBuilder navigation; server behavior uses `action=`. |
| `c:fragment` | Insert a registered PalBuilder fragment. |
| `c:list` | Iterate server-provided `DataList` data. |
| `c:if`, `c:choose`, `c:when`, `c:otherwise` | Server-side conditional rendering. |
| `c:field` | PalBuilder-bound field behavior, including applicable form/select fields. |
| `c:set` | Set template values, including conditional classes. |
| `c:ignore` | Fragment namespace wrapper that emits no wrapper element. |
| `c:resource` | Load a registered platform-hosted third-party resource. |
| `c:upload` / `c:download` | PalBuilder file-transfer behavior. |

`c:button`, `c:select`, `c:div`, and other documented `c:` tags also carry platform behavior;
check `c-tags.md` instead of guessing their syntax. Use the platform's existing UI resources for
modals, toasts, validation, paging, and similar behavior when applicable; see `cpresource.md`.

### Server actions and fragment submission

Normal PalBuilder server actions use `c:a action="..."` (or another documented platform action
tag). `onclick` is **not valid on `c:a`** and cannot replace its action. A fragment's Save/Cancel
or navigation action uses `c:a action="..."`, not an ordinary `<form>` submission,
`href="?action=..."`, `fetch`, ClientPal, or generic JavaScript request. `ajax-target` must name
the real target/fragment contract. Use documented `confirm=` for destructive actions when
applicable.

```html
<c:ignore xmlns:c="contractpal">
    <c:field type="text" name="displayName" value="${displayName}"/>
    <c:a action="saveProfile" ajax-target="body">Save</c:a>
    <c:a action="showProfile" ajax-target="body">Cancel</c:a>
</c:ignore>
```

`c:a` can carry action parameters in its documented `action=` value. A plain `<button>` or
`<a>` remains correct only for a genuinely browser-only interaction with no platform server
behavior.

**Choose the primitive by responsibility:** a server request or platform navigation is an
`action=` on a documented platform tag; a server-provided collection is `c:list`; a server
rendering decision is `c:if`/`c:choose`; and a registered partial is `c:fragment`. Do not move
those responsibilities to the browser merely because browser code can manipulate the DOM.
`c:resource` is specifically for registered platform-hosted third-party resources; project-local
assets use ordinary page `<link>`/`<script>` tags. For platform-owned UI behavior, prefer the
existing CPResource contract rather than copying a modal, toast, validation, loading, or paging
implementation into the pal.

### Server rendering and conditions

Render platform-provided lists and conditionals with the tags below rather than recreating them
in browser JavaScript. `c:list` rows use direct EL property access:

```html
<c:list name="people" id="row">
    <c:if test="${row.active eq 'true'}"><p>${row.firstName}</p></c:if>
</c:list>

<c:choose>
    <c:when test="${status eq 'draft'}"><span>Draft</span></c:when>
    <c:otherwise><span>Published</span></c:otherwise>
</c:choose>
```

Use ordinary HTML inputs only when the behavior is genuinely ordinary HTML and no documented
PalBuilder field behavior is required. When binding, options, submission semantics, or other
platform behavior are involved, use or check the documented `c:field` contract rather than
assuming HTML input behavior is equivalent. Use `c:set` for template values/classes when
appropriate. `test=` is reliable on documented
`c:` tags; use `c:if` for a conditional ordinary HTML block rather than putting `test=` on a
plain element.

### EL / JEXL essentials

`${value}` binds a server value. PalBuilder expressions are Apache Commons JEXL with platform extensions.
Use `${row.field}` for `DataList` rows and `.get('name')` where a key is not
JEXL-friendly. For example, when workflow code does `data.set("first-name", "Bob")`, bind it
as `${info.get('first-name')}` rather than `${info.first-name}`. Use `eq` / `ne` for string
comparisons, `empty(x)` / `!empty(x)` for empty checks, and the available `formatter` for
formatting. Read `c-tags.md` for delimited-list row access and attribute-specific expression
examples. `${...}` inside inline page JavaScript collides with PalBuilder EL/template parsing;
prefer external `scripts/*.js` or safe string construction, and read `platform-facts.md`.

## Reference routing

- Read **`references/c-tags.md`** before using an unfamiliar `c:` tag or attribute. It owns
  exhaustive attributes and uncommon-tag details, not the core `c:` operating model above.
- Read **`references/platform-facts.md`** before unusual markup, images, URL interception, or
  inline page JavaScript; it contains production gotchas.
- Read **`references/cpresource.md`** when using platform UI resources (modals, toast/alerts,
  loading, validation, paging, or CR datalist).
- Read **`references/browser-js.md`** only when browser-JS module architecture, initialization,
  workflow-emitted browser code, or post-AJAX widget initialization is relevant.

## Browser JavaScript boundary

Browser files under `scripts/*.js` are modern browser JavaScript; workflow `.js` is a different,
restricted environment. Use a page-level entry: load once from the page; browser scripts never
belong in a fragment. AJAX fragment insertion does not fire a new `DOMContentLoaded`, so initialization must already be available
or be invoked through a verified integration pattern. Browser JS must not become an invented
replacement for PalBuilder server actions: use documented `c:a action=...` or another documented
platform action tag for server behavior. Consult `browser-js.md` only for the relevant,
verified browser integration pattern.

## Practical conventions

Inspect the existing pal before choosing folder names, shell layout, CSS classes, Bootstrap
version, or resource set; none is a universal default. A common page shell includes registered
fragments such as a navigation area or the CPResource modal shell, but add only what the pal
actually uses. A `c:fragment name=` must match the Fragment name registered in `pal.json`.
Existing pals may organize names like paths, but inspect that registration instead of deriving or
guessing the name from a filename.

When a page needs a modal, include the registered modal shell once and target the shell's actual
content contract with the action response. The modal's close control may be browser-only HTML,
but an operation such as save/delete/navigation remains a documented `c:a action=...`, with a
confirmation mechanism for destructive actions where applicable. This distinction avoids
mistaking a browser-only UI control for permission to bypass a platform action.

For cross-workflow navigation, see `palbuilder-workflow/references/console.md`. For platform
UI helpers, use the documented CPResource paths and contracts rather than reimplementing modal,
alert, loading, validation, or paging behavior in generic JavaScript.
