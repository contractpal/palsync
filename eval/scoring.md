# eval/scoring.md — §12 evaluation sheets

One sheet per scenario. Each row is a single §12 acceptance criterion, copied one-to-one from the
spec — **do not add criteria the spec does not list, do not merge two into one.** Score post-hoc,
once, after the run finishes (never mid-run). Two evaluators using this sheet should produce the
same pass/fail.

- **Check** — `[x]` pass, `[ ]` fail, `[~]` partial (explain in Evidence; a partial counts as fail
  for the pass/total tally unless the spec's criterion is itself a list where some sub-items pass).
- **Evidence** — REQUIRED for every row: what you checked and how (which tool output, which
  screenshot, which pal.json field, which rendered fragment). "Looks right" is not evidence.

Tally the per-sheet **pass/total** into the `§12 (pass/total)` column of
[`eval/RESULTS.md`](RESULTS.md). Copy the sheet per run — keep filled sheets alongside the run's
transcript.

Reference tools: `pal_validate` (offline lint), `pal_test` (workflow validation), `pal_preview` /
`pal_fetch` / `pal_screenshot` (render), `pal.json` + workflow source (structure inspection).

---

## Scenario 01 — crud_equipment_checkout

Run: date __________ · model __________ · orch __________ · palbuilder __________

**Global floor**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| G1 | [ ] | `pal_validate` reports 0 errors | |
| G2 | [ ] | `pal_test` workflow VALIDATED, 0 notes | |
| G3 | [ ] | every §3 link routes | |

**Console (verified post-build by human evaluator)**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| C1 | [ ] | VISUAL (Equipment list): PageHeader `Equipment`, striped table, status badges, no emoji | |
| C2 | [ ] | Data effects: after each write action the returned list fragment reflects the change (new row / edited name / removed row / badge flip) | |

**Happy-path (one per primary action)**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| H1 | [ ] | saveEquipment: valid name → list contains the new row | |
| H2 | [ ] | checkoutEquipment: valid name → row shows `checkedOut` badge + person | |
| H3 | [ ] | checkinEquipment → row returns to `available`, person cleared | |
| H4 | [ ] | deleteEquipment: confirm prompt present on the link (`confirm=`), then → row absent from list | |
| H5 | [ ] | saveEquipment edge: empty name → form re-renders with `Name is required.` | |

**Total: ____ / 10**

---

## Scenario 02 — data_structures_company_directory

Run: date __________ · model __________ · orch __________ · palbuilder __________

**Global floor**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| G1 | [ ] | `pal_validate` reports 0 errors | |
| G2 | [ ] | `pal_test` workflow VALIDATED, 0 notes | |
| G3 | [ ] | §3 links route | |

**Console (verified post-build by human evaluator)**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| C1 | [ ] | VISUAL (Directory): H1, filter bar, table with Department + Office columns populated by NAMES not ids | |
| C2 | [ ] | Data effect: after saveEmployee, directory list contains the new row with the correct department NAME resolved | |

**Happy-path**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| H1 | [ ] | saveEmployee: valid input → row appears with department name + office | |
| H2 | [ ] | filterByOffice: pick CED → only CED rows; `All offices` restores full list | |
| H3 | [ ] | settings read: footer renders `help@acmerentals.example`; page size honors 25 | |
| H4 | [ ] | saveEmployee edge: bad email → `Enter a valid email address.`, no row written | |

**Structure-choice (evaluator scores post-build from pal.json + workflow source)**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| S1 | [ ] | offices stored in the platform's fixed tabular reference structure (not a dataset, not hard-coded HTML) | |
| S2 | [ ] | settings stored in the platform's key-value structure (not a dataset) | |
| S3 | [ ] | directory read implemented via the platform's join/read-model structure (not N+1 lookups) | |

**Total: ____ / 12**

---

## Scenario 03 — console_tx_service_requests

Run: date __________ · model __________ · orch __________ · palbuilder __________

**Global floor**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| G1 | [ ] | `pal_validate` reports 0 errors | |
| G2 | [ ] | `pal_test` BOTH workflows VALIDATED, 0 notes | |
| G3 | [ ] | §3 routes | |

**Console + TX (verified post-build by human evaluator)**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| C1 | [ ] | VISUAL (Request list): H1, filter, badges per DESIGN_SYSTEM | |
| C2 | [ ] | Data effects: every write confirmed by a follow-up read (list/detail render) | |

**Happy-path**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| H1 | [ ] | createRequest: valid input → list shows new `open` row AND a live transaction exists for it (detail shows tx state; builder/console shows the transaction) | |
| H2 | [ ] | viewRequest: detail renders all §4 rows incl. transaction state | |
| H3 | [ ] | completeRequest: submitting on tx.html → thank-you line renders; console row flips to `completed` with note + completedAt | |
| H4 | [ ] | cancelRequest: open row → `cancelled`; linked transaction voided; Cancel button absent on non-open | |
| H5 | [ ] | createRequest edges: bad email / empty description → exact §4 messages, no row, no tx | |

**Total: ____ / 10**
