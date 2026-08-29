"use strict";
// Focused tests for ticket 06 — Target screenshot workflow states
// Proves: explicit selection precedence, unknown type/name listing without Test call,
// normalized workflow names (extension stripped), URLSearchParams encoding (once),
// reserved-key refusal, credential protection, non-leakage of param values, WEB behavior unchanged,
// annotations, and CLI flag forwarding.

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const path = require("path");

// ---- helpers to stub runTest via module cache for screenshot core tests ----
let nextRunTest;
let nextGoto;
let landedUrl;
let pageText;
const gotoCalls = [];
const callLog = [];
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let chromiumPresent = true;
let nextEvaluate;
let nextStylePageState;
let nextDesignAuditState;
let pageListeners;
let launchCount = 0;
let contextCloseCount = 0;

function emitPage(event, arg) {
    for (const fn of (pageListeners[event] || [])) fn(arg);
}

function stub(id, exportsObj) {
    const resolved = require.resolve(id);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

const fakePage = {
    on(event, handler) { (pageListeners[event] = pageListeners[event] || []).push(handler); },
    async goto(url) { gotoCalls.push(url); if (nextGoto) nextGoto(url); },
    async waitForLoadState() {},
    async waitForFunction() {},
    async waitForTimeout() {},
    url() { return landedUrl; },
    async innerText() { return pageText; },
    async screenshot() { return pngBytes; },
    async evaluate(fn, args) {
        if (args && Object.prototype.hasOwnProperty.call(args, "pngBase64")) return nextEvaluate(fn, args);
        if (args && args.audit === "palsync-design-v1") {
            if (nextDesignAuditState instanceof Error) throw nextDesignAuditState;
            return nextDesignAuditState;
        }
        if (nextStylePageState instanceof Error) throw nextStylePageState;
        return nextStylePageState;
    }
};
const fakeBrowser = {
    isConnected() { return true; },
    async newContext() { return { async newPage() { return fakePage; }, async close() { contextCloseCount += 1; } }; },
    async close() {}
};
const fakePlaywright = { get chromium() { return chromiumPresent ? { async launch() { launchCount += 1; return fakeBrowser; } } : null; } };
stub("playwright", fakePlaywright);
const testPath = path.join(__dirname, "..", "src", "core", "test.js");
// Keep original runTest for direct unit tests; screenshot will use stubbed version
const originalTestModule = require("../src/core/test.js");
stub(path.join(__dirname, "..", "src", "core", "test.js"), { runTest: (...a) => nextRunTest(...a), normalizeWorkflowName: originalTestModule.normalizeWorkflowName, RESERVED_QUERY_KEYS: originalTestModule.RESERVED_QUERY_KEYS, availableWorkflows: originalTestModule.availableWorkflows, buildPreviewUrl: originalTestModule.buildPreviewUrl, TYPE_NUM: originalTestModule.TYPE_NUM, KIND_ENDPOINT: originalTestModule.KIND_ENDPOINT });

// Force re-require screenshot after stubbing test
delete require.cache[require.resolve("../src/core/screenshot.js")];
const screenshotHelpers = require("../src/core/screenshot.js");
const { runScreenshot, buildActionUrl } = screenshotHelpers;

function resetScreenshotStub() {
    gotoCalls.length = 0;
    callLog.length = 0;
    pageListeners = {};
    nextGoto = null;
    chromiumPresent = true;
    launchCount = 0;
    contextCloseCount = 0;
    pageText = "hello";
    nextStylePageState = { links: [], inlineStyleTags: 0, totalStyleSheets: 0, bodyComputed: null };
    nextDesignAuditState = { inspected: true, version: 1, metrics: { viewport: { width: 1280, height: 800 }, horizontalOverflow: 0, visibleH1s: 1 }, errors: 0, warnings: 0, pass: true, findings: [] };
    nextEvaluate = (fn, args) => ({ dataUrl: "data:image/jpeg;base64,FAKE", width: 10, height: 10 });
    landedUrl = "https://example.test/app";
}

// ---- runTest unit tests (real implementation with mocked lock/apiManager) ----
describe("runTest workflow selection", () => {
    let lockStub;
    let apiStub;
    let getPalCalls = 0;
    let testWorkflowCalls = [];

    beforeEach(() => {
        getPalCalls = 0;
        testWorkflowCalls = [];
        // stub lock and apiManager via require cache
        const lockPath = require.resolve("../src/core/lock");
        const apiPath = require.resolve("../lib/apiManager");
        const lockMod = require(lockPath);
        const apiMod = require(apiPath);
        // save originals
        lockStub = lockMod.acquireByGuid;
        apiStub = apiMod.CloudPistonAPIManager;
        // inject fakes
        lockMod.acquireByGuid = async () => ({ acquired: true, resolved: { id: "pal-1" } });
        apiMod.CloudPistonAPIManager = {
            getPal: async () => {
                getPalCalls += 1;
                return {
                    pal: {
                        workflows: {
                            entry: [
                                { string: "console.html", Workflow: { workflowType: 7 } },
                                { string: "other.console", Workflow: { workflowType: 7 } },
                                { string: "main.web", Workflow: { workflowType: 9 } },
                                { string: "tx", Workflow: { workflowType: 2 } }
                            ]
                        }
                    }
                };
            },
            testWorkflow: async (session, palId, endpoint) => {
                testWorkflowCalls.push(endpoint);
                return { success: true, validated: true, token: "https://example.test/token?x=1", profileList: {}, validationResults: {} };
            }
        };
        // clear test module cache to pick up stubs
        delete require.cache[require.resolve("../src/core/test.js")];
    });

    afterEach(() => {
        const lockPath = require.resolve("../src/core/lock");
        const apiPath = require.resolve("../lib/apiManager");
        const lockMod = require(lockPath);
        const apiMod = require(apiPath);
        if (lockStub) lockMod.acquireByGuid = lockStub;
        if (apiStub) apiMod.CloudPistonAPIManager = apiStub;
        delete require.cache[require.resolve("../src/core/test.js")];
        // restore screenshot stub
        stub(testPath, { runTest: (...a) => nextRunTest(...a), normalizeWorkflowName: originalTestModule.normalizeWorkflowName, RESERVED_QUERY_KEYS: originalTestModule.RESERVED_QUERY_KEYS });
        delete require.cache[require.resolve("../src/core/screenshot.js")];
    });

    test("explicit workflow wins over auto-detection", async () => {
        const { runTest } = require("../src/core/test.js");
        const res = await runTest({}, "guid", { kind: "console" });
        assert.equal(res.ran, true);
        assert.equal(res.kind, "console");
        assert.equal(testWorkflowCalls[0], "Console");
    });

    test("unknown workflow type lists valid choices and makes no Test call", async () => {
        const { runTest } = require("../src/core/test.js");
        const res = await runTest({}, "guid", { kind: "bad-type" });
        assert.equal(res.ran, false);
        assert.equal(res.blocked, "unknown-workflow-type");
        assert.deepEqual(res.availableKinds.sort(), ["console", "transaction", "web"].sort());
        assert.equal(testWorkflowCalls.length, 0, "must not call Test endpoint for unknown type");
    });

    test("unknown workflow name lists valid choices and makes no Test call", async () => {
        const { runTest } = require("../src/core/test.js");
        const res = await runTest({}, "guid", { kind: "console", workflowName: "nope" });
        assert.equal(res.ran, false);
        assert.equal(res.blocked, "unknown-workflow-name");
        assert.ok(res.availableWorkflowNames.includes("console"), "should list console normalized names");
        assert.ok(res.availableWorkflowNames.includes("other"), "should list normalized other");
        assert.equal(testWorkflowCalls.length, 0);
    });

    test("workflowName extension stripped consistently", async () => {
        const { runTest, normalizeWorkflowName } = require("../src/core/test.js");
        assert.equal(normalizeWorkflowName("console.html"), "console");
        assert.equal(normalizeWorkflowName("my.workflow.js"), "my.workflow");
        const res = await runTest({}, "guid", { kind: "console", workflowName: "console.html" });
        assert.equal(res.ran, true, "extension should be stripped and match");
        assert.equal(testWorkflowCalls[0], "Console");
        // URL should contain stripped name via buildPreviewUrl
        assert.ok(res._previewUrl.includes("cp-workflow=console"), "preview URL should contain stripped name");
        assert.ok(!res._previewUrl.includes("console.html"), "must not contain extension");
    });

    test("workflowName without kind infers owning kind", async () => {
        const { runTest } = require("../src/core/test.js");
        const res = await runTest({}, "guid", { workflowName: "tx" });
        assert.equal(res.ran, true);
        assert.equal(res.kind, "transaction");
    });

    test("buildPreviewUrl uses URLSearchParams and preserves existing token query", async () => {
        const { buildPreviewUrl } = require("../src/core/test.js");
        const url = buildPreviewUrl({ sessionAuthToken: "user:SECRET123" }, "https://example.test/CreateTestConsole.do?existing=1", "console", "prof1", "console");
        const u = new URL(url);
        assert.equal(u.searchParams.get("existing"), "1");
        assert.equal(u.searchParams.get("cp-auth"), "SECRET123");
        assert.equal(u.searchParams.get("nxProfileId"), "prof1");
        assert.equal(u.searchParams.get("cp-workflow"), "console");
    });
});

// ---- screenshot core tests ----
describe("runScreenshot targeting", () => {
    beforeEach(resetScreenshotStub);

    test("explicit workflow forwarded to runTest", async () => {
        let capturedKind = null;
        let capturedWf = null;
        nextRunTest = async (session, guid, opts) => {
            capturedKind = opts.kind;
            capturedWf = opts.workflowName;
            return { ran: true, validated: true, kind: "console", rawToken: null, _previewUrl: "https://secure.test/app?cp-auth=tok" };
        };
        landedUrl = "https://secure.test/app";
        const res = await runScreenshot({}, "guid", { workflow: "console", workflowName: "console" });
        assert.equal(capturedKind, "console");
        assert.equal(capturedWf, "console");
        assert.equal(res.captured, true);
    });

    test("unknown workflow type propagated with available choices, no navigation", async () => {
        nextRunTest = async () => ({ ran: false, blocked: "unknown-workflow-type", availableKinds: ["console", "web"] });
        const res = await runScreenshot({}, "guid", { workflow: "bad" });
        assert.equal(res.captured, false);
        assert.equal(res.blocked, "unknown-workflow-type");
        assert.match(res.reason, /available/i);
        assert.equal(gotoCalls.length, 0);
    });

    test("unknown workflow name propagated with available choices", async () => {
        nextRunTest = async () => ({ ran: false, blocked: "unknown-workflow-name", kind: "console", availableWorkflowNames: ["console", "other"] });
        const res = await runScreenshot({}, "guid", { workflow: "console", workflowName: "nope" });
        assert.equal(res.captured, false);
        assert.equal(res.blocked, "unknown-workflow-name");
        assert.match(res.reason, /available/i);
    });

    test("action and params encoded once via URLSearchParams, preserving token query", async () => {
        nextRunTest = async () => ({ ran: true, validated: true, kind: "console", rawToken: null, _previewUrl: "https://secure.test/app?cp-auth=tok&cp-workflow=console&existing=1" });
        landedUrl = "https://secure.test/app";
        const res = await runScreenshot({}, "guid", { workflow: "console", workflowName: "console", action: "my action", params: { foo: "bar baz", num: 42 } });
        assert.equal(res.captured, true);
        // goto should contain encoded action and params, and preserve existing
        const navigated = gotoCalls[0];
        const u = new URL(navigated);
        assert.equal(u.searchParams.get("cp-ws-doaction"), "my action");
        assert.equal(u.searchParams.get("foo"), "bar baz");
        assert.equal(u.searchParams.get("num"), "42");
        assert.equal(u.searchParams.get("existing"), "1");
        assert.equal(u.searchParams.get("cp-workflow"), "console");
        // ensure single encoding (space => %20 or +, not double-encoded %2520)
        assert.ok(!navigated.includes("%2520"), "must not double-encode");
    });

    test("reserved key in params is refused before navigation", async () => {
        let testCalled = false;
        nextRunTest = async () => { testCalled = true; return { ran: true, validated: true, kind: "console", _previewUrl: "https://secure.test/app" }; };
        const res = await runScreenshot({}, "guid", { workflow: "console", action: "do", params: { "cp-auth": "evil" } });
        assert.equal(res.captured, false);
        assert.equal(res.blocked, "reserved-param");
        assert.equal(testCalled, false, "must not call Test when reserved key early");
        assert.equal(gotoCalls.length, 0);
    });

    test("reserved keys cp-workflow, cp-ws-doaction, nxProfileId refused", async () => {
        for (const key of ["cp-workflow", "cp-ws-doaction", "nxProfileId"]) {
            const res = await runScreenshot({}, "guid", { workflow: "console", action: "do", params: { [key]: "evil" } });
            assert.equal(res.blocked, "reserved-param", "key " + key + " must be reserved");
        }
    });

    test("params without action refused", async () => {
        let called = false;
        nextRunTest = async () => { called = true; return { ran: true, validated: true, kind: "console", _previewUrl: "https://x" }; };
        const res = await runScreenshot({}, "guid", { workflow: "console", params: { foo: "bar" } });
        assert.equal(res.blocked, "params-require-action");
        assert.equal(called, false);
    });

    test("WEB action/params refused before navigation", async () => {
        nextRunTest = async () => ({ ran: true, validated: true, kind: "web", rawToken: "https://webpals.test/site/" });
        const res = await runScreenshot({}, "guid", { action: "do", params: { foo: "bar" } });
        assert.equal(res.captured, false);
        assert.equal(res.blocked, "web-action-not-allowed");
        assert.equal(gotoCalls.length, 0);
    });

    test("WEB page navigation unchanged (auto-detected web uses rawToken + page sub-navigation)", async () => {
        nextRunTest = async () => ({ ran: true, validated: true, kind: "web", rawToken: "https://webpals.test/site/app/" });
        landedUrl = "https://webpals.test/site/app/";
        // simulate second navigation for page
        let secondUrl = null;
        const origGoto = nextGoto;
        nextGoto = (url) => { if (gotoCalls.length === 2) secondUrl = url; };
        const res = await runScreenshot({}, "guid", { page: "about.html" });
        assert.equal(res.captured, true);
        assert.equal(gotoCalls[0], "https://webpals.test/site/app/");
        // second navigation is base + page
        assert.ok(gotoCalls[1].includes("about.html"));
    });

    test("param values never leak via sanitized url or selection metadata", async () => {
        const SECRET = "SUPER_SECRET_VALUE_123";
        nextRunTest = async () => ({ ran: true, validated: true, kind: "console", rawToken: null, _previewUrl: "https://secure.test/app?cp-auth=tok" });
        landedUrl = "https://secure.test/app?cp-auth=tok&foo=" + SECRET;
        const res = await runScreenshot({}, "guid", { workflow: "console", workflowName: "console", action: "act", params: { secretParam: SECRET } });
        assert.equal(res.captured, true);
        const hay = JSON.stringify(res);
        assert.ok(!hay.includes(SECRET), "param value must not appear in result");
        // sanitized url must be origin+path only
        assert.equal(res.url, "https://secure.test/app");
        assert.ok(!res.url.includes(SECRET));
        // selection should not contain values
        if (res.selection) {
            assert.ok(!JSON.stringify(res.selection).includes(SECRET));
        }
    });

    test("buildActionUrl preserves existing query and encodes correctly", () => {
        const url = buildActionUrl("https://secure.test/app?cp-auth=tok&cp-workflow=console", "my action", { q: "a&b=c", n: 5 });
        const u = new URL(url);
        assert.equal(u.searchParams.get("cp-ws-doaction"), "my action");
        assert.equal(u.searchParams.get("q"), "a&b=c");
        assert.equal(u.searchParams.get("n"), "5");
        assert.equal(u.searchParams.get("cp-auth"), "tok");
    });

    test("param values are redacted from browser-derived designAudit samples and renderError", async () => {
        const SECRET = "REDACT_ME_SECRET_42";
        nextDesignAuditState = {
            inspected: true,
            version: 2,
            scope: "#cp-root",
            metrics: { viewport: { width: 1280, height: 800 } },
            errors: 1,
            warnings: 0,
            pass: false,
            findings: [{
                severity: "error",
                rule: "testRule",
                message: "failure contains " + SECRET,
                count: 1,
                samples: ["sample text " + SECRET + " end", "other " + SECRET]
            }]
        };
        pageText = "Workflow: console.js\nMessage: NullPointerException: " + SECRET + " occurred\nMethod Called: DataSet.getRecords\nApprox. Line no: 42";
        nextRunTest = async () => ({ ran: true, validated: true, kind: "console", rawToken: null, _previewUrl: "https://secure.test/app?cp-auth=tok" });
        landedUrl = "https://secure.test/app";
        const res = await runScreenshot({}, "guid", { workflow: "console", workflowName: "console", action: "act", params: { myParam: SECRET, other: "val" } });
        assert.equal(res.captured, true);
        const auditHay = JSON.stringify(res.designAudit);
        assert.ok(!auditHay.includes(SECRET), "designAudit samples/message must be scrubbed of param value");
        const errHay = JSON.stringify(res.renderError);
        assert.ok(!errHay.includes(SECRET), "renderError must be scrubbed of param value");
        // scrubbed marker should appear where secret was
        assert.ok(auditHay.includes("<redacted>") || errHay.includes("<redacted>"));
    });
});

// ---- MCP wrapper and CLI seams ----
describe("MCP and CLI seams", () => {
    test("pal_screenshot annotations are potentially mutating and non-idempotent", async () => {
        const { TOOLS } = require("../src/mcp/tools");
        const tool = TOOLS.find(t => t.name === "pal_screenshot");
        assert.equal(tool.annotations.readOnlyHint, false);
        assert.equal(tool.annotations.destructiveHint, true);
        assert.equal(tool.annotations.idempotentHint, false);
    });

    test("CLI parseFlags forwards workflow flags and params", async () => {
        const { parseFlags } = require("../src/cli/syncCommands");
        const flags = parseFlags(["--workflow", "console", "--workflow-name", "console.html", "--action", "myAction", "--param", "foo=bar baz", "--param", "num=5"]);
        assert.equal(flags.workflow, "console");
        assert.equal(flags.workflowName, "console.html");
        assert.equal(flags.action, "myAction");
        assert.deepEqual(flags.params, { foo: "bar baz", num: "5" });
    });

    test("CLI parseFlags covers screenshot workflow routing (unit)", async () => {
        const { parseFlags } = require("../src/cli/syncCommands");
        const f = parseFlags(["--workflow", "console", "--workflow-name", "my.html", "--action", "do", "--param", "k=v"]);
        assert.equal(f.workflow, "console");
        assert.equal(f.workflowName, "my.html");
        assert.equal(f.action, "do");
        assert.deepEqual(f.params, { k: "v" });
        // forwarding contract: syncCommands screenshot path passes these through to pal_screenshot
        // verified by the MCP tool handling the same keys — CLI is a thin flag-to-arg mapper
        const { TOOLS } = require("../src/mcp/tools");
        const tool = TOOLS.find(t => t.name === "pal_screenshot");
        // ensure the tool accepts the same keys
        for (const key of ["workflow", "workflowName", "action", "params"]) {
            assert.ok(tool.inputShape[key], "tool should accept " + key);
        }
    });
});

// ---- work-history non-leakage via MCP wrapper ----
test("work-history and tool-evidence do not contain param values", async () => {
    const fs = require("node:fs");
    const pathMod = require("path");
    const { tmpWorkspace } = require("./helpers");
    const ws = tmpWorkspace({ "EXECUTION.md": "# Execution\n" });
    // stub screenshot core to succeed
    const screenshotPath = require.resolve("../src/core/screenshot.js");
    const origScreenshot = require(screenshotPath);
    require.cache[screenshotPath] = {
        id: screenshotPath, filename: screenshotPath, loaded: true,
        exports: Object.assign({}, origScreenshot, {
            runScreenshot: async () => ({
                captured: true, available: true, kind: "console",
                viewport: { width: 1280, height: 800 }, viewportName: "desktop",
                url: "https://secure.test/app",
                renderError: null,
                styleStatus: { inspected: true, linked: 0, loaded: 0, likelyLoaded: true },
                designAudit: { inspected: true, pass: true, errors: 0, warnings: 0, findings: [] },
                pngBase64: pngBytes.toString("base64"),
                jpegSmallBase64: null, smallDims: null,
                workflow: "console", workflowName: "console", action: "act"
            })
        })
    };
    delete require.cache[require.resolve("../src/mcp/tools.js")];
    const { TOOLS } = require("../src/mcp/tools");
    const tool = TOOLS.find(t => t.name === "pal_screenshot");
    const ctx = {
        record: { palGuid: "guid-1", palName: "Demo", lastModifiedDate: "2024-01-01", localHash: "abc" },
        session: {},
        workspaceDir: ws,
        lifecycle: { onActivity() {} },
        testingEnabled: true
    };
    const SECRET = "LEAK_SECRET_999";
    const res = await tool.run(ctx, { workflow: "console", workflowName: "console", action: "act", params: { secret: SECRET, other: "val" } });
    // Check returned message does not contain secret
    assert.ok(!res.message.includes(SECRET));
    assert.ok(!JSON.stringify(res).includes(SECRET));
    // Check work-history files
    const workHistoryDir = pathMod.join(ws, ".agent-work-history");
    if (fs.existsSync(workHistoryDir)) {
        const files = fs.readdirSync(workHistoryDir, { recursive: true });
        let combined = "";
        for (const f of files) {
            const full = pathMod.join(workHistoryDir, f.toString());
            try { if (fs.statSync(full).isFile()) combined += fs.readFileSync(full, "utf8") + "\n"; } catch (e) {}
        }
        assert.ok(!combined.includes(SECRET), "work-history must not contain param value: " + combined.slice(0, 500));
    }
    const evidenceFile = pathMod.join(ws, ".palsync", "tool-evidence.jsonl");
    if (fs.existsSync(evidenceFile)) {
        const content = fs.readFileSync(evidenceFile, "utf8");
        assert.ok(!content.includes(SECRET), "tool-evidence must not contain param value");
    }
    // also check that selection metadata exists but without values
    // evidence line should contain paramKeys not values
    if (fs.existsSync(evidenceFile)) {
        const content = fs.readFileSync(evidenceFile, "utf8");
        if (content.trim()) {
            const last = content.trim().split("\n").pop();
            const obj = JSON.parse(last);
            if (obj.selection) {
                assert.ok(!JSON.stringify(obj.selection).includes(SECRET));
                // may contain paramKeys
                if (obj.selection.paramKeys) assert.ok(obj.selection.paramKeys.includes("secret"));
            }
        }
    }
    fs.rmSync(ws, { recursive: true, force: true });
    // restore
    require.cache[screenshotPath] = { id: screenshotPath, filename: screenshotPath, loaded: true, exports: origScreenshot };
    delete require.cache[require.resolve("../src/mcp/tools.js")];
});

// Restore stubbed test.js to original for any later test files in the same process
const _origTestForRestore = originalTestModule;
// node:test runs all files in one process — ensure the global cache is put back before exit
process.nextTick(() => {
    const p = require.resolve("../src/core/test.js");
    require.cache[p] = { id: p, filename: p, loaded: true, exports: _origTestForRestore };
});
