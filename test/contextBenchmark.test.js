"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { run } = require("../eval/benchmark-context");

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
