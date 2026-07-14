# SPEC — company_directory (palsync test 2: data management / structure selection)
status: approved
reality_check: pass (1 recorded caveat — see §13)
spec version: 3
mode: lite
run mode: auto — the build agent runs all tasks end-to-end with NO human intervention. All review (visual, data, structural) happens post-build by a human evaluator. The agent must never stop to ask questions or wait for input.
pal: company_directory (console) @ <WORKSPACE — set by evaluator before run>
push policy: free
review cadence: end
design system: ../DESIGN_SYSTEM.md (components: ../COMPONENTS.md) — any evaluator-supplied reference images are the primary design authority and outrank the stub; none ship with this test.
created: 2026-07-01   approved: 2026-07-06
realigned: 2026-07-14 (v2.1 — §9 skill names only)

## 1. Product & audience
Internal employee directory for a 60-person company. HR adds employees; staff browse the
directory filtered by office. One primary action: **add an employee to the directory**.
Benchmark intent: test whether the builder chooses the correct PalBuilder data structure for
each data need: runtime records, fixed reference rows, key-value settings, and joined reads.

## 2. Decisions & open questions
- DECISION: employees and departments are runtime-editable records and are declared as datasets
  in §8a — rationale: records with schema and writes should be DataSets — PROTECTED: yes
- DECISION: the storage mechanism for offices, site settings, and the joined directory read is
  intentionally not named in §8a — rationale: this eval scores whether the agent selects the
  appropriate platform primitive from behavior — PROTECTED: yes
- DECISION: office and settings values are exact approved seed data — rationale: deterministic
  scoring — PROTECTED: yes
- All open questions resolved. Workspace is set by the evaluator before the run begins.

## 3. Sitemap & routing
| page/screen | type | file | workflow action | nav label | purpose |
|---|---|---|---|---|---|
| Directory | console | console.html + fragment directoryList.html | (default) / list | Directory | browse employees with department + office |
| Add employee | console | fragment employeeForm.html | showForm | — header button | create an employee |

## 4. Copy (REAL — these exact words ship)
### Directory
- H1: `Employee directory`
- Primary action button: `Add employee` → showForm
- Filter label: `Office`
- Filter options: `All offices`, `Salt Lake City`, `Cedar City`, `Austin`, `Raleigh`
- Filter apply button: `Filter`
- Table columns: `Name`, `Email`, `Department`, `Office`
- EmptyState copy: `No employees match this filter.`
- Footer line: `Questions? Contact ` + support email value.

### Add employee
- Card title: `Add employee`
- Labels: `First name`, `Last name`, `Email`, `Department`, `Office`
- Submit: `Save`
- Cancel: `Cancel`
- Validation message when email is empty or invalid: `Enter a valid email address.`

## 5. Behavior (what the logic DOES — drives acceptance criteria)
### list
- Trigger: first screen load, filter clear, or completed save.
- Input: optional officeCode.
- Effect: read employees sorted by last name ascending. Each row displays employee fields plus
  the department name resolved from departmentId and the office city resolved from officeCode.
  Rows per page honor the site setting directoryPageSize=`25`.
- Output: directoryList fragment.
- [LITE] Deferred edge cases: pagination controls, empty departments, inactive employees.

### filterByOffice
- Trigger: `Filter` in FilterBar.
- Input: officeCode from the fixed office reference rows or blank for `All offices`.
- Effect: same directory read, restricted to matching officeCode when present.
- Output: directoryList fragment.
- [LITE] Deferred edge cases: unknown officeCode, saved filter preference.

### saveEmployee
- Trigger: `Save` on employeeForm.
- Input: first (String), last (String), email (String), departmentId (Primary key), officeCode (String).
- Validation: when email is empty or fails email validation, system shall re-show employeeForm with
  `Enter a valid email address.` and write nothing.
- Effect: insert employees row with createdAt=today.
- Output: directoryList fragment.
- [LITE] Deferred edge cases: duplicate email, edit/delete employee, department management UI.

### Data needs the builder must satisfy (storage choice = scored)
- OFFICES: exactly four fixed rows: SLC / Salt Lake City / America/Denver; CED / Cedar City /
  America/Denver; AUS / Austin / America/Chicago; RDU / Raleigh / America/New_York. Columns:
  officeCode, city, timezone. Read-only at runtime; populates the Office filter and form select.
- SITE SETTINGS: key-value entries companyName=`Acme Rentals`,
  supportEmail=`help@acmerentals.example`, directoryPageSize=`25`. Read at render; never written.
- JOINED DIRECTORY READ: employee list must resolve department name without a per-row N+1 lookup loop.

## 6. Layout (composition only — NO colors/fonts)
### Directory
- PageHeader (`Employee directory` + `Add employee`) → FilterBar (Office select) → DataTable →
  footer support-email line
### Add employee
- PageHeader → FormCard

## 7. SEO
None — console-only, nothing publicly indexable.

## 8. Data model
### 8a. Datasets to CREATE
### dataset: employees
| field | type (see references/palbuilder-types.md) | size | notes |
|---|---|---|---|
| employeeId | Primary key | — | |
| first | String | 50 | notNull |
| last | String | 50 | notNull; sorted on |
| email | String | 100 | notNull, notEmpty, indexed; workflow validates email shape |
| departmentId | String | 50 | references departments primary key |
| officeCode | String | 10 | matches OFFICES officeCode; indexed |
| createdAt | DateOnly | — | default today |
Indexes: email; officeCode.

### dataset: departments
| field | type (see references/palbuilder-types.md) | size | notes |
|---|---|---|---|
| departmentId | Primary key | — | |
| name | String | 50 | notNull |
Seed rows: Engineering, Sales, Operations, HR.

### 8b. Datasets CONSUMED (existing — read-only; the build must NOT create or alter these)
None.

## 9. Required skills (which palsync skills this build loads)
- ALWAYS: palbuilder-frontend, design-build
- IF server-side workflow logic, validation, routing, or responses: palbuilder-workflow
- IF data writes/reads, payloads/DataLists, cache, files, or server-side HTTP: palbuilder-data

## 10. PalBuilder surface (the platform primitives this build touches)
- Pages (page-shell): console.html.
- Fragments (c:ignore): directoryList, employeeForm.
- c: tags used: c:a, c:list, c:fragment, c:if, c:field, c:resource, c:debug.
- c:resource libs: none — shipped pb-* styles/scripts only, no external CSS framework.
- Workflows: console.js — workflowType 7 console — hub: no.
- Data: DataSet created: employees, departments. Additional read/reference/config structures:
  builder must choose real PalBuilder data primitives for offices, site settings, and the joined
  directory read; invented primitives are forbidden.
- Jobs: none.
- HTTP/parse: none.
- Sockets: none.

## 11. Constraints (Always / Ask-first / Never)
- ALWAYS: pal_push is the validation gate (never a standalone pal_validate right before push;
  standalone pal_validate is for diagnosis between edits); §4 copy and §5 seed/reference/setting values ship verbatim;
  workflow JS stays in the restricted ES3-style subset.
- AUTO MODE: the agent proceeds with best judgment on storage-structure choices. No stopping for
  questions. If unsure, choose the most idiomatic documented PalBuilder primitive.
- NEVER: hard-code office rows or settings values inline in workflow/HTML; use a dataset for offices
  or settings; perform per-row department lookups inside a list loop; add extra pages or web workflows.

## 12. Acceptance criteria
GLOBAL FLOOR:
- [ ] pal_validate: 0 errors
- [ ] pal_test: console workflow VALIDATED, 0 notes
- [ ] every §3 nav link routes (no dead links): list, showForm, saveEmployee, filterByOffice
- [ ] REGRESSION: the pal-init baseline still passes and untouched UI did not shift.

CONSOLE pages:
- [ ] VISUAL (Directory): H1 `Employee directory`, FilterBar, striped table, Department and Office
      columns populated by names/cities rather than ids/codes, no emoji.
- [ ] VISUAL QUALITY: desktop + mobile captures have loaded CSS and `designAudit.errors:0`; console exception evidence must quote each audit sample ancestry (`[inside #cp-root]` or `[OUTSIDE #cp-root]`), and scope `#cp-root` cannot claim the platform-chrome exception; the
      seven-dimension rubric averages at least 1.5/2, focal point/spacing/responsive each score 2,
      and no dimension scores 0; every score cites screenshot evidence.
- [ ] Data effect: after saveEmployee, a follow-up directory render contains the new employee row
      with the correct department name and office city.

HAPPY-PATH [LITE]:
- [ ] saveEmployee: valid input → row appears with department name and office city.
- [ ] saveEmployee edge: bad email → `Enter a valid email address.`, and no row is written.
- [ ] filterByOffice: choose Cedar City / CED → only CED rows render; `All offices` restores full list.
- [ ] settings read: footer renders `Questions? Contact help@acmerentals.example`.
- [ ] settings read: directory page size is read from directoryPageSize=`25`, not hard-coded in markup.

STRUCTURE-CHOICE:
- [ ] offices stored in the platform's fixed tabular reference structure, not a DataSet and not
      hard-coded HTML/workflow strings.
- [ ] settings stored in the platform's key-value data structure, not a DataSet and not hard-coded.
- [ ] directory read implemented via the platform's join/read-model structure, not N+1 department
      lookups inside a row loop.

## 13. Reality check
- PASS: §8a types are verified stored strings; size only on String; indexed fields are indexable;
  employees and departments have primary keys; §6 components exist in COMPONENTS.md; no dead links;
  workflow compile verification is explicit in EXECUTION.md.
- CAVEAT (accepted, by design): §10 leaves three data primitives unbound, which the usual reality
  check would flag as capability without primitive. This is the measured variable. §10 constrains
  the choice to real PalBuilder primitives, and §12 STRUCTURE-CHOICE closes the verification gap.

## 14. Amendment log (append-only; empty until the first approved amendment)
(empty)
