"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const contextPath = require.resolve("../src/mcp/context");
const palsyncfilePath = require.resolve("../src/core/palsyncfile");
const credentialStorePath = require.resolve("../src/auth/credentialStore");
const sessionPath = require.resolve("../src/core/session");
const lockLifePath = require.resolve("../src/lifecycle/lockLife");
const palsyncfile = require("../src/core/palsyncfile");

function loadContext(record) {
    const originals = new Map([
        [palsyncfilePath, require.cache[palsyncfilePath]],
        [credentialStorePath, require.cache[credentialStorePath]],
        [sessionPath, require.cache[sessionPath]],
        [lockLifePath, require.cache[lockLifePath]],
        [contextPath, require.cache[contextPath]]
    ]);
    let acquireState;

    class LockLifecycle {
        constructor() { this.lockState = null; }
        async acquire() { acquireState = this.lockState; return this.lockState; }
        installSignalHandlers() {}
    }

    require.cache[palsyncfilePath] = {
        id: palsyncfilePath, filename: palsyncfilePath, loaded: true,
        exports: { read: async () => record, write: async () => {} }
    };
    require.cache[credentialStorePath] = {
        id: credentialStorePath, filename: credentialStorePath, loaded: true,
        exports: { resolvePassword: () => ({ password: "p" }), credentialError: () => new Error("missing") }
    };
    require.cache[sessionPath] = {
        id: sessionPath, filename: sessionPath, loaded: true,
        exports: { authenticate: async () => ({}) }
    };
    require.cache[lockLifePath] = {
        id: lockLifePath, filename: lockLifePath, loaded: true, exports: { LockLifecycle }
    };
    delete require.cache[contextPath];
    const { buildContext } = require(contextPath);

    return {
        buildContext,
        getAcquireState: () => acquireState,
        restore() {
            for (const [modulePath, original] of originals) {
                if (original) require.cache[modulePath] = original;
                else delete require.cache[modulePath];
            }
        }
    };
}

test("workspace records persist profileId with the existing pal identity", () => {
    const record = palsyncfile.buildRecord({
        cloudUrl: "https://example.test", userId: "u", username: "u",
        pal: { guid: "GUID", name: "Pal", id: "ID", profileId: "PROFILE" }, workspaceDir: "/tmp/pal"
    });
    assert.equal(record.palId, "ID");
    assert.equal(record.profileId, "PROFILE");
});

test("new workspace profileId seeds complete identity without a resolver", async () => {
    const record = { cloudUrl: "https://example.test", username: "u", palGuid: "GUID", palId: "ID", profileId: "PROFILE" };
    const loaded = loadContext(record);
    try {
        const ctx = await loaded.buildContext("/tmp/palsync-context-identity");
        assert.deepEqual(loaded.getAcquireState(), {
            resolved: { id: "ID", guid: "GUID", profileId: "PROFILE" }
        });
        assert.deepEqual(ctx.lifecycle.lockState, loaded.getAcquireState());
    } finally {
        loaded.restore();
    }
});

test("legacy workspace still seeds its partial persisted identity", async () => {
    const record = { cloudUrl: "https://example.test", username: "u", palGuid: "GUID", palId: "ID" };
    const loaded = loadContext(record);
    try {
        await loaded.buildContext("/tmp/palsync-context-identity");
        assert.deepEqual(loaded.getAcquireState(), {
            resolved: { id: "ID", guid: "GUID", profileId: undefined }
        });
    } finally {
        loaded.restore();
    }
});
