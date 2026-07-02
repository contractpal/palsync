# EXECUTION — service_requests (palsync test 3)
spec: SPEC.md (status: approved)   mode: lite

## Auto mode
This build runs fully autonomously. The agent executes all tasks end-to-end without stopping
for human input. There are no mid-build gates, no "ask first" pauses, no blocker escalations.
If the agent encounters ambiguity — especially around transaction API methods — it proceeds
with its best knowledge and documents what it chose. If the cp-api docs are unreachable, the
agent uses the most standard approach known. All review — visual, functional, tx lifecycle —
happens once at the end by a human evaluator against §12.

## Build plan
Dependency order:
1. serviceRequests dataset.
2. Console shell + console workflow skeleton (type 7).
3. Request list + status filter (frontier — first composition).
4. New-request form + createRequest — INCLUDING transaction creation. Builder should attempt
   to consult cp-api docs for the transaction API before writing this action.
5. tx.html + transaction workflow (type 2) + completeRequest.
6. viewRequest detail + cancelRequest.
Sequential — tx lifecycle depends on creation existing first.
Risks: (a) transaction API is the main unknown — highest failure odds at T4/T5; auto mode means
the agent proceeds with best knowledge rather than stopping. (b) workflowType 2 declaration is
verified-by-example only (SPEC §13 caveat). (c) ES3 limits; pal_test compile-verify after
every push, both workflows.

## Tasks
| id | task | tier | spec ref | depends | status | success condition |
|---|---|---|---|---|---|---|
| T1 | serviceRequests dataset | cheap | §8a | — | todo | pal_validate 0; 8 fields incl. Transaction id; status index |
| T2 | console shell + type-7 workflow skeleton | standard | §3, §10 | T1 | todo | pal_validate 0; pal_test VALIDATED |
| T3 | request list + status filter | frontier | §4, §5, §6 | T2 | todo | render shows H1 "Service requests", filter, EmptyState copy; pal_test VALIDATED |
| T4 | request form + createRequest + tx creation | frontier | §5, §2 | T3 | todo | valid input → open row in list AND live transaction; edge inputs → exact §4 messages, no row/tx; pal_test VALIDATED |
| T5 | tx.html + type-2 workflow + completeRequest | frontier | §5, §10 | T4 | todo | tx page submit renders thank-you line; row flips to completed with note + completedAt; pal_test VALIDATED |
| T6 | viewRequest detail + cancelRequest | standard | §5, §6 | T4 | todo | detail shows tx state; cancel voids tx + row=cancelled; button hidden on non-open |

## Checkpoints (append-only)
## Blockers
None — auto mode; workspace set by evaluator before run.
