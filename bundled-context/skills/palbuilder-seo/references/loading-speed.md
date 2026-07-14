# Loading-speed head optimizations (verified live patterns)

A correct `<head>` and a *fast* `<head>` are both this skill's job — Lighthouse perf score is
part of SEO. In order of impact:

1. **LCP hero image: render it as a real `<img>` in the initial HTML, not a CSS
   `background-image`.** Give it `fetchpriority="high"` and a `srcset`/`sizes` pair so the
   browser discovers and prioritizes it the instant HTML parses — no separate `<link
   rel="preload">` needed (a preload for an image already in the initial markup just trips a
   "preload not used" console warning and wastes a request).
   ```html
   <img class="hero-img" src="../Images/hero.jpg"
        srcset="../Images/hero-m.jpg 900w, ../Images/hero.jpg 1672w" sizes="100vw"
        fetchpriority="high" alt="Describe the hero image"/>
   ```
2. **Below-the-fold images get `loading="lazy"`.** Anything not visible on first paint —
   secondary art, hub illustrations, footer images.
3. **Async-load Google Fonts; never add a `<noscript>` fallback.**
   ```html
   <link rel="preconnect" href="https://fonts.googleapis.com"/>
   <link rel="preconnect" crossorigin="crossorigin" href="https://fonts.gstatic.com"/>
   <link rel="preload" as="style" onload="this.onload=null;this.rel='stylesheet'"
         href="https://fonts.googleapis.com/css2?family=...&amp;display=swap"/>
   ```
   The `onload` swap trick avoids a render-blocking font request. **Do not add the usual
   `<noscript><link rel="stylesheet" .../></noscript>` fallback** — verified live, the
   PalBuilder server unwraps `<noscript>` content at render time and reintroduces the blocking
   `<link>`, defeating the whole async swap. Skip it; the `display=swap` query param already
   covers the no-JS case well enough.
4. **Inline critical above-the-fold CSS in a `<style>` block, placed before any external
   stylesheet `<link>`,** if the page has enough custom CSS that the external sheet round-trip
   would delay first paint. Put it in its own fragment (e.g. `critical-styles.html`) and pull it
   in with `<c:head name="critical-styles"/>` so it's reusable across pages.
5. **Defer everything that isn't needed for first paint:** icon fonts, analytics, non-critical
   JS all take `defer="true"` (or `defer="defer"` on a plain `<script>`). The page's own
   stylesheet and the font-swap preload above are the only render-path resources that load
   un-deferred.
6. Optional progressive enhancement, no downside: a Speculation Rules block to prerender same-
   origin links on supporting browsers —
   `<script type="speculationrules">{"prerender":[{"where":{"href_matches":"/*"},"eagerness":"moderate"}]}</script>`.
