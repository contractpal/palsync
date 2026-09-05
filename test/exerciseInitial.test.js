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
    const state = { gotoCalls, released: 0 };
    state.deps = {
        runTest: async () => (tests ? tests() : { ran: true, validated: true, kind, _previewUrl: "https://cp.test/t.do?cp-auth=S", rawToken: "https://web.test/abc/" }),
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
        const res = await runExercise(null, "g", { steps: [{ expect: ["ok"] }], initial: { page: "x" }, workflow: "console" }, h.deps);
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
        assert.strictEqual(res.potentialMutationStarted, false);
        assert.deepStrictEqual(res.requestedState.paramKeys, ["id"]);
        assert.deepStrictEqual(res.observedState.headings, ["Add Client"]);
        const report = formatExercise(res);
        assert.match(report, /TARGETING FAIL/);
        assert.match(report, /NO step ran/);
        assert.ok(!/PASS/.test(report));
    });

    test("an initial action conflicting with initial params is rejected before any browser work", async () => {
        const h = deps({ page: fakePage({ text: "ok" }) });
        const res = await runExercise(null, "g", {
            steps: [{ expect: ["ok"] }], initial: { action: "openClient?id=9", params: { id: 10 } }, workflow: "console"
        }, h.deps);
        assert.strictEqual(res.status, "invalid");
        assert.match(res.problems[0], /initial: Param "id"/);
        assert.strictEqual(h.gotoCalls.length, 0);
    });

    test("{{runId}} is substituted into initial params", async () => {
        const h = deps({ page: fakePage({ text: "ok", headings: [] }) });
        const res = await runExercise(null, "g", {
            steps: [{ expect: ["ok"] }], initial: { action: "find", params: { q: "Rec {{runId}}" } }, workflow: "console"
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
});

describe("initial request validation", () => {
    test("shape errors are reported, not guessed around", () => {
        assert.deepStrictEqual(validateInitial(undefined), []);
        assert.match(validateInitial({ expect: "x" })[0], /initial\.expect/);
        assert.match(validateInitial({ nope: 1 })[0], /unknown key/);
        assert.match(validateInitial({})[0], /initial does nothing/);
        assert.match(validateInitial({ action: "" })[0], /initial\.action/);
    });
});
