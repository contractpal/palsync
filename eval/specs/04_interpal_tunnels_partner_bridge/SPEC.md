# SPEC — partner_bridge (palsync test 4: inter-pal communication / tunnels)
status: approved
reality_check: pass (1 recorded caveat — see §13)
spec version: 2
mode: lite
run mode: auto — the build agent runs all tasks end-to-end with NO human intervention. All review (visual, data, structural) happens post-build by a human evaluator. The agent must never stop to ask questions or wait for input.
pal: partner_bridge (console) @ <WORKSPACE — set by evaluator before run>
push policy: free
review cadence: end
design system: ../DESIGN_SYSTEM.md (components: ../COMPONENTS.md) — any evaluator-supplied reference images are the primary design authority and outrank the stub; none ship with this test.
created: 2026-07-06   approved: 2026-07-06
realigned: 2026-07-14 (v2.1 — §9 skill names only)

## 1. Product & audience
Internal integration console for an operations analyst who checks a partner catalog and exposes a
small bridge API to other pals. One primary action: **sync catalog availability from an existing
provider pal through a tunnel**. Benchmark intent: test tunnel workflows, console webservice
workflows, server-side HTTP/service calls, and the ability to build a new pal that communicates
with an existing static provider pal through multiple platform-supported methods.

## 2. Decisions & open questions
- DECISION: evaluator provides an existing static provider pal named `partner_catalog_static` before
  the run — rationale: inter-pal communication needs a stable remote endpoint; this eval builds the
  new requester/bridge pal, not the fixture — PROTECTED: yes
- DECISION: provider fixture API contract is fixed in §5 and must not be changed by the agent —
  rationale: deterministic cross-pal scoring — PROTECTED: yes
- DECISION: the new pal also exposes its own tunnel and console webservice endpoints — rationale:
  verifies both request and provide directions — PROTECTED: yes
- All open questions resolved. Workspace and provider fixture are set by the evaluator before the
  run begins.

## 3. Sitemap & routing
| page/screen | type | file | workflow action | nav label | purpose |
|---|---|---|---|---|---|
| Bridge dashboard | console | console.html + fragment bridgeDashboard.html | (default) / dashboard | Bridge | connection status + catalog rows |
| Sync result | console | fragment bridgeDashboard.html | syncCatalog | — button | pull provider catalog via tunnel |
| Health check | console | fragment bridgeDashboard.html | checkProviderHealth | — button | call provider webservice |
| Local tunnel endpoint | console | workflow tunnel.js | quoteAvailability | — tunnel API | provide one SKU availability to another pal |
| Local webservice endpoint | console | workflow bridgeService.js | bridgeStatus | — webservice API | provide JSON bridge status |

## 4. Copy (REAL — these exact words ship)
### Bridge dashboard
- H1: `Partner bridge`
- Primary action button: `Sync catalog`
- Secondary action button: `Check provider health`
- Status labels: `Tunnel sync`, `Provider health`, `Last sync`
- Table columns: `SKU`, `Item`, `Availability`, `Source`
- EmptyState copy: `No catalog rows synced yet.`
- Success message after sync: `Catalog sync complete.`
- Success message after health check: `Provider health check passed.`
- Failure message for either integration path: `Partner integration failed.`

### Local API responses
- Tunnel action quoteAvailability success text: `availability:`
- Webservice bridgeStatus JSON keys: `status`, `lastSyncAt`, `rowCount`

## 5. Behavior (what the logic DOES — drives acceptance criteria)
### Provider fixture contract (remote pal, consumed by this build)
- Provider pal name: `partner_catalog_static`.
- Tunnel workflow action `getCatalogSnapshot` returns three rows:
  AX-100 / Air filter / inStock; BX-200 / Belt kit / lowStock; CX-300 / Control board / outOfStock.
- Console webservice action `providerHealth` returns JSON with status=`ok` and service=`catalog`.
- The agent must use these contracts as given and must not try to edit the provider pal.

### dashboard
- Trigger: first screen load and completed actions.
- Effect: read local partnerCatalog rows sorted by sku; read last integration status from bridge
  settings/cache/data.
- Output: bridgeDashboard fragment.

### syncCatalog
- Trigger: `Sync catalog` button.
- Input: none.
- Effect: call provider pal `partner_catalog_static` tunnel action `getCatalogSnapshot`; upsert the
  returned rows into partnerCatalog; set source=`tunnel`; set lastSyncAt=now; set tunnelSync=`ok`.
- Failure: if the tunnel call throws or returns unusable data, render `Partner integration failed.`
  and do not delete previously synced rows.
- Output: bridgeDashboard fragment with `Catalog sync complete.`

### checkProviderHealth
- Trigger: `Check provider health` button.
- Input: none.
- Effect: call provider console webservice action `providerHealth` via server-side service request;
  parse JSON; set providerHealth=`ok` only if status=`ok`.
- Failure: render `Partner integration failed.`
- Output: bridgeDashboard fragment with `Provider health check passed.`

### quoteAvailability (local tunnel workflow, provide direction)
- Trigger: another pal calls this pal's tunnel workflow action `quoteAvailability`.
- Input: sku.
- Effect: read partnerCatalog by sku.
- Output: string beginning `availability:` followed by the matching availability or `unknown`.

### bridgeStatus (local console webservice workflow, provide direction)
- Trigger: external webservice caller invokes action `bridgeStatus`.
- Input: none.
- Effect: count partnerCatalog rows and read lastSyncAt.
- Output: JSON object with keys `status`, `lastSyncAt`, `rowCount`.
- [LITE] Deferred edge cases: auth hardening, retries/backoff, provider pagination, bidirectional
  mutation, scheduled sync jobs.

## 6. Layout (composition only — NO colors/fonts)
### Bridge dashboard
- PageHeader (`Partner bridge` + `Sync catalog`) → FilterBar-like action row (`Check provider health`)
  → DetailPanel (Tunnel sync / Provider health / Last sync) → DataTable (StatusBadge in Availability
  column; EmptyState when zero rows)

## 7. SEO
None — console and integration endpoints only.

## 8. Data model
### 8a. Datasets to CREATE
### dataset: partnerCatalog
| field | type (see references/palbuilder-types.md) | size | notes |
|---|---|---|---|
| partnerCatalogId | Primary key | — | |
| sku | String | 40 | notNull, notEmpty, indexed; unique by workflow logic |
| item | String | 100 | notNull |
| availability | String | 20 | `inStock`, `lowStock`, `outOfStock`, or `unknown`; indexed |
| source | String | 20 | expected value `tunnel` |
| lastSyncAt | Date | — | |
Indexes: sku; availability.

### 8b. Datasets CONSUMED (existing — read-only; the build must NOT create or alter these)
None. The provider fixture is a separate pal API, not a dataset in this workspace.

## 9. Required skills (which palsync skills this build loads)
- ALWAYS: palbuilder-frontend, design-build
- IF server-side workflow logic, validation, routing, or responses: palbuilder-workflow
- IF data writes/reads, payloads/DataLists, cache, files, or server-side HTTP: palbuilder-data
- IF a webservice or tunnel action: palbuilder-workflow + cp-api docs for exact controller methods

## 10. PalBuilder surface (the platform primitives this build touches)
- Pages (page-shell): console.html.
- Fragments (c:ignore): bridgeDashboard.
- c: tags used: c:a, c:list, c:fragment, c:if, c:resource, c:debug.
- c:resource libs: none — shipped pb-* styles/scripts only, no external CSS framework.
- Workflows: console.js — workflowType 7 console; tunnel.js — workflowType 15 tunnel;
  bridgeService.js — workflowType 12 console webservice — hub: no.
- Data: DataSet created: partnerCatalog. Settings/cache/data may hold lastSyncAt, tunnelSync,
  providerHealth.
- Jobs: none.
- HTTP/parse: ServiceRequest, JsonParser, Buffer/JsonBuffer.
- Sockets: none.

## 11. Constraints (Always / Ask-first / Never)
- ALWAYS: pal_push is the validation gate (never a standalone pal_validate right before push;
  standalone pal_validate is for diagnosis between edits); §4 copy ships verbatim; workflow JS stays in the restricted
  ES3-style subset; tunnel/webservice methods are verified against skills/docs before use.
- AUTO MODE: the agent proceeds with best judgment on exact tunnel/webservice API calls after
  reading available docs/skills. No stopping for questions.
- NEVER: edit or recreate the provider fixture pal; use browser fetch/ClientPal for provider calls;
  hard-code synced catalog rows into the dashboard; add background jobs or sockets.

## 12. Acceptance criteria
GLOBAL FLOOR:
- [ ] pal_validate: 0 errors
- [ ] pal_test: console workflow VALIDATED, tunnel workflow VALIDATED, console webservice workflow
      VALIDATED, 0 notes
- [ ] every §3 nav link routes (no dead links): dashboard, syncCatalog, checkProviderHealth, quoteAvailability,
      bridgeStatus
- [ ] REGRESSION: the pal-init baseline still passes and untouched UI did not shift.

CONSOLE + INTEGRATION:
- [ ] VISUAL (Bridge dashboard): H1 `Partner bridge`, action row, DetailPanel statuses, DataTable,
      and no emoji.
- [ ] VISUAL QUALITY: desktop + mobile dashboard captures have loaded CSS and `designAudit.errors:0`; console exception evidence must quote each audit sample ancestry (`[inside #cp-root]` or `[OUTSIDE #cp-root]`), and scope `#cp-root` cannot claim the platform-chrome exception;
      the seven-dimension rubric averages at least 1.5/2, focal point/spacing/responsive each score
      2, and no dimension scores 0; every score cites screenshot evidence.
- [ ] syncCatalog: after action, dashboard renders `Catalog sync complete.` and rows AX-100,
      BX-200, CX-300 with source `tunnel`.
- [ ] checkProviderHealth: after action, dashboard renders `Provider health check passed.` and
      providerHealth=`ok`.
- [ ] Failure handling: a simulated bad provider response or unavailable provider renders
      `Partner integration failed.` without deleting existing partnerCatalog rows.

PROVIDE/REQUEST API CHECKS:
- [ ] Local tunnel provide direction: `pal_tunnel_test` or equivalent call to quoteAvailability
      with sku=BX-200 returns a string beginning `availability:` and containing `lowStock`.
- [ ] Local webservice provide direction: invoking bridgeStatus returns JSON keys `status`,
      `lastSyncAt`, `rowCount`, with rowCount=3 after sync.
- [ ] Source review: provider tunnel call, provider webservice call, local tunnel workflow, and local
      console webservice workflow are all present; no browser fetch/ClientPal is used.

## 13. Reality check
- PASS: partnerCatalog has primary key and indexable String fields; workflow types 7/12/15 are
  covered by palbuilder-workflow; ServiceRequest/JsonParser are covered by palbuilder-data;
  §6 components exist in COMPONENTS.md; no dead links; pal_test and pal_tunnel_test verification are
  explicit in EXECUTION.md.
- CAVEAT (accepted): the provider fixture is external to this repo and must be created/available
  before the run. This is intentional for inter-pal communication; §5 defines the fixture contract
  and §12 scores the new pal's integration behavior.

## 14. Amendment log (append-only; empty until the first approved amendment)
(empty)
