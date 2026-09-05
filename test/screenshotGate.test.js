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
const { responsiveEvidence } = require("../src/core/reviewCheck");

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
        // Mirrors runScreenshot's normalized output: top-level `action` is the action NAME (a
        // combined c:a suffix would already be stripped) — the tool's identity/selection derive
        // from this, never from the raw MCP argument.
        action: "openClientSetup",
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

    test("desktop evidence of one Console action and mobile of another do NOT satisfy responsive coverage", async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
        const { tool, restore } = loadTools();
        try {
            nextScreenshot = async () => verifiedCapture();
            await tool.run(ctx(ws), { workflow: "console", action: "openClientSetup", expect: ["Client Setup"] });
            nextScreenshot = async () => Object.assign(verifiedCapture("mobile"),
                { action: "openClientList",
                  requestedState: { workflow: "console", workflowName: null, page: null, action: "openClientList", paramKeys: ["id"], expect: ["Client List"] },
                  observedState: { headings: ["Client List"], title: null, expect: [{ string: "Client List", found: true }] } });
            await tool.run(ctx(ws), { workflow: "console", action: "openClientList", expect: ["Client List"] });
            const rs = rows(ws);
            assert.strictEqual(rs.length, 2);
            assert.strictEqual(new Set(rs.map(r => r.route)).size, 2, "each distinct Console action must key its own route");
            const resp = responsiveEvidence(rs, "PAL-GATE", "2026-09-05", "abc");
            assert.strictEqual(resp.complete, false);
            assert.strictEqual(resp.incomplete.length, 2, "both routes are incomplete (desktop-only / mobile-only)");
        } finally { restore(); fs.rmSync(ws, { recursive: true, force: true }); }
    });

    test("desktop and mobile evidence of the SAME Console action DO satisfy responsive coverage", async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
        const { tool, restore } = loadTools();
        try {
            nextScreenshot = async () => verifiedCapture();
            await tool.run(ctx(ws), { workflow: "console", action: "openClientSetup", expect: ["Client Setup"] });
            nextScreenshot = async () => verifiedCapture("mobile");
            await tool.run(ctx(ws), { workflow: "console", action: "openClientSetup", expect: ["Client Setup"] });
            const rs = rows(ws);
            assert.strictEqual(new Set(rs.map(r => r.route)).size, 1, "both viewports must share one route key");
            const resp = responsiveEvidence(rs, "PAL-GATE", "2026-09-05", "abc");
            assert.strictEqual(resp.complete, true);
        } finally { restore(); fs.rmSync(ws, { recursive: true, force: true }); }
    });

    test("a combined c:a action never persists its parameter VALUE (route + selection stay key-only)", async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
        const { tool, restore } = loadTools();
        try {
            nextScreenshot = async () => verifiedCapture(); // stub returns action "openClientSetup", paramKeys ["id"]
            await tool.run(ctx(ws), { workflow: "console", action: "openClientSetup?id=SECRET-VALUE-999", expect: ["Client Setup"] });
            const rs = rows(ws);
            assert.strictEqual(rs.length, 1);
            assert.ok(!JSON.stringify(rs).includes("SECRET-VALUE-999"), "the secret value must never reach any evidence row");
            assert.strictEqual(rs[0].route, "console:default:openClientSetup[id]");
            assert.strictEqual(rs[0].selection.action, "openClientSetup");
            assert.deepStrictEqual(rs[0].selection.paramKeys, ["id"]);
        } finally { restore(); fs.rmSync(ws, { recursive: true, force: true }); }
    });

    test("the work-history metadata.json selection carries the same normalized fields", async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
        const { tool, restore } = loadTools();
        try {
            nextScreenshot = async () => verifiedCapture();
            await tool.run(ctx(ws), { workflow: "console", action: "openClientSetup?id=SECRET-VALUE-999", expect: ["Client Setup"] });
            const historyRoot = path.join(ws, ".agent-work-history");
            const metas = [];
            for (const dir of fs.readdirSync(historyRoot)) {
                const metaPath = path.join(historyRoot, dir, "metadata.json");
                if (fs.existsSync(metaPath)) metas.push(JSON.parse(fs.readFileSync(metaPath, "utf8")));
            }
            assert.ok(metas.length >= 1, "a work-history run should exist");
            const meta = metas.find(m => m.selection && m.selection.action === "openClientSetup");
            assert.ok(meta, "metadata.json should carry the normalized action name");
            assert.deepStrictEqual(meta.selection.paramKeys, ["id"]);
            assert.ok(!JSON.stringify(metas).includes("SECRET-VALUE-999"));
        } finally { restore(); fs.rmSync(ws, { recursive: true, force: true }); }
    });

    test("WEB page evidence still routes on the page for responsive coverage", async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
        const { tool, restore } = loadTools();
        try {
            const webCapture = (viewportName, page) => Object.assign(verifiedCapture(viewportName), {
                kind: "web",
                requestedState: { workflow: "web", workflowName: null, page, action: null, paramKeys: [], expect: ["Equipment List"] },
                observedState: { headings: ["Equipment List"], title: null, expect: [{ string: "Equipment List", found: true }] }
            });
            nextScreenshot = async () => webCapture("desktop", "equipment.pal");
            await tool.run(ctx(ws), { workflow: "web", page: "equipment.pal", expect: ["Equipment List"] });
            nextScreenshot = async () => webCapture("mobile", "equipment.pal");
            await tool.run(ctx(ws), { workflow: "web", page: "equipment.pal", expect: ["Equipment List"] });
            const rs = rows(ws);
            assert.ok(rs.every(r => r.route === "page:equipment.pal"), "both WEB rows key on the page route");
            assert.strictEqual(responsiveEvidence(rs, "PAL-GATE", "2026-09-05", "abc").complete, true);
        } finally { restore(); fs.rmSync(ws, { recursive: true, force: true }); }
    });

    test("a default WEB capture (no page) routes page:/", async () => {
        const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
        const { tool, restore } = loadTools();
        try {
            nextScreenshot = async () => Object.assign(verifiedCapture(), {
                kind: "web",
                requestedState: { workflow: "web", workflowName: null, page: null, action: null, paramKeys: [], expect: [] }
            });
            await tool.run(ctx(ws), { workflow: "web" });
            assert.strictEqual(rows(ws)[0].route, "page:/");
        } finally { restore(); fs.rmSync(ws, { recursive: true, force: true }); }
    });
});

describe("screenshotEvidenceIdentity route identities", () => {
    test("WEB keys on the page route with leading-slash normalization", () => {
        const { screenshotEvidenceIdentity } = require("../src/mcp/tools");
        assert.strictEqual(screenshotEvidenceIdentity({ kind: "web" }), "page:/");
        assert.strictEqual(screenshotEvidenceIdentity({ kind: "web", page: "equipment.pal" }), "page:equipment.pal");
        assert.strictEqual(screenshotEvidenceIdentity({ kind: "web", page: "/equipment.pal" }), "page:equipment.pal");
    });
    test("console keys on kind:workflowName:action with key names only", () => {
        const { screenshotEvidenceIdentity } = require("../src/mcp/tools");
        assert.strictEqual(screenshotEvidenceIdentity({ kind: "console" }), "console:default:entry");
        assert.strictEqual(screenshotEvidenceIdentity({ kind: "console", action: "openClientSetup?id=9" }), "console:default:openClientSetup");
        assert.strictEqual(screenshotEvidenceIdentity({ kind: "console", action: "openClientSetup", paramKeys: ["id", "secret"] }), "console:default:openClientSetup[id,secret]");
        assert.strictEqual(screenshotEvidenceIdentity({ kind: "console", action: "openClientSetup", paramKeys: ["secret", "id"] }), "console:default:openClientSetup[id,secret]");
        assert.strictEqual(screenshotEvidenceIdentity({ kind: "transaction", workflowName: "setup.wf" }), "transaction:setup.wf:entry");
    });
});
