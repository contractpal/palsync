---
name: palbuilder-seo
description: "Load with palbuilder-frontend for public WEB-pal SEO: head, content/structured data, sitemap/robots, performance, and pal_seo_audit. Not console pals."
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
  goes in the page head. Full per-page-type guidance: **`references/structured-data.md`**.
- Test/stage instances route **every** path through the workflow — without an explicit
  robots.txt/sitemap.xml intercept, those URLs render the homepage HTML instead (Lighthouse:
  305 parse errors). Both intercept patterns: **`references/crawler-files.md`** — read it before
  building robots.txt/sitemap.xml for any new web pal.

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
payload var in the templated pattern) — never the same generic `Organization` block on every
page. Every URL inside JSON-LD is absolute (trap 1 below applies here too); JSON-LD is real JSON
(double quotes, no trailing commas/comments). The `@type`-per-page-kind table and a worked
`@graph` example: **`references/structured-data.md`** — read it before writing any page's
JSON-LD.

---

## Loading-speed head optimizations

A correct `<head>` and a *fast* `<head>` are both this skill's job — Lighthouse perf score is
part of SEO. Highest-impact rule: render the LCP hero image as a real `<img fetchpriority="high"
srcset=... />` in the initial HTML, never a CSS `background-image`. Full ordered list (font
loading, critical CSS, defer discipline, speculation rules) with code: **`references/loading-speed.md`**.

---

## robots.txt, sitemap.xml, and llms.txt — every WEB pal needs all three

Test/stage instances route **every** path through the workflow, so without an explicit
robots.txt/sitemap.xml intercept those URLs render the homepage HTML instead of the file (this
exact bug caused 305 Lighthouse parse errors in production). Two verified patterns — direct
workflow intercept (no manifest dependency) or data-driven via `pal.json` Pages/a sitemap
datalist — plus the content checklist: **`references/crawler-files.md`**. Pick Pattern A unless
you already have a `pages`/`datalists` structure that makes B's data-driven sitemap worth it.

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
