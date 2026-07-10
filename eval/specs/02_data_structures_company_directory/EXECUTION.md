# EXECUTION — company_directory (palsync test 2)
spec: SPEC.md (status: approved)   mode: lite

## Auto mode
This build runs fully autonomously. The agent executes all tasks end-to-end without stopping
for human input. There are no mid-build gates, no "ask first" pauses, no blocker escalations.
If the agent encounters ambiguity — especially around which data primitive to use — it proceeds
with best judgment and documents what it chose. Human scoring happens once at the end against §12;
the agent's desktop/mobile render-inspect-revise, functional, and structure self-checks remain
mandatory during the build.

## Build plan
Dependency order (leaf-first — foundations before things that use them):
1. Create employees and departments datasets; seed the four department rows.
2. Create the selected reference/config structures for OFFICES and SITE SETTINGS.
3. Hand-build the console shell as a standalone first step: create the page shell, copy the four canonical design-system files verbatim, author and register the new pal's `styles.css`, and establish the `run()` skeleton from `palbuilder-workflow/references/console.md`.
4. Build the joined directory read and directoryList fragment. This is frontier because the
   read-model choice is the core measured behavior.
5. Add office filtering.
6. Add employeeForm + saveEmployee validation/write.

Parallel-safe: T1 and T2 touch different data structures and can be planned independently; execute
sequentially in one workspace to keep verification simple. Sequential: T3 → T4 → T5/T6 because
workflow and fragment names are shared.
Risks: choosing DataSet for offices/settings, N+1 department lookups, and ES3 workflow syntax.
Verify workflow compile via pal_test after every push that changes workflow or markup.
Checkpoints: after T2 (data structures exist), after T4 (joined list renders), final after T6.

## Tasks
| id | task | tier | spec ref | depends | status | success condition (behavioral + tool-checkable) |
|---|---|---|---|---|---|---|
| T1 | create employees/departments datasets + department seeds | cheap | §8a, §10 | — | todo | pal_validate 0 errors; pal_sync_datasets provisions both datasets; departments has Engineering/Sales/Operations/HR |
| T2 | create offices + site settings using selected PalBuilder primitives | frontier | §2, §5 data needs, §10, §11 | — | todo | structures exist with exact office/settings values; offices/settings are not DataSets and are not hard-coded in markup/workflow |
| T3 | hand-build console shell, design-system files, styles.css, and run skeleton | cheap | §3, §6, §10 | T1,T2 | todo | Console page shell, navbar, `run()` skeleton from `palbuilder-workflow/references/console.md`, four canonical files copied verbatim, and readable `styles.css` are present and registered in pal.json; pal_validate 0; pal_test console workflow VALIDATED on the hand-built shell |
| T4 | directoryList with joined department/office read | frontier | §4, §5 list, §6, §12 | T3 | todo | render shows department names and office cities; footer uses support email; source avoids N+1 department loop; pal_test VALIDATED |
| T5 | office filter | standard | §5 filterByOffice, §12 | T4 | todo | CED filter renders only Cedar City rows; All offices restores full list; pal_test VALIDATED |
| T6 | employeeForm + saveEmployee validation/write + final visual review | standard | §4, §5 saveEmployee, §8a, §12 | T4 | todo | valid save appears in directory; bad email returns `Enter a valid email address.` and writes no row; desktop/mobile audits have 0 errors; rubric average >=1.5 with focal point/spacing/responsive =2 and no 0 |

## Checkpoints (append-only, one line per completed task)
## Blockers (what needs the human — be exact)
None — auto mode; workspace set by evaluator before run.
