"use strict";
// Ticket 08 — bounded, scrubbed final-state text snapshot ONLY after the entire exercise succeeds.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");
const { exerciseByBrowser, exerciseByFetch, runExercise, formatExercise, makeFinalSnapshot, FINAL_TEXT_CAP, FINAL_TEXT_TRUNCATE_MARK } = require("../src/core/exercise");
const usage = require("../src/core/usage");

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
        restore() { for (const [p, c] of saved) { if (c) require.cache[p] = c; else delete require.cache[p]; } }
    };
}

function findTool(tools, name) {
    const t = tools.find(x => x.name === name);
    assert.ok(t, "missing tool " + name);
    return t;
}

function makeBrowserPage({ textsByCall }) {
    let call = 0;
    const pg = {
        on() {},
        url: () => "https://example.test/app",
        locator() { return { async count() { return 1; }, first() { return this; }, getByText() { return this; }, async click() {} }; },
        getByText() { return { async count() { return 1; }, first() { return this; }, async click() {} }; },
        async innerText() {
            const v = textsByCall[Math.min(call, textsByCall.length - 1)];
            call++;
            return v;
        },
        async content() { return "<body>" + textsByCall[Math.min(call - 1, textsByCall.length - 1)] + "</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {},
        async evaluate() { return {}; }, async screenshot() { return Buffer.from("x"); }
    };
    return pg;
}

// ---- browser final visible text after last step ---------------------------------

test("browser success: finalSnapshot is visible text after LAST step (not earlier screen)", async () => {
    let call = 0;
    const texts = ["First visible", "Second final visible"];
    const pg = {
        on() {},
        url: () => "https://example.test/app",
        locator() { return { async count() { return 1; }, first() { return this; } }; },
        getByText() { return { async count() { return 1; }, first() { return this; }, async click() {} }; },
        async innerText() { return texts[call++]; },
        async content() { return "<body>" + texts[call - 1] + "</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {},
        async evaluate() { return {}; }, async screenshot() { return Buffer.from("x"); }
    };
    const res = await exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        [{ expect: ["First"] }, { expect: ["Second"] }],
        undefined,
        { loadChromium: () => ({}), getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }), releaseBrowser: () => {}, waitForRenderablePage: async () => {} }
    );
    assert.equal(res.status, "passed");
    assert.equal(res.pass, true);
    assert.ok(res.finalSnapshot, "successful browser run must carry finalSnapshot");
    assert.equal(res.finalSnapshot.source, "visible");
    assert.equal(res.finalSnapshot.text, "Second final visible");
    assert.equal(res.finalSnapshot.truncated, false);
    assert.doesNotMatch(res.finalSnapshot.text, /First visible/);
});

test("browser wait success: finalSnapshot is text state that satisfied wait predicate", async () => {
    let polls = 0;
    const pg = {
        on() {},
        url: () => "https://example.test/app",
        locator() { return { async count() { return 1; }, first() { return this; } }; },
        getByText() { return { async count() { return 1; }, first() { return this; }, async click() {} }; },
        async innerText() {
            polls++;
            return polls < 3 ? "pending" : "Done wait final";
        },
        async content() { return polls < 3 ? "<body>pending</body>" : "<body>Done wait final</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {},
        async evaluate() { return {}; }, async screenshot() { return Buffer.from("x"); }
    };
    const res = await exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        [{ click: "Start", expect: ["Done"], waitFor: { timeoutMs: 5000, intervalMs: 100 } }],
        undefined,
        {
            loadChromium: () => ({}),
            getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }),
            releaseBrowser: () => {},
            waitForRenderablePage: async () => {},
            wait: async () => {},
            now: (() => { let t = 0; return () => { const v = t; t += 100; return v; }; })()
        }
    );
    assert.equal(res.status, "passed");
    assert.equal(res.finalSnapshot.source, "visible");
    assert.equal(res.finalSnapshot.text, "Done wait final");
    assert.ok(polls >= 3);
});

// ---- fetch provenance labeling ----------------------------------------------------

test("fetch success: finalSnapshot provenance is server-markup, never visible", async () => {
    const previewPath = require.resolve("../src/core/preview");
    const savedPreview = require.cache[previewPath];
    const html = "<html><body>Server markup final</body></html>";
    require.cache[previewPath] = {
        id: previewPath, filename: previewPath, loaded: true, exports: Object.assign({}, savedPreview.exports, {
            openInstanceSessionFromTest: async () => ({
                opened: true,
                fetchPath: async () => ({ status: 200, html, contentType: "text/html", title: "t", bytes: html.length })
            })
        })
    };
    try {
        const res = await runExercise(null, "PAL-X", { steps: [{ action: "list", expect: ["Server"] }], workflow: "web" }, {
            runTest: async () => ({ ran: true, validated: true, kind: "web" }),
            exerciseByBrowser: async () => { throw new Error("must not use browser for fetch-only"); }
        });
        assert.equal(res.mode, "fetch");
        assert.equal(res.status, "passed");
        assert.ok(res.finalSnapshot);
        assert.equal(res.finalSnapshot.source, "server-markup");
        assert.ok(res.finalSnapshot.text.includes("Server markup final"));
        assert.notEqual(res.finalSnapshot.source, "visible", "fetch output must never be labeled visible");
    } finally {
        if (savedPreview) require.cache[previewPath] = savedPreview; else delete require.cache[previewPath];
    }
});

test("MCP wrapper: fetch finalSnapshot labeled server-markup not visible (tool-wrapper seam)", async () => {
    const ws = tmpWorkspace();
    const markup = "<html>fetch body</html>";
    const loaded = loadStubbedExerciseTools({
        exerciseResult: { ran: true, pass: true, status: "passed", kind: "web", mode: "fetch", runId: "run-1", steps: [], finalSnapshot: makeFinalSnapshot(markup, "server-markup") }
    });
    try {
        const out = await findTool(loaded.tools, "pal_exercise").run({
            session: {}, workspaceDir: ws, record: { palGuid: "P1", palName: "Demo", lastModifiedDate: "M1" }
        }, { steps: [{ action: "list", expect: ["x"] }] });
        assert.equal(out.finalSnapshot.source, "server-markup");
        assert.notEqual(out.finalSnapshot.source, "visible");
        assert.match(out.message, /final snapshot \(server-markup/);
        assert.match(out.message, /server markup/);
    } finally { loaded.restore(); fs.rmSync(ws, { recursive: true, force: true }); }
});

// ---- truncation at cap ----------------------------------------------------------

test("finalSnapshot truncates at cap with explicit marker", async () => {
    const long = "a".repeat(FINAL_TEXT_CAP + 500);
    const snap = makeFinalSnapshot(long, "visible");
    assert.equal(snap.truncated, true);
    assert.equal(snap.text.length, FINAL_TEXT_CAP);
    assert.ok(snap.text.endsWith(FINAL_TEXT_TRUNCATE_MARK));
    const short = "hello";
    const snap2 = makeFinalSnapshot(short, "visible");
    assert.equal(snap2.truncated, false);
    assert.equal(snap2.text, "hello");

    // Browser path truncates too
    const bigText = "b".repeat(FINAL_TEXT_CAP + 100);
    const pg = {
        on() {}, url: () => "https://example.test/app",
        locator() { return { async count() { return 1; }, first() { return this; } }; },
        getByText() { return { async count() { return 1; }, first() { return this; }, async click() {} }; },
        async innerText() { return bigText; },
        async content() { return "<body>" + bigText + "</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {},
        async evaluate() { return {}; }, async screenshot() { return Buffer.from("x"); }
    };
    const res = await exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        [{ expect: [bigText.slice(0, 10)] }],
        undefined,
        { loadChromium: () => ({}), getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }), releaseBrowser: () => {}, waitForRenderablePage: async () => {} }
    );
    assert.equal(res.status, "passed");
    assert.equal(res.finalSnapshot.truncated, true);
    assert.ok(res.finalSnapshot.text.endsWith(FINAL_TEXT_TRUNCATE_MARK));
    assert.equal(res.finalSnapshot.text.length, FINAL_TEXT_CAP);
});

test("fetch finalSnapshot also truncates at cap", async () => {
    const previewPath = require.resolve("../src/core/preview");
    const savedPreview = require.cache[previewPath];
    const bigHtml = "x".repeat(FINAL_TEXT_CAP + 200);
    require.cache[previewPath] = {
        id: previewPath, filename: previewPath, loaded: true, exports: Object.assign({}, savedPreview.exports, {
            openInstanceSessionFromTest: async () => ({
                opened: true,
                fetchPath: async () => ({ status: 200, html: bigHtml, contentType: "text/html", title: "t", bytes: bigHtml.length })
            })
        })
    };
    try {
        const res = await runExercise(null, "PAL-X", { steps: [{ action: "list", expect: [bigHtml.slice(0, 5)] }], workflow: "web" }, {
            runTest: async () => ({ ran: true, validated: true, kind: "web" })
        });
        assert.equal(res.status, "passed");
        assert.equal(res.finalSnapshot.truncated, true);
        assert.ok(res.finalSnapshot.text.endsWith(FINAL_TEXT_TRUNCATE_MARK));
    } finally { if (savedPreview) require.cache[previewPath] = savedPreview; else delete require.cache[previewPath]; }
});

// ---- credential scrubbing -------------------------------------------------------

test("finalSnapshot scrubs credential forms and secret-looking values before return", async () => {
    const raw = 'hello "password": "hunter2" token=SECRET https://example.test/p?cp-auth=SECRET Authorization: Bearer eyJhbGciOi.xxx\nnext line';
    const snap = makeFinalSnapshot(raw, "visible");
    for (const secret of ["hunter2", "SECRET", "eyJhbGciOi"]) {
        assert.doesNotMatch(snap.text, new RegExp(secret), "secret " + secret + " must be scrubbed from finalSnapshot");
    }
    assert.match(snap.text, /<redacted>/);
    // Success snapshot preserves ordinary URLs (no blanket <url>), but redacts query param values
    assert.match(snap.text, /https:\/\/example\.test\/p\?cp-auth=<redacted>/);
    assert.doesNotMatch(snap.text, /<url>/);

    // Browser run carries scrubbed text
    const pg = {
        on() {}, url: () => "https://example.test/app",
        locator() { return { async count() { return 1; }, first() { return this; } }; },
        getByText() { return { async count() { return 1; }, first() { return this; }, async click() {} }; },
        async innerText() { return 'visible with "password": "hunter2" and https://example.test/p?token=SECRET'; },
        async content() { return "<body>visible</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {},
        async evaluate() { return {}; }, async screenshot() { return Buffer.from("x"); }
    };
    const res = await exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        [{ expect: ["visible"] }],
        undefined,
        { loadChromium: () => ({}), getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }), releaseBrowser: () => {}, waitForRenderablePage: async () => {} }
    );
    assert.equal(res.status, "passed");
    for (const secret of ["hunter2", "SECRET", "eyJhbGciOi"]) {
        if (secret === "SECRET") {
            // Browser fixture uses token=SECRET, ensure that value is scrubbed
            assert.doesNotMatch(res.finalSnapshot.text, /SECRET/);
        } else {
            assert.doesNotMatch(res.finalSnapshot.text, new RegExp(secret));
        }
    }
    assert.match(res.finalSnapshot.text, /<redacted>/);
    assert.match(res.finalSnapshot.text, /https:\/\/example\.test\/p\?token=<redacted>/);
});

test("fetch finalSnapshot also scrubs secrets", async () => {
    const previewPath = require.resolve("../src/core/preview");
    const savedPreview = require.cache[previewPath];
    const html = 'body with "password": "hunter2" and https://example.test/p?cp-auth=SECRET';
    require.cache[previewPath] = {
        id: previewPath, filename: previewPath, loaded: true, exports: Object.assign({}, savedPreview.exports, {
            openInstanceSessionFromTest: async () => ({
                opened: true,
                fetchPath: async () => ({ status: 200, html, contentType: "text/html", title: "t", bytes: html.length })
            })
        })
    };
    try {
        const res = await runExercise(null, "PAL-X", { steps: [{ action: "list", expect: ["body"] }], workflow: "web" }, {
            runTest: async () => ({ ran: true, validated: true, kind: "web" })
        });
        assert.equal(res.status, "passed");
        assert.equal(res.finalSnapshot.source, "server-markup");
        assert.doesNotMatch(res.finalSnapshot.text, /hunter2/);
    } finally { if (savedPreview) require.cache[previewPath] = savedPreview; else delete require.cache[previewPath]; }
});

// ---- omission on failure / blocked / invalid ----------------------------------

test("failed, blocked, invalid exercises carry no successful finalSnapshot", async () => {
    // Failed behavior (browser)
    const pgFail = {
        on() {}, url: () => "https://example.test/app",
        locator() { return { async count() { return 1; }, first() { return this; } }; },
        getByText() { return { async count() { return 1; }, first() { return this; }, async click() {} }; },
        async innerText() { return "nope"; },
        async content() { return "<body>nope</body>"; },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {},
        async evaluate() { return "body"; }, async screenshot() { return Buffer.from("x"); }
    };
    const failed = await exerciseByBrowser(
        { kind: "console", _previewUrl: "https://example.test/app" },
        [{ expect: ["missing"] }],
        undefined,
        { loadChromium: () => ({}), getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pgFail, close: async () => {} }) }), releaseBrowser: () => {}, waitForRenderablePage: async () => {} }
    );
    assert.equal(failed.status, "failed");
    assert.equal(failed.finalSnapshot, undefined, "failed run must not claim finalSnapshot");

    // Fetch failed
    const previewPath = require.resolve("../src/core/preview");
    const savedPreview = require.cache[previewPath];
    require.cache[previewPath] = {
        id: previewPath, filename: previewPath, loaded: true, exports: Object.assign({}, savedPreview.exports, {
            openInstanceSessionFromTest: async () => ({
                opened: true,
                fetchPath: async () => ({ status: 200, html: "not matching", contentType: "text/html", title: "t", bytes: 12 })
            })
        })
    };
    try {
        const fetchFailed = await runExercise(null, "PAL-X", { steps: [{ action: "list", expect: ["missing"] }], workflow: "web" }, {
            runTest: async () => ({ ran: true, validated: true, kind: "web" })
        });
        assert.equal(fetchFailed.status, "failed");
        assert.equal(fetchFailed.finalSnapshot, undefined);
    } finally { if (savedPreview) require.cache[previewPath] = savedPreview; else delete require.cache[previewPath]; }

    // Blocked
    const blocked = await runExercise(null, "PAL-X", { steps: [{ expect: ["x"] }] }, {
        runTest: async () => ({ ran: false, blocked: "no-lock", holder: "other" })
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.finalSnapshot, undefined);

    // Invalid
    const invalid = await runExercise(null, "PAL-X", { steps: [{}] });
    assert.equal(invalid.status, "invalid");
    assert.equal(invalid.finalSnapshot, undefined);
});

// ---- successful final text NOT in durable evidence ledger ---------------------

test("successful finalSnapshot text is not copied into durable evidence ledger", async () => {
    const ws = tmpWorkspace();
    const uniqueSecret = "SnapshotSecret-" + Math.random().toString(36).slice(2);
    const snapText = "Visible final " + uniqueSecret + " with body";
    const loaded = loadStubbedExerciseTools({
        exerciseResult: {
            ran: true, pass: true, status: "passed", kind: "console", mode: "browser", runId: "run-1", steps: [],
            finalSnapshot: { source: "visible", text: snapText, truncated: false }
        }
    });
    try {
        const out = await findTool(loaded.tools, "pal_exercise").run({
            session: {}, workspaceDir: ws, record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1", localHash: "digest-1" }
        }, { steps: [{ click: "Save", expect: ["x"] }] });
        assert.ok(out.finalSnapshot);
        assert.equal(out.finalSnapshot.text, snapText);
        // Evidence file must exist and must NOT contain the snapshot text
        const evidence = fs.readFileSync(path.join(ws, ".palsync", "tool-evidence.jsonl"), "utf8");
        assert.doesNotMatch(evidence, new RegExp(uniqueSecret), "snapshot text must not leak into evidence ledger");
        // Existing data-minimized summary shape unchanged: summary fields present, no text field
        const rows = usage.readToolEvidence(ws);
        assert.equal(rows.length, 1);
        assert.ok(rows[0].summary);
        assert.equal(rows[0].summary.workflow, "console");
        assert.ok(!("finalSnapshot" in rows[0]), "ledger row must not carry finalSnapshot");
        assert.ok(!("finalText" in rows[0]), "ledger row must not carry finalText");
        // Ledger summary must not contain the visible text itself
        assert.doesNotMatch(JSON.stringify(rows[0]), new RegExp(uniqueSecret));
    } finally { loaded.restore(); fs.rmSync(ws, { recursive: true, force: true }); }
});

// ---- formatExercise compact block -------------------------------------------

test("formatExercise includes compact final snapshot block on PASS and not on fail", () => {
    const passing = formatExercise({
        ran: true, kind: "web", mode: "fetch", pass: true, status: "passed",
        steps: [], finalSnapshot: { source: "server-markup", text: "hello body\nsecond line", truncated: false }
    });
    assert.match(passing, /final snapshot \(server-markup — server markup, 22 chars\):/);
    assert.match(passing, /\"hello body\"/);
    assert.match(passing, /…/);

    const passingVisible = formatExercise({
        ran: true, kind: "console", mode: "browser", pass: true, status: "passed",
        steps: [], finalSnapshot: { source: "visible", text: "visible body", truncated: true }
    });
    assert.match(passingVisible, /final snapshot \(visible — visible text, 12 chars, truncated\):/);

    const failing = formatExercise({
        ran: true, kind: "console", mode: "browser", pass: false, status: "failed", failedStep: 1,
        steps: [{ step: 1, label: "click \"Save\"", pass: false, expect: [{ string: "x", found: false }], absent: [] }]
    });
    assert.ok(!failing.includes("final snapshot"), "failed output must not claim snapshot");
});

test("MCP wrapper success includes finalSnapshot and format block, failure does not", async () => {
    const ws = tmpWorkspace();
    let loaded = loadStubbedExerciseTools({
        exerciseResult: { ran: true, pass: true, status: "passed", kind: "console", mode: "browser", runId: "run-2", steps: [], finalSnapshot: { source: "visible", text: "ok body", truncated: false } }
    });
    try {
        const ok = await findTool(loaded.tools, "pal_exercise").run({
            session: {}, workspaceDir: ws, record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" }
        }, { steps: [{ click: "Save", expect: ["ok"] }] });
        assert.ok(ok.finalSnapshot);
        assert.match(ok.message, /final snapshot \(visible/);
    } finally { loaded.restore(); }

    loaded = loadStubbedExerciseTools({
        exerciseResult: { ran: true, pass: false, status: "failed", kind: "console", mode: "browser", failedStep: 1, steps: [{ step: 1, label: "click \"Save\"", pass: false }] }
    });
    try {
        const bad = await findTool(loaded.tools, "pal_exercise").run({
            session: {}, workspaceDir: ws, record: { palGuid: "PAL-1", palName: "Demo", lastModifiedDate: "M1" }
        }, { steps: [{ click: "Save", expect: ["missing"] }] });
        assert.equal(bad.finalSnapshot, undefined);
        assert.ok(!bad.message.includes("final snapshot"));
    } finally { loaded.restore(); fs.rmSync(ws, { recursive: true, force: true }); }
});
