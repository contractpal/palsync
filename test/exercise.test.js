"use strict";
// pal_exercise — the functional layer above compile (pal_test) and render (pal_screenshot):
// trigger an action, assert expect/absent strings in the rendered result. These tests cover the
// pure, server-free parts: step validation, the expect/absent assertion, labels, mode selection,
// the report format, and the no-server invalid path of runExercise.
const { test } = require("node:test");
const assert = require("node:assert");
const { runExercise, validateSteps, checkStep, checkBrowserStep, stepLabel, needsBrowser, formatExercise, applyRunId, resolveClickTarget, MAX_STEPS } = require("../src/core/exercise");

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
    assert.ok(validateSteps([{ within: "tr" }]).some(p => /within but no click/.test(p)));
    assert.ok(validateSteps([{ click: "Save", within: "" }]).some(p => /within must be/.test(p)));
});

test("validateSteps: invalid click guidance points to within scoping", () => {
    assert.ok(validateSteps([{ click: "" }]).some(p => /if text appears more than once.*within/.test(p)));
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

test("checkBrowserStep: input value markup is diagnostic, not a visible PASS", () => {
    const r = checkBrowserStep(
        "Add equipment\nSave\nCancel",
        '<input name="name" value="Camera run123"/>',
        { expect: ["Camera run123"] }
    );
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.expect[0].found, false);
    assert.strictEqual(r.expect[0].markupOnly, true);
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
    assert.strictEqual(stepLabel({ click: "Check out", within: 'tr:has-text("Camera")' }), 'click "Check out" within "tr:has-text(\\"Camera\\")"');
    assert.strictEqual(stepLabel({ expect: ["x"] }), "assert-only");
});

test("resolveClickTarget: duplicate labels fail instead of silently clicking the first", async () => {
    const duplicate = { async count() { return 2; }, first() { return this; } };
    const pg = { getByText() { return duplicate; } };
    const out = await resolveClickTarget(pg, { click: "Check out" });
    assert.match(out.error, /ambiguous \(matched 2 elements\)/);
    assert.match(out.error, /within/);
    assert.match(out.error, /data-label/,
        "the error should suggest scoping a row through its identifying cell");
    assert.match(out.error, /:has-text/,
        "the error should include an actionable Playwright selector pattern");
});

test("resolveClickTarget: within scopes a repeated action to one record", async () => {
    let clicked = false;
    const target = { async count() { return 1; }, first() { return this; }, async click() { clicked = true; } };
    const scope = { getByText(text, opts) { assert.equal(text, "Check out"); assert.equal(opts.exact, true); return target; } };
    const scopes = { async count() { return 1; }, first() { return scope; } };
    const pg = { locator(sel) { assert.equal(sel, 'tr:has-text("Camera run123")'); return scopes; } };
    const out = await resolveClickTarget(pg, { click: "Check out", within: 'tr:has-text("Camera run123")' });
    assert.ok(out.locator);
    await out.locator.click();
    assert.equal(clicked, true);
});

test("applyRunId: substitutes {{runId}} deeply without touching the original steps", () => {
    const steps = [{
        action: "create",
        params: { name: "Camera {{runId}}", nested: ["tag-{{runId}}"] },
        fill: { search: "Camera {{runId}}" },
        expect: ["Camera {{runId}}"],
        absent: ["old-{{runId}}"]
    }];
    const out = applyRunId(steps, "run123");
    assert.deepStrictEqual(out, [{
        action: "create",
        params: { name: "Camera run123", nested: ["tag-run123"] },
        fill: { search: "Camera run123" },
        expect: ["Camera run123"],
        absent: ["old-run123"]
    }]);
    assert.strictEqual(steps[0].params.name, "Camera {{runId}}");
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

test("formatExercise: reports visible assertions, markup-only clues, screen hints, and renderError", () => {
    const failing = {
        ran: true, kind: "console", mode: "browser", pass: false, failedStep: 2,
        steps: [
            { step: 1, label: "fill{name} click \"Save\"", pass: true, expect: [{ string: "Camera", found: true }], absent: [] },
            { step: 2, label: "click \"Delete\"", pass: false,
              expect: [{ string: "deleted", found: false, markupOnly: true }],
              absent: [{ string: "Camera", absent: false }],
              hints: { headings: ["Edit equipment"], clicks: ["Save"], ids: ["#nameInput"], fields: ["name"] },
              renderError: { message: "NullPointerException: rec is null", workflow: "equipment.js", line: "42" } }
        ]
    };
    const out = formatExercise(failing);
    assert.match(out, /FAIL at step 2/);
    assert.match(out, /✓ step 1/);
    assert.match(out, /expect "deleted": MISSING from visible text \(string exists only in markup \(e\.g\. input value attribute\)/);
    assert.match(out, /absent "Camera": STILL PRESENT/);
    assert.match(out, /headings: "Edit equipment"/);
    assert.match(out, /Push again only after editing a pal file/);
    assert.match(out, /renderError: NullPointerException.*equipment\.js:42/);
    assert.match(out, /Later steps were not run/);

    const invalid = formatExercise({ ran: false, invalid: true, problems: ["step 1 does nothing"] });
    assert.match(invalid, /invalid steps/);

    const passing = formatExercise({ ran: true, kind: "web", mode: "fetch", pass: true, runId: "run123",
        steps: [{ step: 1, label: "action=list", pass: true, expect: [{ string: "Camera", found: true }], absent: [] }] });
    assert.match(passing, /PASS/);
    assert.match(passing, /runId: run123/);
    assert.match(passing, /expect "Camera": found/);
});
