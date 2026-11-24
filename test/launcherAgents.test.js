"use strict";
// The agent registry's launch flags. Pi's built-in MCP support exposes palsync + Playwright tools
// as deferred codemode tools, so the launcher must enable codemode or the pal_* tools never appear.
const { test } = require("node:test");
const assert = require("node:assert");
const { AGENTS, resolve } = require("../src/launcher/agents");

test("Pi launches with codemode enabled", () => {
    const pi = resolve("pi");
    assert.ok(pi, "pi is in the agent registry");
    assert.deepStrictEqual(pi.args, ["--tools", "+codemode"]);
});

test("only Pi adds launch flags", () => {
    for (const agent of AGENTS) {
        if (agent.key === "pi") continue;
        assert.deepStrictEqual(agent.args, [], agent.key + " must launch with no extra flags");
    }
});
