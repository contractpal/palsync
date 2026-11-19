<!-- Adapted in part from claude-seo (MIT, © Agrici Daniel). -->
# Technical SEO — crawlability and indexability

These are the checks that decide whether a public web pal page can be found at all. Every
item below is doable with the page file, the workflow, and `pal.json`.

## Language — `<html lang>`

Declare the page language on the root element: `<html lang="en">` (or the real code, e.g.
`en-GB`, `fr`). It drives screen-reader pronunciation and helps search engines treat the
page as the right locale. The audit warns when it is missing.

## One canonical per page

- Exactly one `<link rel="canonical" href="https://…/page.html"/>` per page, absolute.
- It must point at THIS page, and match `og:url` and the URL in `sitemap.xml`.
- Home aliases (`index.html`, `home.html`, `website.html`, empty) should all declare the
  bare domain as canonical (the web template in `palbuilder-workflow` does this).
- Never emit two canonical tags — the audit flags `canonicalMultiple` and search engines may
  ignore both.
- Canonical is not a redirect: it consolidates URL variants (`?utm=…`, http/https), it does
  not move users.

## robots meta and noindex

- Leave the page indexable unless there is a reason: no `noindex` on pages meant to rank.
- Use `<meta name="robots" content="noindex"/>` on staging copies, thank-you pages, and
  internal tools. The audit warns `robotsNoindex` because a noindex left on a real landing
  page silently removes it from search.
- `disallow` in robots.txt blocks crawling; `noindex` blocks indexing. To keep a page out of
  results, prefer `noindex` — a disallowed page can still be indexed from links.

## Crawlable navigation — plain links

- Site navigation, footer links, breadcrumbs, and every sitemap-relevant link must be
  plain `<a href="page-name.html">…</a>`. Crawlers cannot follow `c:a` — it renders as an
  encrypted `javascript:` href (SKILL.md trap 4).
- Use descriptive anchor text ("Compare plans"), not "click here" — the text is a ranking
  and accessibility signal.
- Keep the same URL in the nav, the sitemap, and the canonical. One URL per page.

## URL design

- Page file names become URLs: use lowercase, hyphenated names (`pricing-plans.html`, not
  `PricingPlans2.html`).
- One topic per URL. Do not serve different content from one path based on session state.
- Do not rename a public page without redirecting the old URL; the sitemap and inbound
  links point at the old one.
- Avoid query strings for distinct public content — they multiply crawlable variants.

## Redirects

`c.redirect(url)` sends the browser elsewhere and works in any workflow context (pattern:
`palbuilder-workflow` `references/responses.md`). Return it from the handler instead of a
page. Point each retired URL at its final destination in one hop; never chain redirects.

## 404 handling via the workflow

On a web pal, every unknown path falls through the workflow. Handle it before the default
route:

- Send the unknown path to a real not-found page (a fragment or page with the site nav, a
  short "page not found" message, and links home) instead of silently rendering the
  homepage. A soft 404 (homepage content at every URL) confuses crawlers and users.
- Set the HTTP status to 404 if the controller exposes a status setter — the exact accessor
  varies by workflow type, so verify it in the controller API rather than guessing (see
  `palbuilder-workflow` `references/webservices.md`). Do not invent a method name.
- Keep the unknown-route response out of `sitemap.xml` and out of the canonical set.

## Mobile-first

- The viewport meta from the page-head recipe is mandatory: `<meta name="viewport"
  content="width=device-width, initial-scale=1"/>`.
- Use responsive CSS (flex/grid, max-width, relative units); never a fixed pixel page width.
- Tap targets at least ~44×44 px, body text at least 16 px, no hover-only information.
- Test at 360 px width in `pal_screenshot` before calling the page done.

## Internal linking depth

- Every public page reachable in three plain-link clicks from the home page. New pages need
  at least one link from an existing page; an orphan page is only found via the sitemap.
- Link hub pages to their children and children back to the hub (service index ↔ service
  page).
- Breadcrumbs on non-home pages: visible plain links, and optionally `BreadcrumbList`
  JSON-LD (see `structured-data.md`).

## Cross-references

- robots.txt, sitemap.xml, llms.txt serving: `crawler-files.md`.
- JSON-LD validity and types: `structured-data.md`.
- Speed, LCP, and CLS: `loading-speed.md` and `images.md`.
- Full audit procedure and score: `audit-workflow.md`.
