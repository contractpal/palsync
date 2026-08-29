"use strict";
// Ticket 07 — bounded wait for asynchronous exercise state.
// Tests at MCP wrapper / core seam using injected browser fakes — never launches Chromium.
const { test } = require("node:test");
const assert = require("node:assert");
const { runExercise, exerciseByBrowser, validateSteps, WAIT_DEFAULT_TIMEOUT_MS, WAIT_MAX_TIMEOUT_MS, WAIT_DEFAULT_INTERVAL_MS, WAIT_MIN_INTERVAL_MS } = require("../src/core/exercise");
const { tmpWorkspace } = require("./helpers");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");

function loadStubbedExerciseTools({ exerciseResult } = {}) {
    const toolsPath = require.resolve("../src/mcp/tools");
    const exercisePath = require.resolve("../src/core/exercise");
    const pushPath = require.resolve("../src/core/push");
    const screenshotPath = require.resolve("../src/core/screenshot");
    const debugPath = require.resolve("../src/core/debug");
    const saved = new Map([
        [toolsPath, require.cache[toolsPath]],
        [exercisePath, require.cache[exercisePath]],
        [pushPath, require.cache[pushPath]],
        [screenshotPath, require.cache[screenshotPath]],
        [debugPath, require.cache[debugPath]]
    ]);
    const realExercise = require("../src/core/exercise");
    require.cache[exercisePath] = { id: exercisePath, filename: exercisePath, loaded: true, exports: Object.assign({}, realExercise, {
        runExercise: async () => Object.assign({}, exerciseResult),
        formatExercise: realExercise.formatExercise,
        applyRunId: realExercise.applyRunId,
        redactStepValues: realExercise.redactStepValues,
        redactSecretForms: realExercise.redactSecretForms
    }) };
    require.cache[pushPath] = { id: pushPath, filename: pushPath, loaded: true, exports: { push: async () => ({}) } };
    require.cache[screenshotPath] = { id: screenshotPath, filename: screenshotPath, loaded: true, exports: { runScreenshot: async () => ({}) } };
    require.cache[debugPath] = { id: debugPath, filename: debugPath, loaded: true, exports: { retrieveServerDebug: async () => ({ retrieved: false }) } };
    delete require.cache[toolsPath];
    const loaded = require("../src/mcp/tools");
    return {
        tools: loaded.TOOLS,
        restore() {
            for (const [p, c] of saved) { if (c) require.cache[p] = c; else delete require.cache[p]; }
        }
    };
}

function findTool(tools, name) {
    const t = tools.find(x => x.name === name);
    assert.ok(t, "missing tool " + name);
    return t;
}

// Fake page helper for wait tests. Tracks mutation counts and poll reads.
function makePollingPage({ texts, htmls, onInnerText, onContent }) {
    let polls = 0;
    const innerTexts = texts ? texts.slice() : null;
    const htmlContents = htmls ? htmls.slice() : null;
    const pg = {
        _clicks: 0,
        _gotos: 0,
        _innerReads: 0,
        _htmlReads: 0,
        on() {},
        url: () => "https://example.test/app",
        locator(sel) {
            return {
                async count() { return 1; },
                first() { return this; },
                getByText() { return this; },
                async ariaSnapshot() { return "body"; }
            };
        },
        getByText(text) {
            return {
                async count() { return 1; },
                first() { return this; },
                async click() { pg._clicks++; }
            };
        },
        async innerText() {
            pg._innerReads++;
            polls++;
            if (onInnerText) return onInnerText(polls);
            if (innerTexts) return innerTexts[Math.min(polls - 1, innerTexts.length - 1)];
            return "";
        },
        async content() {
            pg._htmlReads++;
            if (onContent) return onContent(polls);
            if (htmlContents) return htmlContents[Math.min(polls - 1, htmlContents.length - 1)];
            return "<body></body>";
        },
        async goto() { pg._gotos++; },
        async waitForLoadState() {},
        async waitForFunction() {},
        async waitForTimeout() {},
        async evaluate() { return {}; },
        async screenshot() { return Buffer.from("x"); }
    };
    pg.__polls = () => polls;
    return pg;
}

// ---- validation ------------------------------------------------------------

test("validateSteps: waitFor invalid/oversized timeout and too-small interval are refused preflight", async () => {
    assert.ok(validateSteps([{ click: "Go", waitFor: { timeoutMs: 0 }, expect: ["x"] }]).some(m => /timeoutMs/));
    assert.ok(validateSteps([{ click: "Go", waitFor: { timeoutMs: 60001 }, expect: ["x"] }]).some(m => /timeoutMs/));
    assert.ok(validateSteps([{ click: "Go", waitFor: { intervalMs: 50 }, expect: ["x"] }]).some(m => /intervalMs/));
    assert.ok(validateSteps([{ click: "Go", waitFor: { timeoutMs: "15000" }, expect: ["x"] }]).some(m => /timeoutMs/));
    assert.ok(validateSteps([{ click: "Go", waitFor: null, expect: ["x"] }]).some(m => /waitFor must be/));
    assert.ok(validateSteps([{ click: "Go", waitFor: { unknown: 1 }, expect: ["x"] }]).some(m => /unknown key/));
    assert.ok(validateSteps([{ click: "Go", waitFor: { timeoutMs: 1000 } }]).some(m => /waitFor requires/.test(m)), "waitFor without assertion must be refused");
    assert.ok(validateSteps([{ click: "Go", waitFor: { timeoutMs: 1000 }, expect: [] }]).some(m => /waitFor requires/.test(m)), "empty expect does not satisfy waitFor");
    assert.deepStrictEqual(validateSteps([{ click: "Go", waitFor: { timeoutMs: 1000 }, absent: ["x"] }]), [], "waitFor with absent only is valid");
    // valid cases pass
    assert.deepStrictEqual(validateSteps([{ click: "Go", waitFor: { timeoutMs: 15000, intervalMs: 500 }, expect: ["x"] }]), []);
    assert.deepStrictEqual(validateSteps([{ click: "Go", waitFor: {}, expect: ["x"] }]), []);
    assert.deepStrictEqual(validateSteps([{ click: "Go", waitFor: { timeoutMs: 60000 }, expect: ["x"] }]), []);
    assert.deepStrictEqual(validateSteps([{ click: "Go", waitFor: { intervalMs: 100 }, expect: ["x"] }]), []);
});

test("runExercise preflight refuses invalid waitFor without touching server", async () => {
    const res = await runExercise(null, "PAL-X", { steps: [{ click: "Go", waitFor: { timeoutMs: 99999 }, expect: ["x"] }] });
    assert.equal(res.invalid, true);
    assert.equal(res.status, "invalid");
    assert.ok(res.problems.some(p => /timeoutMs/));
});

// ---- delayed success --------------------------------------------------------

test("exerciseByBrowser: delayed visible text eventually passes", async () => {
    const pg = makePollingPage({ texts: ["pending", "pending", "Done run123"], htmls: ["<body>pending</body>", "<body>pending</body>", "<body>Done run123</body>"] });
    let waits = 0;
    const deps = {
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }),
        releaseBrowser: () => {},
        waitForRenderablePage: async () => {},
        wait: async () => { waits++; },
        now: (() => { let t = 0; return () => { const v = t; t += 500; return v; }; })()
    };
    // Provide click so _clicks increments once before wait loop
    const res = await exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        [{ click: "Start", expect: ["Done"], waitFor: { timeoutMs: 5000, intervalMs: 100 } }],
        undefined,
        deps
    );
    assert.equal(res.status, "passed");
    assert.equal(res.pass, true);
    assert.equal(res.steps.length, 1);
    assert.equal(res.steps[0].pass, true);
    // at least 2 polls before success, waits called at least once
    assert.ok(pg._innerReads >= 3, "should have polled multiple times: " + pg._innerReads);
    assert.ok(waits >= 1);
});

// ---- timeout with last observed assertion state -----------------------------

test("exerciseByBrowser: timeout is behavior failure retaining last observed assertion state", async () => {
    const pg = makePollingPage({ texts: ["pending", "still pending", "still pending"], htmls: ["<body>pending</body>"] });
    let nowVal = 0;
    const deps = {
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }),
        releaseBrowser: () => {},
        waitForRenderablePage: async () => {},
        wait: async () => { nowVal += 250; },
        now: () => nowVal,
        evidenceTimeout: 10
    };
    const res = await exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        [{ click: "Start", expect: ["Done"], absent: ["pending"], waitFor: { timeoutMs: 500, intervalMs: 100 } }],
        undefined,
        deps
    );
    assert.equal(res.status, "failed");
    assert.equal(res.category, "behavior");
    assert.equal(res.failedStep, 1);
    assert.equal(res.steps[0].pass, false);
    // Last observed: expect missing, absent still present
    const exp = res.steps[0].expect.find(e => e.string === "Done");
    assert.ok(exp && !exp.found, "expect should be missing in last observed");
    const abs = res.steps[0].absent.find(a => a.string === "pending");
    assert.ok(abs && !abs.absent, "absent should still be present in last observed");
    assert.ok(res.evidence, "timeout failure carries evidence");
});

// ---- render error aborts promptly ------------------------------------------

test("exerciseByBrowser: render error aborts wait immediately without consuming full timeout", async () => {
    const errorText = "Workflow: console.js\nMessage: NullPointerException: boom\nMethod Called: DataSet.getRecords\nApprox. Line no: 42";
    const pg = makePollingPage({ texts: [errorText], htmls: ["<body>" + errorText + "</body>"] });
    let waits = 0;
    let nowVal = 0;
    const deps = {
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }),
        releaseBrowser: () => {},
        waitForRenderablePage: async () => {},
        wait: async () => { waits++; nowVal += 100; },
        now: () => nowVal,
        evidenceTimeout: 10
    };
    const res = await exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        [{ click: "Start", expect: ["Done"], waitFor: { timeoutMs: 5000, intervalMs: 100 } }],
        undefined,
        deps
    );
    assert.equal(res.status, "failed");
    assert.equal(res.category, "behavior");
    assert.ok(res.steps[0].renderError, "render error should be attached");
    assert.equal(waits, 0, "should not have waited after immediate render error");
    assert.equal(pg._innerReads, 1, "only one poll before abort");
});

// ---- no-replay mutation count pin ------------------------------------------

test("exerciseByBrowser: one click stays one across multi-poll wait (no replay)", async () => {
    const pg = makePollingPage({ texts: ["pending", "pending", "Done"], htmls: ["<body>pending</body>", "<body>pending</body>", "<body>Done</body>"] });
    let gotoCalls = 0;
    let clickCalls = 0;
    // Wrap locator to count clicks more precisely
    const origGetByText = pg.getByText.bind(pg);
    pg.getByText = (text) => {
        const loc = origGetByText(text);
        const origClick = loc.click.bind(loc);
        loc.click = async (...a) => { clickCalls++; return origClick(...a); };
        return loc;
    };
    // Also track waitForRenderablePage calls (navigations)
    let navCalls = 0;
    const deps = {
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }),
        releaseBrowser: () => {},
        waitForRenderablePage: async () => { navCalls++; },
        wait: async () => {},
        now: (() => { let t = 0; return () => { t += 100; return t; }; })()
    };
    const res = await exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        [{ click: "Start", expect: ["Done"], waitFor: { timeoutMs: 5000, intervalMs: 100 } }],
        undefined,
        deps
    );
    assert.equal(res.status, "passed");
    // Only the initial navigation for the exercise + wait loop re-reads, never extra goto/click
    assert.equal(navCalls, 1, "wait loop must not navigate again (initial page load only)");
    assert.equal(pg._clicks, 1, "click must execute exactly once");
    assert.equal(pg._gotos, 0, "pg.goto must not be called in wait loop");
    assert.ok(pg._innerReads >= 3, "poll reads are allowed");
});

test("exerciseByBrowser WEB waitFor: goto/action executes exactly once while polling", async () => {
    const pg = makePollingPage({ texts: ["pending", "Done"], htmls: ["<body>pending</body>", "<body>Done</body>"] });
    let navCalls = 0;
    const deps = {
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }),
        releaseBrowser: () => {},
        waitForRenderablePage: async () => { navCalls++; },
        wait: async () => {},
        now: (() => { let t = 0; return () => { t += 100; return t; }; })()
    };
    const res = await exerciseByBrowser(
        { kind: "web", rawToken: "https://example.test/session" },
        [{ action: "startJob", expect: ["Done"], waitFor: { timeoutMs: 3000, intervalMs: 100 } }],
        undefined,
        deps
    );
    // Initial navigation + one action navigation = 2 calls, no extra in wait loop
    assert.equal(navCalls, 2, "action navigation exactly once, no replay during poll");
    assert.equal(res.status, "passed");
});

// ---- waiting forces browser mode for WEB -----------------------------------

test("runExercise: waiting WEB step uses browser mode (not fetch)", async () => {
    let browserCalled = false;
    let fetchCalled = false;
    // Mock fetch path to detect use
    const originalFetch = require("../src/core/exercise").exerciseByFetch;
    const deps = {
        runTest: async () => ({ ran: true, validated: true, kind: "web", rawToken: "https://example.test/session", _previewUrl: "https://example.test/session" }),
        exerciseByBrowser: async () => { browserCalled = true; return { ran: true, pass: true, status: "passed", category: "behavior", kind: "web", mode: "browser", steps: [] }; },
        wait: async () => {}
    };
    // Temporarily stub openInstanceSessionFromTest to detect fetch via monkey patching exerciseByFetch?
    // Instead verify routing: our deps only provides exerciseByBrowser, and runExercise chooses
    // browser when hasWaitFor. If it incorrectly chose fetch, our exerciseByBrowser wouldn't be called.
    const res = await runExercise(null, "PAL-X", { steps: [{ action: "startJob", expect: ["Done"], waitFor: { timeoutMs: 1000 } }], workflow: "web" }, deps);
    assert.equal(browserCalled, true, "waitFor must force browser mode for WEB");
    assert.equal(res.mode, "browser");
    assert.equal(res.status, "passed");
});

test("runExercise: non-wait WEB fetch path remains unchanged", async () => {
    let browserCalled = false;
    const deps = {
        runTest: async () => ({ ran: true, validated: true, kind: "web" }),
        exerciseByBrowser: async () => { browserCalled = true; return { status: "passed" }; }
    };
    // Use real exerciseByFetch path: need to stub openInstanceSessionFromTest to avoid real fetch
    // Mock it by providing a successful fetch via direct stub of exerciseByFetch dep is not possible
    // via runExercise's internal branching. Instead test that needsBrowser without wait still uses fetch:
    // We call runExercise and check it does NOT call exerciseByBrowser.
    // To avoid real network, make runTest return web and then stub the preview module.
    const previewPath = require.resolve("../src/core/preview");
    const savedPreview = require.cache[previewPath];
    require.cache[previewPath] = {
        id: previewPath, filename: previewPath, loaded: true, exports: Object.assign({}, savedPreview.exports, {
            openInstanceSessionFromTest: async () => ({
                opened: true,
                fetchPath: async () => ({ status: 200, html: "Done", contentType: "text/html", title: "", bytes: 4 })
            })
        })
    };
    try {
        const res = await runExercise(null, "PAL-X", { steps: [{ action: "list", expect: ["Done"] }], workflow: "web" }, deps);
        assert.equal(browserCalled, false, "non-wait WEB without fill/click must stay fetch mode");
        assert.equal(res.mode, "fetch");
        assert.equal(res.status, "passed");
    } finally {
        if (savedPreview) require.cache[previewPath] = savedPreview; else delete require.cache[previewPath];
    }
});

// ---- polling does not consume extra steps ----------------------------------

test("exerciseByBrowser: polling does not count as extra steps (step-cap invariant)", async () => {
    const pg = makePollingPage({ texts: ["Done"], htmls: ["<body>Done</body>"] });
    const deps = {
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }),
        releaseBrowser: () => {},
        waitForRenderablePage: async () => {},
        wait: async () => {},
        now: () => 0
    };
    // 10 steps each with waitFor should still be within cap
    const steps = Array.from({ length: 10 }, (_, i) => ({ click: "Step" + i, expect: ["Done"], waitFor: { timeoutMs: 200, intervalMs: 100 } }));
    // Single step wait should produce one result entry, not multiple
    const single = await exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        [steps[0]],
        undefined,
        deps
    );
    assert.equal(single.steps.length, 1, "one wait step produces one result entry");
    assert.equal(single.status, "passed");
    // Validate 10 steps is allowed
    assert.deepStrictEqual(validateSteps(steps), []);
    assert.ok(validateSteps([...steps, { click: "extra" }]).some(m => /too many steps/));
});

// ---- pre-mutation retry boundary unchanged ---------------------------------

test("wait loop sleeps min(interval, remaining) not full interval past deadline", async () => {
    const pg = makePollingPage({ texts: ["pending", "pending", "pending"], htmls: ["<body>pending</body>"] });
    let nowVal = 0;
    const sleeps = [];
    const deps = {
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }),
        releaseBrowser: () => {},
        waitForRenderablePage: async () => {},
        wait: async (ms) => { sleeps.push(ms); nowVal += ms; },
        now: () => nowVal,
        evidenceTimeout: 10
    };
    const res = await exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        [{ click: "Start", expect: ["Done"], waitFor: { timeoutMs: 1, intervalMs: 60000 } }],
        undefined,
        deps
    );
    assert.equal(res.status, "failed", "timeout must fail");
    assert.equal(res.category, "behavior");
    // Must not have slept the full 60000ms when only 1ms remained
    assert.ok(sleeps.length >= 1, "should have slept at least once");
    assert.ok(sleeps.every(ms => ms <= 1), "each sleep must be bounded by remaining time, not full interval: " + sleeps.join(","));
    assert.ok(sleeps[0] <= 1, "first sleep with 1ms deadline and 60000ms interval must be 1ms, not 60000ms");
    // Total wall time must be ~1ms, not 60s
    assert.ok(nowVal <= 10, "total waited time must be ~deadline, not interval: " + nowVal);
});

test("runExercise: wait timeout does not trigger pre-mutation retry", async () => {
    let tests = 0;
    const pg = makePollingPage({ texts: ["pending"], htmls: ["<body>pending</body>"] });
    let nowVal = 0;
    const deps = {
        runTest: async () => { tests++; return { ran: true, validated: true, kind: "web", rawToken: "https://example.test/session" }; },
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }),
        releaseBrowser: () => {},
        waitForRenderablePage: async () => {},
        wait: async () => { nowVal += 100; },
        now: () => nowVal
    };
    const res = await runExercise(null, "PAL-X", { steps: [{ action: "startJob", expect: ["Done"], waitFor: { timeoutMs: 300, intervalMs: 100 } }], workflow: "web" }, deps);
    assert.equal(res.status, "failed");
    assert.equal(res.category, "behavior", "timeout is behavior failure not retryable");
    assert.equal(tests, 1, "behavior failure must not trigger pre-mutation retry (still 1 test attempt)");
    assert.equal(res.retryAttempted, false);
});

// ---- MCP wrapper seam --------------------------------------------------------

test("MCP wrapper accepts waitFor and rejects invalid waitFor preflight", async () => {
    const ws = tmpWorkspace();
    let loaded = loadStubbedExerciseTools({
        exerciseResult: { ran: true, pass: true, status: "passed", kind: "console", mode: "browser", runId: "run-1" }
    });
    try {
        const tool = findTool(loaded.tools, "pal_exercise");
        const ok = await tool.run({ session: {}, workspaceDir: ws, record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" } },
            { steps: [{ click: "Start", expect: ["Done"], waitFor: { timeoutMs: 5000, intervalMs: 500 } }] });
        assert.equal(ok.pass, true);
    } finally { loaded.restore(); }

    // Invalid waitFor must be rejected through the registered MCP tool, not a stubbed wrapper
    try {
        const serverPath = require.resolve("../src/mcp/server");
        const priorServer = require.cache[serverPath];
        delete require.cache[serverPath];
        const { createServer: createServer2 } = require("../src/mcp/server");
        const server2 = createServer2(async () => ({ session: {}, workspaceDir: ws, record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" }, lifecycle: { onActivity() {} } }), ws);
        const [ct2, st2] = InMemoryTransport.createLinkedPair();
        const client2 = new Client({ name: "waitfor-invalid", version: "0" });
        await Promise.all([server2.connect(st2), client2.connect(ct2)]);
        const listed = await client2.listTools();
        const ex = listed.tools.find(t => t.name === "pal_exercise");
        assert.ok(ex.inputSchema.properties.steps.items.properties.waitFor, "schema must expose waitFor per step");
        const res = await client2.callTool({ name: "pal_exercise", arguments: { steps: [{ click: "Go", expect: ["x"], waitFor: { timeoutMs: 99999 } }] } });
        const text = res.content[0].text;
        assert.match(text, /timeoutMs/, "invalid waitFor timeout must be rejected");
        await client2.close();
        if (priorServer) require.cache[serverPath] = priorServer; else delete require.cache[serverPath];
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});
