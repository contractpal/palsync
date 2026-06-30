---
name: palbuilder-seo
description: "On-page SEO rules for PalBuilder WEB pals — every marketing/public page must follow these from the FIRST push, not as a retrofit. Use this skill ALONGSIDE palbuilder-frontend whenever creating or editing a web pal page (<head>, headings, images, structured data, robots.txt, sitemap.xml). Covers the page-head recipe (title/description/canonical/OG/twitter), loading-speed head optimizations (font swap, LCP hero image, lazy below-fold), page-specific JSON-LD, robots.txt + sitemap.xml + llms.txt setup, the PalBuilder-specific traps (relative og: URLs, non-ASCII attributes, c:a is not crawlable), heading discipline, and the verify loop with pal_seo_audit. Console pals are behind login and are NOT crawled — this skill applies to WEB pals only."
---

# PalBuilder SEO Skill (web pals)

Read this before writing any WEB pal page `<head>`. After pushing, run **`pal_seo_audit`** —
it fetches the page exactly as crawlers see it and checks every head-recipe rule below, plus
robots.txt/sitemap.xml/llms.txt. Fix every ERROR it reports.

The substrate facts you need (verified live, across two production pals):

- A web pal page is served publicly at `webpals.cloudpiston.com` (or your custom domain once
  mapped) — it IS crawled, so SEO is real.
- Local resources load with relative paths (`../Styles/x.css`, `../Scripts/x.js`,
  `../Images/x.jpg`); the server rewrites them to `nx-ref/...` automatically. That rewriting
  does NOT apply to meta attribute values — which is why og: URLs must be written absolute by
  YOU (rule 2).
- `<script>` is allowed in a PAGE `<head>`/body (only FRAGMENTS reject `<script>`), so JSON-LD
  goes in the page head.
- Test/stage instances route **every** path through the workflow — without an explicit
  robots.txt/sitemap.xml intercept, those URLs render the homepage HTML instead (Lighthouse:
  305 parse errors). See the robots/sitemap section below.

---

## The page-head recipe — copy this shape into every web page

```html
<head>
    <title>Primary Benefit | Brand</title>                            <!-- 15–60 chars -->
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>

    <meta name="description" content="What this page offers, for whom, in plain words. 50-160 characters."/>
    <link rel="canonical" href="https://YOUR-DOMAIN/page-url"/>        <!-- ABSOLUTE -->

    <meta property="og:type" content="website"/>
    <meta property="og:title" content="Primary Benefit | Brand"/>
    <meta property="og:description" content="Same offer, said for a social card."/>
    <meta property="og:url" content="https://YOUR-DOMAIN/page-url"/>                       <!-- ABSOLUTE -->
    <meta property="og:image" content="https://YOUR-DOMAIN/nx-ref/Images/hero.jpg"/>       <!-- ABSOLUTE -->
    <meta name="twitter:card" content="summary_large_image"/>

    <script type="application/ld+json">
    { "@context": "https://schema.org", "@type": "...", "...": "see Structured data below" }
    </script>

    <!-- loading-speed block goes here — see below -->
    <link rel="STYLESHEET" type="text/css" href="../Styles/web.css"/>
</head>
```

All `<meta .../>` and `<link .../>` tags are void elements — **self-close them** (XHTML rule,
see palbuilder-frontend). `charset` and `viewport` come right after `<title>` — browsers sniff
encoding early, and a late `charset` tag is a real (if minor) parse-cost regression seen in one
of the two reference pals; the other puts it correctly up top.

Two valid ways to fill the head, pick by how your pal is built:

- **Static per-page** (one page file per route, copy is hand-written): hardcode title/
  description/canonical/JSON-LD directly in that page's `<head>`, like the recipe above.
- **Templated** (one `website.html` shell + a workflow that sets payload vars per route):
  the shell renders `<title>${title}</title>`, `<meta name="description" content="${description}"/>`,
  `<link rel="canonical" href="${canonical}"/>`, and JSON-LD via
  `<c:script test="${!empty(schemaText)}" inline="true" body="${schemaText}" type="application/ld+json"/>`
  where `schemaText` is loaded server-side with `pal.getScript("schema/<name>")` from a
  `scripts/schema/<name>.js` file holding raw JSON. The workflow's route switch sets
  `title`/`description`/`schemaText` (and an OG/Twitter `meta` data-map fed to a shared
  `meta.html` fragment) per `case`. Use this when you have many pages and want one shell to
  stay DRY — it's how GiftHub (gifthub.me) does it.

---

## The PalBuilder-specific traps (all hit in real builds — do NOT repeat them)

1. **og:image and og:url MUST be absolute URLs.** A relative value (`../Images/hero.jpg`)
   saves fine and even renders — but social scrapers (Slack, LinkedIn, X, iMessage) fetch these
   from THEIR servers, where a relative URL resolves to nothing: the share card shows no image.
   Write the full URL: `https://webpals.cloudpiston.com/nx-ref/Images/hero.jpg` (note the
   `nx-ref/` prefix — that is where the server actually serves your `images/` files).
   The same applies to `canonical` and any `logo`/`image` URL inside JSON-LD.

2. **Prefer ASCII separators in titles/descriptions — sidesteps trap 3 entirely.** Both
   reference pals use a plain pipe (`Title | Brand`) rather than an em-dash. If you do want an
   em-dash or curly quote inside an attribute, entity-encode it (`&#8212;`, `&#8217;`) — but
   the simpler fix is to just not need one.

3. **No raw non-ASCII characters inside ATTRIBUTE values.** A literal em-dash (—), curly quote,
   or arrow inside `content="…"` triggers the PalBuilder server's "non ASCII attribute" warning
   on every save. Body TEXT is fine raw — this rule is for attribute values only.

4. **`c:a` is not crawlable — never use it for site navigation.** `c:a` renders as an encrypted
   `javascript:` href; crawlers (and anything that isn't a live browser executing your JS) see
   no link at all. Internal nav, footer links, breadcrumbs, and sitemap-relevant anchors must be
   plain `<a href="page-name.html">...</a>`. Reserve `c:a` for form-submit/server-action
   triggers, never for "go to another page."

5. **`.webp` is served with the wrong content-type — don't ship it.** One reference pal tried
   WebP for hero images and the server returned it as `text/html` (extension not recognized),
   breaking the image. Stick to JPG/PNG and compress aggressively instead (q50 is an acceptable
   quality floor for photographic/painted hero art — one pal cut hero weight from 305K to 146K
   this way with no visible loss).

---

## Heading & content discipline

- **Exactly ONE `<h1>` per page**, stating the page's primary topic — keyword first. Section
  titles are `<h2>`; never skip from `<h1>` to `<h3>`.
- The `<title>` and `<h1>` should agree (same topic, not necessarily identical words).
- Every `<img>` gets `alt="what the image shows"` — or `alt=""` if purely decorative. No
  exceptions; the audit counts them.
- Use semantic structure: `<main>`, `<section>`, `<nav>`, `<footer>` — not div soup. (The
  design skill's composition rules already produce this; keep it.)
- One page = one topic = one primary keyword. Don't stuff; write the offer plainly (the design
  skill's content-economy rules ARE good SEO — scannable, front-loaded, no filler).

---

## JSON-LD structured data — match the @type to the page, not one block for the whole site

Put ONE `<script type="application/ld+json">` block in the page `<head>` (or one `schemaText`
payload var in the templated pattern). The mistake to avoid: dropping the same generic
`Organization` block onto every page. Pick the type that actually describes that page:

| Page kind | `@type` | Notes |
|---|---|---|
| Home | `Organization` + your product, combined via `@graph` | See example below |
| About | `AboutPage` with a `mainEntity` describing the product | |
| Features/product | `WebPage` with `about` (the product) + `mainEntity: ItemList` of features | Add `breadcrumb: BreadcrumbList` on any non-home page that sits under a section |
| FAQ | `FAQPage` with `mainEntity: [Question/acceptedAnswer, ...]` using the REAL on-page Q&A | Don't invent questions not shown to users |
| Blog index | `Blog` with a `publisher` | |
| Blog post | `og:type="article"` + per-post meta (`article:author`, `article:published_time`) | JSON-LD `@type: Article` optional but the OG article tags are the minimum |
| Contact/support | `ContactPage` | |
| Signup/get-started | `WebPage` with a `potentialAction: RegisterAction` | |

`@graph` example for a home page that is both a company and a product (real pattern, trimmed):

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "name": "Brand Parent Co",
      "url": "https://parent-co.com/",
      "logo": "https://YOUR-DOMAIN/nx-ref/Images/logo.png"
    },
    {
      "@type": "WebApplication",
      "name": "Product Name",
      "url": "https://YOUR-DOMAIN",
      "applicationCategory": "...",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "publisher": { "@type": "Organization", "name": "Brand Parent Co", "url": "https://parent-co.com/" }
    }
  ]
}
```

Rules that don't change regardless of type:
- Every URL inside JSON-LD is absolute (trap 1 applies here too).
- JSON-LD is real JSON — double quotes, no trailing commas, no comments.
- In the templated pattern, store each page's JSON-LD as raw JSON text in its own
  `scripts/schema/<page>.js` file and load it with `pal.getScript("schema/<page>")` — keeps the
  workflow's route switch readable and lets you diff schema changes independently of routing.

---

## Loading-speed head optimizations (verified live patterns)

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

---

## robots.txt, sitemap.xml, and llms.txt — every WEB pal needs all three

Pick ONE of the two patterns below — both are verified live. Pattern A is simpler and has no
PalBuilder-manifest dependency; use it unless you already have a `pages`/`datalists` structure
that makes Pattern B's data-driven sitemap worth the setup.

### Pattern A — handle it directly in the workflow (no pal.json page needed)

Intercept these hrefs at the very top of `run()`, **before** any route switch — on test/stage
instances every path falls through to the workflow, so without this intercept a request for
`/robots.txt` renders the homepage HTML instead (this exact bug showed up as 305 Lighthouse
parse errors in production).

```js
function run(controller) {
    c = controller;
    var crawler = serveCrawlerFile();
    if (crawler != null) { return crawler; }
    // ...normal route switch...
}

function serveCrawlerFile() {
    var href = c.getHref();
    if (href == null) { return null; }
    var q = href.indexOf("?");
    if (q >= 0) { href = href.substring(0, q); }

    if (href.indexOf("robots.txt") >= 0) {
        var robots = c.createAjaxResponse(
            "User-agent: *\nAllow: /\nDisallow: /thank-you.html\nSitemap: https://YOUR-DOMAIN/sitemap.xml\n",
            false);
        robots.setContentType("text/plain");           // required — see note below
        return robots;
    }

    if (href.indexOf("sitemap.xml") >= 0) {
        var base = "https://YOUR-DOMAIN/";
        var names = ["index", "page-one", "page-two" /* ...every routable page... */];
        var xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
        for (var i = 0; i < names.length; i++) {
            xml += "<url><loc>" + base + names[i] + ".html</loc></url>\n";
        }
        xml += "</urlset>\n";
        var sitemap = c.createAjaxResponse(xml, false);
        sitemap.setContentType("application/xml");     // required — see note below
        return sitemap;
    }
    return null;
}
```

**`setContentType` is not optional.** Served with the default `text/html`, a browser/crawler
parses `<url>`/`<loc>` as unknown HTML tags and shows bare text instead of a real sitemap — use
`text/plain` for robots.txt and `application/xml` for sitemap.xml.

### Pattern B — data-driven via pal.json page entries

Register `robots.txt` (and optionally `llms.txt`) as **Pages** in `pal.json` with
`"palType": "palTypeRobots"`, `"contentType": "text/plain"`. Route to them with
`c.getPage("robots")` / `c.getPage("llms")`. For the sitemap, register a **Fragment** with
`"palType": "palTypeServiceRequest"` (e.g. `sitemap.html`) holding:

```html
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<c:list name="sitemap" id="s">
<url><loc>${s.page}</loc><lastmod>${lastMod}</lastmod></url>
</c:list>
</urlset>
```

driven by a `datasets`/`datalists` entry named `sitemap` (columns: `page`, `priority`,
`changeFreq`) — one row per route, including dynamic routes like blog posts. Serve it from the
workflow:

```js
function getSitemap() {
    ajax = c.createAjaxResponse(pal.getServiceFragment("sitemap"), true);
    ajax.set("site", getBaseUrl());
    var list = pal.getDataList("sitemap").copy("sitemap");
    for (var i = 0; i < list.getRecordCount(); i++) {
        list.getRecord(i).set("page", getBaseUrl() + list.getRecord(i).getDefaultValue("page", "", true));
    }
    ajax.addDataList(list);
    ajax.setContentType("text/xml");
    return ajax;
}
```

Use this pattern when pages/posts are added dynamically (e.g. a blog) — the datalist grows
without touching workflow code, unlike Pattern A's hardcoded `names` array.

### llms.txt (bonus — modern AI-crawler discovery file)

Not required, but cheap and increasingly checked: a plain-text/markdown file at `/llms.txt`
summarizing what the product is, its core pages, key features, and what it explicitly is NOT
(scope-bounding helps LLM answers stay accurate). Serve it the same way as robots.txt in
whichever pattern you chose above.

### robots.txt content checklist

- `User-agent: *` / `Allow: /` (or scoped `Disallow:` for thank-you/admin/api/temp paths and
  any `?`-querystring duplicate-content URLs).
- `Sitemap: https://YOUR-DOMAIN/sitemap.xml` line, absolute URL.
- `pal_seo_audit` fetches and checks all three files (homepage-HTML fallthrough, content-type,
  required lines/elements) — fix every ERROR it reports there same as for page heads.

---

## Per-page uniqueness

Every page gets its OWN title, description, canonical, og:title/og:description/og:url, and its
own JSON-LD `@type` — never copy the home page's head onto a subpage and call it done. The
canonical/og:url point at THAT page's URL.

---

## The verify loop (not optional)

1. Write the page following this skill → `pal_validate` (offline) → `pal_push`.
2. **`pal_seo_audit`** — it fetches the rendered page and checks: title/description lengths,
   canonical, the 5 og: tags + absolute og:image/og:url, twitter:card, one `<h1>`, viewport,
   JSON-LD presence, img alt coverage, non-ASCII attribute values, and robots.txt/sitemap.xml/
   llms.txt (fallthrough-to-homepage, content-type, required content).
3. Fix every ERROR; review every WARNING. Re-push, re-audit until it reports
   "SEO AUDIT PASSED".

Do not declare a web page done while the audit reports errors.
