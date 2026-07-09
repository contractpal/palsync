# Palbuilder Marketing Library

HTML-only reference for the marketing-section classes in `styles/design-system.css` (shipped
verbatim) plus the motion recipes in `scripts/pb-motion.js`. App/console components (navbar,
sidebar, tables, forms, modal, etc.) live in `component-library.md`, not here — console pals
should never need to load this file. Every class and `data-*` attribute below is copied directly
from the shipped CSS/JS; nothing here is invented.

**XHTML is strict** (self-close voids, boolean attrs as `attr="attr"`) — see
`component-library.md`'s opening note and `bundled-context/CLAUDE.md` for the full platform
contract. **Never hand-edit `design-system.css`** — pal tweaks go in the `PAL OVERRIDES` block at
its end. Load order is the same four files as every pal (`spacing.css`, `design-system.css`,
`pb-ui.js`, `pb-motion.js` as `<script type="module">`) — see `component-library.md` for the
exact shell snippet.

## 1. Hero

Five variants share one base class; pick one layout variant and optionally add a visual treatment.
```html
<section class="pb-hero pb-hero--split pb-hero--aurora pb-hero--beam">
    <div class="pb-hero-inner">
        <div>
            <span class="pb-hero-eyebrow">New</span>
            <h1 class="pb-hero-title" data-animate="fade-up">Ship pals that feel built, not bootstrapped</h1>
            <p class="pb-hero-sub" data-animate="fade-up" data-animate-delay="80">One design system, zero CSS to write.</p>
            <div class="pb-hero-actions" data-animate="fade-up" data-animate-delay="160">
                <a href="?view=start" class="pb-btn pb-btn-primary">Get started</a>
                <a href="?view=demo" class="pb-btn pb-btn-secondary">Watch demo</a>
            </div>
        </div>
        <div class="pb-beam"><div class="pb-mock-browser"><!-- section 11 --></div></div>
    </div>
</section>
```
Variants: `.pb-hero--centered` (single-column centered), `.pb-hero--split` (two-column),
`.pb-hero--stacked` (centered copy plus wide media below), `.pb-hero--aurora` (blurred radial wash),
and `.pb-hero--beam` (premium depth for `.pb-beam`, media, and mock children). Combine one layout
variant with `--aurora` and/or `--beam`. JS: `data-animate` needs pb-motion.js (section 14).

## 2. Bento Grid

Asymmetric feature grid with optional visual slots; four columns collapse to two at 760px.
```html
<div class="pb-bento" data-animate-stagger="80">
    <div class="pb-bento-item pb-bento-item--lg pb-bento-item--visual" data-animate="fade-up">
        <div class="pb-bento-visual pb-bento-visual--grid" aria-hidden="true"><span></span><span></span><span></span></div>
        <strong>Primary capability</strong>
        <span class="pb-muted">Tall cell, spans 2 rows.</span>
    </div>
    <div class="pb-bento-item pb-bento-item--wide pb-bento-item--visual" data-animate="fade-up">
        <div class="pb-bento-visual pb-bento-visual--flow" aria-hidden="true"><span></span><i></i><span></span><i></i><span></span></div>
        <strong>Wide closing cell</strong>
    </div>
</div>
```
Variants: `.pb-bento-item--lg` (spans 2 rows), `.pb-bento-item--wide` (spans all 4 columns, 2 on
mobile), `.pb-bento-item--visual` reserves top space for `.pb-bento-visual`. Visual variants:
`.pb-bento-visual--grid`, `.pb-bento-visual--stat`, `.pb-bento-visual--bars`,
`.pb-bento-visual--flow`.

## 3. Features

```html
<div class="pb-features">
    <div class="pb-feature" data-animate="fade-up">
        <span class="pb-feature-icon" aria-hidden="true">
            <svg class="pb-icon" viewBox="0 0 24 24"><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
        </span>
        <h3 class="pb-feature-title">Fast by default</h3>
        <p class="pb-feature-desc">No build step, no framework, ships in a page load.</p>
        <ul class="pb-feature-list"><li>Instant page-shell sync</li><li>Motion hooks included</li></ul>
    </div>
</div>
```
Repeat `.pb-feature` for each capability; add `.pb-feature-list` for checked proof points. Stagger
with `data-animate-stagger` on the `.pb-features` wrapper instead of per-item delays.

## 4. Pricing

```html
<div class="pb-pricing">
    <div class="pb-price-card">
        <h3 class="pb-card-title">Starter</h3>
        <p class="pb-price-value">$0<small>/mo</small></p>
        <ul class="pb-price-feature-list"><li>1 pal</li><li>Community support</li></ul>
        <a href="?view=signup" class="pb-btn pb-btn-secondary">Start free</a>
    </div>
    <div class="pb-price-card pb-price-card--featured">
        <div class="pb-price-head">
            <h3 class="pb-card-title">Team</h3>
            <span class="pb-badge pb-badge-accent">Most popular</span>
        </div>
        <p class="pb-price-value">$49<small>/mo</small></p>
        <ul class="pb-price-feature-list"><li>Unlimited pals</li><li>Priority support</li></ul>
        <a href="?view=signup" class="pb-btn pb-btn-primary">Start trial</a>
    </div>
</div>
```
`.pb-price-card--featured` adds a gradient border, elevation, and scale; use on exactly one card.
Use `.pb-price-head` for title + `.pb-badge-accent`. List items in `.pb-price-feature-list` render
as checked inclusions automatically.

## 5. Testimonials

```html
<div class="pb-testimonial-grid">
    <div class="pb-testimonial" data-animate="fade-up">
        <p class="pb-testimonial-quote">“Shipped our dashboard in an afternoon.”</p>
        <div class="pb-testimonial-author">
            <span class="pb-avatar" aria-hidden="true">JR</span>
            <div><div class="pb-person-name">Jamie Ruiz</div><div class="pb-person-meta">Ops Lead, Acme</div></div>
        </div>
    </div>
</div>
```
Single testimonial: drop the `-grid` wrapper and use one `.pb-testimonial` directly.

## 6. Logo Cloud

Static row, or an infinite CSS marquee for longer logo lists.
```html
<div class="pb-logo-cloud">
    <img src="${logo1Url}" alt="Acme" />
    <img src="${logo2Url}" alt="Globex" />
</div>

<div class="pb-marquee">
    <div class="pb-marquee-track">
        <img src="${logo1Url}" alt="Acme" /><img src="${logo2Url}" alt="Globex" />
        <img src="${logo1Url}" alt="Acme" /><img src="${logo2Url}" alt="Globex" />
    </div>
</div>
```
`.pb-marquee-track` must repeat its full logo set exactly twice (the CSS scrolls it -50% and
loops) — pure CSS, hover-pauses, no JS. Dark mode auto-inverts logo art via
`[data-theme="dark"] .pb-logo-cloud`.

## 7. CTA Band

```html
<div class="pb-cta-band">
    <div>
        <h2 class="pb-title">Ready to ship?</h2>
        <p class="pb-subtitle">Start free, upgrade when you need more seats.</p>
    </div>
    <a href="?view=signup" class="pb-btn pb-btn-primary">Get started</a>
</div>
```

## 8. Stats With Count-Up

```html
<div class="pb-stats" data-animate-stagger="100">
    <div data-animate="fade-up">
        <p class="pb-stats-value" data-ticker="12,400+">0</p>
        <p class="pb-stats-label">Pals shipped</p>
    </div>
    <div data-animate="fade-up">
        <p class="pb-stats-value" data-ticker="99.9%">0</p>
        <p class="pb-stats-label">Uptime</p>
    </div>
</div>
```
JS: needs pb-motion.js — `data-ticker="12,400+"` count-up eases in on scroll reveal, preserving
any non-numeric prefix/suffix in the attribute value (commas, `%`, `+`). Pair with `data-animate`
on the same or a wrapping element so the two reveals land together.

## 9. Marketing Navbar

Sticky pill-shaped floating bar — distinct from the app `.pb-navbar` in `component-library.md`.
```html
<header class="pb-navbar pb-navbar--marketing">
    <div class="pb-navbar-inner">
        <a class="pb-navbar-brand" href="?">Acme</a>
        <nav class="pb-navbar-links">
            <a href="?view=pricing">Pricing</a>
            <a href="?view=docs">Docs</a>
        </nav>
        <a href="?view=signup" class="pb-btn pb-btn-primary">Sign up</a>
        <button type="button" class="pb-navbar-burger" aria-label="Toggle menu" aria-expanded="false" data-pb-toggle="dropdown" data-pb-target=".pb-navbar-links"><span></span><span></span><span></span></button>
    </div>
</header>
```
`.pb-navbar--marketing` adds the floating/pill/blur treatment on top of the base `.pb-navbar`
classes — always pair both classes, never use `--marketing` alone.

JS: needs pb-ui.js — the burger's `data-pb-toggle="dropdown"` + `data-pb-target=".pb-navbar-links"`
opens the links as a panel below the bar at ≤760px (outside click / Escape closes it).

## 10. Marketing Footer

Same `.pb-footer` classes as the app footer (`component-library.md` section 51); marketing pages
typically give it more columns and a newsletter or social row in `.pb-footer-bottom`.
```html
<footer class="pb-footer">
    <div class="pb-footer-inner">
        <div><p class="pb-footer-col-title">Acme</p><p class="pb-muted">Build pals fast.</p></div>
        <div><p class="pb-footer-col-title">Product</p>
            <ul class="pb-footer-links"><li><a href="?view=pricing">Pricing</a></li><li><a href="?view=docs">Docs</a></li></ul></div>
        <div><p class="pb-footer-col-title">Company</p>
            <ul class="pb-footer-links"><li><a href="?view=about">About</a></li></ul></div>
    </div>
    <div class="pb-footer-bottom"><span class="pb-muted">© 2026 Acme</span><span class="pb-muted">Privacy · Terms</span></div>
</footer>
```

## 11. Mockups

Device frames for product screenshots inside a hero or feature section.
```html
<div class="pb-mock-browser">
    <div class="pb-mock-browser-bar"><span class="pb-mock-browser-dot"></span><span class="pb-mock-browser-dot"></span><span class="pb-mock-browser-dot"></span></div>
    <img src="${screenshotUrl}" alt="Product screenshot" />
</div>

<div class="pb-mock-phone">
    <div class="pb-mock-phone-notch"></div>
    <div class="pb-mock-phone-body"><img src="${mobileScreenshotUrl}" alt="Mobile screenshot" /></div>
</div>
```

## 12. Text Effects

```html
<h2 class="pb-hero-title pb-text-gradient">Built for speed</h2>
<h2 class="pb-hero-title pb-text-shine">Ship it today</h2>
```
`.pb-text-gradient` is a static two-tone gradient clip (safe everywhere). `.pb-text-shine` adds a
looping sweep highlight where `@property` is supported, with the gradient as a static fallback —
both need no JS. Use on short headline text only, not body copy.

## 13. Beam, Glow, Spotlight, Meteors

```html
<div class="pb-card pb-beam">Rotating gradient border.</div>
<div class="pb-card pb-glow">Soft ambient glow behind the card.</div>
<div class="pb-card pb-spotlight" data-spotlight="">Cursor-tracking radial highlight.</div>
<div class="pb-card pb-gradient-animate">Animated gradient background.</div>
<div class="pb-card pb-hover-lift">Subtle hover elevation.</div>
<a href="?view=start" class="pb-btn pb-btn-primary pb-btn-shine">Start now</a>
<div class="pb-hero pb-meteors">
    <div class="pb-meteor" style="--x: 20%; --delay: 0s;"></div>
    <div class="pb-meteor" style="--x: 55%; --delay: 0.6s;"></div>
    <div class="pb-meteor" style="--x: 80%; --delay: 1.2s;"></div>
</div>
```
`.pb-beam`/`.pb-glow`/`.pb-gradient-animate`/`.pb-btn-shine` are pure CSS. `.pb-spotlight` needs `data-spotlight` (pb-motion.js
writes `--x`/`--y` from the pointer position) — gated to fine pointers implicitly by only
mattering on hover. `.pb-meteors` needs one `.pb-meteor` child per streak; vary `--x` (start
position) and `--delay` (stagger) inline per meteor, no JS required.

## 14. Motion Recipes

Beyond the basic `data-animate` reveal (`component-library.md` section 28), marketing sections
use the fuller pb-motion.js vocabulary:

```html
<h1 data-typewriter="Build faster|Ship sooner|Scale later" data-typewriter-loop="">Build faster</h1>

<div class="pb-card" data-tilt="">3D tilt on pointer move (fine pointers only).</div>

<div class="pb-bento" data-animate-stagger="80">
    <div class="pb-bento-item" data-animate="scale-in">Cell A</div>
    <div class="pb-bento-item" data-animate="flip-up">Cell B</div>
</div>
```
JS: all of the above need pb-motion.js (already loaded). `data-typewriter` value is pipe-separated
phrases (not JSON — XHTML attribute quoting can't hold quotes-in-quotes); add
`data-typewriter-loop` to cycle forever, omit it to stop on the last phrase. `data-tilt` no-ops
under `prefers-reduced-motion` and on coarse (touch) pointers. `data-animate-stagger` on a
container delays each `[data-animate]` child by `index * step`ms — set it once on the grid instead
of a `data-animate-delay` per item. Animation variants: `fade-up`, `fade-in`, `fade-left`,
`fade-right`, `zoom-in`, `blur-in`, `scale-in`, `slide-up-lg`, `flip-up`. Utilities:
`.pb-hover-lift`, `.pb-btn-shine`, and `.pb-gradient-animate`.
