"use strict";
// runSelection()'s "profile" step: BACK there has nowhere earlier to fall back to inside
// selection.js, so it must propagate out to the caller (launcher/index.js re-enters login).
// apiManager is mocked via the module cache, like test/debug.test.js.
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const { BACK } = require("../src/core/back");

const apiManagerPath = require.resolve("../lib/apiManager");
const selectionPath = require.resolve("../src/launcher/selection");

function loadSelectionMocked() {
    delete require.cache[selectionPath];
    require.cache[apiManagerPath] = {
        id: apiManagerPath, filename: apiManagerPath, loaded: true,
        exports: {
            CloudPistonAPIManager: {
                getProfileList: async () => ({
                    success: true,
                    profileList: { "com.contractpal.pal.ProfileInfo": [{ profileId: "p1", profileName: "Profile 1" }] }
                })
            }
        }
    };
    return require(selectionPath);
}

afterEach(() => {
    delete require.cache[selectionPath];
    delete require.cache[apiManagerPath];
});

test("BACK at the profile step (the first step) propagates out of runSelection()", async () => {
    const { runSelection } = loadSelectionMocked();
    const prompts = { pickProfile: async () => BACK };
    const result = await runSelection({}, prompts);
    assert.equal(result, BACK);
});

test("a real cancel (no BACK) at the profile step still returns null", async () => {
    const { runSelection } = loadSelectionMocked();
    const prompts = { pickProfile: async () => null };
    const result = await runSelection({}, prompts);
    assert.equal(result, null);
});
