# Brownfield impact-context evals

These fixtures are frozen experiment inputs for measuring whether exact `pal_context(target=...)`
facts reduce exploration during a bounded brownfield rename. Each task has one clean baseline, one
blinded oracle, and two arms. The task documents and baseline are identical between arms; only the
evaluator-owned intervention differs.

Resolve a run with the exact virtual key `<task>-off` or `<task>-on`. Bare task and numeric aliases
are intentionally unsupported. Before a pilot, set `model` in `pilot.json` to one exact weak model
for every declared pair. Regenerate manifests only after an intentional fixture edit:

```sh
node scripts/hash-impact-baselines.js --write
node scripts/hash-impact-baselines.js --check
```

Never inject `oracle.json` or `baseline-manifest.json` into an agent workspace.

## Manual evidence protocol

1. Launch the exact `<task>-off` or `<task>-on` key and retain the generated
   `.palsync/impact-start.json` receipt.
2. Save the raw transcript bytes after the agent stops. Do not summarize or normalize the file.
3. Only after the run, the evaluator opens that task's blinded `oracle.json`, runs its acceptance
   and regression commands, and manually codes the transcript using the oracle's allowed-write and
   first-correct-write definitions. The agent never sees the oracle. Do not automatically interpret
   the transcript with an LLM or heuristic.
4. Write the complete trajectory object:

```json
{
  "schema": "palsync/impact-trajectory/1",
  "acceptance": "pass",
  "regression": "pass",
  "targetCalls": 1,
  "targetBeforeFirstEdit": true,
  "readsBeforeFirstCorrectWrite": 3,
  "searchesBeforeFirstCorrectWrite": 1,
  "writesOutsideOracle": 0,
  "calls": { "mcp": 12, "read": 8, "other": 15 },
  "pushes": 2,
  "failedVerificationLoops": 0,
  "hardRuleViolations": 0,
  "wallTimeMs": 420000,
  "falseExactReferences": 0,
  "impactResponseBytes": 1800
}
```

`regression` records what the AGENT's own `pal_regression` call returned, read from the transcript —
not a value the evaluator re-derives afterward. Seeding writes `baseline/baseline.json` (validate arm
only) so the call has a real baseline, but `pal_regression`'s freshness gate refuses to verdict once
the server marker moves, so re-running it after the agent's push returns `{stale}` by design. The
task's `EXECUTION.md` already sequences regression before the push. An arm whose agent never called
regression, or called it after pushing and got `{stale}`, has no regression verdict — treat that arm
as incomplete rather than recording a guess.

All counts are non-negative integers and `wallTimeMs` is positive. If no correct write occurred,
both pre-correct-write metrics are `null`. Preserve on-arm non-adoption as
`targetCalls:0`, `targetBeforeFirstEdit:false`, and `impactResponseBytes:null`; never rewrite it as
adoption. The off arm requires those same three uncontaminated values.

5. From the repository root, record the row with the full command shape:

```sh
node scripts/record-eval.js \
  --dir <workspace> \
  --scenario impact_01_shared_fragment-on \
  --model <exact-model> \
  --harness <harness> \
  --variant on \
  --pair impact01-r1 \
  --pair-order off-first \
  --orch-skills <branch@sha> \
  --palbuilder-skills <name@sha-or-date> \
  --trajectory <path-to-coded-trajectory.json> \
  --transcript <path-to-raw-transcript>
```

The recorder hashes the exact trajectory/transcript bytes and rejects incomplete or contradictory
impact evidence. Missing usage stays null; never estimate it.

## Fixed twelve-run operator protocol

1. Install or link the exact approved PalSync SHA.
2. Choose one exact weak model and one harness exposing token usage.
3. Run `node bench/impact-context.js --json > <benchmark.json>` once.
4. Follow the fixed `pilot.json` pair order.
5. For each arm, run the exact `palsync --eval <virtual-key>` flow, creating a fresh Pal.
6. Use no mid-run intervention.
7. Score against the blinded oracle after completion.
8. Code trajectory JSON manually from the transcript.
9. Call `record-eval` with all pins.
10. After twelve rows, run:

```sh
node scripts/check-impact-pilot.js \
  --input eval/impact-results.jsonl \
  --benchmark <benchmark.json> \
  --json
```

11. A `fail` or `incomplete` status stops expansion; do not implement proposal Slice 3.
12. Only Sam may approve later slices after reviewing the evidence.
