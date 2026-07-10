"use strict";
// pal_testing is a session switch: it must stop every automated app-running check before the
// underlying implementation touches a session, browser, or server. Static validation remains on.
const { test } = require("node:test");
const assert = require("node:assert");
const { TOOLS } = require("../src/mcp/tools");

function tool(name) {
    const found = TOOLS.find(t => t.name === name);
    assert.ok(found, "missing tool " + name);
    return found;
}

function context() {
    return {
        session: null,
        record: { palGuid: "PAL-1", palName: "Demo" },
        workspaceDir: process.cwd(),
        lifecycle: { onActivity() { this.calls = (this.calls || 0) + 1; } }
    };
}

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
});
