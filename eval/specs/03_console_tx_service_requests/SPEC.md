# SPEC — service_requests (palsync test 3: console + transaction lifecycle)
status: approved
reality_check: pass (1 recorded caveat — see §13)
spec version: 2
mode: lite
run mode: auto — the build agent runs all tasks end-to-end with NO human intervention. All review (visual, data, structural) happens post-build by a human evaluator. The agent must never stop to ask questions or wait for input.
pal: service_requests (console + transaction) @ <WORKSPACE — set by evaluator before run>
push policy: free
review cadence: end
design system: ../DESIGN_SYSTEM.md (components: ../COMPONENTS.md) — any evaluator-supplied reference images are the primary design authority and outrank the stub; none ship with this test.
created: 2026-07-01   approved: 2026-07-06

## 1. Product & audience
A support desk tool. Staff log service requests from a console; each request creates a transaction
that a customer opens via its transaction link to submit a resolution confirmation. Staff monitor,
cancel, and see completion from the console. One primary action: **create a service-request
transaction from the console**. Benchmark intent: test whether the builder correctly creates,
views, and manages transactions from a console workflow paired with a transaction workflow/page.

## 2. Decisions & open questions
- DECISION: each request is mirrored in a `serviceRequests` dataset row linked to its transaction
  id — rationale: gives the console a queryable list and gives the evaluator a verifiable data
  effect independent of transaction internals — PROTECTED: yes
- DECISION: transaction API method names must be checked against palbuilder-workflow transaction
  guidance and cp-api docs before use — rationale: this is a platform-specific surface agents
  often guess — PROTECTED: yes
- DECISION: if cp-api docs are unreachable during an auto run, the agent proceeds with the most
  standard documented approach it already has and records the assumption — rationale: auto mode
  forbids stopping for help — PROTECTED: no
- All open questions resolved. Workspace is set by the evaluator before the run begins.

## 3. Sitemap & routing
| page/screen | type | file | workflow action | nav label | purpose |
|---|---|---|---|---|---|
| Request list | console | console.html + fragment requestList.html | (default) / list | Requests | open/completed/cancelled requests |
| New request | console | fragment requestForm.html | showForm | — header button | create request + transaction |
| Request detail | console | fragment requestDetail.html | viewRequest | — row link | one request + its transaction status |
| Customer completion | transaction | tx.html | (transaction workflow) / completeRequest | — transaction link | customer confirms resolution |

## 4. Copy (REAL — these exact words ship)
### Request list
- H1: `Service requests`
- Primary button: `New request` → showForm
- Filter label: `Status`
- Filter options: `Open`, `Completed`, `Cancelled`, `All`
- Filter button: `Filter`
- Columns: `Customer`, `Description`, `Status`, `Created`, `Actions`
- Row action: `View`
- EmptyState copy: `No service requests found.`

### New request
- Card title: `New service request`
- Labels: `Customer email`, `Description`
- Submit: `Create request`
- Cancel: `Cancel`
- Validation when email is empty or invalid: `Enter a valid customer email.`
- Validation when description is empty: `Description is required.`

### Request detail
- Card title: `Request from ` + customer email
- Rows: `Status`, `Description`, `Created`, `Completed`, `Resolution note`, `Transaction state`
- Action button when status=open: `Cancel request`

### Customer completion
- H1: `Confirm your service request`
- Body line: request description
- Label: `Resolution note (optional)`
- Submit: `Confirm complete`
- After submit: `Thank you — your request is marked complete.`

## 5. Behavior (what the logic DOES — drives acceptance criteria)
### createRequest
- Trigger: `Create request` in requestForm.
- Input: customerEmail (String), description (Text).
- Validation: bad/empty email returns `Enter a valid customer email.` and writes nothing; empty
  description returns `Description is required.` and writes nothing.
- Effect: create a transaction for this pal addressed to customerEmail whose transaction page is
  tx.html; insert serviceRequests row with status=`open`, txId=created transaction id, createdAt=now.
- Output: requestList fragment.
- [LITE] Deferred edge cases: duplicate requests, email deliverability, transaction expiration.

### list / filterByStatus
- Trigger: first screen load or FilterBar submit.
- Input: optional status.
- Effect: read serviceRequests newest first, optionally filtered by status.
- Output: requestList fragment with StatusBadge per row.

### viewRequest
- Trigger: `View` row action.
- Input: requestId.
- Effect: read serviceRequests row and read the linked transaction's current state by txId.
- Output: requestDetail fragment.

### cancelRequest
- Trigger: `Cancel request` on requestDetail.
- Input: requestId.
- Validation: only open rows render the cancel action.
- Effect: cancel/void the linked transaction via the platform transaction API; set row
  status=`cancelled`.
- Output: requestDetail fragment.
- [LITE] Deferred edge cases: already completed/cancelled transaction, missing txId.

### completeRequest
- Trigger: `Confirm complete` on tx.html.
- Input: resolutionNote (Text, optional).
- Effect: set the linked serviceRequests row status=`completed`, resolutionNote=input,
  completedAt=now; complete the transaction.
- Output: tx.html confirmation state with `Thank you — your request is marked complete.`
- [LITE] Deferred edge cases: repeated submit, missing linked row.

## 6. Layout (composition only — NO colors/fonts)
### Request list
- PageHeader (`Service requests` + `New request`) → FilterBar (Status) → DataTable
  (StatusBadge; EmptyState)
### New request
- PageHeader → FormCard
### Request detail
- PageHeader → DetailPanel → action button
### Customer completion
- PageHeader → FormCard

## 7. SEO
None — console + transaction; nothing publicly indexable.

## 8. Data model
### 8a. Datasets to CREATE
### dataset: serviceRequests
| field | type (see references/palbuilder-types.md) | size | notes |
|---|---|---|---|
| requestId | Primary key | — | |
| customerEmail | String | 100 | notNull, notEmpty; workflow validates email shape |
| description | Text | — | display text only |
| status | String | 20 | `open`, `completed`, or `cancelled`; indexed |
| txId | Transaction id | — | links row to its transaction |
| resolutionNote | Text | — | |
| createdAt | Date | — | sorted on |
| completedAt | Date | — | |
Indexes: status.

### 8b. Datasets CONSUMED (existing — read-only; the build must NOT create or alter these)
None.

## 9. Required skills (which palsync skills this build loads)
- ALWAYS: palbuilder-frontend, design-build, pal-restraint
- IF server-side workflow logic, validation, routing, or responses: palbuilder-workflow
- IF data writes/reads, payloads/DataLists, cache, files, or server-side HTTP: palbuilder-data
- Transaction workflows/API: palbuilder-workflow/references/transaction.md + cp-api docs

## 10. PalBuilder surface (the platform primitives this build touches)
- Pages (page-shell): console.html, tx.html.
- Fragments (c:ignore): requestList, requestForm, requestDetail.
- c: tags used: c:a, c:list, c:fragment, c:if, c:field, c:resource, c:debug.
- c:resource libs: none — shipped pb-* styles/scripts only, no external CSS framework.
- Workflows: console.js — workflowType 7 console; tx.js — workflowType 2 transaction — hub: no.
- Data: DataSet created: serviceRequests.
- Jobs: none.
- HTTP/parse: none.
- Sockets: none.

## 11. Constraints (Always / Ask-first / Never)
- ALWAYS: pal_validate before push; §4 copy ships verbatim; workflow JS stays in the restricted
  ES3-style subset; use reserved global `tx` only for the transaction object.
- AUTO MODE: the agent proceeds with best judgment on transaction API method names after checking
  available docs/skills. No stopping for questions.
- NEVER: use ClientPal/fetch; add extra pages beyond §3; invent transaction API names without first
  attempting to verify them; mark a request completed without updating the dataset row.

## 12. Acceptance criteria
GLOBAL FLOOR:
- [ ] pal_validate: 0 errors
- [ ] pal_test: console workflow VALIDATED, transaction workflow VALIDATED, 0 notes
- [ ] every §3 nav link routes (no dead links): list, showForm, createRequest, viewRequest, cancelRequest, tx page,
      completeRequest
- [ ] REGRESSION: the pal-init baseline still passes and untouched UI did not shift.

CONSOLE + TRANSACTION pages:
- [ ] VISUAL (Request list): H1 `Service requests`, Status filter, StatusBadge values per
      DESIGN_SYSTEM, no emoji.
- [ ] VISUAL (Customer completion): H1 `Confirm your service request`, request description,
      resolution note field, and submit button render on tx.html.
- [ ] Data effects: every write is confirmed by a follow-up read in requestList/requestDetail.

HAPPY-PATH [LITE]:
- [ ] createRequest: valid input → list shows a new `open` row and a live transaction exists for it.
- [ ] createRequest edge: bad email → `Enter a valid customer email.`, no row, no transaction.
- [ ] createRequest edge: empty description → `Description is required.`, no row, no transaction.
- [ ] viewRequest: detail renders all §4 rows including `Transaction state`.
- [ ] completeRequest: submitting tx.html renders the thank-you line and the console row flips to
      `completed` with resolutionNote and completedAt.
- [ ] cancelRequest: open row flips to `cancelled`, linked transaction is voided/cancelled, and
      `Cancel request` is absent on non-open rows.

## 13. Reality check
- PASS: serviceRequests has requestId primary key; index on String status; size only on String;
  §6 components exist in COMPONENTS.md; no dead links; pal_test compile verification for both
  workflows is explicit in EXECUTION.md; transaction workflowType 2 is covered by
  palbuilder-workflow transaction guidance.
- CAVEAT (accepted): transaction API behavior requires live platform verification. The spec requires
  docs/skill lookup and post-build functional evidence rather than pretending offline lint can prove
  transaction lifecycle correctness.

## 14. Amendment log (append-only; empty until the first approved amendment)
(empty)
