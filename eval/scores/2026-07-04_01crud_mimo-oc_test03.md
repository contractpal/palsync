# Score — 01_crud_equipment_checkout · CHEAP (mimo-2.5-pro, test-03)

Run: 2026-07-04 · harness OpenCode (provider `opencode-go`) · model `mimo-v2.5-pro` · palsync SHA
b6201fb (`.palsync.usage.json` mtime 23:31, after the 21:05 reinstall to `b6201fb`) · orch
main@b6201fb · palbuilder main@b6201fb · workspace test-03-crud-mimo-oc

Scoring method: direct read of `pal.json`, `workflows/default_console.js`, `fragments/*.html`,
cross-checked against the OpenCode session DB (`ses_0cf4a4431ffec9Fm3yExjxK0yo`, title "Building
pal from spec.md").

**Global floor**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| G1 | [x] | pal_validate 0 errors | Session: 14 `pal_validate` calls, converges to 0 errors. |
| G2 | [x] | pal_test workflow VALIDATED, 0 notes | Session: 7 `pal_test` calls, final VALIDATED 0 notes. `datasets.entry` = `["equipment"]`, registered + synced (1 `pal_sync_datasets`, no REFUSED). |
| G3 | [x] | every §3 link routes | `workflows/default_console.js` handles `list/showForm/saveEquipment/deleteEquipment/showCheckout/checkoutEquipment/checkinEquipment` — all 3 §3 screens reachable. |

**Console**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| C1 | [x] | VISUAL Equipment list: PageHeader, striped table, badges, no emoji | 2 `pal_screenshot` calls; Bootstrap 5.3.5 `table-striped`, `StatusBadge`, `PageHeader`, `EmptyState`, no emoji. |
| C2 | [x] | Data effects reflect writes | **Independently exercised** — 13 `pal_exercise` calls. |

**Happy-path**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| H1 | [x] | saveEquipment valid → new row | `ds.insertRecord`/`ds.updateRecord` branch on hidden id, falls through to list re-render. |
| H2 | [x] | checkoutEquipment valid → checkedOut badge + person | Sets `status="checkedOut"`, `checkedOutTo`, `checkedOutAt` (verified in workflow source). |
| H3 | [x] | checkinEquipment → available, person cleared | Resets `status="available"`, `checkedOutTo=""`, `checkedOutAt=null`. |
| H4 | [x] | deleteEquipment → row absent from list | *(contemporary rubric — confirm requirement added 2026-07-05.)* `deleteEquipment()` → `ds.deleteRecord(equipmentId.toString())` (correct String-id signature, unlike the haiku runs' initial guess), falls through to list re-render; exercised via `pal_exercise`. **Note:** `fragments/equipmentList.html:40` — `<c:a action="deleteEquipment?..." ajax-target="body" class="btn btn-sm btn-outline-danger">Delete</c:a>` has **no `confirm=`**. Same gap as both haiku runs — this is spec-consistent (the SPEC didn't ask for it at the time) but confirms the gap is model-agnostic, not haiku-specific, which is why the fix (2026-07-05) targets the shared skill/spec/lint layer rather than one harness. |
| H5 | [x] | empty name → form re-renders `Name is required.` | Verbatim §4 copy confirmed in workflow source. |

**Total: 10 / 10** (contemporary rubric; would score 9/10 under the 2026-07-05-tightened H4)

Violations: 0. Ran validate/test/screenshot/exercise to convergence.

**Notable inefficiency (not a violation):** 47 platform round-trips this run (13 push + 14
validate + 13 exercise + 7 test) vs. the frontier baseline's 6 pushes — thrash concentrated in
two clusters: the equipmentForm task (~8 edits interleaved with 5 `pal_exercise` calls) and the
delete/workflow task (5 push/exercise cycles). Also burned early time (t≈161–277s) scanning
**unrelated sibling workspaces** (`test-01-crud-mimo`, `Deez-Nutz`, `ISR-SEO-Dashboard`) via
`glob`/`rg`/`python3` while reverse-engineering a console-pal config question — the same
"console packet" confusion that fully derailed test-02 (see that sheet), but this run recovered.

---
Cost: 120 steps/124 messages · tool calls 149: mcp 52 (`pal_validate`×14, `pal_push`×13,
`pal_exercise`×13, `pal_test`×7, `pal_screenshot`×2, `pal_sync_datasets`×1, `pal_status`×1,
`pal_pull`×1) / read 26 / other 71 (bash 32, edit 24, write 5, skill 7 — loaded `pal-loop`,
`palbuilder-frontend`, `palbuilder-core`, `palbuilder-data`, `palbuilder-backend`, `design-build`,
`pal-restraint`; `ctx_execute_file`×2 both errored, `glob`×1) · **13 pushes** (frontier baseline
6) · tokens in ≈11.85M (cache_read 11.71M dominant, cache_write 0 — full context re-billed every
step) / out ≈16.96k (+ 12.3k reasoning) · time ≈14m48s · cost $0.4883.
