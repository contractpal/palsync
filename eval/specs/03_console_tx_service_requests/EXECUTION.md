# EXECUTION — service_requests (palsync test 3)
spec: SPEC.md (status: approved)   mode: lite

## Auto mode
This build runs fully autonomously. The agent executes all tasks end-to-end without stopping
for human input. There are no mid-build gates, no "ask first" pauses, no blocker escalations.
If the agent encounters ambiguity — especially around transaction API methods — it proceeds
with best knowledge after checking available docs/skills and documents what it chose. Human scoring
happens once at the end against §12; the agent's desktop render-inspect-revise, functional, and
transaction lifecycle self-checks remain mandatory during the build; mobile capture belongs to
final review.

## Build plan
Before the first UI task, load `design-build` and checkpoint its six-line design brief; use approved inline SVG icons from `component-library.md` → Icons; validation rules include `debugTagShipped`, `designClassRequired`, `missingFragment`,
`emptyAction`, `pbMain`, and `pbSection` (page shell owns `pb-main`; fragment root is `pb-section`).
Dependency order (leaf-first — foundations before things that use them):
1. Create and sync the serviceRequests dataset.
2. Foundation as a standalone first step: use bash `cp` (never read-then-write) to copy the
   console templates from `palbuilder-workflow/references/templates/` (`console-workflow.js` and
   `console-page.html`) plus shell/styles and only behavior scripts with real consumers
   from `design-system-init/references/`; replace `{{PAL_NAME}}`, author readable
   `styles/styles.css`, and register the four runtime entries in `pal.json`, then adapt.
3. Build requestList + filter first; this establishes composition and data reads.
4. Build requestForm + createRequest, including transaction creation.
5. Build tx.html + type-2 transaction workflow + completeRequest.
6. Build requestDetail + cancelRequest.

Parallel-safe: none; every task touches transaction/data flow. Sequential: T1 → T2 → T3 → T4
→ T5/T6 because transaction completion and cancel both depend on created rows/tx ids.
Risks: transaction API names, workflowType 2 registration, and ES3 workflow syntax. Run one
`pal_test` per task after that task's final push.
Checkpoints: after T3 (console list), after T4 (transaction created), final after T6.

## Tasks
| id | task | tier | spec ref | depends | status | success condition (behavioral + tool-checkable) |
|---|---|---|---|---|---|---|
| T1 | create and sync serviceRequests dataset | cheap | §8a, §10 | — | todo | pal_validate 0 errors; pal_sync_datasets provisions all §8a fields incl. txId and status index |
| T2 | foundation shell, styles.css, and run skeleton | cheap | §3, §6, §10 | T1 | todo | Console page shell, navbar, matching templates copied with bash `cp`, shell/styles plus only runtime scripts with real consumers present and registered in pal.json, readable `styles.css`; pal_validate 0; pal_test console workflow VALIDATED |
| T3 | requestList + filterByStatus | frontier | §4, §5 list, §6 | T2 | todo | render shows H1 `Service requests`, EmptyState, status filter; pal_test VALIDATED |
| T4 | requestForm + createRequest + transaction creation | frontier | §4, §5 createRequest, §9 | T3 | todo | valid submit creates open row and transaction; bad email/empty description show exact messages and write no row/tx |
| T5 | tx.html + type-2 workflow + completeRequest | frontier | §4, §5 completeRequest, §10 | T4 | todo | tx submit renders `Thank you — your request is marked complete.` and console row becomes completed with note/date; pal_test both workflows VALIDATED |
| T6 | requestDetail + cancelRequest + final visual review | standard | §4, §5 viewRequest, §5 cancelRequest, §12 | T4 | todo | detail shows Transaction state; cancel flips row to cancelled and voids/cancels tx; Cancel hidden for non-open; console/transaction desktop/mobile audits have 0 errors; rubric average >=1.5 with focal point/spacing/responsive =2 and no 0 |

## Checkpoints (append-only, one line per completed task)
## Blockers (what needs the human — be exact)
None — auto mode; workspace set by evaluator before run.
