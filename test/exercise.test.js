"use strict";
// pal_exercise — the functional layer above compile (pal_test) and render (pal_screenshot):
// trigger an action, assert expect/absent strings in the rendered result. These tests cover the
// pure, server-free parts: step validation, the expect/absent assertion, labels, mode selection,
// the report format, and the no-server invalid path of runExercise.
const { test } = require("node:test");
const assert = require("node:assert");
const { runExercise, validateSteps, checkStep, stepLabel, needsBrowser, formatExercise, MAX_STEPS } = require("../src/core/exercise");

// ---- validateSteps ---------------------------------------------------------

test("validateSteps: accepts a realistic CRUD flow", () => {
    const steps = [
        { fill: { name: "Camera", category: "AV" }, click: "Save", expect: ["Camera"] },
        { fill: { name: "Camera Pro" }, click: "Save", expect: ["Camera Pro"], absent: ["Camera,"] }
    ];
    assert.deepStrictEqual(validateSteps(steps), []);
});

test("validateSteps: rejects non-array, empty, and over-cap", () => {
    assert.ok(validateSteps(undefined).length);
    assert.ok(validateSteps([]).length);
    const many = Array.from({ length: MAX_STEPS + 1 }, () => ({ click: "x" }));
    assert.ok(validateSteps(many).some(p => /too many steps/.test(p)));
});

test("validateSteps: rejects a do-nothing step, params without action, bad expect", () => {
    assert.ok(validateSteps([{}]).some(p => /does nothing/.test(p)));
    assert.ok(validateSteps([{ params: { id: "1" } }]).some(p => /params but no action/.test(p)));
    assert.ok(validateSteps([{ click: "Save", expect: [""] }]).some(p => /non-empty strings/.test(p)));
    assert.ok(validateSteps([{ click: "Save", expect: "Camera" }]).some(p => /non-empty strings/.test(p)));
    assert.ok(validateSteps([{ fill: { a: { nested: true } }, click: "Save" }]).some(p => /string\/number/.test(p)));
});

// ---- checkStep -------------------------------------------------------------

test("checkStep: expect found + absent clean passes", () => {
    const r = checkStep("…<td>Camera Pro</td>…", { expect: ["Camera Pro"], absent: ["Old Camera"] });
    assert.strictEqual(r.pass, true);
    assert.deepStrictEqual(r.expect.map(x => x.found), [true]);
    assert.deepStrictEqual(r.absent.map(x => x.absent), [true]);
});

test("checkStep: an absent string still present fails (the duplicate-insert catch)", () => {
    // Edit flow: old value must be gone; if the edit inserted a duplicate, the old row survives.
    const r = checkStep("<td>Camera</td><td>Camera Pro</td>", { expect: ["Camera Pro"], absent: ["Camera</td><td>"] });
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.absent[0].absent, false);
});

test("checkStep: a missing expect string fails", () => {
    const r = checkStep("<h1>Equipment</h1>", { expect: ["Camera"] });
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.expect[0].found, false);
});

// ---- mode selection + labels ----------------------------------------------

test("needsBrowser: only fill/click force browser mode", () => {
    assert.strictEqual(needsBrowser([{ action: "list", expect: ["x"] }]), false);
    assert.strictEqual(needsBrowser([{ fill: { a: "b" }, click: "Save" }]), true);
    assert.strictEqual(needsBrowser([{ click: "Delete" }]), true);
});

test("stepLabel: readable one-liners", () => {
    assert.strictEqual(stepLabel({ action: "save", params: { name: "Cam" } }), "action=save?name=Cam");
    assert.strictEqual(stepLabel({ fill: { name: "x" }, click: "Save" }), "fill{name} click \"Save\"");
    assert.strictEqual(stepLabel({ expect: ["x"] }), "assert-only");
});

// ---- runExercise: invalid steps never reach the server ---------------------

test("runExercise: invalid steps return {invalid} without any session use", async () => {
    // session=null — if validation didn't short-circuit, runTest would throw on null.
    const res = await runExercise(null, "PAL-X", { steps: [{}] });
    assert.strictEqual(res.ran, false);
    assert.strictEqual(res.invalid, true);
    assert.ok(res.problems.length);
});

// ---- formatExercise --------------------------------------------------------

test("formatExercise: reports pass/fail, missing strings, surviving absents, renderError", () => {
    const failing = {
        ran: true, kind: "console", mode: "browser", pass: false, failedStep: 2,
        steps: [
            { step: 1, label: "fill{name} click \"Save\"", pass: true, expect: [{ string: "Camera", found: true }], absent: [] },
            { step: 2, label: "click \"Delete\"", pass: false,
              expect: [{ string: "deleted", found: false }],
              absent: [{ string: "Camera", absent: false }],
              renderError: { message: "NullPointerException: rec is null", workflow: "equipment.js", line: "42" } }
        ]
    };
    const out = formatExercise(failing);
    assert.match(out, /FAIL at step 2/);
    assert.match(out, /✓ step 1/);
    assert.match(out, /expect "deleted": MISSING/);
    assert.match(out, /absent "Camera": STILL PRESENT/);
    assert.match(out, /renderError: NullPointerException.*equipment\.js:42/);
    assert.match(out, /Later steps were not run/);

    const invalid = formatExercise({ ran: false, invalid: true, problems: ["step 1 does nothing"] });
    assert.match(invalid, /invalid steps/);

    const passing = formatExercise({ ran: true, kind: "web", mode: "fetch", pass: true,
        steps: [{ step: 1, label: "action=list", pass: true, expect: [{ string: "Camera", found: true }], absent: [] }] });
    assert.match(passing, /PASS/);
    assert.match(passing, /expect "Camera": found/);
});
