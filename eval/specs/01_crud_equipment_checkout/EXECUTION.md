# EXECUTION — equipment_checkout (palsync test 1)
spec: SPEC.md (status: approved)   mode: lite

## Auto mode
This build runs fully autonomously. The agent executes all tasks end-to-end without stopping
for human input. There are no mid-build gates, no "ask first" pauses, no blocker escalations.
If the agent encounters ambiguity, it proceeds with the most standard approach and documents
what it chose. All review — visual, functional, structural — happens once at the end by a human
evaluator against §12.

## Build plan
Dependency order:
1. Dataset `equipment` (data before UI).
2. Scaffold: console.html shell + console workflow skeleton (run function, action switch,
   ajax/page response block per PAL Development Standard).
3. Equipment list fragment + default list action (frontier — establishes composition).
4. Form fragment + saveEquipment (insert + update + validation).
5. Checkout/checkin actions + checkout fragment.
6. deleteEquipment.
Sequential throughout — each step feeds the next.
Risks: ES3 workflow limits are the main correctness risk. pal_test compile-verify after every
push. No mid-build human review; all failures are caught at final evaluation.

## Tasks
| id | task | tier | spec ref | depends | status | success condition |
|---|---|---|---|---|---|---|
| T1 | create equipment dataset | cheap | §8a | — | todo | pal_validate 0 errors; schema shows 7 fields + status index |
| T2 | console shell + workflow skeleton | standard | §3, §10, §11 | T1 | todo | pal_validate 0; pal_test VALIDATED |
| T3 | list action + equipmentList fragment | frontier | §4, §5, §6 | T2 | todo | pal_test VALIDATED; render contains H1 "Equipment" and EmptyState copy when 0 rows |
| T4 | saveEquipment (insert/update + validation) | standard | §5 | T3 | todo | insert then list shows row; empty name re-renders form with "Name is required."; pal_test VALIDATED |
| T5 | checkout + checkin actions + fragment | standard | §5, §6 | T4 | todo | checkout flips badge to checkedOut with person; checkin restores available; pal_test VALIDATED |
| T6 | deleteEquipment | cheap | §5 | T4 | todo | deleted row absent from list render; pal_test VALIDATED |

## Checkpoints (append-only)
## Blockers
None — auto mode; workspace set by evaluator before run.
