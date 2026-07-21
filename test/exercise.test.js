"use strict";
// pal_exercise — the functional layer above compile (pal_test) and render (pal_screenshot):
// trigger an action, assert expect/absent strings in the rendered result. These tests cover the
// pure, server-free parts: step validation, the expect/absent assertion, labels, mode selection,
// the report format, and the no-server invalid path of runExercise.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { tmpWorkspace } = require("./helpers");
const usage = require("../src/core/usage");
const { runExercise, validateSteps, lintSteps, checkStep, checkBrowserStep, stepLabel, needsBrowser, formatExercise, applyRunId, resolveClickTarget, browserFailureMessage, MAX_STEPS } = require("../src/core/exercise");

function loadStubbedTools({ exerciseResult, pushResult }) {
    const toolsPath = require.resolve("../src/mcp/tools");
    const exercisePath = require.resolve("../src/core/exercise");
    const pushPath = require.resolve("../src/core/push");
    const saved = new Map([[toolsPath, require.cache[toolsPath]], [exercisePath, require.cache[exercisePath]], [pushPath, require.cache[pushPath]]]);
    require.cache[exercisePath] = { id: exercisePath, filename: exercisePath, loaded: true, exports: {
        runExercise: async () => Object.assign({}, exerciseResult),
        formatExercise: result => result.pass ? "pal_exercise — PASS" : "pal_exercise — FAIL"
    } };
    require.cache[pushPath] = { id: pushPath, filename: pushPath, loaded: true, exports: {
        push: async (session, record) => {
            const result = Object.assign({}, pushResult);
            if (result.pushed && result.newMarker) record.lastModifiedDate = result.newMarker;
            return result;
        }
    } };
    delete require.cache[toolsPath];
    const loaded = require("../src/mcp/tools");
    return {
        tools: loaded.TOOLS,
        restore() {
            for (const [file, cached] of saved) {
                if (cached) require.cache[file] = cached;
                else delete require.cache[file];
            }
        }
    };
}

function findTool(tools, name) {
    const found = tools.find(tool => tool.name === name);
    assert.ok(found, "missing tool " + name);
    return found;
}

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
    assert.strictEqual(r.absent[0].occurrences, 1);
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

test("runExercise: lint errors short-circuit before session use", async () => {
    // session=null — would throw if the linter didn't reject the ambiguous click first.
    const res = await runExercise(null, "PAL-X", { steps: [{ click: "Delete" }] });
    assert.strictEqual(res.ran, false);
    assert.strictEqual(res.invalid, true);
    assert.ok(res.problems.some(p => /appears in every row/.test(p)));
});

// ---- formatExercise --------------------------------------------------------

test("formatExercise: reports visible assertions, markup-only clues, screen hints, and renderError", () => {
    const failing = {
        ran: true, kind: "console", mode: "browser", pass: false, failedStep: 2,
        steps: [
            { step: 1, label: "fill{name} click \"Save\"", pass: true, expect: [{ string: "Camera", found: true }], absent: [] },
            { step: 2, label: "click \"Delete\"", pass: false,
              expect: [{ string: "deleted", found: false, markupOnly: true }],
              absent: [{ string: "Camera", absent: false, occurrences: 2 }],
              hints: { headings: ["Edit equipment"], clicks: ["Save"], ids: ["#nameInput"], fields: ["name"] },
              renderError: { message: "NullPointerException: rec is null", workflow: "equipment.js", line: "42" } }
        ]
    };
    const out = formatExercise(failing);
    assert.match(out, /FAIL at step 2/);
    assert.match(out, /✓ step 1/);
    assert.match(out, /expect "deleted": MISSING from visible text \(string exists only in markup \(e\.g\. input value attribute\)/);
    assert.match(out, /absent "Camera": STILL PRESENT/);
    assert.match(out, /"Camera" appears 2 times on this page.*scope with `within:`.*unique \{\{runId\}\}/);
    assert.match(out, /headings: "Edit equipment"/);
    assert.match(out, /read the local page\/fragment markup/);
    assert.match(out, /revise the steps and call again without pushing/);
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

// ---- lintSteps -------------------------------------------------------------

test("lintSteps: warns on global absent status words against multi-row lists", () => {
    const r = lintSteps([{ absent: ["Delete"], expect: ["x"] }]);
    assert.ok(r.warnings.some(w => /absent check.*status word.*Delete.*within/.test(w)), r.warnings.join("; "));
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: scoped absent status word passes", () => {
    const r = lintSteps([{ within: 'tr:has([data-label="Name"]:has-text("{{runId}}"))', absent: ["Delete"], expect: ["x"] }]);
    assert.strictEqual(r.warnings.length, 0);
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: rejects duplicate row-action clicks without within", () => {
    const r = lintSteps([{ click: "Delete" }]);
    assert.ok(r.errors.some(e => /Delete.*appears in every row/.test(e)), r.errors.join("; "));
    assert.match(r.errors.join("; "), /within: 'tr:has\(\[data-label="Name"\]:has-text\("\{\{runId\}\}"\)\)'/);
    assert.strictEqual(r.warnings.length, 0);
});

test("lintSteps: scoped duplicate row-action click passes", () => {
    const r = lintSteps([{ click: "Delete", within: 'tr:has([data-label="Name"]:has-text("{{runId}}"))' }]);
    assert.strictEqual(r.errors.length, 0);
    assert.strictEqual(r.warnings.length, 0);
});

test("lintSteps: warns when expecting a just-deleted runId value", () => {
    const r = lintSteps([
        { click: "Delete", within: 'tr:has-text("Camera {{runId}}")' },
        { expect: ["Camera {{runId}}"] }
    ]);
    assert.ok(r.warnings.some(w => /after a delete step.*\{\{runId\}\}/.test(w)), r.warnings.join("; "));
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: non-runId delete scope warns but does not trigger deleted-runId guidance", () => {
    const r = lintSteps([
        { click: "Delete", within: 'tr:has-text("Camera")' },
        { expect: ["Camera {{runId}}"] }
    ]);
    assert.ok(r.warnings.some(w => /within.*without \{\{runId\}\}/.test(w)), r.warnings.join("; "));
    assert.ok(!r.warnings.some(w => /after a delete step/.test(w)), r.warnings.join("; "));
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: rejects nth selectors for record actions", () => {
    const r = lintSteps([{ click: "Delete", within: "tr:nth-child(2)" }]);
    assert.ok(r.errors.some(e => /nth.*positional.*unique row selector/.test(e)), r.errors.join("; "));
});

test("lintSteps: unique row selector for record action passes", () => {
    const r = lintSteps([{ click: "Delete", within: 'tr:has([data-label="Name"]:has-text("{{runId}}"))' }]);
    assert.strictEqual(r.errors.length, 0);
    assert.strictEqual(r.warnings.length, 0);
});

test("lintSteps: warns when expecting a typed value as visible text", () => {
    const r = lintSteps([{ fill: { name: "Camera" }, expect: ["Camera"] }]);
    assert.ok(r.warnings.some(w => /typed into an input.*visible rendered text/.test(w)), r.warnings.join("; "));
    assert.match(r.warnings.join("; "), /full unique old\/new values/);
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: fill + save + expect passes", () => {
    const r = lintSteps([{ fill: { name: "Camera" }, click: "Save", expect: ["Camera"] }]);
    assert.strictEqual(r.warnings.length, 0);
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: warns on shared-name has-text scope with canonical replacement", () => {
    const r = lintSteps([{ click: "Edit", within: 'tr:has-text("Camera")' }]);
    assert.match(r.warnings.join("; "), /within: 'tr:has\(\[data-label="Name"\]:has-text\("\{\{runId\}\}"\)\)'/);
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: shared-name warning notes an available runId fill", () => {
    const r = lintSteps([
        { fill: { name: "Camera {{runId}}" }, click: "Save" },
        { click: "Edit", within: 'tr:has-text("Camera")' }
    ]);
    assert.ok(r.warnings.some(w => /exercise fills a \{\{runId\}\} value/.test(w)), r.warnings.join("; "));
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: runId has-text and non-text selectors do not warn", () => {
    const runId = lintSteps([{ click: "Edit", within: 'tr:has-text("Camera {{runId}}")' }]);
    const css = lintSteps([{ click: "Edit", within: 'tr[data-record-id="42"]' }]);
    assert.strictEqual(runId.warnings.length, 0);
    assert.strictEqual(css.warnings.length, 0);
});

test("lintSteps: rejects absent substring of same-step expectation", () => {
    const r = lintSteps([{ expect: ["EditTest {{runId}} Changed"], absent: ["EditTest {{runId}}"] }]);
    assert.ok(r.errors.some(e => /substring.*cannot pass.*full unique old\/new values/.test(e)), r.errors.join("; "));
});

test("lintSteps: rejects absent substring of current or earlier fill", () => {
    const current = lintSteps([{ fill: { name: "EditTest Changed" }, absent: ["EditTest"] }]);
    const earlier = lintSteps([{ fill: { name: "EditTest Changed" }, click: "Save" }, { absent: ["EditTest"] }]);
    assert.ok(current.errors.some(e => /substring/.test(e)), current.errors.join("; "));
    assert.ok(earlier.errors.some(e => /substring/.test(e)), earlier.errors.join("; "));
});

test("lintSteps: distinct, equal, and reverse-substring assertions do not collide", () => {
    const distinct = lintSteps([{ expect: ["New {{runId}}"], absent: ["Old {{runId}}"] }]);
    const equal = lintSteps([{ expect: ["Same {{runId}}"], absent: ["Same {{runId}}"] }]);
    const reverse = lintSteps([{ expect: ["EditTest"], absent: ["EditTest Changed"] }]);
    assert.strictEqual(distinct.errors.length, 0);
    assert.strictEqual(equal.errors.length, 0);
    assert.strictEqual(reverse.errors.length, 0);
});

test("lintSteps: warns on global empty-state expect and absent", () => {
    const expected = lintSteps([{ expect: ["No equipment yet"] }]);
    const absent = lintSteps([{ absent: ["No records found"] }]);
    assert.ok(expected.warnings.some(w => /global empty-state assertion.*unique \{\{runId\}\}/.test(w)), expected.warnings.join("; "));
    assert.ok(absent.warnings.some(w => /global empty-state assertion.*unique \{\{runId\}\}/.test(w)), absent.warnings.join("; "));
});

test("lintSteps: scoped empty-state and ordinary copy do not warn", () => {
    const scoped = lintSteps([{ within: "#empty-state", expect: ["No equipment yet"] }]);
    const ordinary = lintSteps([{ expect: ["Nobody is assigned"] }]);
    assert.strictEqual(scoped.warnings.length, 0);
    assert.strictEqual(ordinary.warnings.length, 0);
});

// ---- lintSteps regressions (T4 false-positive fixes) -----------------------

test("lintSteps: status word substring does not warn", () => {
    const r = lintSteps([{ absent: ["Deleted"], expect: ["x"] }]);
    assert.strictEqual(r.warnings.length, 0);
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: multi-word status word matched whole", () => {
    const r = lintSteps([{ absent: ["Please Check out"], expect: ["x"] }]);
    assert.ok(r.warnings.some(w => /status word.*Check out/.test(w)), r.warnings.join("; "));
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: conjugated multi-word status word does not warn", () => {
    const r = lintSteps([{ absent: ["Checkout"], expect: ["x"] }]);
    assert.strictEqual(r.warnings.length, 0);
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: allows nth selector beneath a unique row scope", () => {
    const r = lintSteps([{ click: "Delete", within: 'tr:has-text("Camera {{runId}}") > td:nth-child(2)' }]);
    assert.strictEqual(r.errors.length, 0);
    assert.strictEqual(r.warnings.length, 0);
});

test("lintSteps: still rejects nth selector without unique row scope", () => {
    const r = lintSteps([{ click: "Delete", within: 'tr:has-text("Camera") > td:nth-child(2)' }]);
    assert.ok(r.errors.some(e => /nth.*positional.*unique row selector/.test(e)), r.errors.join("; "));
});

test("lintSteps: delete stickiness cleared by re-adding runId value", () => {
    const r = lintSteps([
        { click: "Delete", within: 'tr:has-text("Camera {{runId}}")' },
        { click: "Add" },
        { fill: { name: "Camera {{runId}}" } },
        { expect: ["Camera {{runId}}"] }
    ]);
    assert.strictEqual(r.warnings.length, 0);
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: typed value substring does not warn", () => {
    const r = lintSteps([{ fill: { name: "Cam" }, expect: ["Camera"] }]);
    assert.strictEqual(r.warnings.length, 0);
    assert.strictEqual(r.errors.length, 0);
});

test("lintSteps: typed value superstring does not warn", () => {
    const r = lintSteps([{ fill: { name: "Camera" }, expect: ["Cam"] }]);
    assert.strictEqual(r.warnings.length, 0);
    assert.strictEqual(r.errors.length, 0);
});

// ---- resolveClickTarget within candidates ----------------------------------

function makeMockPageWithTable() {
    const vm = require("node:vm");
    const tags = new Set(["tr", "li"]);
    function makeEl(tag, text, children = []) {
        const el = { tag, children: children.slice(), parentElement: null, textContent: "" };
        el.closest = (selectors) => {
            const want = new Set(selectors.split(",").map(s => s.trim().split(/[:\[]/)[0]).filter(Boolean));
            let p = el;
            while (p) { if (want.has(p.tag)) return p; p = p.parentElement; }
            return p;
        };
        for (const c of el.children) c.parentElement = el;
        if (text && children.length === 0) el.textContent = text;
        else el.textContent = children.map(c => c.textContent).join(" ");
        return el;
    }
    function markLeaves(el) {
        if (el.children.length === 0) el.isText = true;
        for (const c of el.children) markLeaves(c);
    }
    function all(el) { const out = [el]; for (const c of el.children) out.push(...all(c)); return out; }
    const root = makeEl("body", "", [
        makeEl("table", "", [
            makeEl("tr", "", [
                makeEl("td", "", [makeEl("span", "Camera run123")]),
                makeEl("td", "", [makeEl("button", "Delete")])
            ]),
            makeEl("tr", "", [
                makeEl("td", "", [makeEl("span", "Projector run123")]),
                makeEl("td", "", [makeEl("button", "Delete")])
            ])
        ])
    ]);
    markLeaves(root);
    root.querySelectorAll = () => all(root);
    const dom = {
        root,
        NodeFilter: { SHOW_TEXT: 4 },
        createTreeWalker: (r) => ({
            nodes: (function collect(el) {
                let arr = [];
                if (el.isText) arr.push({ textContent: el.textContent });
                for (const c of el.children) arr = arr.concat(collect(c));
                return arr;
            })(r),
            i: 0,
            nextNode() { return this.nodes[this.i++] || null; }
        })
    };
    dom.body = root; // Page.evaluate has no element root; the callback must reach the DOM via document.body.
    return {
        getByText: () => ({ async count() { return 2; }, first() { return this; } }),
        // Faithful to Playwright Page.evaluate(fn, arg): the callback receives arg as its ONLY
        // argument (Locator.evaluate is the one that prepends the element).
        evaluate: (fn, arg) => {
            const ctx = {
                clickText: arg, document: dom, NodeFilter: dom.NodeFilter,
                Array, String, JSON, Math, RegExp, parseInt, parseFloat, isNaN, isFinite
            };
            return vm.runInNewContext(`(${fn.toString()})(clickText)`, ctx);
        }
    };
}

test("resolveClickTarget: ambiguous click suggests nearby unique within selectors", async () => {
    const pg = makeMockPageWithTable();
    const out = await resolveClickTarget(pg, { click: "Delete" });
    assert.match(out.error, /ambiguous/);
    assert.match(out.error, /tr:has-text/);
    const hasCandidate = out.error.includes("Camera run123") || out.error.includes("Projector run123");
    assert.ok(hasCandidate, "error should include a nearby unique text candidate: " + out.error);
});

test("resolveClickTarget: missing click reports the exact resolved Playwright locator", async () => {
    const pg = { getByText() { return { async count() { return 0; } }; } };
    const out = await resolveClickTarget(pg, { click: "Save" });
    assert.match(out.error, /resolved Playwright locator: getByText\("Save", \{ exact: true \}\)/);
});

test("browserFailureMessage distinguishes a timed-out login redirect from a genuine timeout", () => {
    const timeout = new Error("page.goto: Timeout 30000ms exceeded.");
    assert.equal(browserFailureMessage(timeout, { url: () => "https://cloud.example/login" }, false, "console"),
        "console session expired / not authenticated — re-auth and retry");
    assert.match(browserFailureMessage(timeout, { url: () => "https://cloud.example/pal/123" }, false, "console"), /Timeout 30000ms exceeded/);
});

// ---- formatExercise warnings -----------------------------------------------

test("formatExercise: reports preflight warnings on passing runs", () => {
    const out = formatExercise({ ran: true, kind: "web", mode: "fetch", pass: true, runId: "run123",
        warnings: ["step 1 absent check on \"Delete\" is brittle on multi-row lists"],
        steps: [{ step: 1, label: "action=list", pass: true, expect: [{ string: "x", found: true }], absent: [] }] });
    assert.match(out, /warnings:/);
    assert.match(out, /brittle/);
});

test("formatExercise: reports warnings alongside invalid steps", () => {
    const out = formatExercise({ ran: false, invalid: true, problems: ["step 1 does nothing"],
        warnings: ["step 1 absent check on \"Delete\" is brittle"] });
    assert.match(out, /invalid steps/);
    assert.match(out, /warnings:/);
    assert.match(out, /brittle/);
});

// ---- shared-handler durable evidence wiring --------------------------------

test("pal_exercise handler records exactly one passing run and no failed run", async () => {
    const ws = tmpWorkspace();
    let loaded = loadStubbedTools({
        exerciseResult: { ran: true, pass: true, runId: "run-1", kind: "console", mode: "browser" }
    });
    try {
        const result = await findTool(loaded.tools, "pal_exercise").run({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", lastModifiedDate: "M1" }
        }, { steps: [{ expect: ["saved"] }] });
        assert.equal(result.pass, true);
        assert.equal(result.evidenceRecorded, true);
        assert.equal(usage.readToolEvidence(ws).length, 1);
        assert.deepEqual(usage.readToolEvidence(ws)[0], {
            schema: "palsync/tool-evidence/1", tool: "pal_exercise", successful: true,
            palGuid: "PAL-1", marker: "M1", ts: usage.readToolEvidence(ws)[0].ts,
            runId: "run-1", kind: "console", mode: "browser"
        });
    } finally { loaded.restore(); }

    loaded = loadStubbedTools({ exerciseResult: { ran: true, pass: false, kind: "console", mode: "browser" } });
    try {
        await findTool(loaded.tools, "pal_exercise").run({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", lastModifiedDate: "M1" }
        }, { steps: [{ expect: ["missing"] }] });
        assert.equal(usage.readToolEvidence(ws).length, 1);
    } finally {
        loaded.restore();
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("pal_exercise evidence failure stays PASS and warns that review will not count it", async () => {
    const ws = tmpWorkspace({ ".palsync": "not a directory" });
    const loaded = loadStubbedTools({
        exerciseResult: { ran: true, pass: true, runId: "run-1", kind: "web", mode: "fetch" }
    });
    try {
        const result = await findTool(loaded.tools, "pal_exercise").run({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", lastModifiedDate: "M1" }
        }, { steps: [{ expect: ["saved"] }] });
        assert.equal(result.pass, true);
        assert.equal(result.evidenceRecorded, false);
        assert.match(result.message, /Behavior passed.*evidence persistence failed.*review check will not count/s);
    } finally {
        loaded.restore();
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("pal_push handler records the persisted new marker and refused pushes record nothing", async () => {
    const ws = tmpWorkspace();
    const success = {
        pushed: true, newMarker: "M2", serverPaths: [], filesPushed: 1,
        lint: { errors: 0, warnings: 0, findings: [], filesChecked: 0 }, validation: []
    };
    let loaded = loadStubbedTools({ pushResult: success });
    let persisted = false;
    try {
        const ctx = {
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" },
            async persist() { persisted = true; assert.equal(this.record.lastModifiedDate, "M2"); }
        };
        const result = await findTool(loaded.tools, "pal_push").run(ctx, {});
        assert.equal(result.pushed, true);
        assert.equal(result.evidenceRecorded, true);
        assert.equal(persisted, true);
        const entries = usage.readToolEvidence(ws);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].tool, "pal_push");
        assert.equal(entries[0].marker, "M2");
    } finally { loaded.restore(); }

    loaded = loadStubbedTools({ pushResult: { pushed: false, refused: "drift", storedMarker: "M1", liveMarker: "M2" } });
    try {
        await findTool(loaded.tools, "pal_push").run({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" },
            async persist() { throw new Error("refused push must not persist"); }
        }, {});
        assert.equal(usage.readToolEvidence(ws).length, 1);
    } finally {
        loaded.restore();
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("pal_push evidence failure stays successful and warns eval telemetry", async () => {
    const ws = tmpWorkspace({ ".palsync": "not a directory" });
    const loaded = loadStubbedTools({ pushResult: {
        pushed: true, newMarker: "M2", serverPaths: [], filesPushed: 1,
        lint: { errors: 0, warnings: 0, findings: [], filesChecked: 0 }, validation: []
    } });
    try {
        const result = await findTool(loaded.tools, "pal_push").run({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" },
            async persist() {}
        }, {});
        assert.equal(result.pushed, true);
        assert.equal(result.evidenceRecorded, false);
        assert.match(result.message, /Push succeeded.*eval evidence persistence failed/s);
    } finally {
        loaded.restore();
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("one passing MCP pal_exercise records one evidence row without usage success double-counting", async () => {
    const ws = tmpWorkspace();
    const loaded = loadStubbedTools({
        exerciseResult: { ran: true, pass: true, runId: "run-mcp", kind: "console", mode: "browser" }
    });
    const serverPath = require.resolve("../src/mcp/server");
    const priorServer = require.cache[serverPath];
    delete require.cache[serverPath];
    try {
        const { createServer } = require("../src/mcp/server");
        const server = createServer(async () => ({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" }
        }), ws);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "evidence-test", version: "0" });
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        await client.callTool({ name: "pal_exercise", arguments: { steps: [{ expect: ["saved"] }] } });
        assert.equal(usage.readToolEvidence(ws).length, 1);
        usage.formatCost(ws, []);
        const ledger = JSON.parse(fs.readFileSync(path.join(ws, usage.USAGE_FILE), "utf8"));
        assert.equal(ledger.tools.pal_exercise.calls, 1);
        assert.equal(ledger.tools.pal_exercise.successfulCalls, undefined);
        await client.close();
    } finally {
        loaded.restore();
        if (priorServer) require.cache[serverPath] = priorServer;
        else delete require.cache[serverPath];
        fs.rmSync(ws, { recursive: true, force: true });
    }
});
