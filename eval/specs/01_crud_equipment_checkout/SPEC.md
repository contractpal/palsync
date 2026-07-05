# SPEC — equipment_checkout (palsync test 1: CRUD / DataSet fundamentals)
status: approved
reality_check: pass
spec version: 1
mode: lite
run mode: auto — the build agent runs all tasks end-to-end with NO human intervention. All review (visual, data, structural) happens post-build by a human evaluator. The agent must never stop to ask questions or wait for input.
pal: equipment_checkout (console) @ <WORKSPACE — set by evaluator before run>
push policy: free
review cadence: end
design system: ../DESIGN_SYSTEM.md (components: ../COMPONENTS.md)
created: 2026-07-01   approved: 2026-07-01

## 1. Product & audience
Internal tool for an office manager who tracks shared equipment (laptops, projectors, cameras).
One primary action: **check out a piece of equipment to a person**. Secondary: add/edit/delete
equipment records, check items back in. This is a benchmark pal: it exercises the most common
PalBuilder pattern — a console workflow doing full CRUD against a single DataSet.

## 2. Decisions & open questions
- DECISION: single console screen with fragment-swapped views (list / form / checkout) —
  rationale: canonical console pattern, keeps the test focused on data ops — PROTECTED: yes
- DECISION: delete is hard-delete — rationale: LITE scope; soft-delete is deferred — PROTECTED: no
- All open questions resolved. Workspace is set by the evaluator before the run begins.

## 3. Sitemap & routing
| page/screen | type | file | workflow action | nav label | purpose |
|---|---|---|---|---|---|
| Equipment list | console | console.html + frag equipmentList.html | (default) / list | Equipment | table of all equipment |
| Add/Edit form | console | frag equipmentForm.html | showForm | — (row/header link) | create or edit a record |
| Checkout form | console | frag checkoutForm.html | showCheckout | — (row link) | assign item to a person |

## 4. Copy (real — ships verbatim)
### Equipment list
- H1: `Equipment`
- Primary action button: `Add equipment` → showForm
- Table columns: `Name`, `Category`, `Status`, `Checked out to`, `Actions`
- Row actions: `Edit`, `Check out` (only when status=available), `Check in` (only when
  status=checkedOut), `Delete`
- EmptyState copy: `No equipment yet. Add your first item to get started.`
### Add/Edit form
- H1 (card title): `Add equipment` / `Edit equipment`
- Labels: `Name`, `Category`, `Notes`; submit: `Save`; cancel: `Cancel`
- Validation message (name empty): `Name is required.`
### Checkout form
- Card title: `Check out: ` + item name
- Label: `Checked out to`; submit: `Check out`; cancel: `Cancel`
- Validation message (empty): `Enter a name to check this item out.`

## 5. Behavior (happy-path — LITE)
### list (default action)
- Trigger: screen load / any completed action. Effect: read all `equipment` rows sorted by
  name ascending. Output: equipmentList fragment.
### saveEquipment
- Trigger: Save on form. Input: name (string), category (string), notes (string), optional
  equipmentId. Validation: when name is empty, system shall re-show the form with `Name is
  required.` and write nothing. Effect: equipmentId absent → insert new row with
  status=`available`; present → update that row's name/category/notes. Output: list view.
### deleteEquipment
- Trigger: Delete row action. Input: equipmentId. Effect: delete that row. Output: list view.
  The Delete link carries a `confirm=` prompt (DataTable convention, COMPONENTS.md) — clicking
  through it deletes with no undo.
### checkoutEquipment
- Trigger: Check out submit. Input: equipmentId, checkedOutTo (string). Validation: when
  checkedOutTo is empty, re-show checkout form with `Enter a name to check this item out.`
  Effect: set status=`checkedOut`, checkedOutTo=input, checkedOutAt=now. Output: list view.
### checkinEquipment
- Trigger: Check in row action. Input: equipmentId. Effect: set status=`available`, clear
  checkedOutTo and checkedOutAt. Output: list view.
- Deferred (prototype): concurrent checkout conflicts; not-found ids; audit history;
  category management; pagination.

## 6. Layout (composition only)
### Equipment list
- PageHeader (`Equipment` + `Add equipment`) → DataTable (StatusBadge in
  Status column; EmptyState when zero rows)
### Add/Edit form — PageHeader → FormCard
### Checkout form — PageHeader → FormCard

## 7. SEO
None — console-only, nothing publicly indexable.

## 8. Data model
### 8a. Datasets to CREATE
### dataset: equipment
| field | type | size | notes |
|---|---|---|---|
| equipmentId | Primary key | — | |
| name | String | 100 | notNull, notEmpty |
| category | String | 50 | |
| status | String | 20 | `available` \| `checkedOut`; default `available`; indexed |
| checkedOutTo | String | 100 | |
| checkedOutAt | Date | — | datetime |
| notes | Text | — | never filtered/sorted |
Indexes: status.
### 8b. Datasets CONSUMED — none.

## 9. Required skills
- palbuilder-frontend, design-build, pal-restraint
- palbuilder-backend (CRUD writes/reads, validation)

## 10. PalBuilder surface
- Pages: console.html (page-shell). Fragments (c:ignore): equipmentList, equipmentForm,
  checkoutForm.
- c: tags: c:a, c:list, c:fragment, c:if, c:field, c:resource. c:resource: bootstrap 5.3.5.
- Workflows: default console workflow — workflowType 7 — hub: no.
- Data: DataSet created: equipment. No DataView/DataList/jobs/HTTP/sockets.
- Workflow JS: ES3-style engine — no object literals, no let/const/arrow.

## 11. Constraints
- ALWAYS: pal_validate before every push; §4 copy ships verbatim; follow PAL Development
  Standard (run-function pattern, reserved globals, double quotes, camelCase).
- AUTO MODE: the agent proceeds with best judgment on all decisions. No stopping for questions.
  If a needed API method or capability is unclear, use the most standard/documented approach.
- NEVER: create additional pages, datasets, or web (type 9) workflows; no ClientPal/fetch.

## 12. Acceptance criteria
GLOBAL FLOOR: pal_validate 0 errors; pal_test workflow VALIDATED, 0 notes; every §3 link routes.
CONSOLE (all verified post-build by human evaluator):
- [ ] VISUAL (Equipment list): PageHeader `Equipment`, striped table, status badges, no emoji.
- [ ] Data effects: after each write action, the returned list fragment reflects the change
      (new row / edited name / removed row / badge flip).
HAPPY-PATH (one per primary action):
- [ ] saveEquipment: valid name → list contains the new row.
- [ ] checkoutEquipment: valid name → row shows `checkedOut` badge + person.
- [ ] checkinEquipment: → row returns to `available`, person cleared.
- [ ] deleteEquipment: confirm prompt present on the link (`confirm=`), then → row absent from list.
- [ ] saveEquipment edge: empty name → form re-renders with `Name is required.`

## 13. Reality check
- PASS: no TBD inline; all §3 rows routed; equipment in §8a with `equipmentId` key; all §8a
  types are stored strings from references/palbuilder-types.md; size only on String; index
  `status` is on an indexable type (String); every §5 capability maps to §10 primitives
  (DataSet + workflowType 7); every component in §6 exists in COMPONENTS.md; workflow JS
  compile verified via pal_test per EXECUTION.md.

## 14. Amendment log
(empty)
