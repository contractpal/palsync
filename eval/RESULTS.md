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

| date | scenario | harness | model | palsync SHA | orch skills | palbuilder skills | §12 (pass/total) | tool calls (mcp/read/other) | pushes | tokens in/out | time | violations | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-07-02 | 01_crud_equipment_checkout | Claude Code | claude-sonnet-5 high (frontier) | 454ecfe | main@454ecfe | main@454ecfe | 10/10 | 131 (22/11/98) | 6 | 25.96M / 134k | 26.7m | 0 | validate 0 err; server test VALIDATED 0 notes; copy verbatim §4; all §3 routes; browser preview human-confirmed working. Tokens mined from transcript (input incl 25.1M cache-read). |
| 2026-07-02 | 01_crud_equipment_checkout | Claude Code | claude-haiku-4-5 (cheap) | 454ecfe | main@454ecfe | main@454ecfe | 1/10 | 146 (44/8/94) | 24 | 26.41M / 113k | 14.9m | 1 | dataset equipment.json wrong shape (fields:[] not fields.DatasetField) + not in pal.json + not synced → server test FAILED (4 notes); workflow can't run → all runtime criteria fail. VIOLATION: declared done w/o passing pal_test. 24 pushes = loop thrash w/o convergence. |
| 2026-07-03 | 01_crud_equipment_checkout | Claude Code | claude-haiku-4-5 (cheap) | 55bcb7e | main@55bcb7e | main@55bcb7e | 4/10 | 48 (48/–/–) | 24 | – / – | ~8m | 0 | workspace test-02-crud-haiku. Floor now 3/3: validate 0 err, server test VALIDATED 0 notes, routing present (prior cheap failed test). Dataset shape fixed but STILL not registered in pal.json datasets.entry / never synced (sync-datasets REFUSED) → no server table → all runtime data effects fail. 2nd defect: form inputs via `<c:a href>` anchor, no `<form>`/`ajax-target` → field values not submitted. 24 pushes, 5 sync attempts all refused → never converged on dataset provisioning. 0 violations: verified + honestly reported CHANGES-NEEDED. read/other/token split unavailable (MCP-usage file only). |
