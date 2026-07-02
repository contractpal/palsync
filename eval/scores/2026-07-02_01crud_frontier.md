# Score — 01_crud_equipment_checkout · FRONTIER

Run: 2026-07-02 · harness Claude Code · model claude-opus-4-8 · palsync 454ecfe ·
orch main@454ecfe · palbuilder main@454ecfe · workspace test-01-crud-frontier

Scoring method: `palsync validate` + `palsync test` (authoritative floor) + source review of
workflows/console.js and fragments. Live click-through render is the human eyeball step (console
pal renders behind CloudPiston login) — not performed headless; markup verified instead.

**Global floor**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| G1 | [x] | pal_validate 0 errors | `palsync validate` → VALIDATION PASSED, 0 problems in 6 files |
| G2 | [x] | pal_test workflow VALIDATED, 0 notes | `palsync test` → ✅ console workflow VALIDATED, no notes |
| G3 | [x] | every §3 link routes | console.js switch handles showForm/saveEquipment/showCheckout/checkoutEquipment/checkinEquipment/deleteEquipment; default + `list` → listEquipment; Cancel uses action="list" |

**Console**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| C1 | [x] | VISUAL: PageHeader `Equipment`, striped table, status badges, no emoji | equipmentList.html: `<h1>Equipment</h1>`, `table table-striped`, `badge bg-success/bg-secondary`, no emoji chars |
| C2 | [x] | Data effects: each write returns updated list fragment | every write fn sets `frag="equipmentList"`; run() re-calls listEquipment() then ajax-swaps `#body` |

**Happy-path**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| H1 | [x] | saveEquipment valid → new row | createRecord + set name/category/notes + status="available" + insertRecord |
| H2 | [x] | checkoutEquipment valid → checkedOut badge + person | sets status="checkedOut", checkedOutTo, checkedOutAt; list shows badge + checkedOutTo col |
| H3 | [x] | checkinEquipment → available, person cleared | sets status="available", checkedOutTo="", checkedOutAt=null |
| H4 | [x] | deleteEquipment → row absent | ds.deleteRecord(equipmentId) (hard delete per §2) |
| H5 | [x] | empty name → form re-renders `Name is required.` | saveEquipment guards name=="" → frag="equipmentForm", feedback="Name is required." (verbatim §4) |

**Total: 10 / 10**

Violations: 0. Copy cross-checked against §4 — all verbatim, including checkout validation
`Enter a name to check this item out.` (spec copy, not invented).

Residual: live data-effect + visual render confirmed by code/markup + server validation, not by
clicking through the rendered console. If a human eyeball pass is required, do it in the browser
preview `palsync test` opened.
