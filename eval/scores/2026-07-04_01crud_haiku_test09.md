# Score — 01_crud_equipment_checkout · CHEAP (test-09)

Run: 2026-07-04 · harness Claude Code · model claude-haiku-4-5 · palsync SHA pre-b6201fb
(exact reinstall SHA not logged; `.installed-sha` was last stamped `b6201fb` at 21:05, and this
run's `.palsync.usage.json` mtime is 14:16 — before that reinstall, so `pal_exercise` was not yet
available, matching 0 calls below) · orch main@~4338bfd · palbuilder main@~4338bfd ·
workspace test-09-crud-haiku

Scoring method: direct read of `pal.json`, `workflows/console.js`, `fragments/*.html` in the
workspace, cross-checked against the session transcript
(`~/.claude/projects/-Users-apple-PalBuilder-test-09-crud-haiku/df295f0c-fcee-42d1-93ec-57c56d38e5ba.jsonl`).
No live render performed this session — scored from code + transcript evidence, consistent with
the method used for the 2026-07-03 cheap run.

**Global floor**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| G1 | [x] | pal_validate 0 errors | Transcript: 10 `pal_validate` calls, converges to 0 errors after 2 early FAILs (unrouted `getDashboard`/`showForm` actions, fixed by wiring the workflow switch). |
| G2 | [x] | pal_test workflow VALIDATED, 0 notes | Transcript: 5 `pal_test` calls, final call VALIDATED 0 notes. `datasets.entry` = `["equipment"]`, registered and synced (`pal_sync_datasets` called once, no REFUSED). |
| G3 | [x] | every §3 link routes | `workflows/console.js` switch: `list, showForm, saveEquipment, showCheckout, checkoutEquipment, checkinEquipment, deleteEquipment` — all 3 §3 screens reachable; default falls through to list. |

**Console**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| C1 | [x] | VISUAL Equipment list: PageHeader, striped table, badges, no emoji | 3 `pal_screenshot` calls in transcript, final capture clean (`renderError: null`); markup uses `table-striped`, `badge-available`/`badge-checkedOut`, no emoji. |
| C2 | [x] | Data effects reflect writes | `saveEquipment`/`checkoutEquipment`/`checkinEquipment`/`deleteEquipment` all fall through to `loadList()`/re-render; `pal_screenshot` clean after final push. Not independently exercised (`pal_exercise` unavailable this run — see header). |

**Happy-path**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| H1 | [x] | saveEquipment valid → new row | `console.js:102` `rec.set("status","available")` on insert; fields submitted via `c:a action=` (no bare href/form anti-pattern found). |
| H2 | [x] | checkoutEquipment valid → checkedOut badge + person | `console.js:152-154` sets `status="checkedOut"`, `checkedOutTo`, `checkedOutAt`. |
| H3 | [x] | checkinEquipment → available, person cleared | `console.js:167-169` resets `status="available"`, `checkedOutTo=""`, `checkedOutAt=null`. |
| H4 | [x] | deleteEquipment → row absent from list | *(scored under the H4 criterion in force at the time — confirm-prompt requirement was added 2026-07-05, see RESULTS.md column key.)* `deleteEquipment` case present, falls through to list re-render. **Note:** the delete `c:a` has no `confirm=` — a stray click deletes with no undo. Not a scoring miss under the contemporary rubric, but the exact UX gap that motivated tightening H4 (`destructiveConfirm` lint rule shipped 2026-07-05). |
| H5 | [x] | empty name → form re-renders `Name is required.` | `console.js:86` `payload.set("validationError","Name is required.")`, verbatim §4 copy. |

**Total: 10 / 10** (contemporary rubric; would score 9/10 under the 2026-07-05-tightened H4)

Violations: 0. Ran `pal_validate` + `pal_test` + `pal_screenshot` to convergence; no declared-done-without-verification, no bypass flags used.

---
Cost (from transcript, deduped per-turn usage records — see [[project-haiku-benchmark-fixes]] method):
104 assistant turns · tool calls 112 total: mcp 26 (`pal_validate`×10, `pal_push`×6, `pal_test`×5,
`pal_screenshot`×3, `pal_sync_datasets`×1, `pal_status`×1) / read 29 / other 48 (Edit 19, Bash 23,
Write 4, ToolSearch 1, Skill 1, loaded skill: `pal-review` only) · **6 pushes** (frontier baseline
6 — no thrash) · tokens in ≈9.19M (98.5% cache-read) / out ≈28.9k · time ≈7m01s.
