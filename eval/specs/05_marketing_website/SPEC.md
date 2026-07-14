# SPEC — signal_ridge (palsync test 5: marketing website)
status: approved
reality_check: pass
spec version: 3
mode: lite
run mode: auto — the build agent runs all tasks end-to-end with NO human intervention. All review (visual, SEO, routing) happens post-build by a human evaluator. The agent must never stop to ask questions or wait for input.
pal: signal_ridge (web) @ <WORKSPACE — set by evaluator before run>
push policy: free
review cadence: end
design system: ../DESIGN_SYSTEM.md (components: ../COMPONENTS.md) — any evaluator-supplied reference images are the primary design authority and outrank the stub; none ship with this test.
created: 2026-07-06   approved: 2026-07-10
realigned: 2026-07-14 (v2.1 — §9 skill names only)

## 1. Product & audience
Static marketing website for Signal Ridge, a fictional operations consulting studio for growing
field-service teams. Primary action: **book a planning call**. Benchmark intent: test web workflow
routing, static page composition, exact copy handling, SEO heads, crawler files, and web preview
verification without the distraction of datasets.

## 2. Decisions & open questions
- DECISION: public web-only pal, no console UI — rationale: isolates marketing-site behavior —
  PROTECTED: yes
- DECISION: no lead form and no dataset; the CTA uses a mailto link — rationale: static marketing
  benchmark focuses on pages/SEO rather than CRUD — PROTECTED: yes
- DECISION: all claims are fictional and approved as copy in §4 — rationale: no external fact
  lookup or invented stats — PROTECTED: yes
- All open questions resolved. Workspace is set by the evaluator before the run begins.

## 3. Sitemap & routing
| page/screen | type | file | workflow action | nav label | purpose |
|---|---|---|---|---|---|
| Home | web | web.html + fragment home.html | (default) / home | Home | primary landing page |
| Services | web | web.html + fragment services.html | services | Services | describe offers |
| About | web | web.html + fragment about.html | about | About | credibility story |
| Contact | web | web.html + fragment contact.html | contact | Contact | booking CTA |
| robots.txt | web | workflow response | robots.txt path | — | crawler policy |
| sitemap.xml | web | workflow response | sitemap.xml path | — | indexable URLs |
| llms.txt | web | workflow response | llms.txt path | — | AI crawler summary |

## 4. Copy (REAL — these exact words ship)
### Global navigation
- Brand text: `Signal Ridge`
- Nav labels: `Home`, `Services`, `About`, `Contact`
- Persistent navigation CTA: `Book a planning call` (secondary treatment; the hero owns the first primary)

### Home
- H1: `Field operations that stay on schedule`
- Subhead: `Signal Ridge helps service teams turn scattered dispatch, staffing, and inventory work into calm weekly operating rhythms.`
- Hero CTA: `Book a planning call` → contact
- Secondary CTA: `See services` → services
- Section heading: `What gets steadier`
- Outcomes:
  - `Dispatch clarity` — `Know who is going where before the day starts.`
  - `Inventory confidence` — `See what is ready, missing, and waiting on a vendor.`
  - `Manager rhythm` — `Run one weekly meeting that catches drift early.`

### Services
- H1: `Services for teams outgrowing spreadsheets`
- Subhead: `Simple operating systems for dispatch, inventory, and team leads.`
- Services:
  - `Workflow audit` — `A one-week review of handoffs, delays, duplicate entry, and reporting gaps.`
  - `Pilot operating board` — `A lightweight dashboard and meeting cadence your managers can use immediately.`
  - `Implementation coaching` — `Four weeks of working sessions to move the new rhythm into daily use.`

### About
- H1: `Built for practical operators`
- Subhead: `Signal Ridge works with teams that need fewer surprises, not more software theater.`
- Body paragraph: `We design small, durable operating systems around the people already doing the work. The goal is a better week for dispatchers, field leads, and managers.`

### Contact
- H1: `Plan the next steady week`
- Subhead: `Tell us where the work gets stuck. We will reply with two useful next steps.`
- Contact line: `Email hello@signalridge.example to book a planning call.`
- CTA label: `Email Signal Ridge`

### Crawler files
- robots.txt includes: `User-agent: *`, `Allow: /`, `Sitemap: https://signalridge.example/sitemap.xml`
- llms.txt H1: `Signal Ridge`
- llms.txt summary line: `Signal Ridge is a fictional operations consulting studio for field-service teams.`

## 5. Behavior (what the logic DOES — drives acceptance criteria)
### routePage
- Trigger: default load or nav click.
- Input: action home/services/about/contact or no action.
- Effect: select the matching fragment; set active nav state; attach SEO values from §7.
- Output: web.html with the selected fragment.
- [LITE] Deferred edge cases: 404 page, analytics, multilingual routes.

### robotsTxt
- Trigger: request path contains robots.txt.
- Effect: return plain text from §4, not the web page shell.
- Output: response body with crawler policy.

### sitemapXml
- Trigger: request path contains sitemap.xml.
- Effect: return XML urlset for the four §3 web pages using canonical base from §7.
- Output: XML response body.

### llmsTxt
- Trigger: request path contains llms.txt.
- Effect: return plain text summary from §4 plus links to Home, Services, About, Contact.
- Output: text response body.

## 6. Layout (composition only — NO colors/fonts)
### Home
- MarketingShell → split MarketingHero. Left: exact H1/subhead + primary/secondary CTAs. Right:
  `What gets steadier` + OutcomeList using the three approved outcomes (ranked rows, not three equal
  cards). Then CTASection → FooterNav. The hero and outcome proof share the first viewport at desktop.
### Services
- PageHeader → numbered ServiceList using the three approved services → CTASection → FooterNav.
  This is a service/editorial page, not a clone of the Home hero.
### About
- EditorialSplit: PageHeader/subhead on one side, approved body paragraph on the other →
  CTASection → FooterNav.
### Contact
- PageHeader → compact ContactPanel containing the approved contact line + `Email Signal Ridge`
  action → FooterNav. Do not insert a large empty spacer or repeat a second CTA band.

Global navigation is a familiar full-width sticky row, not a floating pill; its persistent CTA is
visually secondary so it does not compete with the hero primary. Skip link is hidden
until focused. Each route has a visibly distinct composition while sharing tokens and components.
At 320-390px every split becomes one column with no page-level horizontal overflow.

## 7. SEO
| page | title (<=60ch) | meta desc (50-160ch) | og:image (ABSOLUTE url) | schema |
|---|---|---|---|---|
| Home | Signal Ridge | Field operations consulting for dispatch, inventory, and manager rhythm in growing service teams. | https://signalridge.example/og/home.jpg | Organization |
| Services | Services — Signal Ridge | Workflow audits, pilot operating boards, and implementation coaching for field-service operators. | https://signalridge.example/og/services.jpg | Service |
| About | About Signal Ridge | A practical operations consulting studio focused on steadier weeks for field-service teams. | https://signalridge.example/og/about.jpg | AboutPage |
| Contact | Contact Signal Ridge | Book a planning call with Signal Ridge to identify the next useful operating improvement. | https://signalridge.example/og/contact.jpg | ContactPage |
Canonical base: https://signalridge.example

## 8. Data model
Omit — no datasets, dataviews, data bundles, or datalists.

## 9. Required skills (which palsync skills this build loads)
- ALWAYS: palbuilder-frontend, design-build
- IF server-side workflow logic, validation, routing, or responses: palbuilder-workflow
- IF any §3 page is publicly indexable (§7 non-empty): palbuilder-seo

## 10. PalBuilder surface (the platform primitives this build touches)
- Pages (page-shell): web.html.
- Fragments (c:ignore): home, services, about, contact, nav, footer.
- c: tags used: c:a, c:fragment, c:if, c:set, c:resource, c:debug.
- c:resource libs: none — shipped pb-* styles/scripts only, no external CSS framework.
- Workflows: web.js — workflowType 9 web — hub: no.
- Data: none.
- Jobs: none.
- HTTP/parse: crawler-file string responses only.
- Sockets: none.

## 11. Constraints (Always / Ask-first / Never)
- ALWAYS: pal_push is the validation gate (never a standalone pal_validate right before push;
  standalone pal_validate is for diagnosis between edits); §4 copy ships verbatim; every §3 nav link routes; SEO fields
  match §7; crawler files return crawler bodies, not the HTML page shell.
- AUTO MODE: the agent proceeds with best judgment on implementation details. No stopping for
  questions.
- NEVER: create datasets, console workflows, transaction workflows, jobs, sockets, fetch/ClientPal
  calls, fake stats/testimonials, or extra pages beyond §3.

## 12. Acceptance criteria
GLOBAL FLOOR:
- [ ] pal_validate: 0 errors
- [ ] pal_test: web workflow VALIDATED, 0 notes
- [ ] every §3 nav link routes (no dead links): home, services, about, contact, robots.txt, sitemap.xml, llms.txt
- [ ] REGRESSION: the pal-init baseline still passes and untouched UI did not shift.

WEB pages:
- [ ] pal_preview/pal_fetch Home contains exact H1 `Field operations that stay on schedule`.
- [ ] pal_preview/pal_fetch Services contains exact H1 `Services for teams outgrowing spreadsheets`.
- [ ] pal_preview/pal_fetch About contains exact H1 `Built for practical operators`.
- [ ] pal_preview/pal_fetch Contact contains exact H1 `Plan the next steady week`.
- [ ] VISUAL hierarchy (Home): split MarketingHero and `What gets steadier` OutcomeList share the
      first desktop viewport; one primary + quieter secondary CTA; H1 does not dominate the whole
      viewport; CTA and FooterNav follow without unexplained blank bands.
- [ ] VISUAL composition (all routes): Services uses a numbered service list, About an editorial
      split, and Contact a compact contact panel. They do not clone one generic card/CTA template.
- [ ] NAV/CONTENT integrity: full-width familiar nav; skip link appears only on keyboard focus;
      no floating pill shell, emoji, invented proof, fake media, fake stats/testimonials, or repeated
      dominant dark CTA slabs.
- [ ] RESPONSIVE/A11Y: desktop + mobile captures for Home, Services, About, and Contact have
      `renderError:null`, loaded CSS, and `designAudit.errors:0`; console exception evidence must quote each audit sample ancestry (`[inside #cp-root]` or `[OUTSIDE #cp-root]`), and scope `#cp-root` cannot claim the platform-chrome exception; mobile has no page-level overflow,
      focus is visible, and content/action order matches the visual hierarchy.
- [ ] VISUAL rubric: focal point/story, spacing/proximity, typography hierarchy, alignment/grid,
      CTA clarity, responsive composition, and context-specific distinctiveness average at least
      1.5/2; focal point, spacing, and responsive composition each score 2; no dimension scores 0.
      Every score cites screenshot evidence.

INDEXABLE pages:
- [ ] pal_seo_audit: 0 errors for Home, Services, About, and Contact.
- [ ] robots.txt returns text containing `User-agent: *`, `Allow: /`, and the absolute sitemap URL.
- [ ] sitemap.xml returns XML containing all four canonical URLs.
- [ ] llms.txt returns text containing `Signal Ridge` and the approved summary line.

HAPPY-PATH [LITE]:
- [ ] Navigation: every global nav label routes to its matching H1.
- [ ] Contact CTA: `Email Signal Ridge` uses a mailto link for hello@signalridge.example.

## 13. Reality check
- PASS: no data model needed; workflowType 9 web is supported; all §6 components are present in
  COMPONENTS.md; SEO titles/descriptions are within limits; og:image values are absolute URLs;
  crawler files map to workflow string responses; pal_test, pal_preview/fetch, and pal_seo_audit
  verification are explicit in EXECUTION.md.

## 14. Amendment log (append-only; empty until the first approved amendment)
(empty)
