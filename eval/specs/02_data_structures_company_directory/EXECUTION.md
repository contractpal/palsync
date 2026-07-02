# EXECUTION — company_directory (palsync test 2)
spec: SPEC.md (status: approved)   mode: lite

## Auto mode
This build runs fully autonomously. The agent executes all tasks end-to-end without stopping
for human input. There are no mid-build gates, no "ask first" pauses, no blocker escalations.
If the agent encounters ambiguity — especially around which storage primitive to use — it
proceeds with its best judgment and documents what it chose. All review — visual, functional,
and structure-choice scoring — happens once at the end by a human evaluator against §12.

## Build plan
Dependency order:
1. Datasets employees + departments (+ seed department rows).
2. Reference/config storage — builder selects and creates the structures for OFFICES and
   SITE SETTINGS per SPEC §5 (scored choice; §11 forbids inline hard-coding).
3. Console shell + workflow skeleton.
4. Directory list: the cross-record read (employee + department name) + directoryList fragment
   (frontier — the read-model choice happens here).
5. Office filter action.
6. Add-employee form + saveEmployee.
Sequential throughout — each step feeds the next.
Risks: the join read is the likeliest failure point (N+1 loop instead of a proper read
structure) — §12 STRUCTURE-CHOICE catches it at review. ES3 workflow limits; compile-verify
via pal_test after each push.

## Tasks
| id | task | tier | spec ref | depends | status | success condition |
|---|---|---|---|---|---|---|
| T1 | employees + departments datasets + dept seeds | cheap | §8a | — | todo | pal_validate 0; departments has 4 rows |
| T2 | offices + settings storage (builder's structural choice) | frontier | §5, §2, §11 | — | todo | structures exist in pal; contain exact §5 values; nothing hard-coded in HTML/workflow |
| T3 | console shell + workflow skeleton | standard | §3, §10 | T1 | todo | pal_validate 0; pal_test VALIDATED |
| T4 | directory list w/ dept-name read + fragment | frontier | §5, §6 | T1,T2,T3 | todo | render shows names not ids; page size from settings; pal_test VALIDATED |
| T5 | office filter | standard | §5 | T4 | todo | CED filter returns only CED rows; All offices restores |
| T6 | employee form + saveEmployee + email validation | standard | §5 | T4 | todo | valid insert appears in list; bad email → exact §4 message, no write |

## Checkpoints (append-only)
## Blockers
None — auto mode; workspace set by evaluator before run.
