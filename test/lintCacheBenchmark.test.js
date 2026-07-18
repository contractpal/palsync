"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { run } = require("../bench/lint-cache-hit-rate");

test("synthetic incremental lint workflow reaches at least 85% cache hits", () => {
    const first = run();
    const second = run();
    assert.deepStrictEqual(second, first);
    assert.ok(first.hitRate >= 85, JSON.stringify(first));
});
