# Palbuilder Component Library

HTML recipe reference for the base styling in `styles/design-system.css` (canonical, shipped
verbatim from `design-system-init/references/design-system.css`) plus its behavior layer
`scripts/pb-ui.js` and motion layer `scripts/pb-motion.js`. Every class and `data-*` attribute below
is copied directly from those three shipped files — nothing here is invented. Per-project tweaks
and reference-driven component overrides belong in the authored `styles/styles.css` of a new pal.

Marketing sections (hero, bento, pricing, testimonials, logo cloud, CTA band, stats/ticker,
mockups, text/glow/spotlight effects) live in `marketing-library.md`, not here. Console/app
pals should never need to load that doc.

**XHTML is strict.** Self-close every void element (`<input />`, `<img />`, `<br />`, `<hr />`),
write boolean attributes as `attr="attr"` (`checked="checked"`, `hidden="hidden"`,
`disabled="disabled"`, `open="open"`), and never leave a tag unclosed. See
`bundled-context/CLAUDE.md` golden rules for the full platform contract (`c:a` vs `onclick`,
`confirm=` on destructive actions, no `<script>` in fragments, no `fetch`/ClientPal).

**Never hand-edit `design-system.css`.** Sections 1-8 of that file are re-synced verbatim from
this skill on every design pass; token-only recolors may use the `PAL OVERRIDES` block, while
component-shaped/reference-driven tweaks in a new pal belong in readable `styles/styles.css`.

## Load Order

Every new-pal page shell links the canonical files plus its authored stylesheet, in this order, once:
```html
<link rel="STYLESHEET" type="text/css" href="../Styles/spacing.css" />
<link rel="STYLESHEET" type="text/css" href="../Styles/design-system.css" />
<link rel="STYLESHEET" type="text/css" href="../Styles/styles.css" />
<script type="module" src="../Scripts/pb-ui.js"></script>
<script type="module" src="../Scripts/pb-motion.js"></script>
```

Web fonts load from the `@import` at line 1 of `design-system.css`; do not add remote font
resources to a page shell. Optional charts add Chart.js separately (section 21) and do not change
the four-file byte-identity contract.

`pb-ui.js` and `pb-motion.js` delegate every listener on `document` and re-scan AJAX-swapped
fragments automatically (MutationObserver) — never add a per-fragment `<script>` or re-init call.
Set `data-preset="indigo|emerald|amber|rose|slate-dark"` on `<html>` to recolor the accent/surface
tokens (omit for the default ink theme); `data-theme="dark"` on `<html>` switches the dark block
(`data-pb-theme-toggle` flips it client-side and persists to `localStorage`).

## Page Shell & Spacing (mandatory)

Every console page shell wraps its fragments in the main container. Fragments NEVER include
`.pb-main` themselves. The shell owns it.

Navbar-only shell:
```html
<body>
    <div id="cp-root">
        <c:fragment name="navbar" />
        <main id="body" class="pb-main">
            <c:fragment name="${frag}" />
        </main>
        <c:debug />
    </div>
</body>
```

Sidebar shell: see section 49 (`.pb-layout` wraps sidebar + `<main id="body" class="pb-main">`).

Fragment root = `<div class="pb-section">`. It is a grid with a 24px gap. Page headers,
toolbars, grids, and cards inside it space themselves. Without it siblings touch.

Spacing primitives (use these, never hand-written margins):

| Class | Gap | Use for |
|---|---|---|
| `.pb-section` | 24px | fragment root; rhythm between page-level blocks |
| `.pb-stack` | 16px | vertical stack inside a card: fields, list rows |
| `.pb-cluster` | 12px | inline row: buttons, chips, filters |
| `.pb-grid-2` / `.pb-grid-3` | 24px | equal-width card/stat grids |
| `.pb-form-grid` | 16/20px | two-column form layouts |

`.pb-field-group` spaces only its own label→input. IF a form has more than one field, THEN wrap
the fields in `.pb-stack` (single column) or `.pb-form-grid` (two column):
```html
<div class="pb-card pb-form-card">
    <div class="pb-stack">
        <div class="pb-field-group">
            <label class="pb-label">
                Email
                <c:field type="text" name="email" class="pb-input ${emailErrorClass}" value="${email}" placeholder="name@example.com" />
            </label>
            <p class="pb-field-error" role="alert" test="${!empty(emailError)}">${emailError}</p>
        </div>
        <label class="pb-toggle">
            <input type="checkbox" name="notify" checked="checked" />
            <span class="pb-toggle-track" aria-hidden="true"></span>
            Notify me
        </label>
        <div class="pb-form-actions"><button class="pb-btn pb-btn-primary">Save</button><button class="pb-btn pb-btn-ghost">Cancel</button></div>
    </div>
</div>
```

Empty states use `.pb-state`; notices use `.pb-alert`. Never use a bare styled `<p>`.
Token-only custom CSS in `PAL OVERRIDES` uses `--ds-space-*` tokens; component-shaped custom CSS
belongs in readable `styles/styles.css`. Utility classes (`.p-*`, `.gap-*`,
`.mt-*`) come from spacing.css and follow its own `--s*` scale. They are fine in markup. Never
mix raw px values or the two scales in one rule.
`.pb-form-card` bounds an operational form to 720px. Labels stay above controls.
Controls fill their field group, not the page. Use `.pb-field-group--short` for codes/compact
values and `.pb-field-group--medium` for names/email when the expected answer should not span the
whole card; long text can use the full bounded width.
`.pb-form-actions` keeps primary Save and ghost/secondary Cancel together at the end; never bare links.

## 1. Buttons

One primary action per view. States (hover/focus/active/disabled) are automatic from the class.
```html
<c:a action="saveRecord" ajax-target="body" class="pb-btn pb-btn-primary">Save</c:a>
<c:a action="deleteRecord?id=${record.id}" confirm="Delete this record?" ajax-target="body" class="pb-btn pb-btn-danger">Delete</c:a>
<button type="button" class="pb-btn pb-btn-ghost" data-pb-modal-close="">Cancel</button>
<button type="button" class="pb-btn pb-btn-primary" disabled="disabled" aria-busy="true">
    <span class="pb-spinner" aria-hidden="true"></span>
    Saving
</button>
```

Variants: `.pb-btn-primary`, `.pb-btn-secondary`, `.pb-btn-ghost`, `.pb-btn-danger`. Add
`.is-disabled` or `disabled="disabled"` to disable.

## 2. Icon Buttons And Icons

One inline SVG icon family per pal; no icon fonts, CDN icon scripts, external sprites, or image
icons. Good libraries: Iconoir (`https://iconoir.com`), Tabler (`https://tabler.io/icons`), and
Phosphor (`https://phosphoricons.com`).
```html
<button type="button" class="pb-icon-btn" aria-label="Search">
    <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 19a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" /><path d="m21 21-4.35-4.35" /></svg>
</button>
```

Decorative icons get `aria-hidden="true"`; icon-only buttons get `aria-label`. `.pb-icon-lg` for a
20px size. Copy the SVG, strip fixed `width`, `height`, and library classes, keep `viewBox`, set
`class="pb-icon" aria-hidden="true"`, and self-close children (`<path />`, `<circle />`,
`<rect />`, `<line />`). Use one family per pal.

## 3. Fields

`c:field` for server-bound values; label/help/error wrap it, never ARIA on `c:field` itself.
```html
<div class="pb-field-group">
    <label class="pb-label">
        Email
        <c:field type="text" name="email" class="pb-input ${emailErrorClass}" value="${email}" placeholder="name@example.com" />
    </label>
    <p class="pb-field-error" role="alert" test="${!empty(emailError)}">${emailError}</p>
</div>
```

Plain input when ARIA on the control itself is required: swap `c:field` for `<input>`, add
`aria-invalid="true" aria-describedby="emailError"`. `.pb-textarea` for multi-line, `.is-error`
on any of `.pb-input`/`.pb-select`/`.pb-textarea`. Native controls use `appearance: none` in the
shipped CSS where needed (select chevron, checkbox, radio, toggle), so do not add browser-specific
inline styling.

## 4. Selects
```html
<div class="pb-field-group">
    <label class="pb-label" for="statusFilter">Status</label>
    <c:select id="statusFilter" name="statusFilter" action="filterRecords" ajaxTarget="body" eventType="onchange" class="pb-select">
        <c:field type="option" value="all" name="All" selected="${statusFilter eq 'all'}"></c:field>
        <c:field type="option" value="open" name="Open" selected="${statusFilter eq 'open'}"></c:field>
    </c:select>
</div>
```

## 5. Checkbox And Toggle
```html
<label class="pb-check">
    <c:field type="checkbox" name="active" value="true" checked="${active eq 'true'}" />
    Active
</label>
<label class="pb-toggle">
    <input type="checkbox" name="notify" checked="checked" />
    <span class="pb-toggle-track" aria-hidden="true"></span>
    Notify me
</label>
```

## 6. Cards

Repeated items and framed tools. Do not nest a card inside a card.
```html
<div class="pb-card">
    <div class="pb-card-head">
        <div>
            <h2 class="pb-card-title">${record.name}</h2>
            <p class="pb-card-sub">${record.owner}</p>
        </div>
        <span class="pb-badge pb-badge-success">Active</span>
    </div>
    <p class="pb-muted">${record.summary}</p>
</div>
```

`.pb-card-link` (on an `<a>` or `<c:a>`) for a whole-card clickable variant.

## 7. Page Header And Toolbar
```html
<div class="pb-page-head">
    <div>
        <h1 class="pb-title">Customers</h1>
        <p class="pb-subtitle">${customerCount} active customers</p>
    </div>
    <c:a action="newCustomer" ajax-target="modalContent" class="pb-btn pb-btn-primary">New customer</c:a>
</div>
<div class="pb-toolbar">
    <span class="pb-muted">Showing ${resultCount} results</span>
    <div class="pb-cluster"><!-- filters/actions --></div>
</div>
```

## 8. Navigation And Tabs

In-page sub-nav (`.pb-nav`) and tab bars (`.pb-tabs`) — distinct from the app-level `.pb-navbar`
(section 50). Two tab patterns are valid: server-swapped (workflow sets the active class) or
client-side (`pb-ui.js`, no round trip).
```html
<div class="pb-nav" role="navigation" aria-label="Primary">
    <c:a action="getDashboard" workflow="console" class="pb-nav-link ${dashboard_active}">Dashboard</c:a>
    <c:a action="getRecords" workflow="console" class="pb-nav-link ${records_active}">Records</c:a>
</div>

<div class="pb-tabs" data-pb-tabs="" role="tablist">
    <button type="button" class="pb-tab" data-pb-tab="panel-overview" aria-selected="true">Overview</button>
    <button type="button" class="pb-tab" data-pb-tab="panel-activity" aria-selected="false">Activity</button>
</div>
<div id="panel-overview">Overview content.</div>
<div id="panel-activity" hidden="hidden">Activity content.</div>
```

JS: `data-pb-tabs`/`data-pb-tab` need pb-ui.js (already loaded from page shell) — it toggles
`aria-selected` and the target panel's `hidden`. Server-swapped tabs use `c:a ajax-target=` with
`.pb-tab`/`.active` set by the workflow instead; skip `data-pb-tabs` in that case.

## 9. Badges And Status Chips
```html
<c:choose>
    <c:when test="${record.status eq 'active'}"><span class="pb-badge pb-badge-success">Active</span></c:when>
    <c:when test="${record.status eq 'paused'}"><span class="pb-badge pb-badge-warning">Paused</span></c:when>
    <c:when test="${record.status eq 'blocked'}"><span class="pb-badge pb-badge-danger">Blocked</span></c:when>
    <c:otherwise><span class="pb-badge pb-badge-neutral">Draft</span></c:otherwise>
</c:choose>
```

Variants: `.pb-badge-neutral`, `.pb-badge-success`, `.pb-badge-warning`, `.pb-badge-danger`,
`.pb-badge-info`, `.pb-badge-accent`.

## 10. Alerts
```html
<div class="pb-alert pb-alert-info" role="alert" test="${!empty(infoMessage)}">
    <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
    <div>
        <p class="pb-alert-title">Review queued</p>
        <p class="pb-alert-msg">${infoMessage}</p>
    </div>
    <button type="button" class="pb-alert-dismiss" aria-label="Dismiss alert" data-pb-dismiss="true">×</button>
</div>
```

Variants: `.pb-alert-info`, `.pb-alert-success`, `.pb-alert-warning`, `.pb-alert-danger`. Dismiss
buttons use `data-pb-dismiss="true"`; pb-ui.js removes the closest `.pb-alert`/`.pb-toast` after
the leave transition.

## 11. Tables

Dense, scannable, numeric right-aligned. Every `td` gets `data-label` for the mobile card collapse.
```html
<div class="pb-table-wrap">
    <table class="pb-table">
        <thead>
            <tr><th>Customer</th><th>Status</th><th class="pb-num">Balance</th><th class="pb-cell-center">Actions</th></tr>
        </thead>
        <tbody>
            <c:list name="customers" id="customer">
                <tr>
                    <td data-label="Customer"><strong>${customer.name}</strong><br />
                        <span class="pb-muted">${customer.email}</span></td>
                    <td data-label="Status"><span class="pb-badge pb-badge-success">${customer.status}</span></td>
                    <td data-label="Balance" class="pb-num">${formatter.formatCurrency(customer.balance)}</td>
                    <td data-label="Actions"><div class="pb-row-actions">
                        <c:a action="editCustomer?id=${customer.customerId}" ajax-target="modalContent" class="pb-btn pb-btn-secondary">Edit</c:a>
                        <c:a action="deleteCustomer?id=${customer.customerId}" ajax-target="body" confirm="Delete this customer? This cannot be undone." class="pb-btn pb-btn-danger">Delete</c:a>
                    </div></td>
                </tr>
            </c:list>
        </tbody>
    </table>
</div>
```

Clickable row: `<c:tr action="viewCustomer?id=${customer.customerId}" ajaxTarget="body" eventType="onclick" class="pb-row-click">`.

Use `.pb-row-actions`; keep one or two frequent safe actions visible and put rare actions in the
documented overflow pattern. Destructive comes last, is separated, and carries `confirm=`. Mobile
uses `data-label`; never hide critical status or destructive context.

## 12. Filter Bar And Search
```html
<div class="pb-filterbar">
    <div class="pb-search pb-field-group">
        <label class="pb-sr-only" for="q">Search</label>
        <c:field type="text" id="q" name="q" value="${q}" class="pb-input" placeholder="Search records" />
    </div>
    <div class="pb-cluster">
        <c:select name="statusFilter" action="filterRecords" ajaxTarget="body" eventType="onchange" class="pb-select">
            <c:field type="option" value="all" name="All"></c:field>
        </c:select>
        <c:a action="filterRecords" ajax-target="body" class="pb-btn pb-btn-secondary">Apply</c:a>
    </div>
</div>
```

## 13. Pagination
```html
<div class="pb-pagination" role="navigation" aria-label="Pagination">
    <c:a action="listRecords?page=${prevPage}" ajax-target="body" class="pb-btn pb-btn-secondary" test="${page gt 1}">Previous</c:a>
    <div class="pb-page-list" aria-label="Pages">
        <c:a action="listRecords?page=1" ajax-target="body" class="pb-page-btn">1</c:a>
        <span class="pb-page-ellipsis">…</span>
        <c:a action="listRecords?page=${page}" ajax-target="body" class="pb-page-btn" aria-current="page">${page}</c:a>
        <span class="pb-page-ellipsis">…</span>
        <c:a action="listRecords?page=${pageCount}" ajax-target="body" class="pb-page-btn">${pageCount}</c:a>
    </div>
    <c:a action="listRecords?page=${nextPage}" ajax-target="body" class="pb-btn pb-btn-secondary" test="${page lt pageCount}">Next</c:a>
</div>
```

Prepare exact numbered links in the workflow; Palbuilder EL has no ternary operator, so render
`aria-current="page"` only on the active `.pb-page-btn`.

## 14. Stat Cards
```html
<div class="pb-stat">
    <p class="pb-stat-label">Open invoices</p>
    <p class="pb-stat-value">${openInvoiceCount}</p>
    <p class="pb-stat-note">${formatter.formatCurrency(openInvoiceTotal)}</p>
</div>
```

Radios, checkboxes, toggles, and segmented controls are custom-rendered by CSS with native inputs
hidden or reset through `appearance: none`; checked marks use `--ds-primary-text` for contrast in
dark themes.

## 15. Progress Bar And Ring
```html
<div class="pb-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${record.percent}">
    <span class="pb-progress-fill" style="--value: ${record.percent};"></span>
</div>
<div class="pb-ring" style="--value: ${record.percent};">
    <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="pb-ring-track" cx="60" cy="60" r="52" />
        <circle class="pb-ring-value" cx="60" cy="60" r="52" />
    </svg>
    <span class="pb-ring-label">${record.percent}%</span>
</div>
```

## 16. Empty, Loading, Error
```html
<div class="pb-state" test="${empty(customers)}">
    <p class="pb-state-title">No customers yet.</p>
    <c:a action="newCustomer" ajax-target="modalContent" class="pb-btn pb-btn-primary">Add customer</c:a>
</div>
<div class="pb-state" role="alert" test="${!empty(errorMessage)}">
    <p class="pb-state-title">Could not load records.</p>
    <p class="pb-state-msg">${errorMessage}</p>
    <c:a action="listRecords" ajax-target="body" class="pb-btn pb-btn-secondary">Try again</c:a>
</div>
<div class="pb-card" aria-hidden="true">
    <span class="pb-skeleton pb-skeleton-title" style="width: 45%;"></span>
    <span class="pb-skeleton pb-skeleton-line" style="width: 72%; margin-top: 12px;"></span>
</div>
```

## 17. Modal Dialog

Native `<dialog>` — no scrim markup, no open/close JS to write.
```html
<dialog id="editCustomerModal" class="pb-modal">
    <div class="pb-modal-head">
        <h2 class="pb-modal-title">Edit customer</h2>
        <button type="button" class="pb-icon-btn" aria-label="Close" data-pb-modal-close="">×</button>
    </div>
    <div class="pb-modal-body">
        <div class="pb-field-group">
            <label class="pb-label">Customer name<c:field type="text" name="customerName" class="pb-input" value="${customer.name}" /></label>
        </div>
    </div>
    <div class="pb-modal-foot">
        <button type="button" class="pb-btn pb-btn-ghost" data-pb-modal-close="">Cancel</button>
        <c:a action="saveCustomer?id=${customer.customerId}" ajax-target="editCustomerModal" class="pb-btn pb-btn-primary">Save</c:a>
    </div>
</dialog>
<button type="button" class="pb-btn pb-btn-secondary" data-pb-modal-open="editCustomerModal">Edit</button>
```

JS: needs pb-ui.js (already loaded) — `data-pb-modal-open="id"` calls `showModal()`,
`data-pb-modal-close` and a backdrop click call `close()`. `@starting-style` enter transition and
`::backdrop` dimming are already in the shipped CSS.

## 18. Activity Feed And Timeline
```html
<div class="pb-feed">
    <c:list name="activity" id="event">
        <div class="pb-feed-item">
            <span class="pb-feed-dot" aria-hidden="true"></span>
            <div>
                <p class="pb-feed-title">${event.summary}</p>
                <p class="pb-feed-meta">${event.actor} - ${formatter.formatDateString(event.createDate, "MMM d, yyyy")}</p>
            </div>
        </div>
    </c:list>
</div>
```

## 19. Stepper
```html
<div class="pb-stepper">
    <div class="pb-step is-done"><span class="pb-step-mark">1</span><span>Details</span></div>
    <div class="pb-step is-active"><span class="pb-step-mark">2</span><span>Review</span></div>
</div>
```

## 20. File Upload

`c:upload` is its own widget; do not pair it with a separate Save button.
```html
<div class="pb-card">
    <div class="pb-card-head">
        <div><h2 class="pb-card-title">Upload document</h2><p class="pb-card-sub">PDF or Office document.</p></div>
    </div>
    <c:upload action="uploadDocument" allow="office" ajax-target="uploadFeedback" stylesheet="../Styles/upload-theme.css" />
    <div id="uploadFeedback" class="pb-stack"></div>
</div>
```

## 21. Charts

Chart.js is opt-in for chart-heavy pals and the showcase only; it is not part of the canonical four
files. Load the platform-hosted resource in the page shell, then the adapter:
```html
<c:resource source="chartjs" version="4.0.0" name="chart.js" />
<script type="module" src="../Scripts/pb-charts.js"></script>
```

Chart markup lives in fragments and auto-rebuilds after AJAX swaps and theme/preset changes:
```html
<div class="pb-chart" style="height: 240px;">
    <canvas data-pb-chart="line" data-pb-height="240" data-pb-labels="Jan|Feb|Mar"
        data-pb-series="Records:45,72,58;Approvals:24,38,41" data-pb-fill="true"></canvas>
</div>
<div class="pb-chart" style="height: 240px;">
    <canvas data-pb-chart="bar" data-pb-height="240" data-pb-labels="Q1|Q2|Q3|Q4"
        data-pb-series="Revenue:32,48,61,78;Costs:18,24,32,41"></canvas>
</div>
<div class="pb-chart" style="height: 240px;">
    <canvas data-pb-chart="doughnut" data-pb-height="240" data-pb-labels="Draft|Review|Approved"
        data-pb-series="Status:28,22,34"></canvas>
</div>
```

No-JS fallback for tiny charts:
```html
<div class="pb-bars" role="img" aria-label="Records completed by month">
    <c:list name="months" id="month">
        <div class="pb-bar" style="--value: ${month.percent};">
            <span class="pb-bar-fill"></span>
            <span class="pb-bar-label">${month.label}</span>
        </div>
    </c:list>
</div>
<svg class="pb-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="0,24 20,18 40,20 60,10 80,13 100,4" />
</svg>
```

`pb-charts.js` silently no-ops if `window.Chart` is absent. Doughnut colors come from
`--ds-primary`, `--ds-accent`, `--ds-success`, `--ds-warning`, and `--ds-danger`.

## 22. Detail Panel / Drawer Content

Static detail card (drawer chrome is section 32). Use as an AJAX target for deferred detail.
```html
<div class="pb-detail" role="complementary">
    <div class="pb-detail-head">
        <div><h2 class="pb-card-title">${record.name}</h2><p class="pb-card-sub">${record.status}</p></div>
        <c:a action="editRecord?id=${record.id}" ajax-target="modalContent" class="pb-btn pb-btn-secondary">Edit</c:a>
    </div>
    <div class="pb-detail-body">
        <dl class="pb-description-list">
            <dt>Owner</dt><dd>${record.owner}</dd>
            <dt>Updated</dt><dd>${formatter.formatDateString(record.updateDate, "MMM d, yyyy")}</dd>
        </dl>
    </div>
</div>
```

## 23. Bulk Action Bar

Appears only after selection; keep compact and action-oriented.
```html
<div class="pb-bulkbar" test="${selectedCount gt 0}">
    <span class="pb-bulkbar-count">${selectedCount} selected</span>
    <div class="pb-cluster">
        <c:a action="archiveSelected" confirm="Archive selected records?" ajax-target="body" class="pb-btn pb-btn-secondary">Archive</c:a>
        <c:a action="clearSelection" ajax-target="body" class="pb-btn pb-btn-ghost">Clear</c:a>
    </div>
</div>
```

## 24. Breadcrumbs

Deep workflow/detail screens only; skip on shallow dashboards.
```html
<div class="pb-crumbs" role="navigation" aria-label="Breadcrumb">
    <c:a action="getDashboard" ajax-target="body">Dashboard</c:a>
    <span class="pb-crumb-sep">/</span>
    <span>${customer.name}</span>
</div>
```

## 25. Avatar / Person

Initials unless the pal has reliable user photos.
```html
<div class="pb-person">
    <span class="pb-avatar" aria-hidden="true">${user.initials}</span>
    <div><div class="pb-person-name">${user.fullName}</div><div class="pb-person-meta">${user.role}</div></div>
</div>
```

`.pb-avatar-lg` for the larger size.

## 26. Permission / Read-Only State

Use when an action is unavailable by role, record state, or lock. Never silently hide it.
```html
<div class="pb-permission" role="note" test="${!canEdit}">
    <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
    <p><strong>Read only</strong> You do not have permission to edit this record.</p>
</div>
```

## 27. Toast

Region is created lazily by pb-ui.js (`#pb-toasts`) — never render `.pb-toast-region` server-side.
```html
<button type="button" class="pb-btn pb-btn-secondary" data-pb-toast="Saved" data-pb-toast-type="ok">Test connection</button>
```

JS: needs pb-ui.js — declarative `data-pb-toast`/`data-pb-toast-type` fires on click; call
`window.pbToast(message, type)` from a page-level module script for programmatic cases (fragments
can't carry `<script>`, so trigger it from the shell's own event handling, not the AJAX response).
`type`: `ok`/`success`, `warn`/`warning`, `error`/`danger`, `info`.

## 28. Reveal / Basic Motion

Scroll-triggered reveal for dashboard sections and lists — richer typewriter/tilt/spotlight/ticker
recipes live in `marketing-library.md`.
```html
<div class="pb-card" data-animate="fade-up">
    <p class="pb-card-title">${record.name}</p>
</div>
<div class="pb-grid-3" data-animate-stagger="80">
    <div class="pb-stat" data-animate="fade-up">…</div>
    <div class="pb-stat" data-animate="fade-up">…</div>
</div>
```

JS: needs pb-motion.js (already loaded) — `data-animate="fade-up|fade-in|fade-left|fade-right|
zoom-in|blur-in|scale-in|slide-up-lg|flip-up"` adds `.is-inview` via one shared
`IntersectionObserver`, unobserves after reveal;
`data-animate-delay`/`data-animate-duration` (ms) on the element, `data-animate-stagger="80"` on
the container. No-ops to the final state under `prefers-reduced-motion: reduce`.

## 29. Button Group And Split Actions

Adjacent actions of equal scope, or a primary action plus overflow.
```html
<div class="pb-split">
    <c:a action="approveRecord?id=${record.id}" ajax-target="body" class="pb-btn pb-btn-primary">Approve</c:a>
    <button type="button" class="pb-icon-btn" aria-label="More approval actions" data-pb-toggle="dropdown" aria-expanded="false">
        <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
</div>
```

`.pb-btn-group` wraps 3+ equal-weight buttons the same way (no split divider).

## 30. Input Group, Textarea, Form Grid

Keep prefixes visual, never the only label.
```html
<div class="pb-form-grid">
    <div class="pb-field-group">
        <label class="pb-label" for="amount">Amount</label>
        <div class="pb-input-group">
            <span class="pb-input-addon">$</span>
            <input id="amount" name="amount" class="pb-input" inputmode="decimal" />
        </div>
    </div>
    <div class="pb-field-group pb-form-span">
        <label class="pb-label">Notes<c:field type="textarea" name="notes" class="pb-textarea" value="${notes}" /></label>
    </div>
</div>
```

## 31. Radio, Choice Cards, Segmented Control

Radio groups for one-of-many; choice cards when options need descriptions.
```html
<div class="pb-choice-grid" role="radiogroup" aria-label="Plan">
    <label class="pb-choice is-selected">
        <span><c:field type="radio" name="plan" value="starter" checked="${plan eq 'starter'}" /> Starter</span>
        <span class="pb-muted">For simple internal workflows.</span>
    </label>
</div>
<div class="pb-segmented">
    <button type="button" class="pb-segment active">Week</button>
    <button type="button" class="pb-segment">Month</button>
</div>
```

## 32. Dropdown Menu And Drawer

Menu (overflow actions) and drawer (contextual panel) share the same toggle mechanism.
```html
<div class="pb-menu-wrap">
    <button type="button" class="pb-icon-btn" aria-label="Record actions" data-pb-toggle="dropdown" aria-expanded="false">⋮</button>
    <div class="pb-menu">
        <c:a action="editRecord?id=${record.id}" ajax-target="modalContent" class="pb-menu-item">Edit</c:a>
        <div class="pb-menu-sep"></div>
        <c:a action="deleteRecord?id=${record.id}" confirm="Delete this record?" ajax-target="body" class="pb-menu-item">Delete</c:a>
    </div>
</div>

<button type="button" class="pb-btn pb-btn-secondary" data-pb-toggle="drawer" aria-expanded="false">Customer details</button>
<div class="pb-drawer-scrim"></div>
<div class="pb-drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
    <div class="pb-drawer-head"><h2 id="drawerTitle" class="pb-modal-title">Customer details</h2>
        <button type="button" class="pb-icon-btn" aria-label="Close" data-pb-toggle="drawer" aria-expanded="true">×</button></div>
    <div class="pb-drawer-body">…</div>
</div>
```

JS: needs pb-ui.js — `data-pb-toggle="dropdown|drawer"` toggles `.is-open` on the resolved target
(menu: nearest `.pb-menu`; drawer: `.pb-drawer`, or `data-pb-target` with more than one), plus
outside-click/Escape close. Sidebar burger (section 50) uses `data-pb-toggle="sidebar"` the same
way but stays open through outside clicks.

## 33. Tooltip, Popover, Hover Card

Pure CSS hover/focus reveal — no JS, no `hidden` toggling.
```html
<span class="pb-tip-wrap">
    <button type="button" class="pb-icon-btn" aria-label="Show SLA details">?</button>
    <div class="pb-popover">
        <div class="pb-hover-card"><strong>Response SLA</strong><span class="pb-muted">Business-hours response target.</span></div>
    </div>
</span>
```

`.pb-tooltip` for a short label above the trigger instead of `.pb-popover`.

## 34. Accordion And Collapsible

Native `details`/`summary` — accessible, simple, no JS.
```html
<div class="pb-accordion">
    <details open="open">
        <summary>Billing details</summary>
        <div class="pb-accordion-body">Plan, renewal, and invoice settings.</div>
    </details>
    <details>
        <summary>Security</summary>
        <div class="pb-accordion-body">Roles, locks, and audit events.</div>
    </details>
</div>
```

## 35. Command Palette

Global navigation and fast actions, opened by `Cmd/Ctrl+K` or a trigger button.
```html
<dialog class="pb-modal pb-command" data-pb-command="">
    <div class="pb-command-search">
        <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 19a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" /><path d="m21 21-4.35-4.35" /></svg>
        <input type="search" placeholder="Search actions, records, or pages" />
    </div>
    <div class="pb-command-list">
        <c:a action="newCustomer" ajax-target="modalContent" class="pb-command-item" data-pb-option=""><span>New customer</span><span class="pb-kbd">N</span></c:a>
        <a href="?view=customers" class="pb-command-item" data-pb-option="">Go to customers</a>
    </div>
</dialog>
```

JS: needs pb-ui.js — `data-pb-command` on the dialog wires `Cmd/Ctrl+K` to `showModal()` and
focuses the input; items need `data-pb-option` to be filterable/selectable (reuses the combobox
engine below); `Enter`/arrow keys navigate, `Escape` closes.

## 36. Combobox / Autocomplete

For simple cases, native `datalist`; for a richer filtered list, `data-pb-combobox`.
```html
<div class="pb-combobox" data-pb-combobox="">
    <input type="text" class="pb-input" placeholder="Search customers" autocomplete="off" />
    <div class="pb-combobox-list">
        <c:list name="customers" id="customer">
            <button type="button" data-pb-option="">${customer.name}</button>
        </c:list>
    </div>
</div>
```

JS: needs pb-ui.js — typing filters `[data-pb-option]` children by text match, hides the rest,
arrow keys move `.is-active`, `Enter`/click selects (fills the input, or navigates if the option
has `href`).

## 37. Date Picker And Calendar List

Native date input for simple capture; a calendar list for scheduling/review screens.
```html
<div class="pb-field-group">
    <label class="pb-label" for="dueDate">Due date</label>
    <input id="dueDate" name="dueDate" type="date" class="pb-input" value="${dueDate}" />
</div>
<div class="pb-calendar-list">
    <div class="pb-calendar-item">
        <div class="pb-calendar-date">${event.day}</div>
        <div><strong>${event.title}</strong><div class="pb-muted">${event.time}</div></div>
        <c:a action="viewEvent?id=${event.id}" ajax-target="body" class="pb-btn pb-btn-secondary">Open</c:a>
    </div>
</div>
```

## 38. Slider / Range

Only when approximate adjustment is acceptable; pair with a visible number.
```html
<label class="pb-range">
    <span class="pb-label">Risk threshold <strong class="pb-range-value">${threshold}%</strong></span>
    <input type="range" name="threshold" min="0" max="100" value="${threshold}" />
</label>
```

## 39. OTP / PIN Input
```html
<div class="pb-otp" data-pb-otp="" aria-label="Verification code">
    <input name="code1" maxlength="1" inputmode="numeric" />
    <input name="code2" maxlength="1" inputmode="numeric" />
    <input name="code3" maxlength="1" inputmode="numeric" />
    <input name="code4" maxlength="1" inputmode="numeric" />
</div>
```

JS: needs pb-ui.js — `data-pb-otp` auto-advances on digit entry, retreats on Backspace into an
empty box, and splits a pasted code across the boxes.

## 40. Data Grid Affordances

A full grid composes: table, sortable headers, filters, pagination, bulk bar, row menu, states.
```html
<th><c:a action="sortRecords?by=name" ajax-target="body" class="pb-sort">Customer
    <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9 4-4 4 4" /><path d="m16 15-4 4-4-4" /></svg>
</c:a></th>
```

## 41. Kanban / Status Board

Workflow state, not decorative task theater — every card needs a clear action path.
```html
<div class="pb-board">
    <div class="pb-board-col">
        <h3 class="pb-board-title"><span>Review</span><span>${reviewCount}</span></h3>
        <c:list name="reviewRecords" id="record">
            <c:a action="viewRecord?id=${record.id}" ajax-target="body" class="pb-board-card">
                <strong>${record.title}</strong>
                <span class="pb-muted">${record.owner}</span>
            </c:a>
        </c:list>
    </div>
</div>
```

## 42. Comments And Messages

Human conversation and approvals; keep system events in the activity feed (section 18) instead.
```html
<div class="pb-thread">
    <c:list name="comments" id="comment">
        <div class="pb-message">
            <span class="pb-avatar" aria-hidden="true">${comment.initials}</span>
            <div>
                <div class="pb-message-bubble">${comment.body}</div>
                <div class="pb-message-meta">${comment.author} - ${comment.createDate}</div>
            </div>
        </div>
    </c:list>
</div>
```

## 43. Attachment List

Show type, size, owner, status, actions alongside upload/download flows.
```html
<div class="pb-attachments">
    <c:list name="attachments" id="file">
        <div class="pb-attachment">
            <span class="pb-attachment-icon pb-attachment-icon--pdf" aria-hidden="true">PDF</span>
            <div><strong>${file.name}</strong><div class="pb-muted">${file.sizeLabel} - ${file.owner}</div></div>
            <c:a action="downloadFile?id=${file.id}" class="pb-btn pb-btn-secondary">Download</c:a>
        </div>
    </c:list>
</div>
```

Type modifiers: `.pb-attachment-icon--pdf`, `.pb-attachment-icon--xls`,
`.pb-attachment-icon--doc`, `.pb-attachment-icon--img`. Use the file extension text in the chip;
do not use CSS data-URI icons.

## 44. Code, Kbd, Preview Blocks

Developer pals, generated document previews, recipe catalogs.
```html
<div class="pb-code-card">
    <div class="pb-code-head">
        <strong>Markup</strong>
        <button type="button" class="pb-btn pb-btn-secondary" data-pb-copy="#buttonCode">Copy</button>
    </div>
    <pre id="buttonCode" class="pb-code">&lt;c:a action="save" class="pb-btn pb-btn-primary"&gt;Save&lt;/c:a&gt;</pre>
</div>
```

JS: needs pb-ui.js — `data-pb-copy="#selector"` copies that element's text to the clipboard and
flashes "Copied!"; omit the selector to copy the nearest `<pre>` instead.

## 45. Metrics Panel

When a dashboard needs hierarchy beyond equal-weight stat cards.
```html
<div class="pb-metrics">
    <div class="pb-metric-hero">
        <p class="pb-stat-label">Revenue at risk</p>
        <p class="pb-metric-value">${formatter.formatCurrency(riskTotal)}</p>
        <span class="pb-trend">${riskTrendLabel}</span>
    </div>
    <div class="pb-stat"><p class="pb-stat-label">Open</p><p class="pb-stat-value">${openCount}</p></div>
    <div class="pb-stat"><p class="pb-stat-label">Blocked</p><p class="pb-stat-value">${blockedCount}</p></div>
</div>
```

## 46. Split Panels And Scroll Area

Master-detail tools, document review, dense admin layouts.
```html
<div class="pb-split-panel">
    <div class="pb-split-list">
        <c:list name="records" id="record">
            <c:a action="viewRecord?id=${record.id}" ajax-target="splitDetail" class="pb-command-item">${record.title}</c:a>
        </c:list>
    </div>
    <div id="splitDetail" class="pb-split-detail"></div>
</div>
```

`.pb-scroll-fade` for a capped-height scrolling region elsewhere on the page.

## 47. Review / Approval Checklist

Workflow completion: what is done, what blocks submission, the next action.
```html
<div class="pb-checklist">
    <div class="pb-checkitem is-done">
        <span class="pb-checkmark"><svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7" /></svg></span>
        <div><strong>Profile complete</strong><div class="pb-muted">All required fields are present.</div></div>
        <span class="pb-badge pb-badge-success">Done</span>
    </div>
    <div class="pb-checkitem is-blocked">
        <span class="pb-checkmark">!</span>
        <div><strong>Approval missing</strong><div class="pb-muted">Finance approval is required before submit.</div></div>
        <c:a action="requestApproval" ajax-target="body" class="pb-btn pb-btn-secondary">Request</c:a>
    </div>
</div>
```

## 48. Theme Toggle
```html
<button type="button" class="pb-icon-btn" aria-label="Toggle dark mode" data-pb-theme-toggle="">
    <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
</button>
```

JS: needs pb-ui.js — flips `data-theme` on `<html>` between `light`/`dark` and persists to
`localStorage`; boot script re-applies the stored value before first paint, no server round trip.

## 49. Empty Chrome — Sidebar

The collapsible left rail for console app layouts (`.pb-layout` two-column grid).
```html
<div class="pb-layout">
    <aside class="pb-sidebar">
        <div class="pb-sidebar-search"><input type="search" class="pb-input" placeholder="Search" data-pb-filter=".pb-sidebar-list .pb-nav-link" /></div>
        <nav class="pb-sidebar-list">
            <c:a action="getDashboard" workflow="console" class="pb-nav-link ${dashboard_active}">Dashboard</c:a>
        </nav>
    </aside>
    <main id="body" class="pb-main"><c:fragment name="${frag}" /></main>
</div>
```

Mobile: `.pb-sidebar` is fixed off-canvas below 860px; toggle it with `data-pb-toggle="sidebar"`
on the navbar burger (section 50), which adds `.is-open`.

JS: needs pb-ui.js — `data-pb-filter` on any input takes a CSS selector and live-hides matched
elements whose text doesn't contain the typed query (works for any list, not just the sidebar).

---

## 50. Navbar (App)

Sticky top bar for console pals; pairs with the sidebar above or stands alone.
```html
<header class="pb-navbar">
    <div class="pb-navbar-inner">
        <a class="pb-navbar-brand" href="?">Acme Console</a>
        <nav class="pb-navbar-links">
            <a href="?view=dashboard" class="active">Dashboard</a>
            <a href="?view=records">Records</a>
        </nav>
        <button type="button" class="pb-navbar-burger" aria-label="Toggle menu" data-pb-toggle="sidebar" aria-expanded="false">
            <span></span><span></span><span></span>
        </button>
    </div>
</header>
```

JS: needs pb-ui.js — the burger only appears below 760px (CSS media query); wire it to
`data-pb-toggle="sidebar"` when the page has a `.pb-sidebar` to reveal. For the marketing variant
see `marketing-library.md` (`.pb-navbar--marketing`).

## 51. Footer
```html
<footer class="pb-footer">
    <div class="pb-footer-inner">
        <div><p class="pb-footer-col-title">Product</p></div>
        <div>
            <p class="pb-footer-col-title">Company</p>
            <ul class="pb-footer-links"><li><a href="?view=about">About</a></li></ul>
        </div>
    </div>
    <div class="pb-footer-bottom"><span class="pb-muted">© 2026 Acme</span></div>
</footer>
```

## 52. Media And Placeholder

Aspect-ratio boxes for images, with a diagonal-hatch placeholder when no image exists yet.
```html
<div class="pb-media">
    <img src="${record.imageUrl}" alt="${record.name}" />
</div>
<div class="pb-media pb-media--square">
    <div class="pb-placeholder">
        <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
    </div>
</div>
```

Variants: `.pb-media--square` (1:1), `.pb-media--portrait` (3:4); default is 16:9.

## 53. Scroll Progress

Thin fixed bar tracking page scroll, typically placed once right after `<body>` opens.
```html
<div class="pb-scroll-progress" data-scroll-progress=""></div>
```

JS: needs pb-motion.js (already loaded) — `data-scroll-progress` sets the element's width to the
page's scroll percentage on scroll/resize; no other markup needed.

---

## Responsive And Review Checklist

- Breakpoints: 1024px sidebar may narrow; 760px shell stacks and toolbars wrap; 640px tables
  collapse to `data-label` cards; coarse pointers get 44px-tall targets (already baked into the
  shipped CSS via `@media (pointer: coarse)`).
- Values come from `--ds-*` tokens; new pals may author reference-driven component tweaks in
  human-readable `styles/styles.css`, while token-only recolors may remain in `PAL OVERRIDES`.
- Every interactive component keeps hover/focus-visible/active/disabled states — they come free
  with the class, don't override them.
- Data surfaces define loading, empty, and error states (section 16).
- Forms carry validation messages with `role="alert"`.
- Exactly one primary action (`.pb-btn-primary`) per view.
- Icons: one inline SVG family, decorative icons `aria-hidden="true"`, icon-only buttons get
  `aria-label`.
- No undocumented `c:` attributes, no inline fragment `<script>`, no `fetch`/ClientPal calls.
- Motion is `data-animate`/`data-ticker`/etc. from pb-motion.js — never add a script tag or
  animation library to a fragment.
