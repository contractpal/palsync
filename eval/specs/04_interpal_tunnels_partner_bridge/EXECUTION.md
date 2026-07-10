# EXECUTION — partner_bridge (palsync test 4)
spec: SPEC.md (status: approved)   mode: lite

## Auto mode
This build runs fully autonomously. The agent executes all tasks end-to-end without stopping
for human input. There are no mid-build gates, no "ask first" pauses, no blocker escalations.
If tunnel/webservice APIs are ambiguous, the agent reads the available skills/docs, proceeds with
the most standard documented approach, and records the assumption. Human scoring happens once at
the end against §12; the agent's desktop/mobile render-inspect-revise and functional/integration
self-checks remain mandatory during the build.

## Build plan
Dependency order (leaf-first — foundations before things that use them):
1. Create and sync partnerCatalog dataset.
2. Apply the `console-app` starter, then adapt console shell + dashboard.
3. Build dashboard read + bridgeDashboard fragment.
4. Build syncCatalog provider tunnel request and local row upsert.
5. Build checkProviderHealth provider webservice request and JSON parse.
6. Build local tunnel workflow quoteAvailability.
7. Build local console webservice workflow bridgeStatus.

Parallel-safe: T6 and T7 can be planned independently after T1/T4 because they expose separate
workflows, but execute sequentially for verification. Sequential: T1 → T2 → T3 → T4/T5 → T6/T7.
Risks: exact tunnel/webservice controller APIs, remote provider fixture availability, ES3 syntax,
and JSON parsing. Verify compile with pal_test after each workflow push; verify tunnel behavior
with pal_tunnel_test or equivalent.
Checkpoints: after T3 (dashboard), after T5 (both request methods), final after T7.

## Tasks
| id | task | tier | spec ref | depends | status | success condition (behavioral + tool-checkable) |
|---|---|---|---|---|---|---|
| T1 | create and sync partnerCatalog dataset | cheap | §8a, §10 | — | todo | pal_validate 0 errors; pal_sync_datasets provisions partnerCatalog with sku/availability indexes |
| T2 | scaffold console shell + dashboard route | standard | §3, §6, §10 | T1 | todo | pal_validate 0; pal_test console workflow VALIDATED |
| T3 | bridgeDashboard read/render | frontier | §4, §5 dashboard, §6 | T2 | todo | dashboard renders H1 `Partner bridge`, DetailPanel labels, EmptyState copy; pal_test VALIDATED |
| T4 | syncCatalog provider tunnel request + upsert | frontier | §5 syncCatalog, §9, §10 | T3 | todo | sync renders `Catalog sync complete.` and rows AX-100/BX-200/CX-300 with source `tunnel` |
| T5 | checkProviderHealth provider webservice request | standard | §5 checkProviderHealth, §10 | T3 | todo | health action renders `Provider health check passed.` and stores providerHealth=`ok`; failure path renders `Partner integration failed.` |
| T6 | local tunnel workflow quoteAvailability | frontier | §5 quoteAvailability, §10, §12 | T1,T4 | todo | pal_tunnel_test quoteAvailability sku=BX-200 returns `availability:` + `lowStock`; pal_test tunnel workflow VALIDATED |
| T7 | local console webservice workflow bridgeStatus + final visual review | standard | §5 bridgeStatus, §10, §12 | T1,T4 | todo | bridgeStatus returns JSON keys status,lastSyncAt,rowCount with rowCount=3; pal_test webservice VALIDATED; dashboard desktop/mobile audits have 0 errors; rubric average >=1.5 with focal point/spacing/responsive =2 and no 0 |

## Checkpoints (append-only, one line per completed task)
## Blockers (what needs the human — be exact)
None — auto mode; evaluator provides provider pal `partner_catalog_static` before run.
