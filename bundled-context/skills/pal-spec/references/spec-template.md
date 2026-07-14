# SPEC.md template

Copy the clean template at the bottom into `SPEC.md` and fill each section. The numbered notes
below tell you how to fill each part — **do not copy the notes into the spec.** The template
itself carries no inline comments, so nothing here leaks into your output.

## How to fill each section

**Frontmatter**
1. `status:` starts `draft`; pal-loop refuses to run until `approved`.
2. `reality_check:` starts `blocked`; the reality-check gate sets `pass` when all hard flags clear.
3. `spec version:` starts `1`; bump on each human-approved amendment (see §14).
4. `mode:` `full` or `lite`.
5. `pal:` name + type `(web | console | web+console)` @ cloud url. `web+console` = the pal mixes
   public and logged-in pages; §3 tags each page's type.
6. `push policy:` `free` or `checkpoint`. `review cadence:` `each-task | every-<N> | end` — default
   `end` (pal-loop pauses for human review only at build completion; each-task/every-N add earlier
   mid-build pauses).

**§1 Product & audience** — what this is, who it serves, the user's state/context, the one
primary action, and the primary journey in one sentence.

**§2 Decisions & open questions** — DECISION lines carry a rationale and a PROTECTED flag (yes = do
not change without sign-off). OPEN lines are blockers the human owes; they are never silently
resolved by the build. Name which task each OPEN blocks.

**§3 Sitemap & routing** — every nav link MUST have a row; no dead links. The `type` column
(web/console) decides which §7/§12 rules apply to that row — it matters for hybrid (web+console)
pals; for a pure web or pure console pal every row shares the pal-level type.

**§4 Copy** — the exact words that ship, per page: H1 / Subhead / Primary CTA → destination /
section copy, written out in full. LITE: primary pages real; secondary may be stubbed-but-marked.

**§5 Behavior** — one block per action/screen: Trigger / Input(+types) / Validation (When <cond>,
system shall <result, exact msg>) / Effect (dataset+field) / Output (next screen). FULL adds edge
cases (empty/invalid/not-found/duplicate/auth-fail → behavior each); LITE lists deferred edge cases
without specifying them. Omit for pure static pages; mandatory for anything with logic.

**§6 Layout** — composition and UX flow only, NO colors/fonts: sections in order, each naming a
COMPONENTS.md component, plus the primary path, hierarchy order, target placement, feedback/next
step, and progressive disclosure notes. Brownfield (MAP.md present): new UI MUST match the
conventions + design reality recorded in MAP.md — reuse before building; no DESIGN_SYSTEM.md yet →
run design-system-init in EXTRACT mode against the map. Every UI page follows `../../shared/references/css-conventions.md`. Existing pals are not retrofitted.

**§7 SEO** — publicly indexable pages only; mark which §3 rows apply (usually `web`-tagged, but a
`console` row can qualify, e.g. a logged-out landing/login screen). title ≤60ch, meta desc
50-160ch, og:image an ABSOLUTE url. Give a canonical base.

**§8 Data model** (omit if none) — §8a datasets to CREATE: every created dataset gets a primary key
field named `<dataset>Id`; types come from `references/palbuilder-types.md`. §8b datasets CONSUMED
(existing, read-only — the build must NOT create or alter these): declare EXACTLY which existing
fields you depend on; an unlisted field is an unverifiable dependency the reality check flags.
Brownfield (MAP.md present): populate §8b from MAP.md's Dataset inventory — existing datasets are
§8b (from the map), NEVER §8a; map-sourced fields count as verified only while `pal_status` shows
no server drift since MAP.md's `mapped` date; if it drifted, re-verify against the live dataset.

**§9 Required skills** — list only what §5/§7/§8 actually require; this scopes the build's context.
`palbuilder-workflow` keys off real server-side logic, validation, response handling, or workflow
routing, NOT just "has a workflow" (every pal has a serving workflow). `palbuilder-data` keys off
dataset/dataview/payload/cache/file/HTTP work. For a webservice/tunnel action, load
`palbuilder-workflow` and look up exact controller methods at the cp-api docs before writing;
never guess a method name.

**§10 PalBuilder surface** — every line must be a REAL primitive; this manifest feeds the reality
check and the build plan.

**§11 Constraints** — ALWAYS / ASK-FIRST / NEVER. NEVER lists out-of-scope pages/datasets the build
must not create, edit, or delete. Brownfield: seed NEVER from the map's load-bearing/shared/
high-blast-radius section plus the user's "must not change" answers.

**§12 Acceptance criteria** — see the layered structure in the template. Console render verification
(pal_screenshot `captured:true` vs human-eyeball fallback on `captured:false`) is defined once in
../../pal-review/references/console-render-verification.md; §12 references it rather than restating it.

**§13 Reality check** — filled by the reality-check gate (references/reality-check.md); the spec
stays draft while hard flags remain.

**§14 Amendment log** — append-only, empty until the first approved amendment. pal-loop NEVER edits
the spec silently; the amendment path is in `amendment-path.md` (this directory). One block per approved
amendment: `- v<n> (<date>, approved by <human>): <which §> — <what changed> — reality forced it
because: <build-time fact>. Re-gate: reality_check re-run for <§> → pass.`

## Clean template

```markdown
# SPEC — <project name>
status: draft
reality_check: blocked
spec version: 1
mode: full | lite
pal: <pal name> (<web | console | web+console>) @ <cloud url>
push policy: free | checkpoint
review cadence: each-task | every-<N> | end
design system: DESIGN_SYSTEM.md @ <path>
created: <date>   approved: <date or pending>

## 1. Product & audience
<what this is, who it serves, user state/context, the one primary action, and the primary journey.>

## 2. Decisions & open questions
- DECISION: <choice> — rationale: <why> — PROTECTED: <yes = do not change without sign-off>
- OPEN: <unresolved item the human owes> — blocks: <task>

## 3. Sitemap & routing
| page/screen | type (web/console) | file | workflow action | nav label | purpose |

## 4. Copy (REAL — these exact words ship)
### <page>
- H1 / Subhead / Primary CTA → <destination> / section copy (written out)

## 5. Behavior (what the logic DOES — drives acceptance criteria)
### <action / screen>
- Trigger / Input(+types) / Validation (When <cond>, system shall <result, exact msg>) /
  Effect (dataset+field) / Output (next screen)
- Seam: <highest-level proof: named pal_exercise flow / pal_test / exact expect>
- [FULL] Edge cases: empty / invalid / not-found / duplicate / auth-fail → behavior each
- [LITE] Deferred edge cases: <bullet list, not specified>

## 6. Layout (composition only — NO colors/fonts)
### <page>
- Sections in order: <hero> → <grid> → <CTA> → <footer>
- Each names a COMPONENTS.md component: <hero = Hero/centered, grid = CardRow x3>
- UX flow: entry point → first decision → primary action placement → feedback → next step
- Hierarchy/disclosure: <what appears first, what is grouped, what is deferred behind tabs/drawer/etc.>

## 7. SEO
| page | title (<=60ch) | meta desc (50-160ch) | og:image (ABSOLUTE url) | schema |
Canonical base: <https://...>

## 8. Data model (omit if none)
### 8a. Datasets to CREATE
### dataset: <name>
| field | type (see references/palbuilder-types.md) | size | notes |

### 8b. Datasets CONSUMED (existing — read-only; the build must NOT create or alter these)
### dataset: <name>  — owner: <who/what owns it>
| field relied on | type | used by (which §5 action / §6 component) |

## 9. Required skills (which palsync skills this build loads)
- ALWAYS: palbuilder-frontend, design-build
- IF server-side workflow logic, validation, routing, or responses: palbuilder-workflow
- IF data writes/reads, payloads/DataLists, cache, files, or server-side HTTP: palbuilder-data
- IF background jobs, long-running work, realtime, server push, or progress UI: palbuilder-realtime
- IF sending email (OTP, notifications, transactional):     palbuilder-email
- IF any §3 page is publicly indexable (§7 non-empty):      palbuilder-seo
- IF a webservice or tunnel action (Q5): palbuilder-workflow + look up the exact
  ConsoleWebServiceController/TunnelController methods in the cp-api docs before writing.

## 10. PalBuilder surface (the platform primitives this build touches)
- Pages (page-shell) / Fragments (c:ignore): <which>
- c: tags used: <c:a, c:field, c:list, c:fragment, c:if/c:when, c:set, c:resource, c:debug>
- CSS/resources: follow `../../shared/references/css-conventions.md`
- c:resource libs: <jquery, chartjs only if explicitly required —
  never Bootstrap just for spacing/layout>
- Workflows: <names> — workflowType <7 console / 9 web / 11 job|receiver / 12 webservice /
  15 tunnel> — hub: <yes/no>
- Data: DataSet <created: list> / DataSet <consumed read-only: list> / DataView <if joins> / DataList <if used>
- Jobs: <jobManager.createJob + Monitor — only if long-running>
- HTTP/parse: <ServiceRequest / JsonParser / Buffer / DownloadResponse — only if used>
- Sockets: <createClientSocket + receiver — only if real-time>

## 11. Constraints (Always / Ask-first / Never)
- ALWAYS: <validate before every push; copy ships verbatim>
- ASK FIRST: <dataset schema change; touching shared fragments>
- NEVER: <out-of-scope pages/datasets the build must not create, edit, or delete>

## 12. Acceptance criteria
GLOBAL FLOOR (both modes):
- [ ] pal_validate: 0 errors   - [ ] pal_test: workflow VALIDATED, 0 notes
- [ ] every §3 nav link routes (no dead links)
- [ ] every new-pal UI page follows `../../shared/references/css-conventions.md`
- [ ] [brownfield/MAP.md present — mandatory] REGRESSION: MAP.md's Step-3 baseline still passes
      (pal_validate/pal_test at least as clean as the baseline) and untouched UI didn't visually
      shift (pal_screenshot before/after the map's saved references).
WEB pages add (every §3 row tagged `web`):
- [ ] pal_preview: rendered page contains the exact H1s from §4
- [ ] VISUAL (one per visually-significant web-tagged §3 page): the hero/key screen renders per
      DESIGN_SYSTEM.md with clear hierarchy, grouped controls, usable target sizing, and no
      anti-slop fingerprints (see ../../pal-review/references/console-render-verification.md).
      State the exact thing to see.
INDEXABLE pages add (every §3 row listed in §7):
- [ ] pal_seo_audit: 0 errors per §7-listed page
CONSOLE pages add (every §3 row tagged `console`):
- [ ] VISUAL (one per visually-significant §3 screen) + HUMAN-EYEBALL fallback — per
      ../../pal-review/references/console-render-verification.md.
- [ ] data effects checked indirectly: after a §5 write, a follow-up read (or builder dataset
      inspection) shows the new/changed row. State the exact check per action.
PER-FEATURE [FULL] (one block per §5 behavior, as checkable conditions):
- [ ] <action>: When <input>, <observable result> — verify via <tool + exact string/state, or
      console render verification for console screens>
- [ ] <action> edge: empty → "<exact msg>" — verify via pal_preview/pal_test/eyeball
HAPPY-PATH [LITE] (one per primary action):
- [ ] <action>: When <valid input>, <observable result> — verify via <tool/eyeball + check>

## 13. Reality check
<filled by the reality-check gate; spec stays draft while hard flags remain>

## 14. Amendment log (append-only; empty until the first approved amendment)
<one block per human-approved amendment; format in the how-to-fill notes above>
```
