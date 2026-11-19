<!-- Adapted in part from claude-seo (MIT, © Agrici Daniel). -->
# Full-site SEO audit for a web pal

Use this after the page heads, crawler files, and copy exist. `pal_seo_audit` covers the
deterministic head/crawler checks; this procedure adds the checks it cannot do and produces
one report with a 0–100 health score.

## 1. List every public page

- Read `pal.json` Pages (`pages.entry`). That is the list `pal_seo_audit` audits automatically.
- Cross-check it with the `<url><loc>` entries in `/sitemap.xml` (see `crawler-files.md`).
  A page missing from one list is a finding: either it is public but unlisted (add it to
  both) or it should not be public (remove it, or serve it noindex).
- Exclude pages that are intentionally noindex (staging, thank-you, internal tools).

## 2. Run the deterministic tool first

- MCP: `pal_seo_audit`; CLI: `palsync seo-audit --dir <pal dir>`.
- With `pal.json` Pages it audits every page; otherwise only the landing page.
- Record per page: errors, warnings, and rule ids. Fix every ERROR before the manual pass —
  a page that fails the tool is not ready for judgment calls.

## 3. Manual checks the tool cannot do

| Check | What to inspect | Reference |
|---|---|---|
| Content / E-E-A-T | one topic per page, real proof, trust pages | `content-eeat.md` |
| AI search readiness | citable passages, FAQ blocks, entity clarity | `geo-ai-search.md` |
| Internal links | every public page ≤3 plain `<a href>` clicks from home; no orphans; no `c:a` in nav | `technical.md` |
| Per-page uniqueness | title, description, canonical, og:*, JSON-LD `@type` all differ | `SKILL.md` |
| Thin pages | ≥150 words (the tool counts; you judge whether the words are useful) | `content-eeat.md` |
| hreflang, only if multilingual | self-reference, return tags, x-default | `international-local.md` |
| Image weight & formats | hero and content images within size targets | `images.md` |

`pal_fetch` a sample of rendered pages and read them. The rendered fetch shows what
crawlers get; the source files show the template that produced it.

## 4. Score — fixed rubric

Score each category 0–100, then weight it. Start each at 100 and deduct per finding:
ERROR −25, WARNING −10; stop at 0. A failed manual check counts as a WARNING.

| Category | Weight | Sources |
|---|---|---|
| On-page head & metadata | 20 | title, description, canonical, og, twitter, lang, noindex |
| Technical crawlability & indexing | 20 | robots.txt, sitemap.xml, redirects, 404, internal links |
| Content & E-E-A-T | 25 | thin content, uniqueness, trust pages, author signals |
| Structured data | 10 | JSON-LD presence, validity, correct `@type` |
| Performance | 10 | Lighthouse / Core Web Vitals, image weight |
| AI search readiness (GEO) | 10 | llms.txt, AI crawler access, citable passages |
| Images | 5 | alt text, width/height, formats, size |

Health score = round(sum(category score × weight / 100)). Use the same rubric every run so
two audits of the same pal are comparable.

## 5. Report template

```md
# SEO audit — <pal name> — <date>
Pages audited: <n> (pal.json Pages + sitemap.xml)
Health score: <0-100>/100

| Category | Score | Weight | Top finding |
|---|---|---|---|
| On-page head & metadata | /100 | 20 | |
| Technical crawlability | /100 | 20 | |
| Content & E-E-A-T | /100 | 25 | |
| Structured data | /100 | 10 | |
| Performance | /100 | 10 | |
| AI search readiness | /100 | 10 | |
| Images | /100 | 5 | |

## Errors (fix first)
1. <page> — <rule> — <finding> — Fix: <exact fix>

## Warnings
- <page> — <rule> — <finding>

## Manual findings
- Content: <thin pages, missing trust pages, duplicate topics>
- GEO: <llms.txt, AI crawler access, citation gaps>
- Internal links: <orphans, depth, `c:a` nav>

## Crawler files
- robots.txt: OK / <finding>
- sitemap.xml: OK / <finding>
- llms.txt: OK / missing (optional)

## Next actions (max 5, ordered)
1. <smallest change with the biggest score gain>
```

Keep the report factual: quote the rule id and the page URL for every finding, and do not
claim a fix worked until a re-run of `pal_seo_audit` passes.
