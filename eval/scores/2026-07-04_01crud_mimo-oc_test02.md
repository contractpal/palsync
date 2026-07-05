# Score — 01_crud_equipment_checkout · CHEAP (mimo-2.5-pro, test-02) — FAILED, shipped a stub

Run: 2026-07-04 · harness OpenCode (provider `opencode-go`) · model `mimo-v2.5-pro` · palsync SHA
b6201fb (`.palsync.usage.json` mtime 23:14, after the 21:05 reinstall to `b6201fb`) · orch
main@b6201fb · palbuilder main@b6201fb · workspace test-02-crud-mimo-oc

Scoring method: direct read of `pal.json`, `workflows/console.js`, `fragments/*.html`, `git log`,
cross-checked against the OpenCode session DB (`ses_0cfc16730ffeR1oO1UW4C1Adpg`, title "Running
pal-loop skill").

**This run did not build the feature.** `git log` shows exactly 2 commits: `loop start: baseline
workspace` and `T1: create equipment dataset`. All three fragments are literal placeholders
(`<p>Equipment list placeholder</p>`, etc. — verified verbatim) and the workflow's action switch
is `switch (c.getAction()) { default: break; }` — no case handlers at all. Every §12 criterion
below fails because there is no CRUD implementation to evaluate, not because of a single bug.

**Root cause:** a self-assigned rabbit hole. The model needed (or believed it needed) to
configure a console pal's home-screen tile and, finding no documentation for it, invented
`pal.json` fields `desktopBindings.DesktopBinding[].{DesktopLabel,DesktopImage}` (also wrong
*shape* — `desktopBindings` should be an array of `{string, DesktopBinding}` entries, not a
`{DesktopBinding: [...]}` object), then spent the entire active-compute budget on 7 `webfetch`
calls to `secure.cloudpiston.com/cpal/cp-api/console/*` docs and cross-project `rg`/`python3`
scans of unrelated sibling workspaces trying to verify field names that don't exist. It never
returned to the actual task. The CRUD spec never asked for a home-screen tile at all — this was
scope the model invented for itself.

Session also shows a **premature-stop violation**: the model went idle mid-task-list at ~+317s;
the user had to ask "why did you stop?" after a ~2-hour gap, and even after "just stick to the
spec" it only pushed twice more without building CRUD.

**Global floor**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| G1 | [~] | pal_validate 0 errors | 3 `pal_validate` calls; placeholder markup has no `c:` tags to violate, so this likely reported clean — but it validates nothing meaningful. Not a real pass. |
| G2 | [~] | pal_test workflow VALIDATED, 0 notes | 1 `pal_test` call; an empty `default: break` switch compiles trivially. Not a real pass. |
| G3 | [ ] | every §3 link routes | FAIL — no `case` handlers for any action; every action falls to `default: break`. |

**Console**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| C1 | [ ] | VISUAL Equipment list: PageHeader, striped table, badges, no emoji | FAIL — fragment is `<p>Equipment list placeholder</p>`, no table, no PageHeader, no badges. |
| C2 | [ ] | Data effects reflect writes | FAIL — no write action exists. |

**Happy-path**
| # | Check | Criterion | Evidence |
|---|---|---|---|
| H1 | [ ] | saveEquipment valid → new row | FAIL — no `saveEquipment` handler exists. |
| H2 | [ ] | checkoutEquipment valid → checkedOut badge + person | FAIL — no handler. |
| H3 | [ ] | checkinEquipment → available, person cleared | FAIL — no handler. |
| H4 | [ ] | deleteEquipment → row absent from list | FAIL — no handler. |
| H5 | [ ] | saveEquipment edge: empty name → `Name is required.` | FAIL — no handler. |

**Total: 0 / 10**

Violations: 1 — premature stop mid-task-list without setting `blocked`/`needs-human` or naming
a blocker (the session went idle rather than reporting the rabbit-hole as a blocker). The
`equipment` dataset WAS correctly registered inline in `pal.json` (T1, done) — the one real
increment of progress.

**Direct link to the 2026-07-05 fixes:** running today's `pal.json` unknown-key lint
(`checkUnknownKeys`) against this exact workspace's manifest reproduces the error deterministically:
`desktopBindings" must be an ARRAY of entries... ` plus two field-level errors suggesting
`name`/`icon` for the invented `DesktopLabel`/`DesktopImage` — confirmed via `node -e` against
this workspace during the fix work. `palbuilder-core/SKILL.md` and `references/pal-json.md` now
also state directly that a console pal needs no tile at all to work. The pal-loop premature-stop
guard (2026-07-05) targets the idle-mid-task-list failure directly.

---
Cost: 60 steps/65 messages, but **only ≈7.6 minutes of active compute** — the 127-minute
wall-clock "duration" is ~2 hours of idle time waiting on the human, not model work (03:07:16
start → ~03:12:39 stall → 05:12:19 user prompt → 05:14:47 end). Tool calls 80: mcp 13
(`pal_push`×7, `pal_validate`×3, `pal_test`×1, `pal_sync_datasets`×1, `pal_status`×1) / read 11 /
other 67 (bash 21, edit 14, write 6, skill 5, webfetch 7, todowrite 2; `ctx_execute_file`×1
errored) · **7 pushes** for zero shipped functionality · tokens in ≈4.73M (cache_read 4.60M,
cache_write 0) / out ≈7.3k (+38.3k reasoning) · cost $0.4592.
