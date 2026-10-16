"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const validationSwitch = require("../src/core/validationSwitch");

function store(initial = {}) {
    const data = Object.assign({}, initial);
    return { data, read: (k, d) => (data[k] !== undefined ? data[k] : d), write: (k, v) => { data[k] = v; return true; } };
}

test("validation is on unless the pal was switched off", () => {
    const s = store();
    assert.strictEqual(validationSwitch.isOff("PAL-1", s.read), false);
    assert.strictEqual(validationSwitch.isOff(null, s.read), false);
});

test("switching off is per pal and switching back on removes the entry", () => {
    const s = store();
    assert.strictEqual(validationSwitch.setOff("PAL-1", true, s.read, s.write), true);
    assert.strictEqual(validationSwitch.isOff("PAL-1", s.read), true);
    assert.strictEqual(validationSwitch.isOff("PAL-2", s.read), false);
    validationSwitch.setOff("PAL-1", false, s.read, s.write);
    assert.strictEqual(validationSwitch.isOff("PAL-1", s.read), false);
    assert.deepStrictEqual(s.data[validationSwitch.KEY], {});
});

test("a malformed stored value is treated as on, and a pal with no guid cannot be switched", () => {
    for (const bad of ["yes", [], 7, null]) {
        assert.strictEqual(validationSwitch.isOff("PAL-1", store({ [validationSwitch.KEY]: bad }).read), false);
    }
    const s = store();
    assert.strictEqual(validationSwitch.setOff("", true, s.read, s.write), false);
    assert.deepStrictEqual(s.data, {});
});
