"use strict";
// The completion-gate invariant: browser-review evidence satisfies the gate ONLY when the intended
// state was positively established. UNVERIFIED != PASS, FAIL != PASS, BLOCKED != PASS.
// Drives the real pal_screenshot handler with a stubbed runScreenshot core and reads back the
// durable evidence rows a `palsync review check` would judge.

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const screenshotPath = require.resolve("../src/core/screenshot");
const debugPath = require.resolve("../src/core/debug");
const toolsPath = require.resolve("../src/mcp/tools");
const usage = require("../src/core/usage");

let nextScreenshot;
function loadTools() {
    const saved = new Map([[toolsPath, require.cache[toolsPath]],
        [screenshotPath, require.cache[screenshotPath]], [debugPath, require.cache[debugPath]]]);
    require.cache[screenshotPath] = { id: screenshotPath, filename: screenshotPath, loaded: true, exports: {
        runScreenshot: async (...a) => nextScreenshot(...a)
    } };
    require.cache[debugPath] = { id: debugPath, filename: debugPath, loaded: true, exports: {
        retrieveServerDebug: async () => ({ retrieved: false, reason: "stubbed" })
    } };
    delete require.cache[toolsPath];
    const loaded = require("../src/mcp/tools");
    return {
        tool: loaded.TOOLS.find(t => t.name === "pal_screenshot"),
        restore() {
            for (const [file, cached] of saved) {
                if (cached) require.cache[file] = cached;
                else delete require.cache[file];
            }
        }
    };
}

function ctx(ws) {
    return {
        session: {}, workspaceDir: ws,
        record: { palGuid: "PAL-GATE", palName: "Gate", lastModifiedDate: "2026-09-05", localHash: "abc" }
    };
}

function rows(ws) {
    return usage.readToolEvidence(ws).filter(e => e.tool === "pal_screenshot");
}

function verifiedCapture(viewportName = "desktop") {
    return {
        captured: true, available: true, kind: "console",
        viewport: { width: 1280, height: 800 }, viewportName,
        requestedState: { workflow: "console", workflowName: null, page: null, action: "openClientSetup", paramKeys: ["id"], expect: ["Client Setup"] },
        stateVerified: true,
        observedState: { headings: ["Client Setup"], title: null, expect: [{ string: "Client Setup", found: true }] },
        url: "https://secure.test/app", renderError: null,
        styleStatus: { inspected: true, linked: 1, loaded: 1, likelyLoaded: true, inlineStyleTags: 0, missingStylesheets: [], failedRequests: [], responses: [] },
        designAudit: { inspected: true, pass: true, errors: 0, warnings: 0, metrics: {}, findings: [] },
        pngBase64: Buffer.from("png").toString("base64"),
        jpegSmallBase64: null, smallDims: null
    };
}

describe("pal_screenshot completion-gate evidence", () => {
    test("an UNVERIFIED targeted capture records no clean evidence and says so", async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
        const { tool, restore } = loadTools();
        try {
            nextScreenshot = async () => Object.assign(verifiedCapture(), { stateVerified: null });
            const out = await tool.run(ctx(ws), { workflow: "console", action: "openClientSetup" });
            const rs = rows(ws);
            assert.strictEqual(rs.length, 1);
            assert.strictEqual(rs[0].renderClean, false, "an unproven screen must not be clean evidence");
            assert.strictEqual(rs[0].stateUnverified, true);
            assert.match(out.message, /NOT VERIFIED/);
            assert.match(out.message, /does NOT count toward the render gate/);
            assert.match(out.message, /expect:\[/);
        } finally { restore(); fs.rmSync(ws, { recursive: true, force: true }); }
    });

    test("a VERIFIED capture still records clean evidence (the gate stays satisfiable)", async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
        const { tool, restore } = loadTools();
        try {
            nextScreenshot = async () => verifiedCapture();
            const out = await tool.run(ctx(ws), { workflow: "console", action: "openClientSetup", expect: ["Client Setup"] });
            const rs = rows(ws);
            assert.strictEqual(rs.length, 1);
            assert.strictEqual(rs[0].renderClean, true);
            assert.strictEqual(rs[0].stateUnverified, undefined);
            assert.match(out.message, /state: VERIFIED/);
        } finally { restore(); fs.rmSync(ws, { recursive: true, force: true }); }
    });

    test("an untargeted default-screen capture still counts (no ambiguity to resolve)", async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
        const { tool, restore } = loadTools();
        try {
            nextScreenshot = async () => Object.assign(verifiedCapture(),
                { requestedState: { workflow: null, workflowName: null, page: null, action: null, paramKeys: [], expect: [] }, stateVerified: null });
            await tool.run(ctx(ws), { workflow: "console" });
            assert.strictEqual(rows(ws)[0].renderClean, true);
        } finally { restore(); fs.rmSync(ws, { recursive: true, force: true }); }
    });

    test("a targeting FAILURE records no render evidence at all", async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
        const { tool, restore } = loadTools();
        try {
            nextScreenshot = async () => ({ captured: false, available: true, kind: "console", viewportName: "desktop",
                status: "failed", category: "targeting", requestedState: { action: "openClientSetup" }, reason: "wrong screen" });
            const out = await tool.run(ctx(ws), { workflow: "console", action: "openClientSetup" });
            assert.strictEqual(rows(ws).length, 0, "a failure must leave no render row behind");
            assert.match(out.message, /STATE NOT REACHED/);
        } finally { restore(); fs.rmSync(ws, { recursive: true, force: true }); }
    });
});
