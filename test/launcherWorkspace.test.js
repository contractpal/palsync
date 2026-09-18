"use strict";
// workspace.setup() — the single pull + drift-guard + lock + inject + register path both the
// recent-Pal fast path and the full wizard use. The network layers are mocked through the require
// cache (the pattern test/impactEval.test.js established); the drift guard, the identity guards
// and .palsync.json are the real implementations, working on a temp directory.
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const paths = {
    workspace: require.resolve("../src/launcher/workspace"),
    pull: require.resolve("../src/core/pull"),
    push: require.resolve("../src/core/push"),
    lock: require.resolve("../src/core/lock"),
    resources: require.resolve("../src/core/resources"),
    contextInject: require.resolve("../src/launcher/contextInject"),
    register: require.resolve("../src/mcp/register"),
    registerCodexProject: require.resolve("../src/mcp/registerCodexProject"),
    registerOpencode: require.resolve("../src/mcp/registerOpencode"),
    registerPi: require.resolve("../src/mcp/registerPi"),
    registerGemini: require.resolve("../src/mcp/registerGemini"),
    registerCursor: require.resolve("../src/mcp/registerCursor"),
    registerCopilot: require.resolve("../src/mcp/registerCopilot"),
    merge: require.resolve("../src/core/merge")
};

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "palsync-setup-test-"));
}

// Load workspace.js with every network/OS layer mocked. `hooks` records what setup() asked for.
function loadWorkspace(hooks = {}) {
    const calls = [];
    const session = { username: "dev@example.com", userId: "U-1", environment: { url: "https://cloud.example" } };
    const mocks = {
        [paths.pull]: { pull: async (s, guid, dir, opts) => {
            calls.push({ what: "pull", guid, dir, opts });
            if (hooks.pull) return hooks.pull(s, guid, dir, opts);
            // Write the pulled files for real: the drift guard hashes what is on disk, so a mock
            // that only returns metadata would make every local-drift test vacuous.
            const files = { "pal.json": '{"pages":["home.html"]}', "pages/home.html": "<h1>home</h1>" };
            for (const [rel, content] of Object.entries(files)) {
                fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
                fs.writeFileSync(path.join(dir, rel), content);
            }
            return {
                resolved: { guid, id: "ID-1", profileId: "P1", lastModifiedDate: "2026-09-18 10:00:00.0" },
                written: { base64: ["pages/home.html"], json: ["pal.json"] }, removed: [], preserved: [],
                serverPaths: Object.keys(files)
            };
        } },
        [paths.push]: { push: async () => { calls.push({ what: "push" }); return { pushed: false, refused: "drift" }; } },
        [paths.lock]: { acquireByGuid: async (s, guid, opts) => {
            calls.push({ what: "lock", guid, opts });
            if (hooks.lock) return hooks.lock(s, guid, opts);
            return { acquired: true, holder: null, resolved: { guid, id: "ID-1", profileId: "P1" } };
        }, releaseByGuid: async () => ({ released: true }) },
        [paths.resources]: { fetchAndExtract: async () => { calls.push({ what: "resources" }); return { ok: true, entries: [{ slug: "x" }] }; } },
        [paths.contextInject]: { inject: async () => { calls.push({ what: "inject" }); return { hookSettings: null }; } },
        [paths.register]: { register: async () => { calls.push({ what: "register" }); return { filePath: ".mcp.json" }; } },
        [paths.registerCodexProject]: { registerCodexProject: async () => ({ filePath: ".codex/config.toml" }) },
        [paths.registerOpencode]: { registerOpencode: async () => ({ filePath: "opencode.json" }) },
        [paths.registerPi]: { register: async () => ({ filePath: "pi-ext" }) },
        [paths.registerGemini]: { registerGemini: async () => ({ filePath: ".gemini/settings.json" }) },
        [paths.registerCursor]: { registerCursor: async () => ({ filePath: ".cursor/mcp.json" }) },
        [paths.registerCopilot]: { registerCopilot: async () => ({ filePath: ".mcp.json" }) },
        [paths.merge]: { mergeWorkspace: async () => ({ merged: false, reason: "not used" }) }
    };
    const saved = new Map();
    for (const [file, exports] of Object.entries(mocks)) {
        saved.set(file, require.cache[file]);
        require.cache[file] = { id: file, filename: file, loaded: true, exports };
    }
    const prior = require.cache[paths.workspace];
    delete require.cache[paths.workspace];
    const workspace = require(paths.workspace);
    return {
        workspace, session, calls,
        restore() {
            delete require.cache[paths.workspace];
            if (prior) require.cache[paths.workspace] = prior;
            for (const [file, cached] of saved) {
                if (cached) require.cache[file] = cached;
                else delete require.cache[file];
            }
        }
    };
}

const SEL = {
    profile: { profileId: "P1" },
    group: { groupId: "GR1" },
    pal: { guid: "GUID-1", name: "Audithelm-V1", branch: "", lastModifiedDate: "2026-09-18 10:00:00.0" }
};

const active = [];
afterEach(() => {
    while (active.length) {
        const h = active.pop();
        h.restore();
        fs.rmSync(h.dir, { recursive: true, force: true });
    }
});

function harness(hooks) {
    const h = loadWorkspace(hooks);
    h.dir = tmpDir();
    h.workspaceDir = path.join(h.dir, "ws");
    active.push(h);
    return h;
}

test("normal setup pulls, locks, fetches resources, injects, registers — in that order", async () => {
    const h = harness();
    const result = await h.workspace.setup({
        session: h.session, cloudUrl: "https://cloud.example", sel: SEL,
        workspaceDir: h.workspaceDir, agent: "claude"
    });
    assert.deepEqual(h.calls.map(c => c.what),
        ["pull", "lock", "resources", "inject", "register"]);
    assert.equal(result.workspaceDir, h.workspaceDir);
    assert.equal(result.locked, true);
    assert.equal(result.pulledFiles, 1);
    assert.equal(result.dataFiles, 1);
    // the workspace now carries its identity for the next launch
    const record = JSON.parse(fs.readFileSync(path.join(h.workspaceDir, ".palsync.json"), "utf8"));
    assert.equal(record.palGuid, "GUID-1");
    assert.equal(record.cloudUrl, "https://cloud.example");
    assert.equal(record.username, "dev@example.com");
    assert.equal(record.workspaceDir, h.workspaceDir);
    assert.ok(record.fileHashes["pal.json"]);
});

test("an already-resolved pal skips the account walk in BOTH pull and lock", async () => {
    const h = harness();
    const resolved = { guid: "GUID-1", id: "ID-1", profileId: "P1", groupId: "GR1", name: "Audithelm-V1", lastModifiedDate: "2026-09-18 10:00:00.0" };
    await h.workspace.setup({
        session: h.session, cloudUrl: "https://cloud.example",
        sel: { ...SEL, resolved }, workspaceDir: h.workspaceDir, agent: "claude"
    });
    const pull = h.calls.find(c => c.what === "pull");
    const lock = h.calls.find(c => c.what === "lock");
    assert.strictEqual(pull.opts.resolved, resolved);
    assert.strictEqual(lock.opts.resolved, resolved);
});

test("a pal locked by someone else refuses: no record, no trace of a fresh folder", async () => {
    const h = harness({
        lock: async () => ({ acquired: false, blocked: "gui-lock-other", holder: "Someone (them@example.com)", since: "2026-09-18" })
    });
    await assert.rejects(
        () => h.workspace.setup({ session: h.session, cloudUrl: "https://cloud.example", sel: SEL, workspaceDir: h.workspaceDir, agent: "claude" }),
        /locked by Someone/
    );
    assert.equal(fs.existsSync(h.workspaceDir), false, "a failed first checkout leaves no folder behind");
});

test("un-pushed local changes: abort keeps the workspace exactly as it is", async () => {
    const h = harness();
    // First run establishes the workspace + baseline.
    await h.workspace.setup({ session: h.session, cloudUrl: "https://cloud.example", sel: SEL, workspaceDir: h.workspaceDir, agent: "claude" });
    // The agent edited a server-tracked file after the last pull.
    fs.writeFileSync(path.join(h.workspaceDir, "pages/home.html"), "<h1>edited locally</h1>");
    h.calls.length = 0;

    let driftInfo = null;
    await assert.rejects(
        () => h.workspace.setup({
            session: h.session, cloudUrl: "https://cloud.example", sel: SEL, workspaceDir: h.workspaceDir,
            agent: "claude", onDrift: async (info) => { driftInfo = info; return "abort"; }
        }),
        /Cancelled — un-pushed local changes left untouched/
    );
    assert.equal(driftInfo.phase, "initial");
    assert.deepEqual(driftInfo.diff.changed, ["pages/home.html"]);
    assert.equal(h.calls.some(c => c.what === "pull"), false, "an aborted drift decision never pulls");
    assert.equal(fs.readFileSync(path.join(h.workspaceDir, "pages/home.html"), "utf8"), "<h1>edited locally</h1>");
});

test("headless setup (no drift prompt) refuses rather than overwriting local changes", async () => {
    const h = harness();
    await h.workspace.setup({ session: h.session, cloudUrl: "https://cloud.example", sel: SEL, workspaceDir: h.workspaceDir, agent: "claude" });
    fs.writeFileSync(path.join(h.workspaceDir, "pages/home.html"), "<h1>edited locally</h1>");
    await assert.rejects(
        () => h.workspace.setup({ session: h.session, cloudUrl: "https://cloud.example", sel: SEL, workspaceDir: h.workspaceDir, agent: "claude" }),
        /Refusing to overwrite them in a non-interactive setup/
    );
    assert.equal(fs.readFileSync(path.join(h.workspaceDir, "pages/home.html"), "utf8"), "<h1>edited locally</h1>");
});

test("a different pal's workspace is refused and its contents stay untouched", async () => {
    const h = harness();
    fs.mkdirSync(h.workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(h.workspaceDir, ".palsync.json"), JSON.stringify({
        cloudUrl: "https://cloud.example", palGuid: "OTHER-GUID", palName: "MacroWeek"
    }));
    fs.writeFileSync(path.join(h.workspaceDir, "keep.txt"), "keep me");
    await assert.rejects(
        () => h.workspace.setup({ session: h.session, cloudUrl: "https://cloud.example", sel: SEL, workspaceDir: h.workspaceDir, agent: "claude" }),
        /already belongs to a different pal/
    );
    assert.equal(h.calls.length, 0);
    assert.equal(fs.readFileSync(path.join(h.workspaceDir, "keep.txt"), "utf8"), "keep me");
});

test("a workspace created against another cloud is refused (new identity guard)", async () => {
    const h = harness();
    fs.mkdirSync(h.workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(h.workspaceDir, ".palsync.json"), JSON.stringify({
        cloudUrl: "https://secure.nimblewire.net", palGuid: "GUID-1", palName: "Audithelm-V1"
    }));
    await assert.rejects(
        () => h.workspace.setup({ session: h.session, cloudUrl: "https://cloud.example", sel: SEL, workspaceDir: h.workspaceDir, agent: "claude" }),
        /was created on https:\/\/secure\.nimblewire\.net/
    );
    assert.equal(h.calls.length, 0);
});
