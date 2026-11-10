# eval/goal — goal-only vs spec-driven builds

Question: does a strong main model build a correct pal from a short user-approved goal, without
the SPEC.md + EXECUTION.md task table? And which subagent topology is best?

This eval is separate from the frozen benchmark in `eval/specs/` and `eval/run.md`. Its rows go
to `eval/goal/scores.jsonl`, not `eval/scores.jsonl`.

## Arms

| Arm | Workspace gets | Prompt | Tests |
|---|---|---|---|
| A | frozen `eval/specs/01_crud_equipment_checkout/` SPEC.md + EXECUTION.md | `arms/A.md` | baseline: current harness |
| B | `01_equipment_checkout/GOAL.md` only | `arms/B.md` | goal, main agent does all work |
| C | GOAL.md only | `arms/C.md` | subagents build, main agent verifies |
| D | GOAL.md only | `arms/D.md` | subagents build, fresh-context subagent verifies |

Main model: Opus 5.5 (`claude-opus-5-5`). Subagents: Sonnet 5.5. Three trials per arm (12 runs).
To test Sonnet 5.5 as the main model, repeat with `--model claude-sonnet-5-5`; never mix main
models inside one comparison.

`oracle.json` is hidden from the model. Never copy it into a run workspace.

## Pin these for every run

- PalSync commit (`git rev-parse --short HEAD`), Claude Code version (`claude --version`).
- Review preference: `palsync settings review off` for every arm. Scoring uses the oracle, not
  REVIEW.md. Restore your own preference after the eval.
- User-level Claude config: your `~/.claude` hooks, agents, CLAUDE.md, and env load into every
  run and change the result. `run.sh` isolates each run with `CLAUDE_CONFIG_DIR` set to
  `$EVAL_CLAUDE_CONFIG_DIR` (default `~/.palsync-eval/claude-config`) when that dir holds a copy
  of your `.credentials.json`, and loads only the workspace `.mcp.json`. It records
  `cleanConfig` in `.eval/run-meta.json`.
- One empty pal per run (names in `runs.map`). A dirty pal invalidates the run.

## Steps

1. Create the 12 empty console pals in `runs.map` in PalBuilder.
2. Stage and set up the workspaces:
   `CP_USER=you@example.com CP_PASS=... ./eval/goal/setup.sh --reset --setup`
3. **Calibrate the oracle once** before you score real runs. Score one finished arm-A run:
   if a check fails but the pal is correct by hand, the oracle step is wrong. Fix
   `oracle.json` before any scored run, and record the calibration in this file.
4. Run each workspace (from the repo root):
   ```bash
   ./eval/goal/run.sh <folder>
   ```
5. Score it, which appends one row to `eval/goal/scores.jsonl`:
   ```bash
   node scripts/score-goal-eval.js --dir eval/runs/<folder> --arm <A|B|C|D> --trial <n>
   ```
6. Score the human rubric (`C9c_visual` in `oracle.json`) by hand from screenshots, and add
   it with `--visual <0-2 average>`.

## What a row records

- `oraclePassed` / `oracleTotal`: hidden checks that pass on the final pushed version.
- `claimedDone`: the run ended with `RESULT: DONE`. `falseDone` is true when it claimed DONE
  but an oracle check failed (an honesty failure).
- `costUsd`, `durationMs`, `numTurns` from Claude Code's JSON result.
- `pushes`, `failedPushes` from PalSync tool evidence and usage.

## Scenario 03 (harder)

`03_service_requests/` adds a console plus a transaction page. Its runs are `goal03_*` in
`runs.map` (arms A, B, D; two trials each). Stage only these with `setup.sh --only goal03_`. The
scorer picks the oracle from the folder prefix.

`R7_customer_completion` is scored by hand from the source: the transaction workflow must find
the row by `txId`, set `status`, `resolutionNote`, and `completedAt`, and show the required copy.
A fresh test transaction has no `serviceRequests` row, so `pal_exercise` cannot check it.
Calibration: `goal03_A1` passed 10/10 with no change. `goal03_B2` showed the new request after
`Create request` (a valid design), so R4–R6 also accept a `Back to list` variant.

## Decision rule

Goal mode wins if an arm in B–D has an oracle pass rate equal to or higher than A across 3
trials, at an equal or lower median cost, with no `falseDone`. If the results are close, add a
second scenario (for example the console service-request scenario 03) before you decide.

## Limits

- The interview is not tested. GOAL.md stands for the result of a good interview.
- GOAL.md fixes some names and words, so that the hidden oracle can find the controls. A real
  user does not always give these.
- One scenario and three trials give weak evidence. Treat a small difference as no difference.
