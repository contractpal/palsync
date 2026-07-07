# Palbuilder Component Library

Palbuilder-ready recipes for `DESIGN_SYSTEM.md` and `COMPONENTS.md`. These are patterns to adapt,
not a package to install. They use plain CSS, XHTML-safe markup, inline SVG icons, GSAP-ready
external JavaScript hooks, and documented `c:` tag patterns.

Quality target: match or beat the practical coverage of shadcn/ui, Radix, Headless UI, Polaris,
Carbon, and Atlassian patterns while staying Palbuilder-native. A generated pal should feel
intentional before any custom brand work: crisp hierarchy, complete states, modern density, clean
SVG icons, restrained motion, and enough component coverage that agents do not invent one-off UI.

## Naming And Files

Recommended files:

- `styles/design-system.css` - tokens, base styles, components.
- `scripts/vendor/gsap.min.js` - local GSAP build when scripted animation is used.
- `scripts/ui-main.js` - page-level module loaded once from the page shell when JS is needed.
- `fragments/common/*` - shared composites such as nav, modal bodies, alerts, empty states.

Recommended class prefix: `pb-`. It avoids collisions with Bootstrap and old pal CSS.

Optional Fontshare load in the page head, when external fonts are allowed. Replace the URL with the
project's selected Fontshare families; otherwise keep the system stack and omit this block.

```html
<link rel="preconnect" href="https://api.fontshare.com" />
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,800&amp;display=swap" rel="stylesheet" />
```

Page shell load:

```html
<html xmlns:c="contractpal">
    <head>
        <title>${pageTitle}</title>
        <link rel="STYLESHEET" type="text/css" href="../Styles/design-system.css" />
        <script src="../Scripts/vendor/gsap.min.js"></script>
        <script type="module" src="../Scripts/ui-main.js"></script>
    </head>
    <body>
        <div id="cp-root" class="pb-app">
            <c:fragment name="common/nav" />
            <div id="body" class="pb-main">
                <c:fragment name="${frag}" />
            </div>
            <c:fragment name="cloudpiston/ui/modalShell" />
            <c:debug />
        </div>
    </body>
</html>
```

Fragment shell:

```html
<c:ignore xmlns:c="contractpal">
    <div class="pb-section">
        <!-- fragment content -->
    </div>
</c:ignore>
```

## Base CSS

```css
:root {
  --ds-bg: #f7f8fb;
  --ds-bg-subtle: #f0f2f5;
  --ds-surface: #ffffff;
  --ds-surface-raised: #fcfcfd;
  --ds-text: #101114;
  --ds-text-muted: #5f6673;
  --ds-text-soft: #848b98;
  --ds-border: #e1e5eb;
  --ds-border-strong: #c7ced8;
  --ds-focus: #3b82f6;
  --ds-focus-ring: #dbeafe;
  --ds-primary: #18181b;
  --ds-primary-hover: #27272a;
  --ds-primary-soft: #eceef2;
  --ds-primary-text: #ffffff;
  --ds-accent: #2563eb;
  --ds-accent-soft: #dbeafe;
  --ds-success: #15803d;
  --ds-success-soft: #dcfce7;
  --ds-warning: #b45309;
  --ds-warning-soft: #fef3c7;
  --ds-danger: #b42318;
  --ds-danger-soft: #fee2e2;
  --ds-info: #1d4ed8;
  --ds-info-soft: #dbeafe;

  --ds-font-ui: "Satoshi", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ds-font-display: var(--ds-font-ui);
  --ds-font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

  --ds-space-1: 4px;
  --ds-space-2: 8px;
  --ds-space-3: 12px;
  --ds-space-4: 16px;
  --ds-space-5: 20px;
  --ds-space-6: 24px;
  --ds-space-8: 32px;
  --ds-space-10: 40px;
  --ds-space-12: 48px;
  --ds-space-16: 64px;

  --ds-radius-xs: 4px;
  --ds-radius-sm: 6px;
  --ds-radius-md: 8px;
  --ds-radius-lg: 12px;
  --ds-radius-pill: 999px;
  --ds-shadow-xs: 0 1px 1px rgba(16, 17, 20, 0.04);
  --ds-shadow-sm: 0 1px 2px rgba(16, 17, 20, 0.08);
  --ds-shadow-md: 0 16px 40px rgba(16, 17, 20, 0.12);
  --ds-shadow-pop: 0 24px 70px rgba(16, 17, 20, 0.18);
  --ds-ease: cubic-bezier(0.2, 0, 0, 1);
  --ds-duration-fast: 120ms;
  --ds-duration-med: 180ms;
  --ds-duration-slow: 280ms;
}

[data-theme="dark"] {
  --ds-bg: #0b0d10;
  --ds-bg-subtle: #11151a;
  --ds-surface: #161a20;
  --ds-surface-raised: #1d232b;
  --ds-text: #f6f7f9;
  --ds-text-muted: #b6bdc8;
  --ds-text-soft: #8b94a3;
  --ds-border: #2a3039;
  --ds-border-strong: #3c4654;
  --ds-focus: #60a5fa;
  --ds-focus-ring: #172a45;
  --ds-primary: #f6f7f9;
  --ds-primary-hover: #ffffff;
  --ds-primary-soft: #242a33;
  --ds-primary-text: #0b0d10;
  --ds-accent: #60a5fa;
  --ds-accent-soft: #172a45;
  --ds-success: #4ade80;
  --ds-success-soft: #12351f;
  --ds-warning: #fbbf24;
  --ds-warning-soft: #422b07;
  --ds-danger: #fb7185;
  --ds-danger-soft: #43151c;
  --ds-info: #93c5fd;
  --ds-info-soft: #172a45;
  --ds-shadow-sm: none;
  --ds-shadow-md: 0 16px 40px rgba(0, 0, 0, 0.35);
  --ds-shadow-pop: 0 24px 70px rgba(0, 0, 0, 0.50);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--ds-bg);
  color: var(--ds-text);
  font: 400 1rem/1.5 var(--ds-font-ui);
  font-variant-numeric: tabular-nums;
}
a { color: inherit; }
.pb-app { min-height: 100vh; background: var(--ds-bg); color: var(--ds-text); }
.pb-main { width: 100%; max-width: 1200px; margin: 0 auto; padding: var(--ds-space-8); }
.pb-section { display: grid; gap: var(--ds-space-6); }
.pb-stack { display: grid; gap: var(--ds-space-4); }
.pb-cluster { display: flex; align-items: center; gap: var(--ds-space-3); flex-wrap: wrap; }
.pb-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ds-space-6); }
.pb-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--ds-space-6); }
.pb-surface { background: var(--ds-surface); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); box-shadow: var(--ds-shadow-xs); }
.pb-muted { color: var(--ds-text-muted); }
.pb-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }

@media (max-width: 760px) {
  .pb-main { padding: var(--ds-space-5); }
  .pb-grid-2, .pb-grid-3 { grid-template-columns: 1fr; }
}
```

## 1. Buttons

States: default, hover, focus-visible, active, disabled, loading. Use one primary action per view.

```css
.pb-btn {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ds-space-2);
  border: 1px solid transparent;
  border-radius: var(--ds-radius-sm);
  padding: 0 var(--ds-space-4);
  font: 600 0.875rem/1 var(--ds-font-ui);
  text-decoration: none;
  cursor: pointer;
  transition: transform var(--ds-duration-fast) var(--ds-ease), background var(--ds-duration-fast) var(--ds-ease), border-color var(--ds-duration-fast) var(--ds-ease), box-shadow var(--ds-duration-fast) var(--ds-ease), color var(--ds-duration-fast) var(--ds-ease);
}
.pb-btn:hover { transform: translateY(-1px); }
.pb-btn:active { transform: translateY(0); }
.pb-btn:focus-visible { outline: 2px solid var(--ds-focus); outline-offset: 2px; }
.pb-btn[disabled], .pb-btn.is-disabled { opacity: 0.55; cursor: not-allowed; pointer-events: none; }
.pb-btn-primary { background: var(--ds-primary); color: var(--ds-primary-text); box-shadow: var(--ds-shadow-sm); }
.pb-btn-primary:hover { background: var(--ds-primary-hover); box-shadow: var(--ds-shadow-md); }
.pb-btn-secondary { background: var(--ds-surface); color: var(--ds-text); border-color: var(--ds-border); }
.pb-btn-secondary:hover { border-color: var(--ds-border-strong); box-shadow: var(--ds-shadow-sm); }
.pb-btn-ghost { background: transparent; color: var(--ds-text-muted); }
.pb-btn-ghost:hover { background: var(--ds-bg-subtle); color: var(--ds-text); }
.pb-btn-danger { background: var(--ds-danger); color: #ffffff; }
@media (pointer: coarse) { .pb-btn { min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { .pb-btn { transition: none; } .pb-btn:hover { transform: none; } }
```

Server action:

```html
<c:a action="saveRecord" ajax-target="body" class="pb-btn pb-btn-primary">Save</c:a>
<c:a action="deleteRecord?id=${record.id}" confirm="Delete this record?" ajax-target="body" class="pb-btn pb-btn-danger">Delete</c:a>
```

JS-only action:

```html
<button type="button" class="pb-btn pb-btn-ghost" onclick="hideModal()">Cancel</button>
```

Busy state:

```html
<button type="button" class="pb-btn pb-btn-primary" disabled="disabled" aria-busy="true">
    <span class="pb-spinner" aria-hidden="true"></span>
    Saving
</button>
```

```css
.pb-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.35);
  border-top-color: currentColor;
  animation: pb-spin 700ms linear infinite;
}
@keyframes pb-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pb-spinner { animation-duration: 1600ms; } }
```

## 2. Icon Buttons And Icons

Default icon families: Iconoir, Tabler, or Phosphor inline SVG. Pick one family per pal and keep
stroke width, caps, joins, and viewBox consistent. Do not use icon fonts, image icons, external
sprite injection, or JS replacers.

```css
.pb-icon { width: 16px; height: 16px; flex: 0 0 auto; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.pb-icon-lg { width: 20px; height: 20px; }
.pb-icon-btn {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-sm);
  background: var(--ds-surface);
  color: var(--ds-text-muted);
  cursor: pointer;
  transition: background var(--ds-duration-fast) var(--ds-ease), border-color var(--ds-duration-fast) var(--ds-ease), color var(--ds-duration-fast) var(--ds-ease), transform var(--ds-duration-fast) var(--ds-ease);
}
.pb-icon-btn:hover { color: var(--ds-text); border-color: var(--ds-border-strong); transform: translateY(-1px); }
.pb-icon-btn:focus-visible { outline: 2px solid var(--ds-focus); outline-offset: 2px; }
```

```html
<button type="button" class="pb-icon-btn" aria-label="Search" onclick="palUI.openSearch()">
    <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 19a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" /><path d="m21 21-4.35-4.35" /></svg>
</button>
```

Icon rules:
- Use decorative icons with `aria-hidden="true"` and no label.
- Icon-only buttons must have `aria-label`.
- SVG children must be valid XHTML: self-close `<path />`, `<circle />`, `<rect />`, `<line />`.
- Do not paste brand icons unless the license allows it.

## 3. Fields

Use `c:field` for server-bound fields. Do not put ARIA attributes on `c:field`; use label and
message wrappers.

```css
.pb-field-group { display: grid; gap: var(--ds-space-2); }
.pb-label { display: block; color: var(--ds-text-muted); font-size: 0.8125rem; font-weight: 600; }
.pb-input, .pb-select, .pb-textarea {
  width: 100%;
  min-height: 40px;
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-sm);
  background: var(--ds-surface);
  color: var(--ds-text);
  padding: 0 var(--ds-space-3);
  font: 400 0.9375rem/1.4 var(--ds-font-ui);
}
.pb-textarea { min-height: 112px; padding-top: var(--ds-space-3); resize: vertical; }
.pb-input:focus, .pb-select:focus, .pb-textarea:focus {
  outline: none;
  border-color: var(--ds-focus);
  box-shadow: 0 0 0 3px var(--ds-focus-ring);
}
.pb-help { color: var(--ds-text-soft); font-size: 0.8125rem; }
.pb-field-error { color: var(--ds-danger); font-size: 0.8125rem; }
.pb-input.is-error, .pb-select.is-error, .pb-textarea.is-error { border-color: var(--ds-danger); }
```

```html
<div class="pb-field-group">
    <label class="pb-label">
        Email
        <c:field type="text" name="email" class="pb-input ${emailErrorClass}" value="${email}" placeholder="name@example.com" />
    </label>
    <p class="pb-field-error" role="alert" test="${!empty(emailError)}">${emailError}</p>
</div>
```

Plain input when ARIA on control is required:

```html
<div class="pb-field-group">
    <label class="pb-label" for="email">Email</label>
    <input type="email" id="email" name="email" class="pb-input is-error" aria-invalid="true" aria-describedby="emailError" />
    <p id="emailError" class="pb-field-error" role="alert">Enter a valid email address.</p>
</div>
```

## 4. Selects

```html
<div class="pb-field-group">
    <label class="pb-label" for="statusFilter">Status</label>
    <c:select id="statusFilter" name="statusFilter" action="filterRecords" ajaxTarget="body" eventType="onchange" class="pb-select">
        <c:field type="option" value="all" name="All" selected="${statusFilter eq 'all'}"></c:field>
        <c:field type="option" value="open" name="Open" selected="${statusFilter eq 'open'}"></c:field>
        <c:field type="option" value="closed" name="Closed" selected="${statusFilter eq 'closed'}"></c:field>
    </c:select>
</div>
```

## 5. Checkbox And Toggle

```css
.pb-check { display: inline-flex; align-items: center; gap: var(--ds-space-2); color: var(--ds-text); font-size: 0.9375rem; }
.pb-check input { width: 18px; height: 18px; accent-color: var(--ds-primary); }
.pb-toggle { display: inline-flex; align-items: center; gap: var(--ds-space-2); }
.pb-toggle-track { width: 40px; height: 22px; border-radius: var(--ds-radius-pill); background: var(--ds-border-strong); position: relative; transition: background 140ms var(--ds-ease); }
.pb-toggle-track::after { content: ""; width: 18px; height: 18px; border-radius: 50%; background: #ffffff; position: absolute; top: 2px; left: 2px; transition: transform 140ms var(--ds-ease); box-shadow: var(--ds-shadow-sm); }
.pb-toggle input:checked + .pb-toggle-track { background: var(--ds-primary); }
.pb-toggle input:checked + .pb-toggle-track::after { transform: translateX(18px); }
```

```html
<label class="pb-check">
    <c:field type="checkbox" name="active" value="true" checked="${active eq 'true'}" />
    Active
</label>
```

Toggle with plain input:

```html
<label class="pb-toggle">
    <input type="checkbox" name="notify" checked="checked" />
    <span class="pb-toggle-track" aria-hidden="true"></span>
    Notify me
</label>
```

## 6. Cards

Use cards for repeated items and framed tools. Do not put cards inside cards.

```css
.pb-card {
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  box-shadow: var(--ds-shadow-sm);
  padding: var(--ds-space-5);
}
.pb-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--ds-space-4); margin-bottom: var(--ds-space-4); }
.pb-card-title { margin: 0; font-size: 1rem; line-height: 1.25; font-weight: 700; color: var(--ds-text); }
.pb-card-sub { margin: 4px 0 0; color: var(--ds-text-soft); font-size: 0.875rem; }
```

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

## 7. Page Header And Toolbar

```css
.pb-page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--ds-space-6); margin-bottom: var(--ds-space-8); }
.pb-title { margin: 0; font: 750 2rem/1.08 var(--ds-font-display); color: var(--ds-text); }
.pb-subtitle { margin: var(--ds-space-2) 0 0; color: var(--ds-text-muted); font-size: 0.9375rem; max-width: 62ch; }
.pb-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-space-4); padding: var(--ds-space-3); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); }
@media (max-width: 760px) { .pb-title { font-size: 1.625rem; } .pb-page-head, .pb-toolbar { align-items: stretch; flex-direction: column; } }
```

```html
<div class="pb-page-head">
    <div>
        <h1 class="pb-title">Customers</h1>
        <p class="pb-subtitle">${customerCount} active customers</p>
    </div>
    <c:a action="newCustomer" ajax-target="modalContent" class="pb-btn pb-btn-primary">New customer</c:a>
</div>
```

## 8. Navigation

Workflow sets active classes, or the template uses `c:set`.

```css
.pb-nav { display: flex; gap: var(--ds-space-1); padding: var(--ds-space-2); background: var(--ds-surface); border-bottom: 1px solid var(--ds-border); }
.pb-nav-link { display: inline-flex; align-items: center; gap: var(--ds-space-2); min-height: 40px; padding: 0 var(--ds-space-3); border-radius: var(--ds-radius-sm); color: var(--ds-text-muted); text-decoration: none; font-weight: 600; font-size: 0.875rem; }
.pb-nav-link:hover { background: var(--ds-bg-subtle); color: var(--ds-text); }
.pb-nav-link.active { background: var(--ds-primary-soft); color: var(--ds-primary); }
```

```html
<c:ignore xmlns:c="contractpal">
    <div class="pb-nav" role="navigation" aria-label="Primary">
        <c:a action="getDashboard" workflow="console" class="pb-nav-link ${dashboard_active}">Dashboard</c:a>
        <c:a action="getRecords" workflow="console" class="pb-nav-link ${records_active}">Records</c:a>
        <c:a action="getSettings" workflow="console" class="pb-nav-link ${settings_active}">Settings</c:a>
    </div>
</c:ignore>
```

## 9. Tabs

Tabs in Palbuilder are usually server actions that swap a fragment.

```css
.pb-tabs { display: flex; gap: var(--ds-space-1); border-bottom: 1px solid var(--ds-border); }
.pb-tab { position: relative; min-height: 40px; padding: 0 var(--ds-space-4); display: inline-flex; align-items: center; color: var(--ds-text-muted); text-decoration: none; font-weight: 600; }
.pb-tab:hover { color: var(--ds-text); }
.pb-tab.active { color: var(--ds-primary); }
.pb-tab.active::after { content: ""; position: absolute; left: var(--ds-space-3); right: var(--ds-space-3); bottom: -1px; height: 2px; background: var(--ds-primary); border-radius: var(--ds-radius-pill); }
```

```html
<div class="pb-tabs" role="tablist">
    <c:a action="showOverview?id=${record.id}" ajax-target="detailPanel" class="pb-tab ${overview_active}">Overview</c:a>
    <c:a action="showActivity?id=${record.id}" ajax-target="detailPanel" class="pb-tab ${activity_active}">Activity</c:a>
</div>
```

## 10. Badges And Status Chips

```css
.pb-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: var(--ds-radius-pill);
  padding: 3px 10px;
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1.4;
}
.pb-badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pb-badge-neutral { background: var(--ds-bg-subtle); color: var(--ds-text-muted); }
.pb-badge-success { background: var(--ds-success-soft); color: var(--ds-success); }
.pb-badge-warning { background: var(--ds-warning-soft); color: var(--ds-warning); }
.pb-badge-danger { background: var(--ds-danger-soft); color: var(--ds-danger); }
.pb-badge-info { background: var(--ds-info-soft); color: var(--ds-info); }
```

```html
<c:choose>
    <c:when test="${record.status eq 'active'}"><span class="pb-badge pb-badge-success">Active</span></c:when>
    <c:when test="${record.status eq 'paused'}"><span class="pb-badge pb-badge-warning">Paused</span></c:when>
    <c:when test="${record.status eq 'blocked'}"><span class="pb-badge pb-badge-danger">Blocked</span></c:when>
    <c:otherwise><span class="pb-badge pb-badge-neutral">Draft</span></c:otherwise>
</c:choose>
```

## 11. Alerts And Toasts

```css
.pb-alert { display: flex; align-items: flex-start; gap: var(--ds-space-3); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); padding: var(--ds-space-4); }
.pb-alert-success { border-color: var(--ds-success); background: var(--ds-success-soft); color: var(--ds-success); }
.pb-alert-warning { border-color: var(--ds-warning); background: var(--ds-warning-soft); color: var(--ds-warning); }
.pb-alert-danger { border-color: var(--ds-danger); background: var(--ds-danger-soft); color: var(--ds-danger); }
.pb-alert-title { margin: 0; color: var(--ds-text); font-weight: 700; }
.pb-alert-msg { margin: 2px 0 0; color: var(--ds-text-muted); font-size: 0.875rem; }
```

```html
<div class="pb-alert pb-alert-danger" role="alert" test="${!empty(errorMessage)}">
    <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
    <div>
        <p class="pb-alert-title">Could not save</p>
        <p class="pb-alert-msg">${errorMessage}</p>
    </div>
</div>
```

## 12. Tables

Dense, scannable, numeric alignment. Every `td` gets `data-label` for mobile card collapse.

```css
.pb-table-wrap { overflow-x: auto; border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); }
.pb-table { width: 100%; border-collapse: collapse; }
.pb-table th { padding: 12px 16px; background: var(--ds-bg-subtle); color: var(--ds-text-muted); text-align: left; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.pb-table td { padding: 14px 16px; border-top: 1px solid var(--ds-border); color: var(--ds-text); font-size: 0.875rem; vertical-align: middle; }
.pb-table tbody tr:hover { background: var(--ds-surface-raised); }
.pb-num { text-align: right; font-variant-numeric: tabular-nums; }
.pb-muted { color: var(--ds-text-muted); }

@media (max-width: 640px) {
  .pb-table-wrap { border: 0; background: transparent; overflow: visible; }
  .pb-table, .pb-table tbody, .pb-table tr, .pb-table td { display: block; width: 100%; }
  .pb-table thead { display: none; }
  .pb-table tr { border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); margin-bottom: var(--ds-space-3); overflow: hidden; }
  .pb-table td { border: 0; display: flex; justify-content: space-between; gap: var(--ds-space-4); padding: 10px 14px; }
  .pb-table td::before { content: attr(data-label); color: var(--ds-text-soft); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
}
```

```html
<div class="pb-table-wrap">
    <table class="pb-table">
        <thead>
            <tr>
                <th>Customer</th>
                <th>Status</th>
                <th class="pb-num">Balance</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            <c:list name="customers" id="customer">
                <tr>
                    <td data-label="Customer">
                        <strong>${customer.name}</strong><br />
                        <span class="pb-muted">${customer.email}</span>
                    </td>
                    <td data-label="Status"><span class="pb-badge pb-badge-success">${customer.status}</span></td>
                    <td data-label="Balance" class="pb-num">${formatter.formatCurrency(customer.balance)}</td>
                    <td data-label="Actions">
                        <c:a action="editCustomer?id=${customer.customerId}" ajax-target="modalContent" class="pb-btn pb-btn-secondary">Edit</c:a>
                    </td>
                </tr>
            </c:list>
        </tbody>
    </table>
</div>
```

Clickable row:

```html
<c:tr action="viewCustomer?id=${customer.customerId}" ajaxTarget="body" eventType="onclick" class="pb-row-click">
    <td data-label="Customer">${customer.name}</td>
    <td data-label="Status">${customer.status}</td>
</c:tr>
```

## 13. Filter Bar And Search

```css
.pb-filterbar { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-space-3); flex-wrap: wrap; padding: var(--ds-space-3); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); }
.pb-search { min-width: 260px; flex: 1 1 280px; }
```

```html
<div class="pb-filterbar">
    <div class="pb-search pb-field-group">
        <label class="pb-sr-only" for="q">Search</label>
        <c:field type="text" id="q" name="q" value="${q}" class="pb-input" placeholder="Search records" />
    </div>
    <div class="pb-cluster">
        <c:select name="statusFilter" action="filterRecords" ajaxTarget="body" eventType="onchange" class="pb-select">
            <c:field type="option" value="all" name="All"></c:field>
            <c:field type="option" value="open" name="Open"></c:field>
        </c:select>
        <c:a action="filterRecords" ajax-target="body" class="pb-btn pb-btn-secondary">Apply</c:a>
    </div>
</div>
```

## 14. Pagination

```css
.pb-pagination { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-space-3); margin-top: var(--ds-space-4); color: var(--ds-text-muted); font-size: 0.875rem; }
```

```html
<div class="pb-pagination" role="navigation" aria-label="Pagination">
    <c:a action="listRecords?page=${prevPage}" ajax-target="body" class="pb-btn pb-btn-secondary" test="${page gt 1}">Previous</c:a>
    <span>Page ${page} of ${pageCount}</span>
    <c:a action="listRecords?page=${nextPage}" ajax-target="body" class="pb-btn pb-btn-secondary" test="${page lt pageCount}">Next</c:a>
</div>
```

## 15. Stat Cards

```css
.pb-stat { background: var(--ds-surface); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); padding: var(--ds-space-5); box-shadow: var(--ds-shadow-sm); }
.pb-stat-label { margin: 0; color: var(--ds-text-muted); font-size: 0.8125rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.pb-stat-value { margin: var(--ds-space-2) 0 0; color: var(--ds-text); font: 800 2rem/1 var(--ds-font-display); font-variant-numeric: tabular-nums; }
.pb-stat-note { margin: var(--ds-space-2) 0 0; color: var(--ds-text-soft); font-size: 0.875rem; }
```

```html
<div class="pb-stat">
    <p class="pb-stat-label">Open invoices</p>
    <p class="pb-stat-value">${openInvoiceCount}</p>
    <p class="pb-stat-note">${formatter.formatCurrency(openInvoiceTotal)}</p>
</div>
```

## 16. Progress Bar And Ring

Bar:

```css
.pb-progress { height: 8px; border-radius: var(--ds-radius-pill); background: var(--ds-bg-subtle); overflow: hidden; }
.pb-progress-fill { display: block; height: 100%; width: calc(var(--value) * 1%); background: var(--ds-primary); border-radius: inherit; transition: width 500ms var(--ds-ease); }
@media (prefers-reduced-motion: reduce) { .pb-progress-fill { transition: none; } }
```

```html
<div class="pb-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${record.percent}">
    <span class="pb-progress-fill" style="--value: ${record.percent};"></span>
</div>
```

Ring:

```css
.pb-ring { position: relative; width: 88px; height: 88px; }
.pb-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.pb-ring circle { fill: none; stroke-width: 8; stroke-dasharray: 326.726px; }
.pb-ring-track { stroke: var(--ds-bg-subtle); }
.pb-ring-value { stroke: var(--ds-primary); stroke-linecap: round; stroke-dashoffset: calc(326.726px - (326.726px * var(--value) / 100)); transition: stroke-dashoffset 500ms var(--ds-ease); }
.pb-ring-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-weight: 800; }
```

```html
<div class="pb-ring" style="--value: ${record.percent};">
    <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="pb-ring-track" cx="60" cy="60" r="52" />
        <circle class="pb-ring-value" cx="60" cy="60" r="52" />
    </svg>
    <span class="pb-ring-label">${record.percent}%</span>
</div>
```

## 17. Empty, Loading, Error

```css
.pb-state { display: grid; place-items: center; gap: var(--ds-space-4); min-height: 220px; padding: var(--ds-space-8); text-align: center; color: var(--ds-text-muted); }
.pb-state-title { margin: 0; color: var(--ds-text); font-size: 1.125rem; font-weight: 700; }
.pb-state-msg { margin: 0; max-width: 44ch; }
.pb-skeleton { display: block; border-radius: var(--ds-radius-sm); background: var(--ds-bg-subtle); position: relative; overflow: hidden; }
.pb-skeleton::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent); animation: pb-shimmer 1400ms ease-in-out infinite; }
.pb-skeleton-line { height: 14px; }
.pb-skeleton-title { height: 24px; }
@keyframes pb-shimmer { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .pb-skeleton::after { animation: none; } }
```

Empty:

```html
<div class="pb-state" test="${empty(customers)}">
    <p class="pb-state-title">No customers yet.</p>
    <c:a action="newCustomer" ajax-target="modalContent" class="pb-btn pb-btn-primary">Add customer</c:a>
</div>
```

Error:

```html
<div class="pb-state" role="alert" test="${!empty(errorMessage)}">
    <p class="pb-state-title">Could not load records.</p>
    <p class="pb-state-msg">${errorMessage}</p>
    <c:a action="listRecords" ajax-target="body" class="pb-btn pb-btn-secondary">Try again</c:a>
</div>
```

Skeleton:

```html
<div class="pb-card" aria-hidden="true">
    <span class="pb-skeleton pb-skeleton-title" style="width: 45%;"></span>
    <span class="pb-skeleton pb-skeleton-line" style="width: 72%; margin-top: 12px;"></span>
    <span class="pb-skeleton pb-skeleton-line" style="width: 60%; margin-top: 8px;"></span>
</div>
```

## 18. Modal Body

Page shell includes `cloudpiston/ui/modalShell`. Load modal content with `ajax-target="modalContent"`.

```css
.pb-modal-head, .pb-modal-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-space-4); padding: var(--ds-space-5); border-bottom: 1px solid var(--ds-border); }
.pb-modal-foot { border-top: 1px solid var(--ds-border); border-bottom: 0; justify-content: flex-end; }
.pb-modal-title { margin: 0; font-size: 1.125rem; font-weight: 700; }
.pb-modal-body { padding: var(--ds-space-5); display: grid; gap: var(--ds-space-4); }
```

```html
<c:ignore xmlns:c="contractpal">
    <div class="pb-modal-head">
        <h2 class="pb-modal-title">Edit customer</h2>
        <button type="button" class="pb-icon-btn" aria-label="Close" onclick="hideModal()">
            <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
    </div>
    <div class="pb-modal-body">
        <span id="modalFeedback" role="alert"></span>
        <div class="pb-field-group">
            <label class="pb-label">
                Customer name
                <c:field type="text" name="customerName" class="pb-input" value="${customer.name}" />
            </label>
        </div>
    </div>
    <div class="pb-modal-foot">
        <button type="button" class="pb-btn pb-btn-ghost" onclick="hideModal()">Cancel</button>
        <c:a action="saveCustomer?id=${customer.customerId}" ajax-target="modalFeedback" class="pb-btn pb-btn-primary">Save</c:a>
    </div>
</c:ignore>
```

## 19. Activity Feed And Timeline

```css
.pb-feed { display: grid; gap: var(--ds-space-4); }
.pb-feed-item { display: grid; grid-template-columns: 28px 1fr; gap: var(--ds-space-3); }
.pb-feed-dot { width: 10px; height: 10px; margin: 7px auto 0; border-radius: 50%; background: var(--ds-primary); box-shadow: 0 0 0 4px var(--ds-primary-soft); }
.pb-feed-title { margin: 0; color: var(--ds-text); font-weight: 700; }
.pb-feed-meta { margin: 2px 0 0; color: var(--ds-text-soft); font-size: 0.8125rem; }
```

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

## 20. Stepper

```css
.pb-stepper { display: grid; gap: var(--ds-space-3); }
.pb-step { display: grid; grid-template-columns: 28px 1fr; gap: var(--ds-space-3); color: var(--ds-text-muted); }
.pb-step-mark { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--ds-border); background: var(--ds-surface); font-weight: 700; font-size: 0.8125rem; }
.pb-step.is-active { color: var(--ds-text); }
.pb-step.is-active .pb-step-mark { background: var(--ds-primary); border-color: var(--ds-primary); color: var(--ds-primary-text); }
.pb-step.is-done .pb-step-mark { background: var(--ds-primary-soft); border-color: var(--ds-primary-soft); color: var(--ds-primary); }
```

```html
<div class="pb-stepper">
    <div class="pb-step ${detailsStepClass}">
        <span class="pb-step-mark">1</span>
        <span>Details</span>
    </div>
    <div class="pb-step ${reviewStepClass}">
        <span class="pb-step-mark">2</span>
        <span>Review</span>
    </div>
</div>
```

## 21. File Upload

`c:upload` is its own widget; do not pair it with a separate Save button.

```html
<div class="pb-card">
    <div class="pb-card-head">
        <div>
            <h2 class="pb-card-title">Upload document</h2>
            <p class="pb-card-sub">PDF or Office document.</p>
        </div>
    </div>
    <c:upload action="uploadDocument" allow="office" ajax-target="uploadFeedback" stylesheet="../Styles/upload-theme.css" />
    <div id="uploadFeedback" class="pb-stack"></div>
</div>
```

## 22. Simple Charts

Prefer CSS/SVG for simple charts. Avoid rainbow series and heavy gridlines.

```css
.pb-bars { display: flex; align-items: flex-end; gap: var(--ds-space-2); height: 160px; border-bottom: 1px solid var(--ds-border); }
.pb-bar { flex: 1; display: grid; align-items: end; gap: var(--ds-space-2); height: 100%; }
.pb-bar-fill { min-height: 2px; height: calc(var(--value) * 1%); border-radius: var(--ds-radius-sm) var(--ds-radius-sm) 0 0; background: var(--ds-primary); transition: height 500ms var(--ds-ease); }
.pb-bar-label { color: var(--ds-text-soft); font-size: 0.75rem; text-align: center; }
.pb-spark { width: 100%; height: 32px; }
.pb-spark polyline { fill: none; stroke: var(--ds-primary); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
```

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

## 23. Detail Panel / Drawer

Use as an AJAX target for deferred detail instead of crowding the default list.

```css
.pb-detail { border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); overflow: hidden; }
.pb-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--ds-space-4); padding: var(--ds-space-5); border-bottom: 1px solid var(--ds-border); }
.pb-detail-body { padding: var(--ds-space-5); display: grid; gap: var(--ds-space-5); }
.pb-description-list { display: grid; grid-template-columns: 160px 1fr; gap: var(--ds-space-3) var(--ds-space-5); }
.pb-description-list dt { color: var(--ds-text-soft); font-weight: 700; }
.pb-description-list dd { margin: 0; color: var(--ds-text); }
@media (max-width: 640px) { .pb-description-list { grid-template-columns: 1fr; gap: var(--ds-space-1); } }
```

```html
<c:ignore xmlns:c="contractpal">
    <div class="pb-detail" role="complementary">
        <div class="pb-detail-head">
            <div>
                <h2 class="pb-card-title">${record.name}</h2>
                <p class="pb-card-sub">${record.status}</p>
            </div>
            <c:a action="editRecord?id=${record.id}" ajax-target="modalContent" class="pb-btn pb-btn-secondary">Edit</c:a>
        </div>
        <div class="pb-detail-body">
            <dl class="pb-description-list">
                <dt>Owner</dt>
                <dd>${record.owner}</dd>
                <dt>Updated</dt>
                <dd>${formatter.formatDateString(record.updateDate, "MMM d, yyyy")}</dd>
            </dl>
        </div>
    </div>
</c:ignore>
```

## 24. Bulk Action Bar

Appears only after selection. Keep it compact and action-oriented.

```css
.pb-bulkbar { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-space-4); padding: var(--ds-space-3) var(--ds-space-4); border: 1px solid var(--ds-border-strong); border-radius: var(--ds-radius-md); background: var(--ds-primary-soft); color: var(--ds-text); }
.pb-bulkbar-count { font-weight: 700; }
@media (max-width: 640px) { .pb-bulkbar { align-items: stretch; flex-direction: column; } }
```

```html
<div class="pb-bulkbar" test="${selectedCount gt 0}">
    <span class="pb-bulkbar-count">${selectedCount} selected</span>
    <div class="pb-cluster">
        <c:a action="archiveSelected" confirm="Archive selected records?" ajax-target="body" class="pb-btn pb-btn-secondary">Archive</c:a>
        <c:a action="clearSelection" ajax-target="body" class="pb-btn pb-btn-ghost">Clear</c:a>
    </div>
</div>
```

## 25. Breadcrumbs

Use for deep workflow/detail screens. Do not add breadcrumbs to shallow dashboards.

```css
.pb-crumbs { display: flex; align-items: center; gap: var(--ds-space-2); color: var(--ds-text-soft); font-size: 0.8125rem; margin-bottom: var(--ds-space-4); }
.pb-crumbs a { color: var(--ds-text-muted); text-decoration: none; }
.pb-crumbs a:hover { color: var(--ds-text); }
.pb-crumb-sep { color: var(--ds-border-strong); }
```

```html
<div class="pb-crumbs" role="navigation" aria-label="Breadcrumb">
    <c:a action="getDashboard" ajax-target="body">Dashboard</c:a>
    <span class="pb-crumb-sep">/</span>
    <c:a action="listCustomers" ajax-target="body">Customers</c:a>
    <span class="pb-crumb-sep">/</span>
    <span>${customer.name}</span>
</div>
```

## 26. Avatar / Initial

Use initials unless the pal has reliable user photos.

```css
.pb-avatar { width: 32px; height: 32px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ds-primary-soft); color: var(--ds-primary); font-weight: 800; font-size: 0.8125rem; }
.pb-avatar-lg { width: 44px; height: 44px; font-size: 1rem; }
.pb-person { display: inline-flex; align-items: center; gap: var(--ds-space-3); min-width: 0; }
.pb-person-name { color: var(--ds-text); font-weight: 700; }
.pb-person-meta { color: var(--ds-text-soft); font-size: 0.8125rem; }
```

```html
<div class="pb-person">
    <span class="pb-avatar" aria-hidden="true">${user.initials}</span>
    <div>
        <div class="pb-person-name">${user.fullName}</div>
        <div class="pb-person-meta">${user.role}</div>
    </div>
</div>
```

## 27. Permission / Read-Only State

Use when an action is unavailable because of role, record state, lock, or workflow rules. Do not
hide important unavailable actions without explanation.

```css
.pb-permission { display: flex; align-items: flex-start; gap: var(--ds-space-3); padding: var(--ds-space-4); border: 1px dashed var(--ds-border-strong); border-radius: var(--ds-radius-md); background: var(--ds-surface-raised); color: var(--ds-text-muted); }
.pb-permission strong { display: block; color: var(--ds-text); }
```

```html
<div class="pb-permission" role="note" test="${!canEdit}">
    <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
    <p>
        <strong>Read only</strong>
        You do not have permission to edit this record.
    </p>
</div>
```

## 28. Toast Surface

For workflow success/error messages, render a small toast region or call an external JS helper from
workflow `runJS`. Do not put scripts in fragments.

```css
.pb-toast-region { position: fixed; right: var(--ds-space-5); bottom: var(--ds-space-5); display: grid; gap: var(--ds-space-3); z-index: 1000; }
.pb-toast { min-width: 260px; max-width: 360px; padding: var(--ds-space-4); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); box-shadow: var(--ds-shadow-md); color: var(--ds-text); }
.pb-toast-title { margin: 0; font-weight: 700; }
.pb-toast-msg { margin: 4px 0 0; color: var(--ds-text-muted); font-size: 0.875rem; }
@media (max-width: 640px) { .pb-toast-region { left: var(--ds-space-4); right: var(--ds-space-4); bottom: var(--ds-space-4); } .pb-toast { min-width: 0; max-width: none; } }
```

```html
<div class="pb-toast-region" aria-live="polite" aria-atomic="true" test="${!empty(toastMessage)}">
    <div class="pb-toast">
        <p class="pb-toast-title">${toastTitle}</p>
        <p class="pb-toast-msg">${toastMessage}</p>
    </div>
</div>
```

## 29. Motion With GSAP

Use CSS for hover/focus and GSAP for scripted UI motion. Load GSAP once from the page shell,
preferably from a local vendor file checked into `Scripts/vendor/gsap.min.js`. Every animation must
respect reduced motion and leave the UI usable when GSAP is absent.

```html
<script src="../Scripts/vendor/gsap.min.js"></script>
<script type="module" src="../Scripts/ui-main.js"></script>
```

```js
window.palUI = window.palUI || {};

window.palUI.motionOK = function () {
  return !window.matchMedia || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

window.palUI.reveal = function (root) {
  if (!window.gsap || !window.palUI.motionOK() || !root) return;
  window.gsap.from(root.querySelectorAll("[data-animate='item']"), {
    autoAlpha: 0,
    y: 8,
    duration: 0.28,
    ease: "power2.out",
    stagger: 0.035
  });
};

window.palUI.openPanel = function (panel) {
  if (!panel) return;
  panel.removeAttribute("hidden");
  if (!window.gsap || !window.palUI.motionOK()) return;
  window.gsap.fromTo(panel, { autoAlpha: 0, x: 20 }, { autoAlpha: 1, x: 0, duration: 0.22, ease: "power2.out" });
};
```

## 30. Button Group And Split Actions

Use for adjacent actions with equal scope, or a primary action plus overflow.

```css
.pb-btn-group { display: inline-flex; align-items: center; isolation: isolate; }
.pb-btn-group .pb-btn { border-radius: 0; margin-left: -1px; }
.pb-btn-group .pb-btn:first-child { border-radius: var(--ds-radius-sm) 0 0 var(--ds-radius-sm); margin-left: 0; }
.pb-btn-group .pb-btn:last-child { border-radius: 0 var(--ds-radius-sm) var(--ds-radius-sm) 0; }
.pb-split { display: inline-flex; align-items: stretch; }
.pb-split .pb-btn:first-child { border-radius: var(--ds-radius-sm) 0 0 var(--ds-radius-sm); }
.pb-split .pb-icon-btn { border-left: 0; border-radius: 0 var(--ds-radius-sm) var(--ds-radius-sm) 0; }
```

```html
<div class="pb-split">
    <c:a action="approveRecord?id=${record.id}" ajax-target="body" class="pb-btn pb-btn-primary">Approve</c:a>
    <button type="button" class="pb-icon-btn" aria-label="More approval actions" onclick="palUI.toggleMenu('approvalMenu')">
        <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
</div>
```

## 31. Input Group, Textarea, And Form Grid

Use input groups for search, currency, URL, and attached action controls. Keep prefixes visual; do
not rely on them as the only label.

```css
.pb-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ds-space-4) var(--ds-space-5); }
.pb-form-span { grid-column: 1 / -1; }
.pb-input-group { display: flex; align-items: stretch; width: 100%; }
.pb-input-addon { display: inline-flex; align-items: center; padding: 0 var(--ds-space-3); border: 1px solid var(--ds-border); background: var(--ds-bg-subtle); color: var(--ds-text-muted); font-weight: 650; font-size: 0.875rem; }
.pb-input-addon:first-child { border-radius: var(--ds-radius-sm) 0 0 var(--ds-radius-sm); border-right: 0; }
.pb-input-addon:last-child { border-radius: 0 var(--ds-radius-sm) var(--ds-radius-sm) 0; border-left: 0; }
.pb-input-group .pb-input { border-radius: 0; }
.pb-input-group .pb-input:first-child { border-radius: var(--ds-radius-sm) 0 0 var(--ds-radius-sm); }
.pb-input-group .pb-input:last-child { border-radius: 0 var(--ds-radius-sm) var(--ds-radius-sm) 0; }
@media (max-width: 760px) { .pb-form-grid { grid-template-columns: 1fr; } }
```

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
        <label class="pb-label">
            Notes
            <c:field type="textarea" name="notes" class="pb-textarea" value="${notes}" />
        </label>
    </div>
</div>
```

## 32. Radio, Choice Cards, And Segmented Control

Use radio groups for one-of-many choices; use choice cards when options need descriptions.

```css
.pb-radio-group, .pb-choice-grid { display: grid; gap: var(--ds-space-3); }
.pb-choice-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pb-radio { display: inline-flex; align-items: center; gap: var(--ds-space-2); }
.pb-radio input { width: 18px; height: 18px; accent-color: var(--ds-primary); }
.pb-choice { display: grid; gap: var(--ds-space-2); padding: var(--ds-space-4); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); cursor: pointer; }
.pb-choice.is-selected { border-color: var(--ds-focus); box-shadow: 0 0 0 3px var(--ds-focus-ring); }
.pb-segmented { display: inline-flex; padding: 3px; border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-bg-subtle); }
.pb-segment { min-height: 32px; padding: 0 var(--ds-space-3); border: 0; border-radius: var(--ds-radius-sm); background: transparent; color: var(--ds-text-muted); font-weight: 650; cursor: pointer; }
.pb-segment.active { background: var(--ds-surface); color: var(--ds-text); box-shadow: var(--ds-shadow-xs); }
@media (max-width: 760px) { .pb-choice-grid { grid-template-columns: 1fr; } }
```

```html
<div class="pb-choice-grid" role="radiogroup" aria-label="Plan">
    <label class="pb-choice">
        <span><c:field type="radio" name="plan" value="starter" checked="${plan eq 'starter'}" /> Starter</span>
        <span class="pb-muted">For simple internal workflows.</span>
    </label>
    <label class="pb-choice">
        <span><c:field type="radio" name="plan" value="team" checked="${plan eq 'team'}" /> Team</span>
        <span class="pb-muted">Adds approvals and collaboration.</span>
    </label>
</div>
```

## 33. Dropdown And Overflow Menu

Use menus for secondary actions. The trigger is a plain button; menu items can be `c:a` actions.

```css
.pb-menu-wrap { position: relative; display: inline-block; }
.pb-menu { position: absolute; right: 0; top: calc(100% + var(--ds-space-2)); min-width: 220px; padding: var(--ds-space-2); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); box-shadow: var(--ds-shadow-pop); z-index: 50; }
.pb-menu-item { display: flex; align-items: center; gap: var(--ds-space-2); width: 100%; min-height: 36px; padding: 0 var(--ds-space-3); border-radius: var(--ds-radius-sm); color: var(--ds-text); text-decoration: none; font-size: 0.875rem; font-weight: 600; }
.pb-menu-item:hover, .pb-menu-item:focus-visible { background: var(--ds-bg-subtle); outline: none; }
.pb-menu-sep { height: 1px; margin: var(--ds-space-2); background: var(--ds-border); }
```

```html
<div class="pb-menu-wrap">
    <button type="button" class="pb-icon-btn" aria-label="Record actions" aria-expanded="false" onclick="palUI.toggleMenu('recordMenu')">
        <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6h.01" /><path d="M12 12h.01" /><path d="M12 18h.01" /></svg>
    </button>
    <div id="recordMenu" class="pb-menu" hidden="hidden">
        <c:a action="editRecord?id=${record.id}" ajax-target="modalContent" class="pb-menu-item">Edit</c:a>
        <c:a action="duplicateRecord?id=${record.id}" ajax-target="body" class="pb-menu-item">Duplicate</c:a>
        <div class="pb-menu-sep"></div>
        <c:a action="deleteRecord?id=${record.id}" confirm="Delete this record?" ajax-target="body" class="pb-menu-item">Delete</c:a>
    </div>
</div>
```

## 34. Tooltip, Popover, And Hover Card

Use tooltips for short labels and popovers for actionable detail. For complex content, prefer a
drawer or detail panel.

```css
.pb-tip-wrap { position: relative; display: inline-flex; }
.pb-tooltip, .pb-popover { position: absolute; z-index: 40; border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); color: var(--ds-text); box-shadow: var(--ds-shadow-pop); }
.pb-tooltip { bottom: calc(100% + var(--ds-space-2)); left: 50%; transform: translateX(-50%); white-space: nowrap; padding: 6px 9px; font-size: 0.8125rem; font-weight: 650; }
.pb-popover { top: calc(100% + var(--ds-space-2)); right: 0; width: 320px; padding: var(--ds-space-4); }
.pb-hover-card { display: grid; gap: var(--ds-space-3); }
```

```html
<span class="pb-tip-wrap">
    <button type="button" class="pb-icon-btn" aria-label="Show SLA details" onclick="palUI.toggleMenu('slaPopover')">?</button>
    <div id="slaPopover" class="pb-popover" hidden="hidden">
        <div class="pb-hover-card">
            <strong>Response SLA</strong>
            <span class="pb-muted">Business-hours response target for this customer tier.</span>
        </div>
    </div>
</span>
```

## 35. Accordion And Collapsible

Use native `details`/`summary` where possible. It is accessible, simple, and Palbuilder-safe.

```css
.pb-accordion { border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); overflow: hidden; }
.pb-accordion details + details { border-top: 1px solid var(--ds-border); }
.pb-accordion summary { min-height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 var(--ds-space-4); cursor: pointer; font-weight: 700; }
.pb-accordion-body { padding: 0 var(--ds-space-4) var(--ds-space-4); color: var(--ds-text-muted); }
```

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

## 36. Drawer / Sheet

Use drawers for contextual details or forms that should not replace the list.

```css
.pb-drawer-scrim { position: fixed; inset: 0; background: rgba(11, 13, 16, 0.42); z-index: 80; }
.pb-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100%); display: grid; grid-template-rows: auto 1fr auto; background: var(--ds-surface); border-left: 1px solid var(--ds-border); box-shadow: var(--ds-shadow-pop); z-index: 81; }
.pb-drawer-head, .pb-drawer-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-space-4); padding: var(--ds-space-5); border-bottom: 1px solid var(--ds-border); }
.pb-drawer-foot { border-top: 1px solid var(--ds-border); border-bottom: 0; justify-content: flex-end; }
.pb-drawer-body { padding: var(--ds-space-5); overflow: auto; }
```

```html
<div id="customerDrawer" hidden="hidden">
    <div class="pb-drawer-scrim" onclick="palUI.closePanel('customerDrawer')"></div>
    <div class="pb-drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
        <div class="pb-drawer-head">
            <h2 id="drawerTitle" class="pb-modal-title">Customer details</h2>
            <button type="button" class="pb-icon-btn" aria-label="Close" onclick="palUI.closePanel('customerDrawer')">
                <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
        </div>
        <div class="pb-drawer-body" id="drawerBody"></div>
    </div>
</div>
```

## 37. Command Palette

Use for global navigation and fast actions. Keep commands server-backed where possible.

```css
.pb-command { width: min(680px, calc(100vw - 32px)); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-lg); background: var(--ds-surface); box-shadow: var(--ds-shadow-pop); overflow: hidden; }
.pb-command-search { display: flex; align-items: center; gap: var(--ds-space-3); padding: var(--ds-space-3) var(--ds-space-4); border-bottom: 1px solid var(--ds-border); }
.pb-command-search input { border: 0; outline: 0; width: 100%; background: transparent; color: var(--ds-text); font: inherit; }
.pb-command-list { max-height: 360px; overflow: auto; padding: var(--ds-space-2); }
.pb-command-item { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-space-3); min-height: 42px; padding: 0 var(--ds-space-3); border-radius: var(--ds-radius-sm); color: var(--ds-text); text-decoration: none; font-weight: 650; }
.pb-command-item:hover, .pb-command-item:focus-visible { background: var(--ds-bg-subtle); outline: none; }
.pb-kbd { display: inline-flex; align-items: center; min-height: 22px; padding: 0 6px; border: 1px solid var(--ds-border); border-bottom-color: var(--ds-border-strong); border-radius: var(--ds-radius-xs); background: var(--ds-surface-raised); color: var(--ds-text-muted); font: 700 0.75rem/1 var(--ds-font-mono); }
```

```html
<div class="pb-command" role="dialog" aria-label="Command menu">
    <div class="pb-command-search">
        <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 19a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" /><path d="m21 21-4.35-4.35" /></svg>
        <input type="search" placeholder="Search actions, records, or pages" />
    </div>
    <div class="pb-command-list">
        <c:a action="newCustomer" ajax-target="modalContent" class="pb-command-item"><span>New customer</span><span class="pb-kbd">N</span></c:a>
        <c:a action="listCustomers" ajax-target="body" class="pb-command-item"><span>Go to customers</span><span class="pb-kbd">G C</span></c:a>
    </div>
</div>
```

## 38. Combobox / Autocomplete

For simple cases, use native `datalist`; for server-backed search, render suggestions into a
popover target and select with `c:a`.

```html
<div class="pb-field-group">
    <label class="pb-label" for="customerSearch">Customer</label>
    <input id="customerSearch" name="customerSearch" class="pb-input" list="customerOptions" autocomplete="off" />
    <datalist id="customerOptions">
        <c:list name="customers" id="customer">
            <option value="${customer.name}"></option>
        </c:list>
    </datalist>
</div>
```

Server-backed pattern:

```html
<div class="pb-field-group">
    <label class="pb-label">
        Search records
        <c:field type="text" name="q" class="pb-input" value="${q}" placeholder="Type a name or ID" />
    </label>
    <c:a action="searchRecords" ajax-target="recordSuggestions" class="pb-btn pb-btn-secondary">Search</c:a>
    <div id="recordSuggestions" class="pb-menu"></div>
</div>
```

## 39. Date Picker And Calendar List

Use native date inputs for simple capture. Use a calendar list for scheduling and review screens.

```css
.pb-date-row { display: flex; align-items: center; gap: var(--ds-space-3); }
.pb-calendar-list { display: grid; gap: var(--ds-space-3); }
.pb-calendar-item { display: grid; grid-template-columns: 72px 1fr auto; gap: var(--ds-space-4); align-items: center; padding: var(--ds-space-4); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); }
.pb-calendar-date { display: grid; place-items: center; min-height: 58px; border-radius: var(--ds-radius-md); background: var(--ds-bg-subtle); color: var(--ds-text); font-weight: 800; }
@media (max-width: 640px) { .pb-calendar-item { grid-template-columns: 1fr; } .pb-calendar-date { place-items: start; padding: var(--ds-space-3); } }
```

```html
<div class="pb-field-group">
    <label class="pb-label" for="dueDate">Due date</label>
    <input id="dueDate" name="dueDate" type="date" class="pb-input" value="${dueDate}" />
</div>
```

## 40. Slider / Range

Use only when approximate adjustment is acceptable. Pair with a visible number.

```css
.pb-range { display: grid; gap: var(--ds-space-2); }
.pb-range input[type="range"] { width: 100%; accent-color: var(--ds-primary); }
.pb-range-value { color: var(--ds-text); font-weight: 800; font-variant-numeric: tabular-nums; }
```

```html
<label class="pb-range">
    <span class="pb-label">Risk threshold <strong class="pb-range-value">${threshold}%</strong></span>
    <input type="range" name="threshold" min="0" max="100" value="${threshold}" />
</label>
```

## 41. OTP / PIN Input

Use for short verification codes. Keep paste behavior in external JS if enhanced.

```css
.pb-otp { display: flex; gap: var(--ds-space-2); }
.pb-otp input { width: 44px; height: 48px; text-align: center; border: 1px solid var(--ds-border); border-radius: var(--ds-radius-sm); background: var(--ds-surface); color: var(--ds-text); font: 800 1.125rem/1 var(--ds-font-ui); }
.pb-otp input:focus { outline: 2px solid var(--ds-focus); outline-offset: 2px; }
```

```html
<div class="pb-otp" aria-label="Verification code">
    <input name="code1" maxlength="1" inputmode="numeric" />
    <input name="code2" maxlength="1" inputmode="numeric" />
    <input name="code3" maxlength="1" inputmode="numeric" />
    <input name="code4" maxlength="1" inputmode="numeric" />
</div>
```

## 42. Data Grid Affordances

A full data grid is a composition: table, row selection, sortable headers, filters, pagination,
bulk bar, row menu, loading, empty, and error states.

```css
.pb-table th .pb-sort { display: inline-flex; align-items: center; gap: 6px; color: inherit; text-decoration: none; }
.pb-row-actions { display: flex; justify-content: flex-end; gap: var(--ds-space-2); }
.pb-row-click { cursor: pointer; }
.pb-row-click:hover td { background: var(--ds-bg-subtle); }
```

```html
<th>
    <c:a action="sortRecords?by=name" ajax-target="body" class="pb-sort">
        Customer
        <svg class="pb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9 4-4 4 4" /><path d="m16 15-4 4-4-4" /></svg>
    </c:a>
</th>
```

## 43. Kanban / Status Board

Use for workflow state, not decorative task theater. Every card must have a clear action path.

```css
.pb-board { display: grid; grid-template-columns: repeat(3, minmax(240px, 1fr)); gap: var(--ds-space-4); overflow-x: auto; }
.pb-board-col { min-width: 240px; display: grid; align-content: start; gap: var(--ds-space-3); padding: var(--ds-space-3); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-bg-subtle); }
.pb-board-title { margin: 0; display: flex; justify-content: space-between; color: var(--ds-text-muted); font-size: 0.8125rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
.pb-board-card { display: grid; gap: var(--ds-space-2); padding: var(--ds-space-4); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); box-shadow: var(--ds-shadow-xs); }
```

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

## 44. Comments And Messages

Use for collaboration, approvals, and audit trails. Keep system events in activity feeds; keep human
messages here.

```css
.pb-thread { display: grid; gap: var(--ds-space-4); }
.pb-message { display: grid; grid-template-columns: 36px 1fr; gap: var(--ds-space-3); }
.pb-message-bubble { padding: var(--ds-space-3) var(--ds-space-4); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); }
.pb-message-meta { margin-top: var(--ds-space-1); color: var(--ds-text-soft); font-size: 0.8125rem; }
```

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

## 45. Attachment List

Use with upload/download flows. Show type, size, owner, status, and actions.

```css
.pb-attachments { display: grid; gap: var(--ds-space-2); }
.pb-attachment { display: grid; grid-template-columns: 32px 1fr auto; gap: var(--ds-space-3); align-items: center; padding: var(--ds-space-3); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); }
.pb-attachment-icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: var(--ds-radius-sm); background: var(--ds-bg-subtle); color: var(--ds-text-muted); }
```

```html
<div class="pb-attachments">
    <c:list name="attachments" id="file">
        <div class="pb-attachment">
            <span class="pb-attachment-icon" aria-hidden="true">PDF</span>
            <div>
                <strong>${file.name}</strong>
                <div class="pb-muted">${file.sizeLabel} - ${file.owner}</div>
            </div>
            <c:a action="downloadFile?id=${file.id}" class="pb-btn pb-btn-secondary">Download</c:a>
        </div>
    </c:list>
</div>
```

## 46. Code, Kbd, And Preview Blocks

Use for developer pals, generated document previews, and recipe catalogs.

```css
.pb-code-card { border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); overflow: hidden; }
.pb-code-head { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-space-3); padding: var(--ds-space-3) var(--ds-space-4); border-bottom: 1px solid var(--ds-border); background: var(--ds-bg-subtle); }
.pb-code { margin: 0; padding: var(--ds-space-4); overflow: auto; color: var(--ds-text); font: 500 0.8125rem/1.6 var(--ds-font-mono); }
```

```html
<div class="pb-code-card">
    <div class="pb-code-head">
        <strong>Markup</strong>
        <button type="button" class="pb-btn pb-btn-secondary" onclick="palUI.copyCode('buttonCode')">Copy</button>
    </div>
    <pre id="buttonCode" class="pb-code">&lt;c:a action="save" class="pb-btn pb-btn-primary"&gt;Save&lt;/c:a&gt;</pre>
</div>
```

## 47. Metrics Panel

Use when a dashboard needs hierarchy beyond equal stat cards.

```css
.pb-metrics { display: grid; grid-template-columns: 1.4fr repeat(2, 1fr); gap: var(--ds-space-4); }
.pb-metric-hero { padding: var(--ds-space-6); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); box-shadow: var(--ds-shadow-xs); }
.pb-metric-value { margin: var(--ds-space-3) 0 0; font: 800 2.5rem/1 var(--ds-font-display); }
.pb-trend { display: inline-flex; align-items: center; gap: 6px; color: var(--ds-success); font-weight: 800; }
@media (max-width: 900px) { .pb-metrics { grid-template-columns: 1fr; } }
```

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

## 48. Split Panels And Scroll Area

Use for master-detail tools, document review, and dense admin layouts.

```css
.pb-split-panel { display: grid; grid-template-columns: minmax(260px, 0.42fr) minmax(0, 1fr); min-height: 520px; border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); overflow: hidden; }
.pb-split-list { border-right: 1px solid var(--ds-border); overflow: auto; }
.pb-split-detail { overflow: auto; padding: var(--ds-space-5); }
.pb-scroll-fade { position: relative; max-height: 360px; overflow: auto; }
@media (max-width: 860px) { .pb-split-panel { grid-template-columns: 1fr; } .pb-split-list { border-right: 0; border-bottom: 1px solid var(--ds-border); } }
```

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

## 49. Review, Approval, And Onboarding Checklist

Use for workflow completion. It should show what is done, what blocks submission, and the next
action.

```css
.pb-checklist { display: grid; gap: var(--ds-space-3); }
.pb-checkitem { display: grid; grid-template-columns: 24px 1fr auto; gap: var(--ds-space-3); align-items: start; padding: var(--ds-space-3); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md); background: var(--ds-surface); }
.pb-checkmark { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: var(--ds-bg-subtle); color: var(--ds-text-muted); font-weight: 800; }
.pb-checkitem.is-done .pb-checkmark { background: var(--ds-success-soft); color: var(--ds-success); }
.pb-checkitem.is-blocked .pb-checkmark { background: var(--ds-danger-soft); color: var(--ds-danger); }
```

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

## 50. Responsive Rules

- At 1024px: sidebar may collapse to a narrower rail.
- At 760px: shell stacks, toolbar wraps, primary action remains visible.
- At 640px: tables collapse to cards.
- On coarse pointers: clickable controls are at least 44px tall.

```css
@media (pointer: coarse) {
  .pb-nav-link, .pb-tab, .pb-row-click { min-height: 44px; }
}
```

## Component Review Checklist

- Values come from `--ds-*` tokens unless a new token is deliberately added.
- Every interactive component has hover, focus-visible, active, disabled where applicable.
- Data surfaces define loading, empty, and error states.
- Tables have numeric alignment and mobile `data-label` collapse.
- Forms have validation messages with `role="alert"`.
- There is exactly one primary action in the current view.
- Hierarchy, grouping, target size, progressive disclosure, and next-step feedback pass the
  applied design-principles checklist.
- Icons are one family, inline SVG, decorative icons `aria-hidden="true"`, and from Iconoir,
  Tabler, or Phosphor unless the project documents another SVG family.
- Typography is system-stack or Fontshare. Do not add a Google Fonts dependency by default.
- Scripted motion uses GSAP from external `scripts/*.js`; no inline animation scripts in fragments.
- No undocumented `c:` attributes.
- No inline fragment scripts.
- No `${...}` inside inline `<script>`.
