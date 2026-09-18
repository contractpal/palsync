"use strict";
// End-to-end smoke test on a DISPOSABLE workspace: real config file, real recent-Pal store, real
// path handling, real workspace.setup() (drift guard, identity guards, .palsync.json, MCP
// registration), real agent registry. Only the network layers are stubbed — the pull itself,
// the pal lock, and the resource fetch — because no test may touch a live cloud.
//
// Runs in a child process with HOME/USERPROFILE pointed at a temp directory, so the launcher
// resolves ~/.palsync/config.json there and the real one is never read or written.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

// The child script: stub the network seams in the require cache, then drive the REAL launcher.
const SMOKE = `
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const mode = process.argv[3];
const log = [];
const rec = (m) => log.push(String(m));

function stub(file, exports) {
    const id = require.resolve(path.join(root, file));
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

const SESSION = { username: "dev@example.com", userId: "U-1", environment: { url: "https://cloud.example" } };
const PAL = { guid: "GUID-SMOKE", id: "ID-SMOKE", name: "Audithelm-V1", description: "smoke", branch: "",
              lastModifiedDate: "2026-09-18 10:00:00.0", profileId: "P1", profileName: "Profile",
              groupId: "GR1", groupName: "Group" };
const calls = [];
const loginPrompts = [];

// The OS keychain holds a cached password for this account (the real auth/credentials.js login
// runs against these seams — this is what makes a later launch prompt-free). Nothing here writes
// a password anywhere.
stub("src/platform/keychain", {
    listUsernames: () => ["dev@example.com"],
    getPassword: () => (process.env.SMOKE_BAD_CACHED_PASSWORD ? "stale-password" : "cached-password"),
    setCredential: () => {},
    deleteCredential: () => {}
});
// The only network seam left: Ping.do (authentication).
stub("src/core/session", {
    authenticate: async (url, username, password) => {
        calls.push("authenticate:" + username + "@" + url);
        if (password === "stale-password") throw new Error("Authentication failed (Ping.do)");
        return SESSION;
    }
});
stub("src/core/resolve", {
    refreshResolvedPal: async () => { calls.push("resolve:scoped"); return PAL; },
    resolveServerPalByGuid: async () => { calls.push("resolve:walk"); return PAL; },
    timestampText: v => v, shapePal: p => p
});
stub("src/core/pull", {
    pull: async (session, guid, dir) => {
        calls.push("pull");
        const files = { "pal.json": '{"pages":["home.html"]}', "pages/home.html": "<h1>smoke</h1>" };
        for (const [rel, body] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
            fs.writeFileSync(path.join(dir, rel), body);
        }
        return { resolved: { guid, id: PAL.id, profileId: PAL.profileId, lastModifiedDate: PAL.lastModifiedDate },
                 written: { base64: ["pages/home.html"], json: ["pal.json"] }, removed: [], preserved: [],
                 serverPaths: Object.keys(files) };
    }
});
stub("src/core/lock", {
    acquireByGuid: async (session, guid) => {
        calls.push("lock");
        if (process.env.SMOKE_LOCKED) {
            return { acquired: false, blocked: "gui-lock-other", holder: "Someone Else (them@example.com)", since: "2026-09-18" };
        }
        return { acquired: true, holder: null, resolved: { guid, id: PAL.id, profileId: PAL.profileId } };
    },
    releaseByGuid: async () => ({ released: true })
});
stub("src/core/resources", { fetchAndExtract: async () => { calls.push("resources"); return { ok: true, entries: [] }; } });
// The wizard's own profile→group→pal walk: stubbed so no test can reach a live cloud.
stub("src/launcher/selection", {
    runSelection: async () => {
        calls.push("wizard-selection");
        return { mode: "open", profile: { profileId: PAL.profileId }, group: { groupId: PAL.groupId },
                 pal: { guid: PAL.guid, name: PAL.name, branch: "", lastModifiedDate: PAL.lastModifiedDate },
                 resolved: PAL };
    },
    normalizePal: p => p
});
stub("src/core/createPal", { createNewPal: async () => ({ guid: PAL.guid, name: PAL.name }), listKeys: async () => [] });
stub("src/mcp/registerCodexProject", { registerCodexProject: async () => ({ filePath: ".codex/config.toml" }) });
stub("src/mcp/registerOpencode", { registerOpencode: async () => ({ filePath: "opencode.json" }) });
stub("src/mcp/registerPi", { register: async () => ({ filePath: "pi-ext" }) });
stub("src/mcp/registerGemini", { registerGemini: async () => ({ filePath: ".gemini/settings.json" }) });
stub("src/mcp/registerCursor", { registerCursor: async () => ({ filePath: ".cursor/mcp.json" }) });
stub("src/mcp/registerCopilot", { registerCopilot: async () => ({ filePath: ".mcp.json" }) });

const launcher = require(path.join(root, "src/launcher/index.js"));
const recent = require(path.join(root, "src/platform/recentPals.js"));

const questions = [];
const opts = {
    autoLaunch: false,
    agent: process.env.SMOKE_AGENT || undefined,
    // An explicit --dir for this session (what bin/palsync.js passes through as workspaceDir).
    workspaceDir: process.env.SMOKE_EXPLICIT_DIR || undefined,
    // The real login() step machine runs; only its cloud picker is answered here (a cached
    // keychain credential means no username/password prompt is ever reached).
    loginPrompts: {
        pickCloud: async () => { loginPrompts.push("cloud"); return "https://cloud.example"; },
        pickAccount: async (users) => { loginPrompts.push("account"); return users[0]; },
        askUsername: async () => { loginPrompts.push("username"); return "dev@example.com"; },
        askPassword: async () => { loginPrompts.push("password"); return "typed-password"; },
        onAuthFailure: () => { loginPrompts.push("auth-failure"); }
    },
    log: rec,
    preflight: async (key) => calls.push("preflight:" + key),
    agentOnPath: () => true,
    pickRecentPrompt: async (entries) => {
        questions.push("pal-menu");
        return { kind: process.env.SMOKE_MENU || "pal", entry: entries[0] };
    },
    pickRecentPalPrompt: async (entries) => { questions.push("pal-for-dir"); return entries[0]; },
    pickRecoveryPrompt: async (message) => {
        questions.push("recovery");
        rec("recovery: " + message.split("\\n")[0]);
        return process.env.SMOKE_RECOVERY === "choose-dir" ? { kind: "choose-dir" }
             : process.env.SMOKE_RECOVERY === "other" ? { kind: "other" } : null;
    },
    chooseWorkspaceDir: async (defaultDir) => {
        questions.push("dir");
        return process.env.SMOKE_DIR || defaultDir;
    },
    onDrift: async () => { questions.push("drift"); return process.env.SMOKE_DRIFT || "abort"; },
    pickAgent: async () => ({ id: "claude-code", key: "claude", label: "Claude Code", command: "claude", args: [] }),
    resolve: {
        refreshResolvedPal: async () => { calls.push("resolve:scoped"); return PAL; },
        resolveServerPalByGuid: async () => { calls.push("resolve:walk"); return PAL; }
    }
};

launcher.run(opts).then((result) => {
    process.stdout.write(JSON.stringify({
        ok: true,
        cancelled: !result,
        workspaceDir: result && result.workspaceDir,
        agent: result && result.agent && result.agent.key,
        questions,
        loginPrompts,
        calls,
        history: recent.list().map(e => ({ palGuid: e.palGuid, palName: e.palName, workspaceDir: e.workspaceDir, agent: e.agent, launchCount: e.launchCount })),
        log
    }, null, 2));
}).catch((err) => {
    process.stdout.write(JSON.stringify({
        ok: false, error: err && err.message, questions, loginPrompts, calls,
        history: recent.list(), log
    }, null, 2));
});
`;

function homeDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-smoke-"));
    fs.writeFileSync(path.join(dir, "smoke.js"), SMOKE);
    return dir;
}

// Run the smoke script in its own process, with HOME pointed at the disposable directory.
function smoke(home, env = {}) {
    const res = spawnSync(process.execPath, [path.join(home, "smoke.js"), ROOT, "run"], {
        encoding: "utf8",
        timeout: 60000,
        cwd: home,
        env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home, PALSYNC_DEBUG: "" }, env)
    });
    assert.equal(res.status, 0, `smoke run failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    parsed.stderr = res.stderr; // warnings (e.g. an unreadable config) go to stderr, not the log
    return parsed;
}

function workspaceFile(home, ...rel) {
    return fs.readFileSync(path.join(home, "PalBuilder", "Audithelm-V1", ...rel), "utf8");
}

test("first launch (empty history) runs the wizard; the second reuses everything", () => {
    const home = homeDir();
    try {
        // 1st launch: no history → wizard-shaped behavior (the directory is asked for, the agent
        // is picked), and history is written only after setup succeeded.
        const first = smoke(home, { SMOKE_DIR: path.join(home, "projects", "Audithelm-V1") });
        assert.equal(first.ok, true, JSON.stringify(first));
        assert.deepEqual(first.questions, ["dir"], "the wizard asks for a workspace directory");
        assert.deepEqual(first.history.map(e => e.palName), ["Audithelm-V1"]);
        assert.equal(first.history[0].workspaceDir, path.join(home, "projects", "Audithelm-V1"));
        assert.equal(first.history[0].launchCount, 1);

        // The workspace on disk is a real PalSync workspace.
        const dir = path.join(home, "projects", "Audithelm-V1");
        const record = JSON.parse(fs.readFileSync(path.join(dir, ".palsync.json"), "utf8"));
        assert.equal(record.palGuid, "GUID-SMOKE");
        assert.equal(record.workspaceDir, dir);
        assert.ok(fs.existsSync(path.join(dir, "pal.json")));
        assert.ok(fs.existsSync(path.join(dir, "pages", "home.html")));
        assert.ok(fs.existsSync(path.join(dir, ".mcp.json")), "the MCP server was registered");
        assert.ok(record.fileHashes["pages/home.html"], "the drift baseline was recorded");

        // 2nd launch: the menu appears, and choosing the pal asks NOTHING and reuses the folder.
        const second = smoke(home, {});
        assert.equal(second.ok, true, JSON.stringify(second));
        assert.deepEqual(second.questions, ["pal-menu"], "one question: which pal");
        assert.equal(second.workspaceDir, dir, "the remembered folder is reused exactly");
        assert.equal(second.agent, "claude", "the remembered agent is reused");
        assert.deepEqual(second.calls.filter(c => c.startsWith("resolve")), ["resolve:scoped"],
            "one scoped resolve — no full account walk");
        assert.deepEqual(second.calls.filter(c => c.startsWith("authenticate")),
            ["authenticate:dev@example.com@https://cloud.example"], "authentication still happens exactly once");
        assert.deepEqual(second.loginPrompts, [], "cached credentials mean no login prompt at all");
        assert.ok(second.calls.includes("pull") && second.calls.includes("lock"), "the safe setup still runs");
        assert.deepEqual(second.history[0].launchCount, 2, "the launch is counted once per launch");
        assert.equal(second.history.length, 1, "no duplicate history row");
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("the default directory still applies when nothing is customized", () => {
    const home = homeDir();
    try {
        const res = smoke(home, {});
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.workspaceDir, path.join(home, "PalBuilder", "Audithelm-V1"));
        assert.equal(workspaceFile(home, "pal.json"), '{"pages":["home.html"]}');
        // A path outside the home directory is stored as-is; inside it, the menu shows ~/…
        const { shortenHome } = require("../src/launcher/workspacePath");
        assert.equal(shortenHome(res.history[0].workspaceDir, home), "~/PalBuilder/Audithelm-V1");
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("a custom, spaced, ~-prefixed folder is remembered and reused exactly", () => {
    const home = homeDir();
    try {
        const custom = path.join(home, "My Projects", "Audithelm V1 (custom)");
        const first = smoke(home, { SMOKE_DIR: "~/My Projects/Audithelm V1 (custom)" });
        assert.equal(first.ok, true, JSON.stringify(first));
        assert.equal(first.workspaceDir, custom, "~ expanded and spaces preserved");
        assert.equal(first.history[0].workspaceDir, custom);

        const second = smoke(home, {});
        assert.equal(second.workspaceDir, custom, "the exact remembered path is reused");
        assert.ok(fs.existsSync(path.join(custom, "pal.json")));
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("un-pushed local changes are still protected on the fast path", () => {
    const home = homeDir();
    try {
        smoke(home, {});
        const target = path.join(home, "PalBuilder", "Audithelm-V1", "pages", "home.html");
        fs.writeFileSync(target, "<h1>edited after the last pull</h1>");

        const aborted = smoke(home, { SMOKE_DRIFT: "abort" });
        assert.equal(aborted.ok, false, "the launch stops rather than overwriting");
        assert.match(aborted.error, /Cancelled — un-pushed local changes left untouched/);
        assert.equal(fs.readFileSync(target, "utf8"), "<h1>edited after the last pull</h1>", "the local edit survives");
        assert.ok(aborted.questions.includes("drift"), "the drift prompt was offered");
        assert.equal(aborted.history[0].launchCount, 1, "an aborted launch is not counted");
        assert.ok(!aborted.calls.includes("pull"), "no pull happened");
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("a rejected cached credential falls back to the normal login prompt", () => {
    const home = homeDir();
    try {
        smoke(home, {});
        // Now the cached password is wrong: the real login() drops it, reports the failure, and
        // asks for a password — then proceeds with the same remembered pal.
        const res = smoke(home, { SMOKE_BAD_CACHED_PASSWORD: "1" });
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.deepEqual(res.loginPrompts, ["auth-failure", "password"],
            "the rejection is reported and the user is asked for a password — nothing else");
        assert.deepEqual(res.questions, ["pal-menu"], "and the pal menu is still the only pal question");
        assert.equal(res.workspaceDir, path.join(home, "PalBuilder", "Audithelm-V1"));
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("no credential or token is ever written to the config file", () => {
    const home = homeDir();
    try {
        smoke(home, {});
        const raw = fs.readFileSync(path.join(home, ".palsync", "config.json"), "utf8");
        assert.ok(!/cached-password|typed-password|password|token|secret/i.test(raw), raw);
        const parsed = JSON.parse(raw);
        assert.equal(parsed.recentPals.length, 1);
        assert.equal(parsed.recentPals[0].username, "dev@example.com"); // keychain key, not a secret
        assert.ok(!("password" in parsed.recentPals[0]));
        // ...and it must not be in the workspace record either
        const record = fs.readFileSync(path.join(home, "PalBuilder", "Audithelm-V1", ".palsync.json"), "utf8");
        assert.ok(!/cached-password|typed-password|password|token|secret/i.test(record), record);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("a history write failure never breaks a launch that already succeeded", () => {
    const home = homeDir();
    try {
        smoke(home, {});
        // Make ~/.palsync/config.json a directory so the write cannot succeed.
        const cfg = path.join(home, ".palsync", "config.json");
        fs.rmSync(cfg);
        fs.mkdirSync(cfg);
        const res = smoke(home, {});
        assert.equal(res.ok, true, `the launch still completed: ${JSON.stringify(res)}`);
        assert.equal(res.workspaceDir, path.join(home, "PalBuilder", "Audithelm-V1"));
        assert.ok(res.log.some(l => /could not save recent-Pal history/.test(l)), res.log.join("\n"));
        assert.equal(res.calls.filter(c => c === "pull").length, 1, "the workspace was still set up");
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("a corrupted history file falls back to the wizard instead of failing", () => {
    const home = homeDir();
    try {
        fs.mkdirSync(path.join(home, ".palsync"), { recursive: true });
        fs.writeFileSync(path.join(home, ".palsync", "config.json"), "{ this is not json");
        const before = fs.readFileSync(path.join(home, ".palsync", "config.json"));
        const res = smoke(home, { PALSYNC_DEBUG: "1" });
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.ok(res.calls.includes("wizard-selection"), "the full wizard ran");
        assert.equal(res.workspaceDir, path.join(home, "PalBuilder", "Audithelm-V1"));
        // ...and the damaged file is LEFT ALONE. Writing the new history over it would erase
        // whatever unrelated preferences are still in there (and still recoverable by hand), so
        // the failed save is reported instead — the launch itself already succeeded.
        assert.deepEqual(fs.readFileSync(path.join(home, ".palsync", "config.json")), before,
            "the malformed config is byte-for-byte unchanged");
        assert.ok(res.log.some(l => /could not save recent-Pal history/.test(l)), res.log.join("\n"));
        assert.match(res.stderr, /could not read .*config\.json/);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("a locked pal refuses and is not counted as a launch", () => {
    const home = homeDir();
    try {
        smoke(home, {});
        const before = fs.readFileSync(path.join(home, "PalBuilder", "Audithelm-V1", "pal.json"), "utf8");
        const res = smoke(home, { SMOKE_LOCKED: "1" });
        assert.equal(res.ok, false, JSON.stringify(res));
        assert.match(res.error, /locked by Someone Else/);
        assert.equal(res.history[0].launchCount, 1, "a lock refusal is not a launch");
        assert.equal(res.calls.filter(c => c === "pull").length, 1, "the pull ran (it precedes the lock)");
        assert.equal(res.calls.filter(c => c === "lock").length, 1);
        assert.equal(fs.readFileSync(path.join(home, "PalBuilder", "Audithelm-V1", "pal.json"), "utf8"), before,
            "the existing workspace is left exactly as it was");
        assert.equal(res.workspaceDir, undefined, "nothing was handed to an agent");
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("a folder belonging to another pal is refused, its contents untouched", () => {
    const home = homeDir();
    try {
        smoke(home, {});
        const dir = path.join(home, "PalBuilder", "Audithelm-V1");
        fs.writeFileSync(path.join(dir, ".palsync.json"), JSON.stringify({
            cloudUrl: "https://cloud.example", palGuid: "SOMEONE-ELSES", palName: "MacroWeek"
        }));
        fs.writeFileSync(path.join(dir, "pal.json"), '{"mine":true}');

        // Quitting at the recovery menu: nothing is opened, nothing is written.
        const refused = smoke(home, {});
        assert.equal(refused.cancelled, true, JSON.stringify(refused));
        assert.deepEqual(refused.questions, ["pal-menu", "recovery"]);
        assert.equal(fs.readFileSync(path.join(dir, "pal.json"), "utf8"), '{"mine":true}');
        assert.ok(!refused.calls.includes("pull"), "nothing was pulled into another pal's folder");

        // "Open another Pal…" hands over to the wizard — which then hits the SAME identity guard,
        // because the wizard's default folder is the one belonging to the other pal.
        const other = smoke(home, { SMOKE_RECOVERY: "other" });
        assert.ok(other.calls.includes("wizard-selection"), "the full wizard ran");
        assert.equal(other.ok, false, "setup still refuses the other pal's folder");
        assert.match(other.error, /belongs to a different pal/);
        assert.equal(fs.readFileSync(path.join(dir, "pal.json"), "utf8"), '{"mine":true}',
            "the other pal's folder is still untouched");
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("--dir overrides the remembered folder, and is an exact path", () => {
    const home = homeDir();
    try {
        smoke(home, {});
        const elsewhere = path.join(home, "elsewhere", "Exact-Pal");
        const res = smoke(home, { SMOKE_EXPLICIT_DIR: elsewhere });
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.workspaceDir, elsewhere);
        assert.deepEqual(res.questions, ["pal-menu"], "no directory question with --dir");
        assert.ok(fs.existsSync(path.join(elsewhere, "pal.json")));
        assert.equal(JSON.parse(fs.readFileSync(path.join(elsewhere, ".palsync.json"), "utf8")).palGuid, "GUID-SMOKE");
        // --dir is a ONE-SESSION override: the remembered folder is unchanged, and the previous
        // folder is left exactly as it was (never moved, renamed, or deleted).
        assert.ok(fs.existsSync(path.join(home, "PalBuilder", "Audithelm-V1", "pal.json")));
        assert.equal(res.history[0].workspaceDir, path.join(home, "PalBuilder", "Audithelm-V1"),
            "--dir does not rewrite the remembered folder");
        assert.equal(res.history[0].launchCount, 2, "but the launch still counts");
        assert.equal(smoke(home, {}).workspaceDir, path.join(home, "PalBuilder", "Audithelm-V1"),
            "the next plain launch goes back to the remembered folder");
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
