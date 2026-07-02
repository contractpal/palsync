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
| | | | | | | | | / / | | / | | | |
