# eval/RESULTS.md — palsync benchmark results

One row per run. See [`eval/run.md`](run.md) for the protocol: what each column means, how to
capture it, the one-variable rule (§2), and the model matrix (§5). Score each run with
[`eval/scoring.md`](scoring.md).

**A row is invalid for comparison unless every pinned-variable column is filled** (date,
scenario, harness, model, palsync SHA, orch skills, palbuilder skills). Leave a cost column blank
only if the harness genuinely does not report it (tokens) — never guess.

Column key:
- **orch skills** — `main@<sha>` vs `refactor@<sha>` (orchestration-skill set).
- **palbuilder skills** — `legacy@<sha/date>` vs `palbuilder-core@<sha/date>`.
- **§12** — passed / total from `scoring.md`.
- **tool calls (mcp/read/other)** — from the transcript, split per run.md §4a.
- **pushes** — `pal_push` count (subset of mcp), the iteration-loop proxy.
- **tokens in/out** — `/cost` in Claude Code; blank if unavailable.
- **time** — wall-clock.
- **violations** — count per run.md §4e; explain in notes.
- **H4 tightened 2026-07-05** — scenario 01's H4 criterion now also requires a `confirm=` prompt
  on the deleteEquipment link (SPEC.md §12 / scoring.md H4). Rows dated before 2026-07-05 scored
  H4 on "row absent" only — not strictly comparable to later rows on that one criterion.

| date | scenario | harness | model | palsync SHA | orch skills | palbuilder skills | §12 (pass/total) | tool calls (mcp/read/other) | pushes | tokens in/out | time | violations | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-07-02 | 01_crud_equipment_checkout | Claude Code | claude-sonnet-5 high (frontier) | 454ecfe | main@454ecfe | main@454ecfe | 10/10 | 131 (22/11/98) | 6 | 25.96M / 134k | 26.7m | 0 | validate 0 err; server test VALIDATED 0 notes; copy verbatim §4; all §3 routes; browser preview human-confirmed working. Tokens mined from transcript (input incl 25.1M cache-read). |
| 2026-07-02 | 01_crud_equipment_checkout | Claude Code | claude-haiku-4-5 (cheap) | 454ecfe | main@454ecfe | main@454ecfe | 1/10 | 146 (44/8/94) | 24 | 26.41M / 113k | 14.9m | 1 | dataset equipment.json wrong shape (fields:[] not fields.DatasetField) + not in pal.json + not synced → server test FAILED (4 notes); workflow can't run → all runtime criteria fail. VIOLATION: declared done w/o passing pal_test. 24 pushes = loop thrash w/o convergence. |
| 2026-07-03 | 01_crud_equipment_checkout | Claude Code | claude-haiku-4-5 (cheap) | 55bcb7e | main@55bcb7e | main@55bcb7e | 4/10 | 48 (48/–/–) | 24 | – / – | ~8m | 0 | workspace test-02-crud-haiku. Floor now 3/3: validate 0 err, server test VALIDATED 0 notes, routing present (prior cheap failed test). Dataset shape fixed but STILL not registered in pal.json datasets.entry / never synced (sync-datasets REFUSED) → no server table → all runtime data effects fail. 2nd defect: form inputs via `<c:a href>` anchor, no `<form>`/`ajax-target` → field values not submitted. 24 pushes, 5 sync attempts all refused → never converged on dataset provisioning. 0 violations: verified + honestly reported CHANGES-NEEDED. read/other/token split unavailable (MCP-usage file only). |
| 2026-07-04 | 01_crud_equipment_checkout | Claude Code | claude-haiku-4-5 (cheap) | ~4338bfd (pre-b6201fb, exact reinstall SHA not logged) | main@~4338bfd | main@~4338bfd | 10/10* | 112 (26/29/48+skills:1) | 6 | 9.19M / 28.9k | 7.0m | 0 | workspace test-09-crud-haiku. Full pass, converged on first attempt — no thrash (6 pushes = frontier baseline). No `pal_exercise` this run (predates that tool's landing). *H4 under the contemporary rubric only (row absent); would be 9/10 under the 2026-07-05-tightened H4 — delete `c:a` has no `confirm=`. See eval/scores/2026-07-04_01crud_haiku_test09.md. |
| 2026-07-04 | 01_crud_equipment_checkout | Claude Code | claude-haiku-4-5 (cheap) | b6201fb | main@b6201fb | main@b6201fb | 10/10* | ~112 (~50/17/~50+skills:6) | 10 | 11.03M / 51.9k | 11.0m | 0 | workspace test-10-crud-haiku. Full pass, but ~5.5min (half the session) burned on a delete-feature fix loop: 6 `pal_exercise` FAILs + 13 edits, from guessing `deleteRecord`'s signature (record vs String id), a `request.get`/`getData().get()` mix-up, and misreading an alphabetically-sorted list as a failed delete. *Same H4 caveat as the row above — no `confirm=` on delete. Directly motivated the 2026-07-05 backend-signatures cribsheet + pal-loop delete-absent guidance. See eval/scores/2026-07-04_01crud_haiku_test10.md. |
| 2026-07-04 | 01_crud_equipment_checkout | OpenCode | mimo-v2.5-pro (cheap) | b6201fb | main@b6201fb | main@b6201fb | 10/10* | 149 (52/26/71) | 13 | 11.85M / 17.0k | 14.8m | 0 | workspace test-03-crud-mimo-oc. Full pass via a different (also cheap) model — confirms the confirm-dialog gap is model-agnostic, not haiku-specific. 47 platform round-trips vs frontier's 6 (13 push/14 validate/13 exercise/7 test); some early time lost scanning unrelated sibling workspaces while confused about console-pal tile config (milder version of the test-02 failure below). *Same H4 caveat — no `confirm=` on delete. See eval/scores/2026-07-04_01crud_mimo-oc_test03.md. |
| 2026-07-04 | 01_crud_equipment_checkout | OpenCode | mimo-v2.5-pro (cheap) | b6201fb | main@b6201fb | main@b6201fb | 0/10 | 80 (13/11/67) | 7 | 4.73M / 7.3k | 7.6m active (127m wall incl. ~2h idle) | 1 | workspace test-02-crud-mimo-oc. **FAILED — shipped a placeholder stub**, not a passing build (only "T1: create dataset" done; empty action switch, placeholder fragments). Root cause: invented pal.json fields (`desktopBindings.DesktopBinding[].DesktopLabel/DesktopImage`, wrong shape too) chasing an undocumented, spec-unrequired console-tile feature; burned the entire session on 7 webfetches + cross-project greps instead of building CRUD. VIOLATION: went idle mid-task-list without a `blocked`/`needs-human` handoff — user had to ask "why did you stop?" Directly motivated the 2026-07-05 `checkUnknownKeys` pal.json lint (reproduces this exact error against this workspace) + pal-loop's premature-stop guard. See eval/scores/2026-07-04_01crud_mimo-oc_test02.md. |
