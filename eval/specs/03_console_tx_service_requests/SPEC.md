# SPEC — service_requests (palsync test 3: console + transaction lifecycle)
status: approved
reality_check: pass (1 recorded caveat — see §13)
spec version: 1
mode: lite
run mode: auto — the build agent runs all tasks end-to-end with NO human intervention. All review (visual, data, structural) happens post-build by a human evaluator. The agent must never stop to ask questions or wait for input.
pal: service_requests (console + transaction) @ <WORKSPACE — set by evaluator before run>
push policy: free
review cadence: end
design system: ../DESIGN_SYSTEM.md (components: ../COMPONENTS.md)
created: 2026-07-01   approved: 2026-07-01

## 1. Product & audience
A support desk tool. Staff log service requests from a console; each request creates a
**transaction** that a customer opens via its transaction link to submit their resolution
confirmation. Staff monitor, cancel, and see completion from the console. One primary action:
**create a service-request transaction from the console**. Benchmark intent: measure the
builder's ability to correctly create, view, and manage transactions from a console workflow
(workflowType 7) paired with a transaction workflow/page (workflowType 2).

## 2. Decisions & open questions
- DECISION: each request is mirrored in a `serviceRequests` dataset row linked to its
  transaction id — rationale: gives the console a queryable list and gives the test a
  verifiable data effect independent of tx internals — PROTECTED: yes
- DECISION: transaction controller/API method names are NOT specified here; the builder must
  consult the CloudPiston cp-api documentation (transaction + console controllers at
  https://secure.cloudpiston.com/cpal/cp-api/) and use the correct method names. If the docs
  are unreachable, use the most standard/documented approach the builder knows and document the
  assumption — do NOT stop the build. — PROTECTED: yes
- All open questions resolved. Workspace is set by the evaluator before the run begins.

## 3. Sitemap & routing
| page/screen | type | file | workflow action | nav label | purpose |
|---|---|---|---|---|---|
| Request list | console | console.html + frag requestList.html | (default) / list | Requests | open/completed/cancelled requests |
| New request | console | frag requestForm.html | showForm | — (header button) | create request + transaction |
| Request detail | console | frag requestDetail.html | viewRequest | — (row link) | one request + its tx status |
| Customer completion | transaction | tx.html | (transaction workflow) | — (tx link) | customer confirms resolution |

## 4. Copy (real — ships verbatim)
### Request list
- H1: `Service requests`; primary button: `New request` → showForm
- Filter label: `Status`; options: `Open`, `Completed`, `Cancelled`, `All`; button: `Filter`
- Columns: `Customer`, `Description`, `Status`, `Created`, `Actions`; row action: `View`
- EmptyState: `No service requests found.`
### New request
- Card title: `New service request`
- Labels: `Customer email`, `Description`; submit: `Create request`; cancel: `Cancel`
- Validation (email empty/invalid): `Enter a valid customer email.`
- Validation (description empty): `Description is required.`
### Request detail
- Card title: `Request from ` + customer email
- Rows: `Status`, `Description`, `Created`, `Completed`, `Resolution note`
- Action button (status=open only): `Cancel request`
### Customer completion (transaction page)
- H1: `Confirm your service request`
- Body line: the request's description
- Label: `Resolution note (optional)`; submit: `Confirm complete`
- After submit: `Thank you — your request is marked complete.`

## 5. Behavior (happy-path — LITE)
### createRequest (console)
- Input: customerEmail, description. Validation: exact §4 messages; write nothing on failure.
- Effect: (1) create a transaction for this pal addressed to customerEmail whose transaction
  page is tx.html; (2) insert serviceRequests row: status=`open`, txId=the new transaction's id,
  createdAt=now. Output: request list.
### list / filterByStatus (console)
- Effect: read serviceRequests, newest first, optionally filtered by status. Output:
  requestList fragment with StatusBadge per row.
### viewRequest (console)
- Input: requestId. Effect: read the row; display fields incl. the transaction's current state
  read via the transaction id. Output: requestDetail.
### cancelRequest (console)
- Input: requestId (status must be `open`). Effect: cancel/void the linked transaction via the
  platform's transaction management API; set row status=`cancelled`. Output: requestDetail.
### completeRequest (transaction workflow, customer side)
- Trigger: `Confirm complete` on tx.html. Input: resolutionNote (optional).
- Effect: set the linked serviceRequests row status=`completed`, resolutionNote=input,
  completedAt=now; complete the transaction. Output: tx.html confirmation state with the exact
  §4 thank-you line.
- Deferred (prototype): reminder emails; reopening; multi-step transactions; auth on tx link
  beyond platform default; not-found/duplicate edges.

## 6. Layout (composition only)
### Request list — PageHeader → FilterBar (Status) → DataTable (StatusBadge; EmptyState)
### New request — PageHeader → FormCard
### Request detail — PageHeader → DetailPanel → action button
### Customer completion — PageHeader → FormCard (single field + submit)

## 7. SEO
None — console + transaction; nothing indexable.

## 8. Data model
### 8a. Datasets to CREATE
### dataset: serviceRequests
| field | type | size | notes |
|---|---|---|---|
| requestId | Primary key | — | |
| customerEmail | String | 100 | notNull, notEmpty, validation: email |
| description | Text | — | never filtered |
| status | String | 20 | `open` \| `completed` \| `cancelled`; indexed |
| txId | Transaction id | — | links row to its transaction |
| resolutionNote | Text | — | |
| createdAt | Date | — | sorted on (indexable) |
| completedAt | Date | — | |
Indexes: status.
### 8b. Datasets CONSUMED — none.

## 9. Required skills
- palbuilder-frontend, design-build, pal-restraint
- palbuilder-backend (writes/reads, validation, both workflows — same ES3 rules)
- Transaction API: no dedicated skill — builder should look up transaction creation/cancel/
  complete methods in the cp-api docs. If unreachable, proceed with best knowledge and document.

## 10. PalBuilder surface
- Pages: console.html, tx.html (both page-shell). Fragments: requestList, requestForm,
  requestDetail.
- c: tags: c:a, c:list, c:fragment, c:if, c:field, c:resource. c:resource: bootstrap 5.3.5.
- Workflows: console workflow — workflowType 7; transaction workflow — workflowType 2
  (verified by example: the reference pal `large_example` declares defaults/default_tx.js as
  workflowType 2 with palTypeTransaction) — hub: no.
- Data: DataSet created: serviceRequests. No DataView/DataList/jobs/HTTP/sockets.
- Workflow JS: ES3-style engine — no object literals, no let/const/arrow.

## 11. Constraints
- ALWAYS: pal_validate before push; §4 copy verbatim; PAL Development Standard conventions
  (reserved global `tx` for the transaction; run-function pattern in both workflows).
- AUTO MODE: the agent proceeds with best judgment on all decisions including transaction API
  method names. No stopping for questions. If the cp-api docs are unreachable, use the most
  standard approach known and document the assumption.
- NEVER: guess a transaction API method name without first attempting to look it up; no
  ClientPal/fetch; no extra pages beyond what §3 specifies.

## 12. Acceptance criteria
GLOBAL FLOOR: pal_validate 0 errors; pal_test BOTH workflows VALIDATED, 0 notes; §3 routes.
CONSOLE + TX (all verified post-build by human evaluator):
- [ ] VISUAL (Request list): H1, filter, badges per DESIGN_SYSTEM.
- [ ] Data effects: every write confirmed by a follow-up read (list/detail render).
HAPPY-PATH:
- [ ] createRequest: valid input → list shows new `open` row AND a live transaction exists for
      it (verify: detail screen shows tx state; builder/console shows the transaction).
- [ ] viewRequest: detail renders all §4 rows incl. transaction state.
- [ ] completeRequest: submitting on tx.html → thank-you line renders; console row flips to
      `completed` with note + completedAt.
- [ ] cancelRequest: open row → `cancelled`; linked transaction voided; Cancel button absent
      on non-open.
- [ ] createRequest edges: bad email / empty description → exact §4 messages, no row, no tx.

## 13. Reality check
- PASS: types all stored strings (`Transaction id` is a verified system/key type used
  explicitly for tx linking, per its stated purpose); size only on String; index on String
  status; requestId key present; §6 components exist in COMPONENTS.md; no dead links; no inline
  TBD; pal_test compile-verify for both workflows in EXECUTION.md.
- CAVEAT (accepted): workflowType 2 is attested by the reference example pal, not by
  references/palbuilder-types.md's verified list (which covers 7/9/11/12/15). Treated as
  verified-by-example; if the builder cannot declare type 2, it should proceed with the closest
  alternative and document the deviation.

## 14. Amendment log
(empty)
