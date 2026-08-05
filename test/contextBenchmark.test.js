"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { run, runJson } = require("../eval/benchmark-context");

test("context benchmark output is deterministic and covers planned scenarios", async () => {
    const first = await run();
    const second = await run();
    assert.equal(second, first);
    for (const scenario of ["Repeated inject", "Pal-name change", "Agent switch", "Skill source edit", "Tool schema edit", "Clean validation", "Repeated pal_validate"]) {
        assert.match(first, new RegExp(scenario));
    }
    assert.match(first, /0 writes \| pass/);
    assert.match(first, /Deterministic local benchmark/);
});

test("efficiency metrics are deterministic and the frozen baseline is valid", async () => {
    const first = await runJson();
    const second = await runJson();
    assert.equal(second, first);
    const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "bench", "efficiency-baseline.json"), "utf8"));
    assert.equal(baseline.schema, "palsync/efficiency-baseline/1");
    assert.ok(baseline.eagerContextBytes.total > 0);
});

// The baseline is the north-star efficiency metric, so it has to be a pin and not a decoration:
// asserting only its schema let it drift silently (it once claimed toolSchemaBytes 19390 while the
// real value was 19105, because nothing ever compared the file to a live measurement). Any change
// to eager context, tool schemas, or lint-cache behavior now fails here until the recorded numbers
// are regenerated with `node eval/benchmark-context.js --json > bench/efficiency-baseline.json`.
test("the frozen baseline matches the live measurement byte for byte", async () => {
    const baselinePath = path.join(__dirname, "..", "bench", "efficiency-baseline.json");
    const recorded = fs.readFileSync(baselinePath, "utf8");
    assert.deepEqual(
        JSON.parse(await runJson()),
        JSON.parse(recorded),
        "bench/efficiency-baseline.json is stale — regenerate it with " +
        "`node eval/benchmark-context.js --json > bench/efficiency-baseline.json` and review the delta."
    );
    assert.equal(recorded, await runJson(), "baseline file formatting must match the generator's output exactly.");
});
