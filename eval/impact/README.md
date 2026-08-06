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
regression, or called it after pushing and got `{stale}`, has no verdict — record it as
`regression: "stale"`. Do NOT re-run the arm to obtain a verdict: discarding arms by how the agent
behaved selects for compliant runs, which is the one bias that would invalidate the pilot. A stale
arm still satisfies `treatment-completion` (nothing regressed) and never counts as a pass (nothing
was checked); the `regression-coverage` check reports how many arms went unverified.

Coding the thirteen transcript-derived fields by hand is impractical — arm one's log is 171 entries.
Use the deterministic extractor, which reads only exact facts from the structured log and derives
first-correct-write and `writesOutsideOracle` by set membership against the oracle:

```sh
node scripts/extract-impact-trajectory.js \
  --transcript <path-to-transcript.jsonl> \
  --oracle eval/impact/<task>/oracle.json
```

It makes no judgment and prints what it cannot decide as adjudication lines with the evidence
attached. Record rows with `--output eval/impact-results.jsonl`; the default output is
`eval/scores.jsonl`, which the pilot checker does not read.

All counts are non-negative integers and `wallTimeMs` is positive. If no correct write occurred,
both pre-correct-write metrics are `null`. **Under generation v1 neither arm calls `pal_context`**, so
both variants record `targetCalls:0`, `targetBeforeFirstEdit:false`, and `impactResponseBytes:null`.
A treatment that called the tool anyway broke its own arm instruction: record the call honestly and
let `facts-delivered` fail — never rewrite it.

### Arm generations

Generation v0's ON arm ORDERED the agent to call `pal_context` before its first edit. That made the
`adoption` gate a **compliance** rate rather than a measure of the intervention, and a weak model
ignored the order on half its ON arms. An ON arm that never calls the tool is an OFF arm with one
extra sentence, so those pairs silently compared off-vs-off and the primary median reduction they fed
was flattered. Because no arm may be re-run to chase a verdict, the gate's ceiling fell to exactly its
own threshold.

Generation v1 removes invocation from the experiment. `arms/on.md` **injects the facts `pal_context`
would return**, and both arms forbid calling it, so the only difference between the two sides of a
pair is whether the agent has the facts. This isolates the question the remaining slices depend on —
do these facts reduce exploration — from the separate question of whether a weak model can invoke a
deferred MCP tool. `adoption` is therefore replaced by `facts-delivered`, and `response-budget` now
measures the injected payload rather than a tool response.

Never hand-edit `arms/on.md`. Regenerate it from the frozen fixture, which keeps the injected block
provably identical to the tool's own output:

```sh
node scripts/gen-impact-arm-facts.js          # rewrite every ON arm
node scripts/gen-impact-arm-facts.js --check  # non-zero exit if any arm has drifted
```

Changing an arm also invalidates `test/fixtures/impact-pilot-pass.jsonl`, whose rows pin each arm's
sha and injected payload size. Refresh them from the arms themselves:

```sh
node -e '
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const {resolveSpec}=require("./src/core/evalSpec");
const f="test/fixtures/impact-pilot-pass.jsonl";
const rows=fs.readFileSync(f,"utf8").trim().split("\n").map(JSON.parse);
for (const row of rows) {
  const p=resolveSpec(row.experiment.taskKey+"-"+row.experiment.variant).armPath;
  const text=fs.readFileSync(p,"utf8");
  const line=text.split("\n").find(l=>l.startsWith("{\"schema\":\"palsync/impact/1\""));
  row.experiment.armFile={ name:path.basename(p),
    sha256:crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"),
    factsBytes:line===undefined?null:Buffer.byteLength(line,"utf8") };
}
fs.writeFileSync(f,rows.map(r=>JSON.stringify(r)).join("\n")+"\n");'
```

**After changing any arm, reinstall the pinned tarball before running an arm.** `eval/impact/` ships
in `package.json` `files`, so an arm is seeded from the *installed* palsync while it is scored against
this repo — a repo-only edit changes nothing an arm sees. `record-eval` hard-fails a row whose
workspace arm text does not match this repo's arm, so a stale install is caught at record time instead
of silently reverting a v1 ON arm to a v0 mandate.

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
5. For each arm, run the exact `palsync --eval <virtual-key>` flow, creating a fresh Pal. The Pal's
   activation key must carry the Console Workflow entitlement — the fixture ships
   `workflows/console.js`, and a key without it fails the baseline push as `save-rejected` after the
   fresh Pal already exists on the server.
6. Use no mid-run intervention. Before handing the agent its prompt, confirm the seeded
   `EXECUTION.md` carries the arm the current generation expects — for an ON arm,
   `rg -c '"schema":"palsync/impact/1"' <workspace>/EXECUTION.md` must be non-zero. A stale install
   otherwise serves the previous generation's arm and wastes the whole run.
7. Copy the raw transcript into `eval/runs/` — it is the only source of the arm's model spend and the
   host prunes transcripts on a retention timer.
8. Score against the blinded oracle after completion.
9. Extract, then adjudicate — never hand-tally:
   `scripts/extract-session-cost.js --transcript <t> --dir <ws>` (must run BEFORE `record-eval`, or
   `modelUsage` records as null) and `scripts/extract-impact-trajectory.js --transcript <t> --oracle <o>`.
   The extractors compute only what follows mechanically; their ADJUDICATE lines are the operator's.
10. Call `record-eval` with all pins, then assert the new row's `modelUsage` is non-null.
11. After twelve rows, run:

```sh
node scripts/check-impact-pilot.js \
  --input eval/impact-results.jsonl \
  --benchmark <benchmark.json> \
  --json
```

11. A `fail` or `incomplete` status stops expansion; do not implement proposal Slice 3.
12. Only Sam may approve later slices after reviewing the evidence.
