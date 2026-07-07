# EXECUTION — equipment_checkout (palsync test 1)
spec: SPEC.md (status: approved)   mode: lite

## Auto mode
This build runs fully autonomously. The agent executes all tasks end-to-end without stopping
for human input. There are no mid-build gates, no "ask first" pauses, no blocker escalations.
If the agent encounters ambiguity, it proceeds with the most standard approach and documents
what it chose. All review — visual, functional, and structural — happens once at the end by a
human evaluator against §12.

## Build plan
Dependency order (leaf-first — foundations before things that use them):
1. Create the `equipment` dataset in pal.json and provision it with the dataset-sync step.
2. Apply the `console-app` starter via `palsync scaffold`, then adapt console.html and console.js.
3. Build the list action + equipmentList fragment first; this establishes the console composition.
4. Add equipmentForm + saveEquipment insert/update/validation.
5. Add checkoutForm + checkoutEquipment/checkinEquipment.
6. Add deleteEquipment with the required `confirm=`.

Parallel-safe: none; all tasks touch the same console workflow and fragments. Sequential:
T1 → T2 → T3 → T4 → T5/T6 because UI actions depend on the dataset and response skeleton.
Risks: workflow JS ES3 subset; c:a field submission semantics; dataset provisioning. Verify
workflow compile via pal_test after every push that changes workflow or markup.
Checkpoints: after T3 (list renders), after T5 (core checkout flow), final after T6.

## Tasks
| id | task | tier | spec ref | depends | status | success condition (behavioral + tool-checkable) |
|---|---|---|---|---|---|---|
| T1 | create and sync equipment dataset | cheap | §8a, §10 | — | todo | pal_validate 0 errors; pal_sync_datasets provisions equipment with freeform:true and all §8a fields |
| T2 | scaffold console shell + workflow skeleton | standard | §3, §6, §10, §11 | T1 | todo | pal_validate 0 errors; pal_test console workflow VALIDATED |
| T3 | list action + equipmentList fragment | frontier | §4, §5 list, §6, §12 | T2 | todo | list route renders H1 `Equipment` and EmptyState copy; pal_test VALIDATED |
| T4 | equipmentForm + saveEquipment insert/update/validation | standard | §4, §5 saveEquipment, §8a | T3 | todo | valid save returns list containing row; empty name returns `Name is required.`; pal_test VALIDATED |
| T5 | checkoutForm + checkout/checkin actions | standard | §4, §5 checkoutEquipment, §5 checkinEquipment | T4 | todo | checkout shows checkedOut + assignee; empty assignee message appears; checkin returns available; pal_test VALIDATED |
| T6 | deleteEquipment with confirm | cheap | §5 deleteEquipment, §11, §12 | T4 | todo | delete link includes exact confirm text; confirmed delete removes row from follow-up list; pal_validate 0 |

## Checkpoints (append-only, one line per completed task)
## Blockers (what needs the human — be exact)
None — auto mode; workspace set by evaluator before run.
