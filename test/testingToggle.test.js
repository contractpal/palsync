"use strict";
// pal_testing is a session switch: it must stop every automated app-running check before the
// underlying implementation touches a session, browser, or server. Static validation remains on.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { TOOLS } = require("../src/mcp/tools");
const { tmpWorkspace } = require("./helpers");
const usage = require("../src/core/usage");

function tool(name) {
    const found = TOOLS.find(t => t.name === name);
    assert.ok(found, "missing tool " + name);
    return found;
}

// A real tmp workspace, not cwd — pal_screenshot writes a durable evidence row even when
// testing is off, and that must never land in the repo. Callers own cleanup.
function context() {
    return {
        session: null,
        record: { palGuid: "PAL-1", palName: "Demo" },
        workspaceDir: tmpWorkspace(),
        lifecycle: { onActivity() { this.calls = (this.calls || 0) + 1; } }
    };
}

function cleanup(ctx) { fs.rmSync(ctx.workspaceDir, { recursive: true, force: true }); }

test("pal_testing toggles automated testing for the current session", async () => {
    const ctx = context();
    const testing = tool("pal_testing");

    assert.equal((await testing.run(ctx, {})).enabled, true, "default is on");
    const off = await testing.run(ctx, { enabled: false });
    assert.equal(off.enabled, false);
    assert.match(off.message, /OFF/);
    assert.equal(ctx.testingEnabled, false);

    const on = await testing.run(ctx, { enabled: true });
    assert.equal(on.enabled, true);
    assert.equal(ctx.testingEnabled, true);
    cleanup(ctx);
});

test("testing off skips every automated app-running tool before it uses the session", async () => {
    const ctx = context();
    await tool("pal_testing").run(ctx, { enabled: false });

    for (const name of [
        "pal_test", "pal_tunnel_test", "pal_preview", "pal_fetch", "pal_screenshot",
        "pal_exercise", "pal_seo_audit", "pal_regression"
    ]) {
        const result = await tool(name).run(ctx, {});
        assert.equal(result.ran, false, name);
        assert.equal(result.skipped, true, name);
        assert.equal(result.testingEnabled, false, name);
        assert.match(result.message, /Automated testing is OFF/, name);
    }
    assert.equal(ctx.lifecycle.calls || 0, 0, "disabled tools must not touch the lifecycle");
    cleanup(ctx);
});

// pal_testing enabled:false returns from testingDisabledResult BEFORE runScreenshot runs, and
// ctx.testingEnabled is in-memory MCP state the offline `palsync review check` cannot see. The
// durable signal row (viewportName:null, never a viewport pass) is the only cross-process trace
// that the responsive requirement degraded to a human gate.
test("testing off still writes a durable pal_screenshot signal row", async () => {
    const ctx = context();
    await tool("pal_testing").run(ctx, { enabled: false });

    const result = await tool("pal_screenshot").run(ctx, { page: "/board" });
    assert.equal(result.skipped, true);
    assert.equal(result.evidenceRecorded, true);
    const rows = usage.readToolEvidence(ctx.workspaceDir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tool, "pal_screenshot");
    assert.equal(rows[0].route, "/board");
    assert.equal(rows[0].viewportName, null);
    assert.equal(rows[0].renderClean, false);
    assert.equal(rows[0].unavailable, true);
    assert.equal(rows[0].testingDisabled, true);
    cleanup(ctx);
});

test("re-enabling testing removes the guard", async () => {
    const ctx = context();
    await tool("pal_testing").run(ctx, { enabled: false });
    await tool("pal_testing").run(ctx, { enabled: true });

    // Invalid exercise steps return before any server call, so this proves the toggle no longer
    // short-circuits the tool without needing a real authenticated session.
    const result = await tool("pal_exercise").run(ctx, { steps: [{}] });
    assert.equal(result.skipped, undefined);
    assert.equal(result.invalid, true);
    assert.equal(ctx.lifecycle.calls, 1, "the re-enabled tool reached its normal lifecycle hook");
    cleanup(ctx);
});
