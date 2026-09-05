"use strict";
// A console action can no longer be represented-but-not-executed, and no step runs until the
// browser has positively reached the requested initial state.

const { test, describe } = require("node:test");
const assert = require("node:assert");
const { runExercise, validateInitial, webInitialPath, formatExercise } = require("../src/core/exercise");

function fakePage({ url = "https://cp.test/console", text = "", headings = [] } = {}) {
    return {
        _url: url,
        on() {},
        url() { return this._url; },
        async innerText() { return text; },
        async content() { return "<body>" + text + "</body>"; },
        async screenshot() { return Buffer.from("img"); },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {},
        locator() { return { async count() { return 1; }, first() { return this; }, async click() {}, async ariaSnapshot() { return "body"; } }; },
        getByText() { return { async count() { return 1; }, first() { return this; }, async click() {} }; },
        async fill() {},
        async evaluate(fn) { return String(fn).includes("role='heading'") ? { title: "Console", headings } : {}; }
    };
}

function deps({ page, kind = "console", tests }) {
    const gotoCalls = [];
    const state = { gotoCalls, released: 0, testsCalled: 0 };
    state.deps = {
        runTest: async () => {
            state.testsCalled++;
            return typeof tests === "function" ? tests() : { ran: true, validated: true, kind, _previewUrl: "https://cp.test/t.do?cp-auth=S", rawToken: "https://web.test/abc/" };
        },
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => ({ newPage: async () => page, close: async () => {} }) }),
        releaseBrowser: () => { state.released++; },
        wait: async () => {},
        waitForRenderablePage: async (pg, url) => { gotoCalls.push(url); }
    };
    return state;
}

describe("console actions cannot be silently ignored", () => {
    for (const step of [
        { action: "openClientSetup", fill: { name: "x" }, expect: ["ok"] },
        { action: "openClientSetup", click: "Save", expect: ["ok"] },
        { page: "somewhere", click: "Save", expect: ["ok"] }
    ]) {
        test("a console step carrying " + Object.keys(step).filter(k => k === "action" || k === "page") + " is REJECTED", async () => {
            const h = deps({ page: fakePage({ text: "ok" }) });
            const res = await runExercise(null, "g", { steps: [step], workflow: "console" }, h.deps);
            assert.strictEqual(res.status, "invalid");
            assert.match(res.problems[0], /step 1 carries action\/page/);
            assert.match(res.problems[0], /initial/);
            assert.strictEqual(h.gotoCalls.length, 0, "nothing was navigated or dispatched");
        });
    }

    test("the same steps stay valid on a WEB pal", async () => {
        const h = deps({ page: fakePage({ text: "ok" }), kind: "web" });
        const res = await runExercise(null, "g", {
            steps: [{ action: "saveThing", params: { id: 1 }, click: "Save", expect: ["ok"] }], workflow: "web"
        }, h.deps);
        assert.notStrictEqual(res.status, "invalid");
    });

    test("initial.page is rejected on a console pal", async () => {
        const h = deps({ page: fakePage({ text: "ok" }) });
        const res = await runExercise(null, "g", { steps: [{ expect: ["ok"] }], initial: { page: "x", expect: ["ok"] }, workflow: "console" }, h.deps);
        assert.strictEqual(res.status, "invalid");
        assert.match(res.problems[0], /initial\.action/);
    });
});

describe("initial target establishment", () => {
    test("the console initial action is dispatched ONCE before step 1", async () => {
        const h = deps({ page: fakePage({ text: "Client Setup Step 8 saved", headings: ["Client Setup"] }) });
        const res = await runExercise(null, "g", {
            steps: [{ click: "Save", expect: ["saved"] }],
            initial: { action: "openClientSetup", params: { id: 9 }, expect: ["Client Setup", "Step 8"] },
            workflow: "console"
        }, h.deps);
        assert.strictEqual(res.status, "passed", JSON.stringify(res));
        assert.strictEqual(h.gotoCalls.length, 1);
        assert.strictEqual(new URL(h.gotoCalls[0]).searchParams.get("cp-ws-doaction"), "openClientSetup?id=9");
    });

    test("steps do NOT run when the initial state is not reached", async () => {
        const h = deps({ page: fakePage({ text: "Add Client Step 1", headings: ["Add Client"] }) });
        const res = await runExercise(null, "g", {
            steps: [{ click: "Delete", within: "tr:has-text(\"{{runId}}\")", expect: ["gone"] }],
            initial: { action: "openClientSetup", params: { id: 9 }, expect: ["Client Setup", "Step 8"] },
            workflow: "console"
        }, h.deps);
        assert.strictEqual(res.status, "failed");
        assert.strictEqual(res.category, "targeting");
        assert.strictEqual(res.code, "initial-state-not-reached");
        assert.strictEqual(res.stateVerified, false);
        assert.deepStrictEqual(res.steps, [], "no step ran");
        // The cp-ws-doaction navigation WAS issued before the wrong screen rendered, so the action
        // may have executed — the result must never claim pre-mutation safety.
        assert.strictEqual(res.potentialMutationStarted, true);
        assert.deepStrictEqual(res.requestedState.paramKeys, ["id"]);
        assert.deepStrictEqual(res.observedState.headings, ["Add Client"]);
        const report = formatExercise(res);
        assert.match(report, /TARGETING FAIL/);
        assert.match(report, /NO exercise step ran/);
        assert.match(report, /may already have executed/);
        assert.ok(!/nothing was mutated/.test(report));
        assert.ok(!/PASS/.test(report));
    });

    test("an initial action conflicting with initial params is rejected before any browser work", async () => {
        const h = deps({ page: fakePage({ text: "ok" }) });
        const res = await runExercise(null, "g", {
            steps: [{ expect: ["ok"] }], initial: { action: "openClient?id=9", params: { id: 10 }, expect: ["ok"] }, workflow: "console"
        }, h.deps);
        assert.strictEqual(res.status, "invalid");
        assert.match(res.problems[0], /initial: Param "id"/);
        assert.strictEqual(h.gotoCalls.length, 0);
    });

    test("{{runId}} is substituted into initial params", async () => {
        const h = deps({ page: fakePage({ text: "ok", headings: [] }) });
        const res = await runExercise(null, "g", {
            // expect "ok" proves the substituted initial state actually landed (the fake page
            // renders it), instead of relying on the old stateVerified:null "not proven" pass.
            steps: [{ expect: ["ok"] }], initial: { action: "find", params: { q: "Rec {{runId}}" }, expect: ["ok"] }, workflow: "console"
        }, h.deps);
        assert.strictEqual(res.status, "passed");
        const dispatched = new URL(h.gotoCalls[0]).searchParams.get("cp-ws-doaction");
        assert.ok(dispatched.includes(res.runId), dispatched);
        assert.ok(!dispatched.includes("{{runId}}"));
    });
});

describe("initial state on WEB", () => {
    test("fetch mode verifies the initial route before running steps", async () => {
        const fetched = [];
        const preview = require("../src/core/preview");
        const original = preview.openInstanceSessionFromTest;
        preview.openInstanceSessionFromTest = async () => ({
            opened: true, base: "https://web.test/abc/",
            async fetchPath(p) { fetched.push(p); return { status: 200, html: "<h1>Equipment List</h1>", title: "Equipment" }; }
        });
        try {
            const h = deps({ page: fakePage({}), kind: "web" });
            const res = await runExercise(null, "g", {
                steps: [{ expect: ["Equipment List"] }],
                initial: { page: "equipment.pal", expect: ["Equipment List"] }, workflow: "web"
            }, h.deps);
            assert.strictEqual(res.mode, "fetch");
            assert.strictEqual(res.status, "passed");
            assert.strictEqual(fetched[0], "equipment.pal");
        } finally { preview.openInstanceSessionFromTest = original; }
    });

    test("fetch mode fails targeting when the initial route is wrong", async () => {
        const preview = require("../src/core/preview");
        const original = preview.openInstanceSessionFromTest;
        preview.openInstanceSessionFromTest = async () => ({
            opened: true, base: "https://web.test/abc/",
            async fetchPath() { return { status: 200, html: "<h1>Home</h1>", title: "Home" }; }
        });
        try {
            const h = deps({ page: fakePage({}), kind: "web" });
            const res = await runExercise(null, "g", {
                steps: [{ expect: ["Equipment List"] }],
                initial: { page: "equipment.pal", expect: ["Equipment List"] }, workflow: "web"
            }, h.deps);
            assert.strictEqual(res.category, "targeting");
            assert.deepStrictEqual(res.steps, []);
            // A page-only initial is a pure route fetch — no action was ever dispatched, so the
            // failure provably mutated nothing.
            assert.strictEqual(res.potentialMutationStarted, false);
            const report = formatExercise(res);
            assert.match(report, /no mutation-capable action was dispatched/);
        } finally { preview.openInstanceSessionFromTest = original; }
    });

    test("browser:true forces a real browser for a WEB pal with no fill/click", async () => {
        const h = deps({ page: fakePage({ url: "https://web.test/abc/index.html", text: "Equipment List" }), kind: "web" });
        const res = await runExercise(null, "g", {
            steps: [{ expect: ["Equipment List"] }], workflow: "web", browser: true
        }, h.deps);
        assert.strictEqual(res.mode, "browser");
        assert.strictEqual(res.status, "passed");
    });

    test("the WEB initial target keeps the documented plain-link ?action= form", () => {
        assert.strictEqual(
            webInitialPath({ page: "list.pal", target: { action: "openThing", params: { id: "9" } } }),
            "list.pal?action=openThing&id=9");
    });

    test("a WEB initial action failure is never replayed (afterLanding mutation boundary)", async () => {
        const h = deps({ page: fakePage({ url: "https://web.test/abc/index.html", text: "Equipment List" }), kind: "web" });
        let calls = 0;
        h.deps.waitForRenderablePage = async (_pg, url) => {
            calls++;
            if (calls === 2 && String(url).includes("?action=openThing")) {
                // Call 1 (the token bootstrap) succeeded; call 2 is the action-bearing afterLanding
                // navigation — the mutation itself. Record its URL, then fail it.
                h.gotoCalls.push(url);
                throw new Error("action navigation boom");
            }
            h.gotoCalls.push(url);
        };
        const res = await runExercise(null, "g", {
            steps: [{ expect: ["Equipment List"] }],
            initial: { action: "openThing", params: { id: 9 }, expect: ["Equipment List"] },
            workflow: "web", browser: true
        }, h.deps);
        assert.strictEqual(res.status, "blocked");
        assert.strictEqual(res.category, "navigation");
        assert.strictEqual(h.testsCalled, 1, "an action-bearing failure must never be replayed");
        assert.strictEqual(h.gotoCalls.filter(u => String(u).includes("?action=openThing")).length, 1, "the action-bearing navigation was issued exactly once");
        assert.strictEqual(res.retryAttempted, false);
        assert.strictEqual(res.potentialMutationStarted, true);
    });

    test("a pre-action WEB initial page failure stays retryable (fresh test, then passes)", async () => {
        const h = deps({ page: fakePage({ url: "https://web.test/abc/index.html", text: "Equipment List" }), kind: "web" });
        let calls = 0;
        h.deps.waitForRenderablePage = async (_pg, url) => {
            calls++;
            // Attempt 1: token bootstrap ok (call 1); the page-only afterLanding navigation throws
            // (call 2) — provably pre-action, so one retry against a fresh test instance is allowed.
            // Attempt 2 (calls 3-4) succeeds end to end.
            if (calls === 2) throw new Error("page navigation boom on first attempt");
            h.gotoCalls.push(url);
        };
        const res = await runExercise(null, "g", {
            steps: [{ expect: ["Equipment List"] }],
            initial: { page: "equipment.pal", expect: ["Equipment List"] },
            workflow: "web", browser: true
        }, h.deps);
        assert.strictEqual(res.status, "passed");
        assert.strictEqual(res.retryAttempted, true);
        assert.strictEqual(h.testsCalled, 2, "a provably pre-action failure mints a fresh test instance");
        assert.strictEqual(res.potentialMutationStarted, false, "no mutation-capable dispatch ever happened");
        assert.ok(h.gotoCalls.some(u => String(u).endsWith("equipment.pal")), "the retry re-issued the page navigation");
    });

    test("WEB targeting failure after a successful action navigation is not pre-mutation", async () => {
        const h = deps({ page: fakePage({ url: "https://web.test/abc/index.html", text: "Home", headings: ["Home"] }), kind: "web" });
        const res = await runExercise(null, "g", {
            steps: [{ expect: ["Equipment List"] }],
            initial: { action: "openThing", params: { id: 9 }, expect: ["Equipment List"] },
            workflow: "web", browser: true
        }, h.deps);
        assert.strictEqual(res.category, "targeting");
        assert.strictEqual(res.code, "initial-state-not-reached");
        assert.deepStrictEqual(res.steps, []);
        // The ?action= afterLanding navigation WAS issued and landed before the wrong screen
        // rendered — the action may already have executed.
        assert.strictEqual(res.potentialMutationStarted, true);
        const report = formatExercise(res);
        assert.match(report, /may already have executed/);
        assert.ok(!/nothing was mutated/.test(report));
    });
});

describe("initial request validation", () => {
    test("shape errors are reported, not guessed around", () => {
        assert.deepStrictEqual(validateInitial(undefined), []);
        assert.match(validateInitial({ expect: "x" })[0], /initial\.expect/);
        assert.match(validateInitial({ nope: 1 })[0], /unknown key/);
        assert.match(validateInitial({})[0], /initial does nothing/);
        assert.match(validateInitial({ action: "" })[0], /initial\.action/);
    });

    test("a targeted initial (action or page) requires a non-empty expect proving that screen", () => {
        const invalid = (initial) => {
            const errs = validateInitial(initial);
            assert.strictEqual(errs.length, 1, JSON.stringify(initial) + " must fail with exactly the expect error");
            assert.match(errs[0], /initial\.expect/);
        };
        invalid({ action: "openX" });
        invalid({ page: "list.pal" });
        invalid({ action: "openX", expect: ["   "] }); // whitespace-only strings prove nothing
        assert.deepStrictEqual(validateInitial({ action: "openX", expect: ["Setup"] }), []);
        assert.deepStrictEqual(validateInitial({ page: "list.pal", expect: ["Items"] }), []);
        // Expect-only initials stay valid — they verify the pal's default screen, which needs no
        // targeting navigation.
        assert.deepStrictEqual(validateInitial({ expect: ["Home"] }), []);
    });

    test("a targeted initial without expect is rejected before any Test/browser work", async () => {
        const h = deps({ page: fakePage({ text: "ok" }) });
        const res = await runExercise(null, "g", {
            steps: [{ expect: ["ok"] }], initial: { action: "openX" }, workflow: "console"
        }, h.deps);
        assert.strictEqual(res.status, "invalid");
        assert.match(res.problems[0], /initial\.expect/);
        assert.strictEqual(h.testsCalled, 0, "the Test instance must never be minted");
        assert.strictEqual(h.gotoCalls.length, 0, "nothing was navigated or dispatched");
    });
});
