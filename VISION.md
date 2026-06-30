# palsync — Vision & Roadmap Proposal

*Status: proposal for discussion (June 2026). The numbered priorities are an opinionated
ordering; everything here is built on what the codebase and the live platform actually
support today, with research items called out where they aren't.*

palsync's job is to be the bridge that makes PalBuilder a first-class target for AI agents.
Bridges are judged on two things: **nothing falls off** (0.6.0 closed the data-loss and
reliability gaps), and **traffic flows both ways**. Today the bridge is one-way: the agent
writes code and pushes it, but nothing about the *result* — the rendered page, the workflow
compile, the SEO surface — ever flows back. Every priority below is some form of closing
that loop.

---

## 1. `pal_preview` — let the agent SEE what it built ⭐ highest leverage

The design skill already ends with: *"review the render, not your intentions — push the
fragment and load the actual page; the screen tells the truth."* The agent currently has no
way to do that. This is the single biggest gap between "agent that writes plausible UI" and
"agent that ships designed software." One render-feedback loop is worth more than any amount
of additional skill prose, because it converts the design skill's self-review checklist from
an honor system into an observation.

**Shape:** an MCP tool (`pal_preview`) that renders a deployed page and returns a screenshot
(plus the served HTML) to the agent.

- **Web pals** are open-internet — fetch/screenshot directly, no auth. Start here.
- **Console pals** need an authenticated browser session. palsync holds credentials in the
  keychain; a headless Chromium (Playwright) can log in to the console and screenshot the
  page. Research: confirm the console login flow is scriptable and whether test-mode URLs
  render without full enterprise context.
- Loop: agent edits → `pal_push` → `pal_preview` → sees the pixels → fixes → repeat. Add
  viewport presets (mobile/desktop) so the responsive craft-floor rules become checkable.
- Implementation note: Playwright is a heavy dependency — make it lazy/optional
  (`palsync --with-preview` or auto-install-on-consent like Claude Code in preflight).

## 2. `pal_validate` — catch the silent failure class before it ships

Two PalBuilder failure modes are invisible until too late:

- **Workflow JS compile errors don't surface through the save API** (frozen/cached
  validation — documented in the backend skill). An agent can push a workflow "successfully"
  that is full of `Objects not supported` errors only visible in the builder GUI.
- **XHTML/c: tag violations** are hard errors at parse time (unclosed voids, undocumented
  attributes).

Both are lintable locally, cheaply, with total certainty:

- Workflow-JS subset linter: parse each `workflows/*.js` (acorn) and flag the banned
  constructs — object literals, `let`/`const`, arrow functions, template literals,
  destructuring, `for...of`, array HOFs, function expressions — with file:line and the
  workflow-native alternative (from the skill's own guidance).
- Markup linter: void-tag self-closing, `c:` attribute whitelists (the skill already
  enumerates the valid attribute sets — encode them as data), `${}` inside inline
  `<script>`, `aria-*` on `c:field`, one `c:upload` per page, fragment vs page shell rules.
- Surface it three ways: an MCP tool the agent can call, an automatic pre-push check in
  `pal_push` (warn, don't block — the server stays the authority), and `palsync lint` in
  the CLI.

This makes the skills *enforced* rather than advisory, and it shrinks the iteration loop
the same way `pal_preview` does — failures move from "discovered in the builder next week"
to "fixed before the push."

## 3. Three-way merge on drift — finish the sync story

0.6.0 added per-file baselines (`fileHashes`), which makes drift *visible* per file. The
natural completion: keep the pulled **bytes** (a `.palsync/baseline/` snapshot, gitignore-
style cheap), so when both sides change, palsync can do a real 3-way resolution:

- Server changed `A`, local changed `B` → merge both automatically; no prompt at all.
- Both changed `A` → per-file choice (or textual merge for code files), instead of today's
  whole-workspace force-push/overwrite coin flip.

This dissolves the scariest remaining UX moment (the "both sides changed" prompt) for the
common case where the changes don't actually collide.

## 4. `seo-core` skill + `pal_seo_audit` — perfect SEO from the start

Two halves, one cheap and one cheaper:

- **`seo-core` bundled skill** (injected every session, like every bundled skill):
  PalBuilder-valid recipes for semantic structure, title/meta/OG/Twitter tags, schema.org
  JSON-LD blocks (Organization, Product, FAQ, Article, LocalBusiness), canonical/sitemap
  guidance, and the E-E-A-T/AIO content rules distilled from the existing seo-copywriting
  material. The skill teaches it at build time, so it ships in the initial push.
- **`pal_seo_audit` MCP tool**: web pals are public — fetch the deployed page and check it
  (title/meta lengths, single H1, heading order, alt text, schema validity, OG completeness,
  render-blocking resources). Same closed-loop principle as preview: the agent reads the
  audit and fixes its own output.

## 5. Project starters — the on-ramp for "build me a client portal"

Full non-technical accessibility (web UI/chat front-end) is a product of its own; the
realistic next step is removing blank-page setup cost for *semi*-technical users:

- `palsync --template <marketing-site|client-portal|dashboard|pwa>`: seeds the workspace
  with a `spec.md` scaffold (sections the design skill knows how to consume: brand tokens,
  references, page list), reference imagery slots, and an initial prompt file the user just
  edits in plain English.
- The launcher's outro prints "open Claude and say: *build the spec*" — the one-sentence
  start the vision asks for.
- Longer term, the same MCP server registered with claude.ai (web/desktop) gives a chat-only
  surface without palsync building any UI. Worth a research spike on remote MCP transport —
  the codebase is already transport-agnostic at the tool layer.

## 6. Research findings (June 2026 — mined from the reference extension source)

The builder protocol is not in the public docs; the VS Code extension
(`~/.vscode/extensions/undefined_publisher.pal-builder-0.0.1/out/`) is the ground truth, and
it contains several endpoints **never ported into palsync**:

- **CONFIRMED — dataset provisioning via API.** The extension's dataset editor writes the
  `Dataset` definition (fields/indexes) into `pal.json`, saves, then calls
  `SyncDataSet.do` with the dataset names (`Recreate-Dataset: true` header optional — drops
  data, so palsync should never send it). This is what the GUI's "sync dataset" does. So
  "datasets are PalBuilder-only" is a palsync porting gap, not a platform limit: a
  `pal_sync_datasets` tool would let the agent do real data modeling (define → push → sync).
- **CONFIRMED — `Test<Console|Web|Pal>.do` is the preview/validation primitive.** It returns
  *fresh* `validationResults` (the workflow feedback the save API never gives) **plus a
  runnable token URL**; for console/transaction the extension appends
  `&cp-auth=<base64 user:pass>&nxProfileId=<id>&cp-workflow=<name>` and opens it in a
  browser. That URL is plain-fetchable — `pal_preview` may need no headless-browser login at
  all, and `pal_validate` gets ground truth instead of lint approximation. Requires holding
  the pal lock (which an MCP session already does). **Live probe written and ready:**
  `node scripts/test-workflow-probe.js` (needs an explicit go-ahead to run against ISR, or a
  designated test pal — it locks, tests, fetches the token URL, unlocks; no save).
- **CONFIRMED — deployment via API.** `RequestPalDeployment.do` + `ProcessPalDeployment.do`
  with `DeploymentParameters` (activationKey, upgradeReason "Initial Commit" | upgrade
  packet flags). The full edit → push → test → deploy lifecycle is automatable.
- **OPEN — pal creation.** Nothing in the extension creates a pal (`uploadPal` is local-file
  import). One for the platform team: does `ProcessPalBuilder` accept a CREATE operation?
- **OPEN — debugger output.** No fetchable debug endpoint found in the extension or docs.
  The Test token URL may render the `c:debug` panel inline in test mode, which would
  partially cover it — the probe will tell.

---

## Sequencing (revised after the research findings + "team tool" audience answer)

palsync is a tool for the existing team (everyone has a login), so the accessibility track
(starters, chat-only surfaces) drops to "later" and the close-the-loop track is everything:

| Order | Item | Size | Status |
|---|---|---|---|
| 1 | Run the `Test<Type>.do` probe | XS | ✅ DONE — confirmed live on ISR (fresh validation + token URL; console renders inside the platform shell via encrypted AJAX) |
| 2 | `pal_test` (fresh server validation + browser preview) | M | ✅ DONE — shipped 0.7.0; credential URL opened locally, never returned to the agent |
| 2b | `pal_preview` → render TO the agent | M | ✅ DONE 0.10.0 — WEB pals: plain fetch of the webpals.cloudpiston.com token URL returns the FULLY RENDERED HTML straight to the agent (no auth, no browser, no credential URL) — live-verified on V2 OE. CONSOLE pals open in the user's browser (agent can't see). A headless-browser SCREENSHOT for both (incl. console) is a later add-on; the web HTML path covers the high-value case already |
| 3 | `pal_validate` (local lint: workflow-JS subset + c: attribute whitelists) | M | ✅ DONE — shipped 0.8.0; auto-runs inside pal_push (refuses on errors unless skipValidation). NOTE: Test*.do's `validated` does NOT cover workflow compile (ISR carries 63 object literals yet "validates"), so this offline lint is the only pre-builder compile guardrail |
| 4 | `pal_sync_datasets` (+ lift the datasets-are-GUI-only rule, recreate never) | M | ✅ DONE 0.9.x — LIVE-VERIFIED on ISR: create, already-exists, additive schema change, recreate-gate refusals, real recreate of an empty test dataset, and cleanup all pass (scripts/dataset-live-test.js). Recreate is gated behind an exact typed phrase. Bonus findings: SyncDataSet.do advances the drift marker (fixed); push DOES delete datasets (remove the pal.json entry); valid fieldTypes are a fixed enum (offline-linted, server-confirmed) |
| 5 | 3-way merge | M | Partly unblocked — 0.11.0 added a baseline CONTENT store (.palsync/baseline/), the foundation a 3-way merge needs; merge logic itself still to build |
| 6 | `seo-core` + `pal_seo_audit` | M | Rides on the preview plumbing |
| 7 | Deployment tooling (`pal_deploy`) | M | Confirmed API; turns palsync into the full lifecycle bridge |
| later | Starters/templates, non-technical surfaces | S–L | Team has logins + terminals today |

**Probe outcome (what `pal_test` is built on):** `TestConsole.do` on ISR returned
`validated:true` with 0 notes and a `token` URL. Following that URL with a cookie jar +
programmatic console login lands on the platform console host (`cp-root`, `cp-lib`,
`desktop.css`); the pal's own page then loads *inside* it via server-encrypted
`ContractPal.handleAction` calls a plain fetch can't replay. So: **validation is fetch-cheap
and exact** (the basis of `pal_test`), but **seeing a *console* pal render needs a real
browser** (step 2b). Web pals should screenshot directly from the token URL — untested (ISR is
console-only); a web test pal would confirm it.

A **designated throwaway test pal** unblocks live verification for all of it (standalone
push smoke, the Test probe, dataset sync, deployment) without ever touching a client pal.

The thread through all of it: **close the loop**. An agent that can see the render, the
compile errors, the audit results, and the data is an agent that can iterate to excellent —
which is the difference between "PalBuilder has an AI integration" and "PalBuilder is the
platform where agents do their best work."
