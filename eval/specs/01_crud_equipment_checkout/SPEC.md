# SPEC — equipment_checkout (palsync test 1: CRUD / DataSet fundamentals)
status: approved
reality_check: pass
spec version: 2
mode: lite
run mode: auto — the build agent runs all tasks end-to-end with NO human intervention. All review (visual, data, structural) happens post-build by a human evaluator. The agent must never stop to ask questions or wait for input.
pal: equipment_checkout (console) @ <WORKSPACE — set by evaluator before run>
push policy: free
review cadence: end
design system: ../DESIGN_SYSTEM.md (components: ../COMPONENTS.md)
created: 2026-07-01   approved: 2026-07-06

## 1. Product & audience
Internal tool for an office manager who tracks shared equipment: laptops, projectors, and cameras.
One primary action: **check out a piece of equipment to a person**. Secondary actions add, edit,
delete, and check equipment back in. Benchmark intent: exercise the most common PalBuilder pattern,
a console workflow doing CRUD against one DataSet and rendering fragment-swapped console screens.

## 2. Decisions & open questions
- DECISION: single console page with fragment-swapped list/form/checkout screens — rationale:
  canonical console pattern and lowest possible scope for CRUD correctness — PROTECTED: yes
- DECISION: delete is hard-delete with `confirm=` on the destructive link — rationale: LITE scope;
  soft-delete/audit history is deferred — PROTECTED: no
- DECISION: status values are exactly `available` and `checkedOut` — rationale: deterministic
  evaluator checks — PROTECTED: yes
- All open questions resolved. Workspace is set by the evaluator before the run begins.

## 3. Sitemap & routing
| page/screen | type | file | workflow action | nav label | purpose |
|---|---|---|---|---|---|
| Equipment list | console | console.html + fragment equipmentList.html | (default) / list | Equipment | table of all equipment |
| Add/Edit form | console | fragment equipmentForm.html | showForm | — row/header link | create or edit a record |
| Checkout form | console | fragment checkoutForm.html | showCheckout | — row link | assign item to a person |

## 4. Copy (REAL — these exact words ship)
### Equipment list
- H1: `Equipment`
- Primary action button: `Add equipment` → showForm
- Table columns: `Name`, `Category`, `Status`, `Checked out to`, `Actions`
- Row actions: `Edit`, `Check out`, `Check in`, `Delete`
- EmptyState copy: `No equipment yet. Add your first item to get started.`

### Add/Edit form
- Card title for a new row: `Add equipment`
- Card title for an existing row: `Edit equipment`
- Labels: `Name`, `Category`, `Notes`
- Submit: `Save`
- Cancel: `Cancel`
- Validation message when name is empty: `Name is required.`

### Checkout form
- Card title: `Check out: ` + item name
- Label: `Checked out to`
- Submit: `Check out`
- Cancel: `Cancel`
- Validation message when assignee is empty: `Enter a name to check this item out.`

## 5. Behavior (what the logic DOES — drives acceptance criteria)
### list
- Trigger: first screen load and any completed action.
- Input: none.
- Effect: read all `equipment` rows sorted by name ascending.
- Output: equipmentList fragment. If there are no rows, render the exact EmptyState copy.

### saveEquipment
- Trigger: `Save` on equipmentForm.
- Input: name (String), category (String), notes (Text), optional equipmentId (Primary key).
- Validation: when name is empty, system shall re-show equipmentForm with `Name is required.`
  and write nothing.
- Effect: equipmentId absent → insert row with status=`available`; equipmentId present → update
  name/category/notes on the matching equipment row, preserving status and checkout fields.
- Output: equipmentList fragment.
- [LITE] Deferred edge cases: duplicate names, not-found ids, concurrent edits.

### deleteEquipment
- Trigger: `Delete` row action.
- Input: equipmentId.
- Validation: destructive link must carry `confirm="Delete this item? This cannot be undone."`.
- Effect: delete the matching equipment row.
- Output: equipmentList fragment.
- [LITE] Deferred edge cases: not-found ids, undo.

### checkoutEquipment
- Trigger: `Check out` submit on checkoutForm.
- Input: equipmentId, checkedOutTo (String).
- Validation: when checkedOutTo is empty, system shall re-show checkoutForm with `Enter a name to
  check this item out.` and write nothing.
- Effect: set status=`checkedOut`, checkedOutTo=input, checkedOutAt=now.
- Output: equipmentList fragment.
- [LITE] Deferred edge cases: item already checked out, not-found ids.

### checkinEquipment
- Trigger: `Check in` row action.
- Input: equipmentId.
- Effect: set status=`available`, clear checkedOutTo and checkedOutAt.
- Output: equipmentList fragment.
- [LITE] Deferred edge cases: item already available, not-found ids.

## 6. Layout (composition only — NO colors/fonts)
### Equipment list
- PageHeader (`Equipment` + `Add equipment`) → DataTable (StatusBadge in Status column;
  EmptyState when zero rows)
### Add/Edit form
- PageHeader → FormCard
### Checkout form
- PageHeader → FormCard

## 7. SEO
None — console-only, nothing publicly indexable.

## 8. Data model
### 8a. Datasets to CREATE
### dataset: equipment
| field | type (see references/palbuilder-types.md) | size | notes |
|---|---|---|---|
| equipmentId | Primary key | — | |
| name | String | 100 | notNull, notEmpty |
| category | String | 50 | |
| status | String | 20 | `available` or `checkedOut`; default `available`; indexed |
| checkedOutTo | String | 100 | |
| checkedOutAt | Date | — | datetime |
| notes | Text | — | display text only |
Indexes: status.

### 8b. Datasets CONSUMED (existing — read-only; the build must NOT create or alter these)
None.

## 9. Required skills (which palsync skills this build loads)
- ALWAYS: palbuilder-frontend, design-build, pal-restraint
- IF server-side workflow logic, validation, routing, or responses: palbuilder-workflow
- IF data writes/reads, payloads/DataLists, cache, files, or server-side HTTP: palbuilder-data

## 10. PalBuilder surface (the platform primitives this build touches)
- Pages (page-shell): console.html.
- Fragments (c:ignore): equipmentList, equipmentForm, checkoutForm.
- c: tags used: c:a, c:list, c:fragment, c:if, c:field, c:resource, c:debug.
- c:resource libs: bootstrap 5.3.5.
- Workflows: console.js — workflowType 7 console — hub: no.
- Data: DataSet created: equipment. DataView none. Static DataList none. Data none.
- Jobs: none.
- HTTP/parse: none.
- Sockets: none.

## 11. Constraints (Always / Ask-first / Never)
- ALWAYS: pal_validate before every push; §4 copy ships verbatim; workflow JS stays in the
  restricted ES3-style subset; every destructive `c:a` carries `confirm=`.
- AUTO MODE: the agent proceeds with best judgment on all decisions. No stopping for questions.
  If a needed API method or capability is unclear, use the most standard documented approach.
- NEVER: create additional pages, datasets, web workflows, jobs, sockets, ClientPal calls, or fetch.

## 12. Acceptance criteria
GLOBAL FLOOR:
- [ ] pal_validate: 0 errors
- [ ] pal_test: console workflow VALIDATED, 0 notes
- [ ] every §3 nav link routes (no dead links): list, showForm, showCheckout, saveEquipment, checkoutEquipment,
      checkinEquipment, deleteEquipment
- [ ] REGRESSION: the pal-init baseline still passes and untouched UI did not shift.

CONSOLE pages:
- [ ] VISUAL (Equipment list): PageHeader `Equipment`, striped table, status badges, no emoji.
- [ ] Data effects: after each §5 write, a follow-up list render shows the new/changed/deleted row.

HAPPY-PATH [LITE]:
- [ ] saveEquipment: valid name → list contains the new row.
- [ ] saveEquipment edge: empty name → form re-renders with `Name is required.` and no row is written.
- [ ] checkoutEquipment: valid assignee → row shows `checkedOut` badge and the assignee name.
- [ ] checkoutEquipment edge: empty assignee → form re-renders with
      `Enter a name to check this item out.` and row remains available.
- [ ] checkinEquipment → row returns to `available`, checkedOutTo is blank.
- [ ] deleteEquipment: Delete link has `confirm="Delete this item? This cannot be undone."`;
      after confirmation, row is absent from the list.

## 13. Reality check
- PASS: no placeholders except evaluator-owned workspace header; all §3 rows route to §5 actions;
  equipment in §8a has `equipmentId` primary key; all §8a types are verified stored strings from
  references/palbuilder-types.md; size is only on String fields; status is indexable; every §5
  capability maps to §10 primitives (workflowType 7 + DataSet + fragments); every §6 component
  exists in COMPONENTS.md; workflow compile verification is explicit in EXECUTION.md.

## 14. Amendment log (append-only; empty until the first approved amendment)
(empty)
