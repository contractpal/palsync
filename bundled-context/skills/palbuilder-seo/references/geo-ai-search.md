<!-- Adapted in part from claude-seo (MIT, © Agrici Daniel). -->
# AI search / GEO — get the pal cited by answer engines

Generative Engine Optimization (GEO) is making a page easy for AI answer engines (Google AI
Overviews, ChatGPT search, Claude, Perplexity, Bing Copilot) to read, quote, and attribute.
It is plain HTML and text work on top of the normal SEO rules — no API keys, no paid tools.

## What AI crawlers can read in a pal

The server renders the page HTML before sending it. Copy that lives in page files and
fragments is in that HTML. Text injected only by client JavaScript may never be seen — put
answers in the served markup, not behind a script.

## llms.txt and robots.txt

- `llms.txt` is a plain-text summary of the product, its core pages, key claims, and what it
  is NOT. Serving pattern and content checklist: `crawler-files.md`. Optional but cheap.
- AI crawler rules go in the same `robots.txt` intercept described in `crawler-files.md`.
  Match each token to what it actually controls:

| Token | Governs |
|---|---|
| `OAI-SearchBot` | ChatGPT search citations |
| `Claude-SearchBot` | Claude search citations |
| `PerplexityBot` | Perplexity answers |
| `GPTBot` | OpenAI model training — not ChatGPT search |
| `ClaudeBot` | Anthropic model training — not Claude search |
| `Google-Extended` | Gemini/Vertex training and grounding — not Google Search or AI Overviews |
| `CCBot` | Common Crawl datasets used by many models |

- Allow the search crawlers whose citations you want; decide the training crawlers
  separately. Blocking everything guarantees you are never cited.
- Keep the file plain text with `setContentType("text/plain")`; a fallthrough page here is
  an audit ERROR (`robotsFallthrough`).

## Citable passage structure

- Answer the page's question in the first 40–60 words of the page and of each section. The
  opening paragraph is the passage an engine is most likely to lift.
- Use question-shaped H2s ("How much does X cost?") over vague labels ("Details").
- Make each section self-contained: a reader who sees only that block still gets a complete
  answer (roughly 130–170 words, one idea per block).
- Prefer lists, numbered steps, and small tables for processes and comparisons — they are
  easy to quote and hard to garble.
- Attribute statistics and claims to a named source. Unattributed numbers are weaker
  citation material.
- Put the answer in visible text. Text inside images is not read; neither is text that only
  client JS renders.

## FAQ blocks

- Add a visible FAQ section of questions users actually ask, each with a short direct answer.
- Mark it up with `FAQPage` JSON-LD using the same questions and answers shown on the page
  (type table: `structured-data.md`). Do not invent questions that are not visible.
- Keep one FAQ block per page; duplicating the same FAQ across the site dilutes uniqueness.

## Entity clarity in JSON-LD

- Use one consistent brand/product name across the site, the footer, and schema.
- Home page schema: `Organization` (or `WebApplication` for a product) with `name`, `url`,
  absolute `logo`, and `sameAs` links to the real external profiles.
- Every URL inside JSON-LD is absolute; JSON must parse (the audit warns `jsonLdInvalid`).
- Describe the same entity on every page that references it — conflicting names split the
  entity in search and AI systems.

## Measure without APIs

Spot-check by hand: ask the AI engines the questions the page should answer and record
whether the pal is cited and which URL is used. Re-check after a content or schema change.
Do not claim AI visibility from page structure alone — only from an observed answer.

## Related

- `content-eeat.md` for the trust signals that make a source citable.
- `technical.md` for crawlable markup and indexability.
- `audit-workflow.md` for scoring AI search readiness in the report.
