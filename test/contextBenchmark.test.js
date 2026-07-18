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
