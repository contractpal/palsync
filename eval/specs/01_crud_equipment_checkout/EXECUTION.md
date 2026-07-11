# EXECUTION — equipment_checkout (palsync test 1)
spec: SPEC.md (status: approved)   mode: lite

## Auto mode
This build runs fully autonomously. The agent executes all tasks end-to-end without stopping
for human input. There are no mid-build gates, no "ask first" pauses, no blocker escalations.
If the agent encounters ambiguity, it proceeds with the most standard approach and documents
what it chose. Human scoring happens once at the end against §12; the agent's desktop
render-inspect-revise loop and functional self-verification remain mandatory during the build;
mobile capture belongs to final review.

## Build plan
Dependency order (leaf-first — foundations before things that use them):
1. Create the `equipment` dataset in pal.json and provision it with the dataset-sync step.
2. Foundation as a standalone first step: use bash `cp` (never read-then-write) to copy the
   console templates from `palbuilder-workflow/references/templates/` (`console-workflow.js` and
   `console-page.html`) plus canonical runtime files `spacing.css`, `pb-ui.js`, and `pb-motion.js`
   from `design-system-init/references/`; replace `{{PAL_NAME}}`, author readable
   `styles/styles.css`, and register the four runtime entries in `pal.json`, then adapt.
3. Build the list action + equipmentList fragment first; this establishes the console composition.
4. Add equipmentForm + saveEquipment insert/update/validation.
5. Add checkoutForm + checkoutEquipment/checkinEquipment.
6. Add deleteEquipment with the required `confirm=`.
7. Render desktop + mobile, inspect `designAudit` and pixels, fix the highest-impact UX failures,
   re-render changed viewports, then re-run the CRUD exercise.

Parallel-safe: none; all tasks touch the same console workflow and fragments. Sequential:
T1 → T2 → T3 → T4 → T5 → T6 because UI actions depend on the dataset and response skeleton.
Risks: workflow JS ES3 subset; c:a field submission semantics; dataset provisioning. Run one
`pal_test` per task after that task's final push.
Checkpoints: after T3 (list renders), after T5 (core checkout flow), final after T6.

## Tasks
| id | task | tier | spec ref | depends | status | success condition (behavioral + tool-checkable) |
|---|---|---|---|---|---|---|
| T1 | create and sync equipment dataset | cheap | §8a, §10 | — | todo | pal_validate 0 errors; pal_sync_datasets provisions equipment with freeform:true and all §8a fields |
| T2 | foundation shell, canonical runtime files, styles.css, and run skeleton | cheap | §3, §6, §10, §11 | T1 | todo | Console page shell, navbar, matching templates copied with bash `cp`, four canonical runtime files present and registered in pal.json, readable `styles.css`; pal_validate 0; pal_test console workflow VALIDATED |
| T3 | list action + designed equipmentList fragment | frontier | §4, §5 list, §6, §12 | T2 | todo | list renders compact PageHeader, designed EmptyState/table, badges and grouped actions; desktop screenshot audit errors 0; pal_test VALIDATED |
| T4 | bounded equipmentForm + saveEquipment insert/update/validation | standard | §4, §5 saveEquipment, §8a | T3 | todo | top-labeled bounded form + grouped actions; valid save returns row; empty name returns adjacent `Name is required.`; desktop screenshot audit errors 0; pal_test VALIDATED |
| T5 | bounded checkoutForm + checkout/checkin actions | standard | §4, §5 checkoutEquipment, §5 checkinEquipment | T4 | todo | top-labeled bounded form; checkout shows checkedOut + assignee; adjacent empty-assignee message; checkin returns available; desktop screenshot audit errors 0; pal_test VALIDATED |
| T6 | deleteEquipment + final responsive visual review | standard | §5 deleteEquipment, §6, §11, §12 | T5 | todo | exact confirm; delete removes row; list/Add/Edit/Checkout desktop + mobile captures have designAudit errors 0; rubric average >=1.5 with focal point/spacing/responsive =2 and no 0; final CRUD exercise still passes |

## Checkpoints (append-only, one line per completed task)
## Blockers (what needs the human — be exact)
None — auto mode; workspace set by evaluator before run.
