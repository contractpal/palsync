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
const { runExercise, exerciseByBrowser, validateSteps, lintSteps, checkStep, checkBrowserStep, stepLabel, needsBrowser, formatExercise, applyRunId, resolveClickTarget, browserFailureMessage, redactStepValues, redactSecretForms, BROWSER_EVENTS_CAP, MAX_STEPS } = require("../src/core/exercise");
const { waitForRenderablePage } = require("../src/core/browser");

function loadStubbedTools({ exerciseResult, pushResult, screenshotResult, workHistoryModule } = {}) {
    const toolsPath = require.resolve("../src/mcp/tools");
    const exercisePath = require.resolve("../src/core/exercise");
    const pushPath = require.resolve("../src/core/push");
    const screenshotPath = require.resolve("../src/core/screenshot");
    const debugPath = require.resolve("../src/core/debug");
    const workHistoryPath = require.resolve("../src/mcp/workHistory");
    const saved = new Map([[toolsPath, require.cache[toolsPath]], [exercisePath, require.cache[exercisePath]], [pushPath, require.cache[pushPath]], [screenshotPath, require.cache[screenshotPath]], [debugPath, require.cache[debugPath]]]);
    if (workHistoryModule) saved.set(workHistoryPath, require.cache[workHistoryPath]);
    require.cache[exercisePath] = { id: exercisePath, filename: exercisePath, loaded: true, exports: {
        runExercise: async () => Object.assign({}, exerciseResult),
        // formatExercise is pure — keep the real one so handler-level warnings are testable.
        formatExercise,
        // tools.js also imports these for failure-artifact persistence; keep them real.
        applyRunId,
        redactStepValues,
        redactSecretForms
    } };
    require.cache[pushPath] = { id: pushPath, filename: pushPath, loaded: true, exports: {
        push: async (session, record) => {
            const result = Object.assign({}, pushResult);
            if (result.pushed && result.newMarker) record.lastModifiedDate = result.newMarker;
            return result;
        }
    } };
    require.cache[screenshotPath] = { id: screenshotPath, filename: screenshotPath, loaded: true, exports: {
        runScreenshot: async () => Object.assign({}, screenshotResult)
    } };
    // pal_screenshot wraps its result in withServerDebug; keep the stubbed handlers offline.
    require.cache[debugPath] = { id: debugPath, filename: debugPath, loaded: true, exports: {
        retrieveServerDebug: async () => ({ retrieved: false, reason: "stubbed" })
    } };
    if (workHistoryModule) require.cache[workHistoryPath] = { id: workHistoryPath, filename: workHistoryPath, loaded: true, exports: workHistoryModule };
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
    assert.ok(validateSteps([{ click: "Save", expect: [""] }]).some(p => /non-whitespace strings/.test(p)));
    assert.ok(validateSteps([{ click: "Save", expect: [" "] }]).some(p => /non-whitespace strings/.test(p)));
    assert.ok(validateSteps([{ click: "Save", absent: ["   "] }]).some(p => /non-whitespace strings/.test(p)));
    assert.ok(validateSteps([{ click: "Save", expect: "Camera" }]).some(p => /non-whitespace strings/.test(p)));
    assert.ok(validateSteps([{ fill: { a: { nested: true } }, click: "Save" }]).some(p => /string\/number/.test(p)));
    assert.ok(validateSteps([{ within: "tr" }]).some(p => /within but no click/.test(p)));
    assert.ok(validateSteps([{ click: "Save", within: "" }]).some(p => /within must be/.test(p)));
});

test("validateSteps: invalid click guidance points to within scoping", () => {
    assert.ok(validateSteps([{ click: "" }]).some(p => /if text appears more than once.*within/.test(p)));
});

test("render navigation requires domcontentloaded but tolerates networkidle timeout", async () => {
    const seen = [];
    const pg = {
        async goto(_url, options) { seen.push(options.waitUntil); },
        async waitForLoadState(state) { seen.push(state); if (state === "networkidle") throw new Error("long polling"); },
        async waitForFunction() {}, async evaluate() {}, async waitForTimeout() {}
    };
    await waitForRenderablePage(pg, "https://example.test");
    assert.deepEqual(seen, ["domcontentloaded", "load", "networkidle"]);
});

test("browser auth/navigation retries once before mutation and cleans both contexts", async () => {
    let navigations = 0, contexts = 0, closes = 0, releases = 0, tests = 0;
    const page = () => ({
        on() {}, url: () => "https://example.test/app", innerText: async () => "ok", content: async () => "<body>ok</body>"
    });
    const deps = {
        runTest: async () => { tests++; return { ran: true, validated: true, kind: "console", _previewUrl: "https://example.test/app" }; },
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => { contexts++; return { newPage: async () => page(), close: async () => { closes++; } }; } }),
        releaseBrowser: () => { releases++; }, wait: async () => {},
        waitForRenderablePage: async () => { if (++navigations === 1) throw new Error("temporary navigation failure"); }
    };
    const result = await runExercise(null, "PAL-X", { steps: [{ expect: ["ok"] }], workflow: "console" }, deps);
    assert.equal(result.status, "passed");
    assert.equal(result.retryAttempted, true);
    assert.deepEqual({ tests, contexts, closes, releases }, { tests: 2, contexts: 2, closes: 2, releases: 2 });
});

test("second initial navigation failure is blocked after one retry", async () => {
    let tests = 0;
    const result = await runExercise(null, "PAL-X", { steps: [{ fill: { name: "x" } }], workflow: "console" }, {
        runTest: async () => { tests++; return { ran: true, validated: true, kind: "console" }; },
        exerciseByBrowser: async () => ({ status: "blocked", category: "navigation", potentialMutationStarted: false, ran: false, reason: "offline" }),
        wait: async () => {}
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.retryAttempted, true);
    assert.equal(tests, 2);
});

test("post-mutation block and behavior failure are never replayed", async () => {
    for (const outcome of [
        { status: "blocked", category: "navigation", potentialMutationStarted: true, ran: true },
        { status: "failed", category: "behavior", potentialMutationStarted: false, ran: true, pass: false }
    ]) {
        let tests = 0;
        const result = await runExercise(null, "PAL-X", { steps: [{ click: "Save" }], workflow: "console" }, {
            runTest: async () => { tests++; return { ran: true, validated: true, kind: "console" }; },
            exerciseByBrowser: async () => outcome, wait: async () => {}
        });
        assert.equal(result.status, outcome.status);
        assert.equal(result.retryAttempted, false);
        assert.equal(tests, 1);
    }
});

test("exerciseByBrowser bounds navigation/action waits and skips style/font settle", async () => {
    const calls = [];
    const clickTarget = {
        async count() { return 1; },
        first() { return this; },
        async click(options) { calls.push(["click", options]); }
    };
    const pg = {
        on() {},
        url: () => "https://example.test/app",
        async goto(_url, options) { calls.push(["goto", options]); },
        async waitForLoadState(state, options) { calls.push(["waitForLoadState:" + state, options]); },
        async waitForFunction(_fn, arg) { calls.push(["waitForFunction", arg]); },
        async evaluate() { return {}; },
        async waitForTimeout() {},
        locator() { return { async count() { return 1; }, first() { return clickTarget; } }; },
        getByText() { return clickTarget; },
        async fill(_sel, _value, options) { calls.push(["fill", options]); },
        async innerText() { return "saved"; },
        async content() { return "<body>saved</body>"; }
    };
    const browser = { async newContext() { return { async newPage() { return pg; }, async close() {} }; } };
    const res = await exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        [{ fill: { name: "x" }, click: "Save", expect: ["saved"] }],
        undefined,
        { loadChromium: () => ({}), getBrowser: async () => browser, releaseBrowser: () => {} }
    );
    assert.equal(res.status, "passed");
    const gotoOpts = calls.find(c => c[0] === "goto")[1];
    assert.equal(gotoOpts.waitUntil, "domcontentloaded");
    assert.equal(gotoOpts.timeout, 10000, "a single navigation must be time-bounded");
    assert.equal(calls.find(c => c[0] === "waitForLoadState:load")[1].timeout, 5000);
    assert.equal(calls.find(c => c[0] === "waitForLoadState:networkidle")[1].timeout, 3000);
    assert.ok(!calls.some(c => c[0] === "waitForFunction" && c[1] === null),
        "stylesheet/font settling is screenshot-only and must be skipped");
    assert.deepEqual(calls.find(c => c[0] === "fill")[1], { timeout: 5000 });
    assert.deepEqual(calls.find(c => c[0] === "click")[1], { timeout: 5000 });
});

test("blocked navigation returns completed-step evidence after mutation (no replay)", async () => {
    let tests = 0;
    const working = {
        async count() { return 1; },
        first() { return this; },
        async click() {}
    };
    const stuck = {
        async count() { return 1; },
        first() { return this; },
        async click() { throw new Error("element is not receiving pointer events (Timeout 3000ms exceeded)"); }
    };
    const pg = {
        on() {},
        url: () => "https://example.test/app",
        async innerText() { return "saved ok"; },
        async content() { return "<body>saved ok</body>"; },
        locator() { return { async count() { return 1; }, first() { return working; } }; },
        getByText(text) { return text === "Save" ? working : stuck; },
        async fill() {},
        async evaluate() { return {}; },
        async waitForLoadState() {},
        async waitForFunction() {},
        async waitForTimeout() {}
    };
    const result = await runExercise(null, "PAL-X", {
        steps: [{ fill: { name: "x" }, click: "Save", expect: ["saved"] }, { click: "Next" }],
        workflow: "console"
    }, {
        runTest: async () => { tests++; return { ran: true, validated: true, kind: "console", _previewUrl: "https://example.test/app" }; },
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }),
        releaseBrowser: () => {},
        waitForRenderablePage: async () => {}
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.category, "navigation");
    assert.equal(result.potentialMutationStarted, true);
    assert.equal(result.retryAttempted, false, "a post-mutation block is never replayed");
    assert.equal(tests, 1);
    assert.equal(result.steps.length, 1, "the completed step must ride on the blocked result");
    assert.equal(result.steps[0].pass, true);
    assert.match(result.steps[0].label, /click "Save"/);
    const out = formatExercise(result);
    assert.match(out, /BLOCKED/);
    assert.match(out, /completed steps before the block \(1\):/);
    assert.match(out, /✓ step 1 \[fill\{name\} click "Save"\]/);
    assert.match(out, /Data may already have changed/);
});

test("formatExercise: bare blocked output stays unchanged (no steps section)", () => {
    const out = formatExercise({ ran: false, status: "blocked", category: "environment",
        potentialMutationStarted: false, retryAttempted: true, reason: "offline",
        remediation: "Fix the test environment, then run a new exercise." });
    assert.match(out, /category: environment/);
    assert.match(out, /retry attempted: yes/);
    assert.match(out, /potential mutation started: no/);
    assert.match(out, /next: Fix the test environment/);
    assert.ok(!/completed steps/.test(out));
    assert.ok(!/evidence:/.test(out), "no browser evidence means no evidence line");
});

// ---- Slice 2: bounded browser failure evidence ------------------------------

// Fake page with real event plumbing: `on` records handlers and emit() fires them mid-run, so the
// capture happens while the exercise drives the page — the same path production uses.
function failingPageWithEvents({ ariaSnapshot, hints }) {
    const listeners = {};
    const emit = (event, arg) => { for (const fn of (listeners[event] || [])) fn(arg); };
    const clickTarget = {
        async count() { return 1; },
        first() { return this; },
        async click() {
            // Fired mid-run by the page itself, exactly like a real browser console/network stream.
            emit("console", { type: () => "error", text: () => "Failed to load resource: the server responded with a status of 500 (https://api.example.test/data?token=SECRET)" });
            emit("console", { type: () => "error", text: () => "Failed to load resource: the server responded with a status of 500 (https://api.example.test/data?token=SECRET)" }); // duplicate → deduped
            emit("console", { type: () => "log", text: () => "ordinary log line" });
            emit("response", { status: () => 500, url: () => "https://api.example.test/data?cp-auth=SECRET&x=1" });
            emit("response", { status: () => 502, url: () => "https://api.example.test/" + "x".repeat(1000) });
            emit("requestfailed", { url: () => "https://api.example.test/asset.css?secret=1", failure: () => ({ errorText: "net::ERR_FAILED" }) });
            emit("pageerror", { message: "TypeError: x is undefined" });
        }
    };
    const pg = {
        on(event, handler) { (listeners[event] = listeners[event] || []).push(handler); },
        url: () => "https://example.test/app",
        getByText() { return clickTarget; },
        locator() { return { async count() { return 1; }, first() { return clickTarget; }, async ariaSnapshot() { return ariaSnapshot; } }; },
        async evaluate() { return hints || {}; },
        async screenshot() { return Buffer.from("fake-jpeg-bytes"); },
        async innerText() { return "saved"; },
        async content() { return "<body>saved</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {}
    };
    return { pg, emit };
}

function runFailingExercise(pg, steps, deps = {}) {
    return exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        steps,
        undefined,
        Object.assign({ loadChromium: () => ({}), getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }), releaseBrowser: () => {} }, deps)
    );
}

test("exerciseByBrowser captures bounded, deduped, sanitized browser events on failure", async () => {
    const { pg } = failingPageWithEvents({ ariaSnapshot: "body\n- root [body]", hints: {} });
    const res = await runFailingExercise(pg, [{ click: "Save", expect: ["missing"] }]);
    assert.equal(res.status, "failed");
    assert.deepEqual(res.evidence.events, [
        { type: "console:error", message: "Failed to load resource: the server responded with a status of 500 (<url>)" },
        { type: "http", status: 500, url: "https://api.example.test/data" },
        { type: "http", status: 502, url: "https://api.example.test/" + "x".repeat(261) + "… (truncated)" },
        { type: "requestfailed", url: "https://api.example.test/asset.css", message: "net::ERR_FAILED" },
        { type: "pageerror", message: "TypeError: x is undefined" }
    ]);
    const dumped = JSON.stringify(res.evidence);
    assert.doesNotMatch(dumped, /SECRET|cp-auth|token=|secret=/, "no credential URL/query/fragment may reach evidence");
    assert.ok(!/ordinary log line/.test(dumped), "non-error/warning console messages are ignored");
    assert.ok(res.evidence.events.every(event => !event.url || event.url.length <= 300), "event URLs are bounded");
});

test("exerciseByBrowser caps browser events at the bound and keeps only unique events", async () => {
    const listeners = {};
    let clickTarget;
    clickTarget = {
        async count() { return 1; },
        first() { return this; },
        async click() { for (let n = 0; n < BROWSER_EVENTS_CAP + 5; n++) {
            for (const fn of (listeners["console"] || [])) fn({ type: () => "error", text: () => "unique error " + n });
        } }
    };
    const pg = {
        on(event, handler) { (listeners[event] = listeners[event] || []).push(handler); },
        url: () => "https://example.test/app",
        getByText() { return clickTarget; },
        locator() { return { async count() { return 1; }, first() { return clickTarget; }, async ariaSnapshot() { return "body\n- root [body]"; } }; },
        async evaluate() { return {}; },
        async screenshot() { return Buffer.from("x"); },
        async innerText() { return "saved"; },
        async content() { return "<body>saved</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {}
    };
    const res = await runFailingExercise(pg, [{ click: "Save", expect: ["missing"] }]);
    assert.equal(res.evidence.events.length, BROWSER_EVENTS_CAP, "events are capped");
});

test("exerciseByBrowser truncates the accessibility snapshot with an explicit marker and scrubs it", async () => {
    const snapshot = "Link https://cred.example/p?cp-auth=SECRET\n" + "y".repeat(10000);
    const { pg } = failingPageWithEvents({ ariaSnapshot: snapshot, hints: {} });
    const res = await runFailingExercise(pg, [{ click: "Save", expect: ["missing"] }]);
    assert.equal(res.evidence.aria.length, 4096, "snapshot is capped at ~4k");
    assert.match(res.evidence.aria, /… \(snapshot truncated\)$/);
    assert.equal(res.evidence.ariaTruncated, true);
    assert.equal(res.evidence.ariaScope, "body");
    assert.match(res.evidence.aria, /<url>/);
    assert.doesNotMatch(res.evidence.aria, /SECRET|cp-auth/);
});

test("exerciseByBrowser falls back to screen hints when ariaSnapshot is unavailable", async () => {
    const pg = {
        on() {},
        url: () => "https://example.test/app",
        getByText() { return { async count() { return 1; }, first() { return this; }, async click() {} }; },
        locator() { return { async count() { return 1; }, first() { return this; } }; },
        async evaluate() { return { clicks: ["Save"], ids: [], fields: [], headings: ["Edit equipment"] }; },
        async screenshot() { throw new Error("page closed"); },
        async innerText() { return "saved"; },
        async content() { return "<body>saved</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {}
    };
    const res = await runFailingExercise(pg, [{ click: "Save", expect: ["missing"] }]);
    assert.equal(res.status, "failed");
    assert.equal(res.evidence.aria, null);
    assert.deepEqual(res.evidence.hints, { clicks: ["Save"], ids: [], fields: [], headings: ["Edit equipment"] });
    assert.equal(res.evidence.jpegBase64, null, "a failed screenshot is best-effort, never a crash");
});

test("formatExercise: failure evidence summary is compact and points at persisted artifacts", () => {
    const out = formatExercise({
        ran: true, kind: "console", mode: "browser", pass: false, failedStep: 1,
        steps: [{ step: 1, label: "click \"Save\"", pass: false, error: "expect missing", url: "https://example.test/app" }],
        evidence: {
            events: [
                { type: "console:error", message: "boom (<url>)" },
                { type: "pageerror", message: "TypeError: x" },
                { type: "http", status: 500, url: "https://example.test/api" },
                { type: "http", status: 502, url: "https://example.test/api" }
            ],
            aria: "body\n- root [body]", ariaScope: "body", ariaTruncated: false, hints: null,
            jpegBase64: "AAAA", jpegBytes: null
        },
        artifacts: {
            dir: "/ws/.agent-work-history/2026-01-01T00-00-00-000Z--pal-exercise--failure-failed",
            steps: "steps.json", events: "browser-events.json", aria: "aria-snapshot.txt",
            jpeg: "failure.jpg", metadata: "metadata.json", notes: "notes.md"
        }
    });
    assert.match(out, /BEHAVIOR FAIL/);
    assert.match(out, /evidence: browser events: console:error ×1, http ×2, pageerror ×1; accessibility snapshot \(body\) 18 chars; failure screenshot 1KB/);
    assert.match(out, /artifacts: \/ws\/\.agent-work-history\/2026-01-01T00-00-00-000Z--pal-exercise--failure-failed \(steps\.json, browser-events\.json, aria-snapshot\.txt, failure\.jpg, metadata\.json, notes\.md\)/);
    assert.match(out, /inspect the artifacts instead of probing selectors by trial and error — blocked\/failed is not PASS/);
    assert.doesNotMatch(out, /AAAA|base64/, "JPEG base64 never appears inline");

    const blocked = formatExercise({
        ran: false, status: "blocked", category: "navigation", potentialMutationStarted: true,
        reason: "navigation timed out", steps: [{ step: 1, label: "click \"Save\"", pass: true, url: "https://example.test/app" }],
        evidence: { events: [{ type: "http", status: 504, url: "https://example.test/api" }], aria: null, ariaScope: "body", ariaTruncated: false, hints: { clicks: [] }, jpegBase64: null, jpegBytes: null }
    });
    assert.match(blocked, /BLOCKED/);
    assert.match(blocked, /completed steps before the block \(1\):/);
    assert.match(blocked, /evidence: browser events: http ×1; accessibility snapshot unavailable — screen hints captured/);
    assert.ok(!/artifacts:/.test(blocked), "no artifact map means no artifacts line");
});

test("pal_exercise handler persists failure-only artifacts and never returns JPEG base64", async () => {
    const ws = tmpWorkspace();
    const loaded = loadStubbedTools({
        exerciseResult: {
            ran: true, pass: false, status: "failed", category: "behavior", kind: "console",
            mode: "browser", runId: "run-f1", failedStep: 1,
            reason: "expect \"saved\" missing from visible text",
            steps: [{ step: 1, label: "fill{name,password} click \"Save\"", pass: false, error: "expect missing", url: "https://example.test/app" }],
            evidence: {
                events: [{ type: "requestfailed", url: "https://api.example.test/asset.css?cp-auth=SECRET", message: "net::ERR_FAILED" }],
                aria: "body\n- root [body]", ariaScope: "body", ariaTruncated: false, hints: null,
                jpegBase64: Buffer.from("fake-jpeg").toString("base64"), jpegBytes: null
            }
        }
    });
    try {
        const result = await findTool(loaded.tools, "pal_exercise").run({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" }
        }, { steps: [{ page: "/records?token=TOPSECRET", action: "save", params: {
            callback: "https://callback.example.test/done?token=NESTED", password: "param-secret"
        }, fill: { name: "Camera {{runId}}", password: "hunter2" }, click: "Save", expect: ["saved"] }] });
        assert.equal(result.status, "failed");
        assert.equal(result.evidence.jpegBase64, undefined, "JPEG base64 must never reach the caller");
        assert.equal(result.evidence.jpegBytes, Buffer.from("fake-jpeg").length, "byte count survives for the compact summary");
        assert.ok(result.artifacts && result.artifacts.dir, "artifact directory is returned");
        const runDir = result.artifacts.dir;
        for (const name of ["steps.json", "browser-events.json", "aria-snapshot.txt", "failure.jpg", "metadata.json", "notes.md"]) {
            assert.equal(fs.existsSync(path.join(runDir, name)), true, name + " must be persisted");
        }
        const persistedSteps = JSON.parse(fs.readFileSync(path.join(runDir, "steps.json"), "utf8"));
        assert.deepEqual(persistedSteps, {
            // Requested steps (runId applied, auth-like fill values redacted) and execution
            // results are persisted as two DISTINCT arrays — never mislabeled as one.
            requestedSteps: [{ page: "/records?token=<redacted>", action: "save", params: {
                callback: "https://callback.example.test/done", password: "<redacted>"
            }, fill: { name: "Camera run-f1", password: "<redacted>" }, click: "Save", expect: ["saved"] }],
            executionResults: [{ step: 1, label: "fill{name,password} click \"Save\"", pass: false, error: "expect missing", url: "https://example.test/app" }]
        }, "steps.json keeps distinct redacted requested steps and sanitized execution results");
        const metadata = JSON.parse(fs.readFileSync(path.join(runDir, "metadata.json"), "utf8"));
        assert.equal(metadata.viewport, "desktop", "an omitted viewport records the effective desktop default");
        // Artifact inventory is keyed by the artifact map, so the persisted list names real files.
        assert.deepEqual(metadata.artifacts, ["steps.json", "browser-events.json", "aria-snapshot.txt", "failure.jpg", "notes.md", "metadata.json"]);
        assert.deepEqual(metadata.incomplete, [], "all artifact writes succeeded");
        // Durable artifacts are credential-free even when evidence carries a raw URL.
        for (const name of ["steps.json", "browser-events.json", "aria-snapshot.txt", "metadata.json", "notes.md"]) {
            const text = fs.readFileSync(path.join(runDir, name), "utf8");
            assert.doesNotMatch(text, /SECRET|NESTED|param-secret|cp-auth|hunter2/, name + " must not carry credentials");
        }
        const events = JSON.parse(fs.readFileSync(path.join(runDir, "browser-events.json"), "utf8"));
        assert.deepEqual(events, [{ type: "requestfailed", url: "https://api.example.test/asset.css", message: "net::ERR_FAILED" }]);
        assert.equal(usage.readToolEvidence(ws).length, 0, "a failed run appends no successful review evidence");
    } finally {
        loaded.restore();
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("pal_exercise PASS writes no failure artifacts", async () => {
    const ws = tmpWorkspace();
    const loaded = loadStubbedTools({
        exerciseResult: { ran: true, pass: true, runId: "run-1", kind: "console", mode: "browser" }
    });
    try {
        const result = await findTool(loaded.tools, "pal_exercise").run({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" }
        }, { steps: [{ click: "Save", expect: ["saved"] }] });
        assert.equal(result.pass, true);
        assert.equal(fs.existsSync(path.join(ws, ".agent-work-history")), false,
            "a PASS must not write failure artifacts");
    } finally {
        loaded.restore();
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("exerciseByBrowser sets context-level timeouts and time-bounds the failure screenshot", async () => {
    const calls = [];
    let contextOpts = null, defaultActionTimeout = null, defaultNavigationTimeout = null;
    const clickTarget = {
        async count() { return 1; },
        first() { return this; },
        async click() {}
    };
    const pg = {
        on() {},
        url: () => "https://example.test/app",
        getByText() { return clickTarget; },
        locator() { return { async count() { return 1; }, first() { return clickTarget; }, async ariaSnapshot() { return "body\n- root [body]"; } }; },
        async evaluate() { return {}; },
        async screenshot(options) { calls.push(["screenshot", options]); return Buffer.from("jpeg"); },
        async innerText() { return "saved"; },
        async content() { return "<body>saved</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {}
    };
    const res = await runFailingExercise(pg, [{ click: "Save", expect: ["missing"] }], {
        getBrowser: async () => ({ newContext: async (opts) => {
            contextOpts = opts;
            return {
                setDefaultTimeout(ms) { defaultActionTimeout = ms; },
                setDefaultNavigationTimeout(ms) { defaultNavigationTimeout = ms; },
                newPage: async () => pg, close: async () => {}
            };
        } })
    });
    assert.equal(res.status, "failed");
    assert.deepEqual(contextOpts, { viewport: { width: 1280, height: 800 } });
    assert.equal(defaultActionTimeout, 5000, "context-level default action timeout");
    assert.equal(defaultNavigationTimeout, 10000, "context-level default navigation timeout");
    const shot = calls.find(c => c[0] === "screenshot")[1];
    assert.equal(shot.type, "jpeg");
    assert.ok(shot.timeout > 0, "the failure screenshot itself is time-bounded");
});

test("a hung evaluate cannot hang evidence capture: bounded per-call, run still completes", async () => {
    const hung = new Promise(() => {}); // never settles
    const pg = {
        on() {},
        url: () => "https://example.test/app",
        getByText() { return { async count() { return 1; }, first() { return this; }, async click() {} }; },
        locator() { return { async count() { return 1; }, first() { return this; } }; },
        async evaluate() { return hung; },
        async screenshot() { return Buffer.from("x"); },
        async innerText() { return "saved"; },
        async content() { return "<body>saved</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {}
    };
    const start = Date.now();
    const res = await runFailingExercise(pg, [{ click: "Save", expect: ["missing"] }], { evidenceTimeout: 30 });
    const elapsed = Date.now() - start;
    assert.equal(res.status, "failed");
    assert.deepEqual(res.evidence.hints, { clicks: [], ids: [], fields: [], headings: [] },
        "hung screen hints fall back to empty hints instead of hanging");
    assert.ok(res.evidence.jpegBase64, "screenshot capture still proceeds after the bound");
    assert.ok(elapsed < 2000, "bounded evidence must not hang (took " + elapsed + "ms)");
});

test("a failing scoped ariaSnapshot falls back to the body snapshot before screen hints", async () => {
    let ariaCalls = 0;
    const clickTarget = {
        async count() { return 1; },
        first() { return this; },
        async click() {}
    };
    const pg = {
        on() {},
        url: () => "https://example.test/app",
        getByText() { return clickTarget; },
        locator(sel) {
            const self = {
                async count() { return 1; },
                first() { return self; },
                getByText() { return clickTarget; },
                async ariaSnapshot() {
                    ariaCalls++;
                    if (sel !== "body") throw new Error("scoped snapshot unavailable");
                    return "body\n- root [body]\n- button Save";
                }
            };
            return self;
        },
        async evaluate() { return {}; },
        async screenshot() { return Buffer.from("x"); },
        async innerText() { return "saved"; },
        async content() { return "<body>saved</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {}
    };
    const res = await runFailingExercise(pg, [{ click: "Save", within: ".panel", expect: ["missing"] }]);
    assert.equal(res.status, "failed");
    assert.equal(ariaCalls, 2, "scoped attempt, then body attempt");
    assert.equal(res.evidence.ariaScope, "body");
    assert.match(res.evidence.aria, /button Save/);
    assert.equal(res.evidence.hints, null, "no hints when a snapshot was captured");
});

test("evidence redaction covers bearer/basic authorization and query/header/JSON secret forms", async () => {
    const listeners = {};
    const emit = (event, arg) => { for (const fn of (listeners[event] || [])) fn(arg); };
    const clickTarget = {
        async count() { return 1; },
        first() { return this; },
        async click() {
            emit("console", { type: () => "error", text: () => "Authorization: Bearer eyJhbGciOi.abc.def" });
            emit("console", { type: () => "error", text: () => "Basic " + Buffer.from("user:pass").toString("base64") });
            emit("console", { type: () => "error", text: () => "{\"password\": \"hunter2\", \"otp\": \"123456\"}" });
            emit("console", { type: () => "error", text: () => "X-Api-Key: k123" });
            emit("console", { type: () => "error", text: () => "&api_key=k456&pin=9999" });
            emit("console", { type: () => "error", text: () => "401 Unauthorized, retry with Bearer eyJhbGciOi.abc.def" });
        }
    };
    const pg = {
        on(event, handler) { (listeners[event] = listeners[event] || []).push(handler); },
        url: () => "https://example.test/app",
        getByText() { return clickTarget; },
        locator() { return { async count() { return 1; }, first() { return clickTarget; }, async ariaSnapshot() { return "body\n- root [body]"; } }; },
        async evaluate() { return {}; },
        async screenshot() { return Buffer.from("x"); },
        async innerText() { return "saved"; },
        async content() { return "<body>saved</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {}
    };
    const res = await runFailingExercise(pg, [{ click: "Save", expect: ["missing"] }]);
    const messages = res.evidence.events.map(e => e.message);
    const joined = messages.join("\n");
    assert.doesNotMatch(joined, /eyJhbGci|hunter2|123456|k123|k456|9999|user:pass/, "secret values must never reach evidence");
    assert.ok(messages.some(m => m === "Authorization: <redacted>"), "header-form authorization is scrubbed");
    assert.ok(messages.some(m => m === "Basic <redacted>"), "basic authorization is scrubbed");
    assert.ok(messages.some(m => m === "401 Unauthorized, retry with Bearer <redacted>"), "standalone bearer tokens are scrubbed");
    assert.ok(messages.some(m => m === "{\"password\": \"<redacted>\", \"otp\": \"<redacted>\"}"), "JSON-like secret assignments are scrubbed");
    assert.ok(messages.some(m => m === "&api_key=<redacted>&pin=<redacted>"), "query-like secret values are scrubbed");
    assert.ok(messages.some(m => m === "X-Api-Key: <redacted>"), "header-like api keys are scrubbed");
});

test("pal_exercise handler reports partial artifact writes and never returns unpersisted JPEG base64", async () => {
    const ws = tmpWorkspace();
    const realWorkHistory = require("../src/mcp/workHistory");
    const loaded = loadStubbedTools({
        exerciseResult: {
            ran: true, pass: false, status: "failed", category: "behavior", kind: "console",
            mode: "browser", runId: "run-j1", failedStep: 1,
            steps: [{ step: 1, label: "click \"Save\"", pass: false, error: "expect missing", url: "https://example.test/app" }],
            evidence: {
                events: [],
                aria: "body\n- root [body]", ariaScope: "body", ariaTruncated: false, hints: null,
                jpegBase64: Buffer.from("fake-jpeg").toString("base64"), jpegBytes: null
            }
        },
        workHistoryModule: Object.assign({}, realWorkHistory, {
            writeArtifactFile: (run, name, ...rest) => name === "failure.jpg" ? null : realWorkHistory.writeArtifactFile(run, name, ...rest)
        })
    });
    try {
        const result = await findTool(loaded.tools, "pal_exercise").run({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" }
        }, { steps: [{ click: "Save", expect: ["saved"] }] });
        assert.equal(result.status, "failed", "the primary exercise result is never thrown away");
        assert.match(result.message, /BEHAVIOR FAIL/);
        assert.equal(result.evidence.jpegBase64, undefined, "JPEG base64 is stripped even when persistence fails");
        assert.equal(result.evidence.jpegBytes, null, "no byte count is claimed for an unpersisted JPEG");
        assert.equal(result.evidence.jpegUnavailable, true, "the unpersisted screenshot is explicitly marked unavailable");
        assert.ok(result.artifacts.incomplete.includes("failure.jpg"), "incomplete list names failure.jpg");
        assert.equal(fs.existsSync(path.join(result.artifacts.dir, "failure.jpg")), false);
        assert.equal(fs.existsSync(path.join(result.artifacts.dir, "steps.json")), true, "sibling artifacts still persist");
        assert.match(result.message, /failure screenshot: captured but not persisted/);
        assert.match(result.message, /warning: 1 artifact write\(s\) failed: failure\.jpg/);
        const metadata = JSON.parse(fs.readFileSync(path.join(result.artifacts.dir, "metadata.json"), "utf8"));
        assert.ok(!metadata.artifacts.includes("failure.jpg"), "inventory lists only persisted files");
        assert.deepEqual(metadata.incomplete, ["failure.jpg"]);
    } finally {
        loaded.restore();
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("pal_exercise preserves its failure result when work-history creation throws", async () => {
    const ws = tmpWorkspace();
    const loaded = loadStubbedTools({
        exerciseResult: {
            ran: true, pass: false, status: "failed", category: "behavior", kind: "console",
            mode: "browser", runId: "run-j2", failedStep: 1, steps: [],
            evidence: { events: [], aria: "body", ariaScope: "body", jpegBase64: Buffer.from("jpeg").toString("base64") }
        },
        workHistoryModule: Object.assign({}, require("../src/mcp/workHistory"), {
            createWorkHistoryRun() { throw new Error("disk unavailable"); }
        })
    });
    try {
        const result = await findTool(loaded.tools, "pal_exercise").run({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" }
        }, { steps: [{ click: "Save" }] });
        assert.equal(result.status, "failed");
        assert.equal(result.evidence.jpegBase64, undefined);
        assert.equal(result.evidence.jpegUnavailable, true);
        assert.deepEqual(result.artifacts.incomplete, ["work-history run"]);
        assert.match(result.message, /warning: 1 artifact write\(s\) failed: work-history run/);
    } finally {
        loaded.restore();
        fs.rmSync(ws, { recursive: true, force: true });
    }
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

test("stepLabel: readable one-liners without credential values", () => {
    assert.strictEqual(stepLabel({ action: "save", params: { name: "Cam" } }), "action=save?name=Cam");
    assert.strictEqual(stepLabel({ fill: { name: "x" }, click: "Save" }), "fill{name} click \"Save\"");
    assert.strictEqual(stepLabel({ click: "Check out", within: 'tr:has-text("Camera")' }), 'click "Check out" within "tr:has-text(\\"Camera\\")"');
    assert.strictEqual(stepLabel({ expect: ["x"] }), "assert-only");
    const secret = stepLabel({ page: "https://example.test/items?token=SECRET", action: "save", params: {
        password: "hunter2", callback: "https://callback.test/done?token=NESTED"
    } });
    assert.doesNotMatch(secret, /SECRET|hunter2|NESTED/);
    assert.match(secret, /page=<url> action=save\?password=%3Credacted%3E&callback=%3Curl%3E/);
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

test("runExercise: whitespace-only assertions return invalid", async () => {
    for (const input of [
        { steps: [{ click: "Save", expect: [" "] }] },
        { steps: [{ click: "Save", absent: ["   "] }] },
        { steps: [{ click: "Save" }], initial: { expect: [" "] } }
    ]) {
        const res = await runExercise(null, "PAL-X", input);
        assert.strictEqual(res.status, "invalid");
        assert.strictEqual(res.invalid, true);
    }
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
    assert.match(out, /BEHAVIOR FAIL.*step 2/);
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
    assert.match(invalid, /INVALID STEPS/);

    const passing = formatExercise({ ran: true, kind: "web", mode: "fetch", pass: true, runId: "run123",
        steps: [{ step: 1, label: "action=list", pass: true, expect: [{ string: "Camera", found: true }], absent: [] }] });
    assert.equal(passing, [
        "pal_exercise (web, fetch mode) — PASS",
        "  runId: run123 ({{runId}} placeholders in steps were replaced with this value)",
        "  ✓ step 1 [action=list]",
        "      expect \"Camera\": found in visible text"
    ].join("\n"), "PASS output stays compact and carries no failure-evidence/artifact lines");
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
    assert.match(out, /INVALID STEPS/);
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
            record: { palGuid: "PAL-1", lastModifiedDate: "M1", localHash: "digest-1" }
        }, { steps: [{ fill: { secret: "private-value" }, click: "Save", expect: ["saved"], absent: ["old"] }], viewport: "mobile" });
        assert.equal(result.pass, true);
        assert.equal(result.evidenceRecorded, true);
        assert.equal(usage.readToolEvidence(ws).length, 1);
        assert.deepEqual(usage.readToolEvidence(ws)[0], {
            schema: "palsync/tool-evidence/1", tool: "pal_exercise", successful: true,
            palGuid: "PAL-1", marker: "M1", sourceDigest: "digest-1", ts: usage.readToolEvidence(ws)[0].ts,
            runId: "run-1", kind: "console", mode: "browser",
            summary: {
                stepCount: 1, webActions: [], browserInteractionCount: 2,
                filledFields: ["secret"], positiveAssertionCount: 1, absenceAssertionCount: 1,
                workflow: "console", viewport: "mobile"
            }
        });
        assert.doesNotMatch(JSON.stringify(usage.readToolEvidence(ws)[0].summary), /private-value|Save|saved|old|run-1/);
    } finally { loaded.restore(); }

    for (const exerciseResult of [
        { ran: true, pass: false, status: "failed", kind: "console", mode: "browser" },
        { ran: false, pass: false, status: "blocked", category: "navigation" },
        { ran: false, pass: false, status: "invalid", invalid: true, problems: ["bad"] }
    ]) {
        loaded = loadStubbedTools({ exerciseResult });
        try {
            await findTool(loaded.tools, "pal_exercise").run({
                session: {}, workspaceDir: ws,
                record: { palGuid: "PAL-1", lastModifiedDate: "M1" }
            }, { steps: [{ expect: ["missing"] }] });
            assert.equal(usage.readToolEvidence(ws).length, 1);
        } finally { loaded.restore(); }
    }
    fs.rmSync(ws, { recursive: true, force: true });
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

// A clean-render pal_screenshot capture is the durable responsive evidence the offline
// `palsync review check` gate reads. The predicate is render cleanliness only — an audit ERROR
// is reported in the row but never flips renderClean (advisory rules must not become walls).
test("pal_screenshot handler records a durable render row with audit findings reported, not gated", async () => {
    const ws = tmpWorkspace();
    const loaded = loadStubbedTools({
        screenshotResult: {
            captured: true, available: true, kind: "web",
            url: "https://example.test/p/board", viewportName: "mobile",
            viewport: { width: 390, height: 844 },
            renderError: null,
            styleStatus: { inspected: true, linked: 1, loaded: 1, likelyLoaded: true },
            designAudit: {
                inspected: true, pass: false, errors: 1, warnings: 1, metrics: {},
                findings: [
                    { severity: "error", rule: "horizontalOverflow", message: "overflows" },
                    { severity: "warning", rule: "targetSize", message: "small target" },
                    { severity: "warning", rule: "targetSize", message: "second small target" },
                    { severity: "info", rule: "advice", message: "not evidence" }
                ]
            }
        }
    });
    try {
        const result = await findTool(loaded.tools, "pal_screenshot").run({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1", localHash: "digest-1" }
        }, { page: "/board", imageless: true });
        assert.equal(result.captured, true);
        assert.equal(result.evidenceRecorded, true);
        const rows = usage.readToolEvidence(ws);
        assert.equal(rows.length, 1);
        assert.deepEqual(rows[0], {
            schema: "palsync/tool-evidence/1", tool: "pal_screenshot", successful: true,
            palGuid: "PAL-1", marker: "M1", sourceDigest: "digest-1", ts: rows[0].ts,
            route: "page:board", viewportName: "mobile",
            renderClean: true, // audit error present, render itself clean — NOT screenshotClean
            auditErrors: 1,
            auditRules: ["horizontalOverflow", "targetSize"] // both tiers, deduped, info dropped
        });
    } finally { loaded.restore(); fs.rmSync(ws, { recursive: true, force: true }); }
});

test("pal_screenshot render error and unavailable browser both leave durable rows", async () => {
    const ws = tmpWorkspace();
    let loaded = loadStubbedTools({
        screenshotResult: {
            captured: true, available: true, kind: "web",
            url: "https://example.test/p", viewportName: "desktop",
            viewport: { width: 1280, height: 800 },
            renderError: { message: "boom at runtime" },
            styleStatus: { inspected: true, linked: 1, loaded: 1, likelyLoaded: true },
            designAudit: { inspected: true, pass: true, errors: 0, warnings: 0, metrics: {}, findings: [] }
        }
    });
    try {
        const result = await findTool(loaded.tools, "pal_screenshot").run({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" }
        }, { imageless: true });
        assert.equal(result.evidenceRecorded, true);
        const rows = usage.readToolEvidence(ws);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].viewportName, "desktop");
        assert.equal(rows[0].route, "page:/", "a WEB capture with no page keys on the page route");
        assert.equal(rows[0].renderClean, false, "a runtime render error is never a clean render");
    } finally { loaded.restore(); }

    // No browser available: the row is a signal (viewportName:null), never a viewport pass.
    loaded = loadStubbedTools({
        screenshotResult: { captured: false, available: false, reason: "chromium missing" }
    });
    try {
        const ctx = {
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" }
        };
        const result = await findTool(loaded.tools, "pal_screenshot").run(ctx, { page: "/board" });
        assert.equal(result.captured, false);
        assert.equal(result.evidenceRecorded, true);
        assert.equal(ctx.renderVerified, "unavailable");
        const rows = usage.readToolEvidence(ws);
        assert.equal(rows.length, 2);
        assert.equal(rows[1].viewportName, null);
        assert.equal(rows[1].renderClean, false);
        assert.equal(rows[1].unavailable, true);
        assert.equal(rows[1].testingDisabled, undefined);
        assert.equal(rows[1].route, "page:board");
    } finally {
        loaded.restore();
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("pal_screenshot evidence failure stays captured and warns that review will not count it", async () => {
    const ws = tmpWorkspace({ ".palsync": "not a directory" });
    const loaded = loadStubbedTools({
        screenshotResult: {
            captured: true, available: true, kind: "web",
            url: "https://example.test/p", viewportName: "desktop",
            viewport: { width: 1280, height: 800 },
            renderError: null,
            styleStatus: { inspected: true, linked: 1, loaded: 1, likelyLoaded: true },
            designAudit: { inspected: true, pass: true, errors: 0, warnings: 0, metrics: {}, findings: [] }
        }
    });
    try {
        const result = await findTool(loaded.tools, "pal_screenshot").run({
            session: {}, workspaceDir: ws,
            record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" }
        }, { imageless: true });
        assert.equal(result.captured, true);
        assert.equal(result.evidenceRecorded, false);
        assert.match(result.message, /Render evidence persistence failed.*review check will not count/s);
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
