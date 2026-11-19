<!-- Adapted in part from claude-seo (MIT, © Agrici Daniel). -->
# International (hreflang) and local business

Read this only when the pal needs it: multiple languages/regions, or one real physical
business that serves local customers. For a normal single-language web pal, skip it.

## hreflang — multilingual or multi-region pals

Each language/region version is its own page file (or its own route in the templated shell)
with its own title, description, canonical, and body copy. Then, in the `<head>` of every
version, list every version with plain `<link>` tags — absolute URLs only:

```html
<link rel="alternate" hreflang="en" href="https://YOUR-DOMAIN/pricing.html"/>
<link rel="alternate" hreflang="en-GB" href="https://YOUR-DOMAIN/en-gb/pricing.html"/>
<link rel="alternate" hreflang="fr" href="https://YOUR-DOMAIN/fr/tarifs.html"/>
<link rel="alternate" hreflang="x-default" href="https://YOUR-DOMAIN/pricing.html"/>
```

Rules that make the set valid:

- **Self-reference:** each page lists itself, with a URL that exactly matches its canonical.
  A missing self-reference can make search engines ignore the whole set.
- **Reciprocal:** if A lists B, B must list A. Copy the same set (with the self entry
  changed) into every version.
- **x-default:** one fallback URL for unmatched languages, usually the global/English page.
- **Codes:** ISO 639-1 language (`en`, `fr`, `ja`) plus optional ISO 3166-1 region in capitals
  (`en-GB`, `pt-BR`). `en-uk` is invalid; `jp` is invalid (use `ja`); a region alone (`EU`)
  is invalid.
- **Crawlable language switcher:** plain `<a href="…">` links between versions, never `c:a`.
- Each version has its own canonical and `og:url`; do not point translated pages at the
  English canonical unless the pages really are duplicates.

## Local business — one real place

Only use this when a real, verifiable business address exists. Do not invent one.

- **JSON-LD:** use the specific `LocalBusiness` subtype that fits (`Restaurant`,
  `Dentist`, `LegalService`, `AutoRepair`, …), not the generic type. Include `name`,
  `address` (`PostalAddress` with street, city, region, postal code, country),
  `telephone`, `url`, and `openingHoursSpecification`. The full JSON-LD rules are in
  `structured-data.md`.
- **NAP consistency:** the Name, Address, and Phone must match exactly — same punctuation
  and formatting — in the visible footer, the Contact page, and the JSON-LD. Mismatches
  weaken the local entity.
- **Hours:** visible text on screen, not only inside JSON-LD or an image. Keep both in sync.
- **Map:** link "Get directions" to the verified listing with a plain `<a href>`. A provider
  `<iframe>` embed is optional; if you add one, give it `title`, `width`, `height`, and
  `loading="lazy"`, and do not hide the address behind it.
- **Reviews:** show real reviews only; `aggregateRating` must reflect ratings actually on the
  page and be allowed by the platform's review policy. Invented ratings are a trust and
  policy risk.
- **Location pages:** each extra location or service area needs genuinely different content
  (staff, area details, local proof). Duplicating one page with a swapped city name is a
  doorway page and can be treated as spam.

## Scope check

- No real address → no LocalBusiness schema; use `Organization` (home) or `AboutPage`
  instead.
- One language → no hreflang tags at all. Wrong or partial hreflang is worse than none.
- After adding either, re-run `pal_seo_audit` and verify every alternate URL returns 200.

## Related

- `structured-data.md` — JSON-LD types and validity rules.
- `technical.md` — crawlable nav, canonicals, URL design.
- `audit-workflow.md` — where these checks appear in the report.
