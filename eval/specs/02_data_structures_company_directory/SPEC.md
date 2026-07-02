# SPEC — company_directory (palsync test 2: data-structure selection)
status: approved
reality_check: pass (1 recorded caveat — see §13)
spec version: 1
mode: lite
run mode: auto — the build agent runs all tasks end-to-end with NO human intervention. All review (visual, data, structural) happens post-build by a human evaluator. The agent must never stop to ask questions or wait for input.
pal: company_directory (console) @ <WORKSPACE — set by evaluator before run>
push policy: free
review cadence: end
design system: ../DESIGN_SYSTEM.md (components: ../COMPONENTS.md)
created: 2026-07-01   approved: 2026-07-01

## 1. Product & audience
An internal employee directory for a ~60-person company. HR adds employees; anyone browses,
filtered by office. One primary action: **add an employee to the directory**.
BENCHMARK INTENT: this pal contains four kinds of data with different natures — runtime records,
a cross-record read that spans two record types, a small fixed reference list, and key-value
configuration. The spec describes each need *behaviorally* and deliberately does NOT name the
storage primitive for two of them. The measured dimension is whether the builder selects the
appropriate PalBuilder structure for each.

## 2. Decisions & open questions
- DECISION: employees and departments are runtime-editable records and are declared as datasets
  in §8a — records with schemas can't be left ambiguous. — PROTECTED: yes
- DECISION: the storage mechanism for (a) the office reference list, (b) site settings, and
  (c) the joined directory read is intentionally unstated — the builder must choose the
  appropriate PalBuilder primitive from the platform's data structures. — PROTECTED: yes
- All open questions resolved. Workspace is set by the evaluator before the run begins.

## 3. Sitemap & routing
| page/screen | type | file | workflow action | nav label | purpose |
|---|---|---|---|---|---|
| Directory | console | console.html + frag directoryList.html | (default) / list | Directory | browse employees with department + office |
| Add employee | console | frag employeeForm.html | showForm | — (header button) | create an employee |

## 4. Copy (real — ships verbatim)
### Directory
- H1: `Employee directory`
- Primary action button: `Add employee` → showForm
- Filter label: `Office`; options: all four office names from the reference list + `All offices`;
  apply button: `Filter`
- Table columns: `Name`, `Email`, `Department`, `Office`
- EmptyState: `No employees match this filter.`
- Footer line (reads from site settings): `Questions? Contact ` + support email value.
### Add employee
- Card title: `Add employee`
- Labels: `First name`, `Last name`, `Email`, `Department` (select of department names),
  `Office` (select of office names); submit: `Save`; cancel: `Cancel`
- Validation message (email empty/invalid): `Enter a valid email address.`

## 5. Behavior (happy-path — LITE)
### list (default)
- Effect: read employees; each row must display the employee's fields PLUS the NAME of its
  department (departments store name; employees store only departmentId) — a cross-record read
  the builder must implement with the platform's appropriate read structure, not a per-row
  lookup loop. Sort: last name ascending. Rows per page: the `directoryPageSize` value from
  site settings. Output: directoryList fragment.
### filterByOffice
- Input: officeCode (from the office reference list). Effect: same read, restricted to
  employees whose officeCode matches; `All offices` clears the filter. Output: directoryList.
### saveEmployee
- Input: first, last, email, departmentId, officeCode. Validation: when email is empty or fails
  email validation, re-show form with `Enter a valid email address.`; write nothing.
  Effect: insert employees row, createdAt = today. Output: directory list.
### Data needs the builder must satisfy (storage choice = scored)
- OFFICES: exactly four fixed offices — (SLC, Salt Lake City, America/Denver),
  (CED, Cedar City, America/Denver), (AUS, Austin, America/Chicago), (RDU, Raleigh,
  America/New_York) — columns officeCode/city/timezone. Read-only at runtime; never edited by
  any action; populates the Office filter and form select.
- SITE SETTINGS: three key→value entries — companyName=`Acme Rentals`,
  supportEmail=`help@acmerentals.example`, directoryPageSize=`25`. Read at render; never
  written by any action.
- Deferred (prototype): edit/delete employee; department management UI; pagination controls
  beyond page size; photo upload.

## 6. Layout (composition only)
### Directory — PageHeader (`Employee directory` + `Add employee`) → FilterBar (Office select) →
  DataTable → footer support-email line (plain text under table)
### Add employee — PageHeader → FormCard

## 7. SEO
None — console-only.

## 8. Data model
### 8a. Datasets to CREATE (runtime records ONLY — other storage per §2 DECISION)
### dataset: employees
| field | type | size | notes |
|---|---|---|---|
| employeeId | Primary key | — | |
| first | String | 50 | notNull |
| last | String | 50 | notNull; sorted on |
| email | String | 100 | notNull, notEmpty, validation: email; indexed |
| departmentId | String | 50 | references departments primary key |
| officeCode | String | 10 | matches OFFICES officeCode; indexed (filtered on) |
| createdAt | DateOnly | — | default now() |
Indexes: email; officeCode.
### dataset: departments
| field | type | size | notes |
|---|---|---|---|
| departmentId | Primary key | — | |
| name | String | 50 | notNull |
Seed rows (create at build): Engineering, Sales, Operations, HR.
### 8b. Datasets CONSUMED — none.

## 9. Required skills
- palbuilder-frontend, design-build, pal-restraint
- palbuilder-backend (reads/writes, validation, the cross-record read)

## 10. PalBuilder surface
- Pages: console.html. Fragments: directoryList, employeeForm.
- c: tags: c:a, c:list, c:fragment, c:if, c:field, c:resource. c:resource: bootstrap 5.3.5.
- Workflows: default console workflow — workflowType 7 — hub: no.
- Data: DataSet created: employees, departments. Additional read/reference/config structures:
  builder's choice among real PalBuilder data primitives — no invented primitives permitted.
- Workflow JS: ES3-style engine — no object literals, no let/const/arrow.

## 11. Constraints
- ALWAYS: pal_validate before push; §4 copy and §5 seed/reference/setting VALUES ship verbatim;
  PAL Development Standard conventions.
- AUTO MODE: the agent proceeds with best judgment on all decisions including storage structure
  selection. No stopping for questions. If unsure, choose the most idiomatic PalBuilder approach.
- NEVER: hard-code office rows or settings values inline in workflow/HTML (they must live in a
  data structure); per-row department lookups inside a loop; extra pages or web workflows.

## 12. Acceptance criteria
GLOBAL FLOOR: pal_validate 0 errors; pal_test workflow VALIDATED, 0 notes; §3 links route.
CONSOLE (all verified post-build by human evaluator):
- [ ] VISUAL (Directory): H1, filter bar, table with Department + Office columns populated by
      NAMES not ids.
- [ ] Data effect: after saveEmployee, directory list contains the new row with the correct
      department NAME resolved.
HAPPY-PATH:
- [ ] saveEmployee: valid input → row appears with department name + office.
- [ ] filterByOffice: pick CED → only CED rows; `All offices` restores full list.
- [ ] settings read: footer renders `help@acmerentals.example`; page size honors 25.
- [ ] saveEmployee edge: bad email → `Enter a valid email address.`, no row written.
STRUCTURE-CHOICE (evaluator scores post-build from pal.json + workflow source):
- [ ] offices stored in the platform's fixed tabular reference structure (not a dataset, not
      hard-coded HTML).
- [ ] settings stored in the platform's key-value structure (not a dataset).
- [ ] directory read implemented via the platform's join/read-model structure (not N+1 lookups).

## 13. Reality check
- PASS: §8a types all stored strings; sizes only on String; indexed fields (email String,
  officeCode String) indexable; employees/departments have Id keys; §6 components exist in
  COMPONENTS.md; no dead links; workflow compile via pal_test in EXECUTION.md.
- CAVEAT (accepted, by design): §10 leaves three storage primitives unbound, which the standard
  reality check would flag as "capability with no primitive." Intentional — it is the measured
  variable; §10 constrains the choice to real PalBuilder primitives, and §12 STRUCTURE-CHOICE
  criteria close the verification gap.

## 14. Amendment log
(empty)
