"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace, parseEnvelope } = require("./helpers");

// pal_regression was the one lifecycle gate that wrote no durable artifact, so its verdict rested on
// reading the transcript alone. These pin that it now produces the same envelope + content-addressed
// artifact as the other enveloped tools, without losing the human verdict.
function loadTool(regressionResult) {
    const toolsPath = require.resolve("../src/mcp/tools");
    const regressionPath = require.resolve("../src/core/regression");
    const previous = require.cache[toolsPath];
    delete require.cache[toolsPath];
    require.cache[regressionPath] = {
        id: regressionPath, filename: regressionPath, loaded: true,
        exports: { runRegression: async () => regressionResult }
    };
    const { TOOLS } = require("../src/mcp/tools");
    const tool = TOOLS.find(item => item.name === "pal_regression");
    return {
        tool,
        restore() {
            delete require.cache[regressionPath];
            delete require.cache[toolsPath];
            if (previous) require.cache[toolsPath] = previous;
        }
    };
}

function context() {
    const workspaceDir = tmpWorkspace();
    return {
        workspaceDir,
        session: {}, record: { palGuid: "PAL-1" },
        lifecycle: { onActivity() { this.calls = (this.calls || 0) + 1; } },
        async persist() {}
    };
}

const PASSING = {
    ran: true, stale: false, pass: true, mapped: "M1", current: "M1",
    validate: { baseline: { errors: 0, warnings: 0 }, current: { errors: 0, warnings: 0 } },
    tests: [], pages: [{ page: "pages/console.html", fetched: true, status: 200, h1s: [] }],
    caused: [], inherited: [], needs_human: [], notes: [], known_issues: [],
    summary: "REGRESSION PASS — no caused failures."
};

test("1. a passing regression yields a parseable envelope, a durable artifact, and its verdict", async t => {
    const { tool, restore } = loadTool(PASSING);
    t.after(restore);
    const ctx = context();
    const result = await tool.run(ctx, {});
    const { envelope, trailer } = parseEnvelope(result.message);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.summary, PASSING.summary);
    assert.equal(envelope.stale, false);
    assert.equal(envelope.filesChecked, 1);
    assert.deepEqual(envelope.diagnostics, []);
    // The artifact is the point: the verdict is now checkable from disk, not from the transcript.
    assert.match(trailer, /^Full result: .+$/);
    assert.ok(envelope.detailsRef, "envelope carries a details reference");
    const artifact = path.join(ctx.workspaceDir, envelope.detailsRef.split("#")[0].replace(/^\.\//, ""));
    assert.equal(fs.existsSync(artifact), true, artifact);
    assert.equal(JSON.parse(fs.readFileSync(artifact, "utf8")).summary, PASSING.summary);
    assert.ok(result._usage.rawBytes > 0);
    fs.rmSync(ctx.workspaceDir, { recursive: true, force: true });
});

test("2. caused, inherited, needs-human and notes map onto distinct severities", async t => {
    const { tool, restore } = loadTool(Object.assign({}, PASSING, {
        pass: false,
        caused: [{ subject: "validate", detail: "errors rose 0 -> 2" }],
        inherited: [{ subject: "pages/legacy.html", detail: "already broken at baseline" }],
        needs_human: [{ page: "pages/console.html", viewport: "mobile", reason: "eyeball_only viewport" }],
        notes: ["validate warnings rose 1 -> 3"],
        summary: "REGRESSION FAIL — 1 caused failure."
    }));
    t.after(restore);
    const ctx = context();
    const { envelope } = parseEnvelope((await tool.run(ctx, {})).message);
    assert.equal(envelope.ok, false);
    const bySeverity = {};
    for (const item of envelope.diagnostics) bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
    // An INHERITED failure is never the agent's to fix, so it must not read as an error; a needs-human
    // viewport must not read as a pass. The envelope normalizes "warning" to "warn" and carries a rule
    // as `code`, so these assert the shape the agent actually receives.
    assert.equal(bySeverity.error, 1);
    assert.equal(bySeverity.warn, 1);
    assert.equal(bySeverity.info, 2);
    const codes = envelope.diagnostics.map(item => item.code).sort();
    assert.deepEqual(codes, ["regressionCaused", "regressionInherited", "regressionNeedsHuman", "regressionNote"]);
    // Only the caused failure and the needs-human viewport are actionable; inherited breakage and notes
    // must not inflate the count a model triages against.
    assert.equal(envelope.diagnosticCount, 2);
    assert.equal(envelope.infoCount, 2);
    fs.rmSync(ctx.workspaceDir, { recursive: true, force: true });
});

test("3. a stale baseline withholds a verdict rather than reporting a pass", async t => {
    const { tool, restore } = loadTool({
        ran: true, stale: true, mapped: "M1", current: "M2", caused: [], inherited: [],
        needs_human: [], notes: [], pages: [],
        summary: "STALE baseline — the server moved since mapped (M1 -> M2)."
    });
    t.after(restore);
    const ctx = context();
    const { envelope } = parseEnvelope((await tool.run(ctx, {})).message);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.stale, true);
    assert.match(envelope.summary, /STALE baseline/);
    fs.rmSync(ctx.workspaceDir, { recursive: true, force: true });
});

test("4. a regression that never ran keeps its plain summary and writes no artifact", async t => {
    const { tool, restore } = loadTool({ ran: false, noBaseline: true, summary: "No baseline/baseline.json." });
    t.after(restore);
    const ctx = context();
    const result = await tool.run(ctx, {});
    assert.equal(result.message, "No baseline/baseline.json.");
    assert.equal(result.envelope, undefined);
    assert.throws(() => parseEnvelope(result.message));
    fs.rmSync(ctx.workspaceDir, { recursive: true, force: true });
});
