# Modal pattern + JavaScript conventions (frontend)

The recurring fragment patterns and JS conventions for Palbuilder front-end code. Open this when
building a modal fragment or writing fragment JavaScript. Core rules (fragment architecture, the
`DOMContentLoaded` gotcha, security) live in the skill's SKILL.md.

---

## Modal Fragment Pattern

A modal fragment is a `c:ignore`-wrapped fragment with `modal-header` / `modal-body` / `modal-footer`.
Close buttons are plain `<button onclick="hideModal()">`; action buttons are `c:a`. **CSS class names
are project-specific (design skill territory) — match the pal's design system; don't assume specific
class names.**

```html
<!-- real: GiftHub/fragments/exchange/groupModal.html (classes are GiftHub's own) -->
<c:ignore xmlns:c="contractpal">
    <div class="modal-header">
        <p class="mb-0">Add to group</p>
        <button type="button" class="modal-close" onclick="hideModal()"><i class="fas fa-times"></i></button>
    </div>
    <div class="modal-body">
        <p>Groups will go here</p>
    </div>
    <div class="modal-footer">
        <c:a action="doShareList?listId=${activeList.listId}" ajax-target="body" class="btn btn-primary">Add</c:a>
    </div>
</c:ignore>
```

- `showModal(path)` / `hideModal()` come from the `cloudpiston/ui/v5/lib-ui` include.
- Trigger from a page/fragment with `<c:a action="..." ajax-target="modalContent">`.
- For inline server messages, a `feedback` span is one option; actions may also re-render a region
  via `ajax-target="body"`.

---

## JavaScript Naming Conventions

- **Variables:** camelCase — `campaignName`, `userId`, `isOpen`
- **Constants:** UPPER_SNAKE_CASE — `var MAX_RESULTS = 100;` (`const` is not available in workflow JS)
- **Strings:** double quotes
- **Be descriptive:** `inviterId` not `id`.
- Remove debug `console.log` once an issue is resolved.

---

## JavaScript Rules

- AJAX-loaded fragments do **not** fire `DOMContentLoaded` — run init code directly, never in a
  `DOMContentLoaded` wrapper. (Full-page reloads fire it normally.)
- Use the **module pattern** — group a fragment's functions into a named object, called from HTML via
  `onclick`:

```js
var CampaignModule = (function() {
    function openNewCampaign() { /* ... */ }
    function toggleScheduler(show) {
        document.getElementById("scheduler").classList.toggle("d-none", !show);
    }
    return { openNewCampaign: openNewCampaign, toggleScheduler: toggleScheduler };
})();
```
```html
<button onclick="CampaignModule.openNewCampaign()">New Campaign</button>
```

- Bootstrap dropdowns loaded via AJAX must be manually initialized:

```js
document.querySelectorAll('[data-bs-toggle="dropdown"]').forEach(function(el) {
    new bootstrap.Dropdown(el);
});
```
