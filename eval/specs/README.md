# Palsync Test Specs

Five benchmark specs to measure palsync's ability to produce functional, structurally correct
pal code. Each test runs fully autonomously (auto mode) — the agent builds end-to-end with
zero human input. Evaluation happens once at the end.

## Test matrix

| # | Folder | What it tests | Key scoring dimensions |
|---|---|---|---|
| 1 | `01_crud_equipment_checkout` | CRUD against a single DataSet | insert/update/delete, status toggle, validation, fragment swap, PAL Dev Standard compliance |
| 2 | `02_data_structures_company_directory` | Correct storage primitive selection | DataList for fixed refs, Data for key-value config, DataView for joined reads — NOT specified in the spec |
| 3 | `03_console_tx_service_requests` | Console ↔ transaction lifecycle | tx creation from console (type 7), tx completion (type 2), cancel/void, dataset ↔ tx linkage |
| 4 | `04_interpal_tunnels_partner_bridge` | Inter-pal communication | tunnel request, webservice request, local tunnel provider, local webservice provider |
| 5 | `05_marketing_website` | Static marketing website | web routing, exact copy, SEO heads, crawler files, visual anti-slop |

## Running a test

1. Set the workspace/cloud URL in the spec's `pal:` header line (replace `<WORKSPACE — set by evaluator before run>`).
2. Copy the test folder's `SPEC.md` + `EXECUTION.md` into the palsync workspace alongside
   `DESIGN_SYSTEM.md` and `COMPONENTS.md` from this bundle's root.
3. Launch palsync in Claude Code (Sonnet, high). Run in auto/full mode — no human intervention.
4. When the agent finishes, evaluate against the spec's §12 acceptance criteria.

## Two runs per test

Each scenario gets two runs:
- **Run A**: current palsync config (baseline).
- **Run B**: updated skills (experimental).

Record the §12 pass/fail checklist for each run to compare.

## Shared files

- `DESIGN_SYSTEM.md` — minimal bootstrap-only design stub (all tests share it).
- `COMPONENTS.md` — the shared component vocabulary every §6 layout references.
