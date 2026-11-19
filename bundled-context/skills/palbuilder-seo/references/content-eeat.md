<!-- Adapted in part from claude-seo (MIT, © Agrici Daniel). -->
# Content and E-E-A-T for a web pal

Search engines and AI answer engines reward pages that show real experience, expertise,
authority, and trust. On PalBuilder that means the copy in the page file or fragment, the
trust pages you ship, and the facts you can prove — not a keyword field.

## One page = one topic

- Each page has one primary topic and one primary keyword; the `<title>`, `<h1>`, and first
  paragraph all state it (SKILL.md "Heading & content discipline").
- Split unrelated offers into separate pages, each with its own head and JSON-LD `@type`.
  Every page's title/description/canonical must be unique (SKILL.md "Per-page uniqueness").
- Do not clone one page per city or keyword with only the noun swapped — that is a doorway
  page pattern. Local pages need genuinely different content (see `international-local.md`).

## Thin content

- `pal_seo_audit` warns below 150 words of visible body text. That is a floor, not a goal.
- Competitive coverage floors, adapted from claude-seo (they reflect topical coverage, not
  a Google word-count ranking factor):

| Page kind | Starting coverage |
|---|---|
| Home | ~500 words |
| Service / feature | ~800 words |
| Article / guide | ~1,500 words |
| Product | ~300+ words (400+ if complex) |
| Location page | ~500–600 words |

- Add words by adding information the reader needs: who it is for, what happens, what it
  costs, proof, objections, next step. Never pad with generic filler.

## E-E-A-T signals you can ship in a pal

- **Experience** — first-hand detail: screenshots, process, numbers, before/after, a short
  case note. Specific beats promotional.
- **Expertise** — author byline on articles with a real name and role, visible publish and
  update dates, correct terminology.
- **Authoritativeness** — link to the real profiles and sources you own (company site,
  documentation, press); cite external sources for claims that are not yours.
- **Trust** — real About, Contact, and Privacy pages, linked from the footer with plain
  anchors. Contact must show a working channel (email, phone, form), not a placeholder.
- No invented reviews, ratings, certifications, or addresses. If the pal does not have a
  real one, omit the claim and the matching JSON-LD.
- Keep the brand name, product name, and contact details identical on every page and in the
  footer fragment.

## Page copy shape

1. First paragraph answers the page's question directly (40–60 words). It doubles as the
   AI-citation passage — see `geo-ai-search.md`.
2. H2 sections for the reader's real questions; H3 only under an H2. No skipped levels —
   the audit warns `headingSkip`.
3. Concrete facts: numbers, timeframes, limits, prices, what is included. Attribute external
   statistics to their source.
4. One primary call to action, repeated at natural decision points; secondary actions use
   plain links or `c:a` only for server actions.
5. A visible FAQ for the questions support actually receives (markup: `structured-data.md`).

## Content brief — fill this before writing a new page

```md
Page file / URL:      <e.g. pricing-plans.html>
Primary topic + keyword: <>
Audience:             <who they are, what they already know>
Promise:              <what this page gives them that no other page does>
Proof:                <specifics: numbers, process, screenshots, guarantees>
Structure:
  H1: <>
  H2: <> · H2: <> · H2: <>
  FAQ: <2-4 real questions>
Internal links in:    <3 existing pages that will link here>
Internal links out:   <2-4 related pages>
CTA:                  <one primary action>
Title:                <15-60 chars, keyword first>
Description:          <50-160 chars, plain offer>
JSON-LD @type:        <the matching type from structured-data.md>
```

Re-run `pal_seo_audit` after the copy lands; a page that reads well but has a missing
canonical or noindex still fails.
