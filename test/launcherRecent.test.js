"use strict";
// The launcher's two startup paths (src/launcher/index.js):
//   * recent-Pal fast path — local menu → authenticate with cached creds → ONE scoped resolve →
//     remembered workspace + agent → the shared workspace.setup()
//   * the original full wizard
// Everything the launcher talks to is mocked through the require cache (the pattern
// test/impactEval.test.js established): credentials, selection, agents, workspace.setup, lock,
// and ~/.palsync/config.json. The REAL recent-Pal store, path handling, and prompt wiring run.
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { BACK } = require("../src/core/back");
const realWorkspace = require("../src/launcher/workspace");

const P = {
    launcher: require.resolve("../src/launcher/index"),
    config: require.resolve("../src/platform/config"),
    recentPals: require.resolve("../src/platform/recentPals"),
    policy: require.resolve("../src/core/policy"),
    credentials: require.resolve("../src/auth/credentials"),
    keychain: require.resolve("../src/platform/keychain"),
    selection: require.resolve("../src/launcher/selection"),
    createPal: require.resolve("../src/core/createPal"),
    agents: require.resolve("../src/launcher/agents"),
    workspace: require.resolve("../src/launcher/workspace"),
    evalSpec: require.resolve("../src/core/evalSpec"),
    impactEval: require.resolve("../src/core/impactEval"),
    lock: require.resolve("../src/core/lock")
};

// Reloaded against this harness's mocked config: these capture the config module at load time.
const FRESH_PER_HARNESS = [P.launcher, P.recentPals, P.policy];

const AGENT_LIST = [
    { id: "claude-code", key: "claude", label: "Claude Code", command: "claude", args: [] },
    { id: "codex", key: "codex", label: "Codex", command: "codex", args: [] },
    { id: "pi", key: "pi", label: "Pi", command: "pi", args: [] }
];

const RESOLVED = {
    guid: "GUID-1", id: "ID-1", name: "Audithelm-V1", description: "audit", branch: "",
    lastModifiedDate: "2026-09-18 10:00:00.0", profileId: "P1", profileName: "Profile",
    groupId: "GR1", groupName: "Group"
};

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "palsync-recent-test-"));
}

function entry(over = {}) {
    return {
        cloudUrl: "https://cloud.example", username: "dev@example.com", palGuid: "GUID-1",
        palName: "Audithelm-V1", profileId: "P1", groupId: "GR1", palId: "ID-1",
        workspaceDir: "/home/dev/projects/Audithelm-V1", agent: "pi",
        launchCount: 3, lastLaunchedAt: "2026-09-18T10:00:00.000Z", ...over
    };
}

const active = [];
afterEach(() => {
    while (active.length) {
        const h = active.pop();
        for (const [file, cached] of h.saved) {
            if (cached) require.cache[file] = cached;
            else delete require.cache[file];
        }
        fs.rmSync(h.root, { recursive: true, force: true });
    }
});

// Build a launcher with mocked collaborators. `over` may override any behavior:
//   history, config, login, selection, setup, failWrite, pickRecent, pickRecentPal, recovery,
//   chooseDir, agentOnPath, pickAgent
function harness(over = {}) {
    const root = tmpDir();
    const state = {
        root, serverCalls: 0, loginCalls: [], setupCalls: [], launches: [], preflights: [],
        seenEntries: null, recoveries: [], dirDefaults: [], prompts: [], logs: [], selectionCalls: 0,
        agentPicks: 0
    };
    const configStore = { recentPals: over.history || [] };
    const session = over.session || {
        username: "dev@example.com", userId: "U-1", environment: { url: "https://cloud.example" }
    };
    let loginOverride = over.login;
    let setupOverride = over.setup;
    const setLogin = (fn) => { loginOverride = fn; };
    const setSetup = (fn) => { setupOverride = fn; };

    // Every test gets a real directory (optionally with .palsync.json) it can point history at.
    state.ws = (name, identity) => {
        const dir = path.join(root, name);
        fs.mkdirSync(dir, { recursive: true });
        if (identity) {
            fs.writeFileSync(path.join(dir, ".palsync.json"), JSON.stringify({
                cloudUrl: "https://cloud.example", username: "dev@example.com",
                palGuid: "GUID-1", palName: "Audithelm-V1", ...identity
            }));
        }
        return dir;
    };

    const mocks = {
        [P.config]: {
            get: (k, d) => (configStore[k] !== undefined ? configStore[k] : d),
            set: (k, v) => { if (over.failWrite) return false; configStore[k] = v; return true; }
        },
        [P.credentials]: {
            login: async (args) => {
                state.loginCalls.push(args);
                if (loginOverride) return loginOverride(args);
                return {
                    session, cloudUrl: args.cloudUrl || "https://cloud.example",
                    username: args.username || "dev@example.com", prompted: false
                };
            },
            getClouds: () => [], defaultPrompts: {}
        },
        [P.keychain]: {
            getPassword: () => "cached-password",
            listUsernames: () => ["dev@example.com"],
            setCredential: () => {},
            deleteCredential: () => {}
        },
        [P.selection]: {
            runSelection: async () => {
                state.selectionCalls++;
                state.serverCalls += 3; // getProfileList + getGroupList + getPalList
                if (over.selection !== undefined) return over.selection;
                return {
                    mode: "open", profile: { profileId: "P1" }, group: { groupId: "GR1" },
                    pal: { guid: "GUID-1", name: "Audithelm-V1", branch: "", lastModifiedDate: "2026-09-18 10:00:00.0" },
                    resolved: RESOLVED
                };
            }
        },
        [P.createPal]: { createNewPal: async () => ({ guid: "NEW-GUID", name: "New Pal" }) },
        [P.agents]: {
            AGENTS: AGENT_LIST,
            resolve: k => AGENT_LIST.find(a => a.key === k) || null,
            pick: async (prompt) => {
                const opts = AGENT_LIST;
                return prompt ? await prompt(opts) : opts[0];
            },
            launch: (agent, opts) => {
                state.launches.push({ agent: agent.key, cwd: opts.cwd });
                return { pid: 1 };
            }
        },
        [P.workspace]: {
            // The real default-folder rule, rooted in this test's temp directory so a developer's
            // own ~/PalBuilder can never collide with (or be touched by) a test. The rule itself
            // is pinned in test/workspacePath.test.js.
            defaultWorkspaceDir: (name, branch, baseDir) => realWorkspace.defaultWorkspaceDir(name, branch, baseDir || root),
            slug: realWorkspace.slug,
            setup: async (args) => {
                state.setupCalls.push(args);
                if (setupOverride) return setupOverride(args);
                return {
                    workspaceDir: args.workspaceDir, locked: true,
                    record: {
                        palGuid: args.sel.pal.guid, palName: args.sel.pal.name, profileId: "P1", palId: "ID-1",
                        cloudUrl: args.cloudUrl, username: args.session.username, userId: args.session.userId,
                        workspaceDir: args.workspaceDir
                    }
                };
            }
        },
        [P.evalSpec]: {
            listSpecs: () => [],
            resolveSpec: () => ({ key: "01_bench", suggestedName: "bench-pal", kind: undefined }),
            injectSpec: () => ({ written: ["SPEC.md"], skipped: [] }),
            injectImpactSpec: () => ({ written: ["SPEC.md"], skipped: [] })
        },
        [P.impactEval]: { seedImpactBaseline: async () => ({}) },
        [P.lock]: { releaseByGuid: async () => ({ released: true }) }
    };

    const saved = new Map();
    for (const file of FRESH_PER_HARNESS) {
        saved.set(file, require.cache[file]);
        delete require.cache[file];
    }
    for (const [file, exports] of Object.entries(mocks)) {
        saved.set(file, require.cache[file]);
        require.cache[file] = { id: file, filename: file, loaded: true, exports };
    }
    const launcher = require(P.launcher);

    // `cfg` is mutable: run(overrides) merges into it, so a test can vary the prompts, the
    // resolve behavior, or the login per call without rebuilding the harness.
    const cfg = { ...over };
    const h = {
        root, state, configStore, saved, cfg, setLogin, setSetup,
        run: (overrides = {}) => {
            Object.assign(cfg, overrides);
            const opts = {
                autoLaunch: cfg.autoLaunch === true,
                // Tests state interactivity outright instead of inheriting whatever the test runner's
                // stdio happens to be.
                interactive: true,
                log: (m) => state.logs.push(String(m)),
                preflight: async (agentKey) => { state.preflights.push(agentKey); },
                agentOnPath: cfg.agentOnPath || (() => true),
                resolve: cfg.resolve || {
                    refreshResolvedPal: async () => {
                        state.serverCalls++;
                        return cfg.scoped !== undefined ? cfg.scoped : RESOLVED;
                    },
                    resolveServerPalByGuid: async () => {
                        state.serverCalls += 3; // full account walk
                        return cfg.walk !== undefined ? cfg.walk : RESOLVED;
                    }
                },
                pickAgent: cfg.pickAgent,
                agent: cfg.agent,
                workspaceDir: cfg.workspaceDir,
                evalSpec: cfg.evalSpec
            };
            // The agent seam is always supplied: it is what tells the launcher a caller can answer
            // the agent question (a caller with neither a seam nor a TTY gets a clear error).
            opts.pickAgent = async (list) => {
                state.agentPicks++;
                state.prompts.push("agent");
                if (cfg.pickAgent) return cfg.pickAgent(list);
                return list ? list[0] : AGENT_LIST[0];
            };
            opts.pickRecentPrompt = async (entries) => {
                state.seenEntries = entries;
                state.prompts.push("pal-menu");
                if (cfg.pickRecentPrompt) return cfg.pickRecentPrompt(entries);
                return cfg.pickRecent ? cfg.pickRecent(entries) : { kind: "pal", entry: entries[0] };
            };
            opts.pickRecentPalPrompt = async (entries) => {
                state.prompts.push("pal-for-dir");
                if (cfg.pickRecentPalPrompt) return cfg.pickRecentPalPrompt(entries);
                return cfg.pickRecentPal ? cfg.pickRecentPal(entries) : entries[0];
            };
            opts.pickRecoveryPrompt = async (message) => {
                state.recoveries.push(message);
                state.prompts.push("recovery");
                if (cfg.pickRecoveryPrompt) return cfg.pickRecoveryPrompt(message);
                return cfg.recovery ? cfg.recovery(message) : null;
            };
            opts.chooseWorkspaceDir = async (defaultDir) => {
                state.dirDefaults.push(defaultDir);
                state.prompts.push("dir");
                if (cfg.chooseWorkspaceDir) return cfg.chooseWorkspaceDir(defaultDir);
                return cfg.chooseDir ? cfg.chooseDir(defaultDir) : defaultDir;
            };
            // A caller with no directory seam and no TTY cannot be asked — the launcher must error
            // rather than hang, which these tests exercise by NOT supplying a seam.
            // The login seam: the wizard's cloud/account/password questions are answered here so a
            // non-interactive test can reach the directory and agent guards (the CLI refuses a
            // non-TTY launch outright, so this only matters to library callers).
            opts.loginPrompts = cfg.loginPrompts || {
                pickCloud: async () => "https://cloud.example",
                pickAccount: async (users) => users[0],
                askUsername: async () => "dev@example.com",
                askPassword: async () => "pw",
                onAuthFailure: () => {}
            };
            if (cfg.noLoginSeam) delete opts.loginPrompts;
            if (cfg.noDirSeam) delete opts.chooseWorkspaceDir;
            if (cfg.noMenuSeam) delete opts.pickRecentPrompt;
            if (cfg.nonInteractive) opts.interactive = false;
            return launcher.run(opts);
        }
    };
    active.push(h);
    return h;
}

// --- STARTUP ------------------------------------------------------------------------------

test("empty history opens the full wizard with the unchanged default directory", async () => {
    const h = harness();
    const result = await h.run();
    const expected = realWorkspace.defaultWorkspaceDir("Audithelm-V1", "", h.state.root);
    assert.equal(h.state.seenEntries, null, "no recent-Pal menu without history");
    assert.equal(h.state.selectionCalls, 1);
    assert.equal(h.state.loginCalls.length, 1);
    assert.equal(h.state.dirDefaults[0], expected);
    assert.equal(h.state.setupCalls[0].workspaceDir, expected);
    assert.equal(result.workspaceDir, expected);
});

test("a successful wizard launch records history; the next launch starts with the menu", async () => {
    let h;
    const chosen = () => {
        const dir = path.join(h.state.root, "Audithelm-V1");
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    };
    h = harness({ chooseDir: chosen });
    await h.run();
    const recorded = h.configStore.recentPals;
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].palGuid, "GUID-1");
    assert.equal(recorded[0].palName, "Audithelm-V1");
    assert.equal(recorded[0].cloudUrl, "https://cloud.example");
    assert.equal(recorded[0].username, "dev@example.com");
    assert.equal(recorded[0].agent, "claude");
    assert.equal(recorded[0].workspaceDir, path.join(h.state.root, "Audithelm-V1"));
    assert.equal(recorded[0].launchCount, 1);
    assert.ok(Date.parse(recorded[0].lastLaunchedAt) > 0);

    // Second launch: the menu appears first, and choosing the pal never re-enters the wizard.
    const dir = path.join(h.state.root, "Audithelm-V1");
    fs.writeFileSync(path.join(dir, ".palsync.json"), JSON.stringify({
        cloudUrl: "https://cloud.example", username: "dev@example.com", palGuid: "GUID-1", palName: "Audithelm-V1"
    }));
    h.state.selectionCalls = 0;
    h.state.prompts.length = 0;
    const second = await h.run();
    assert.equal(h.state.selectionCalls, 0, "the wizard is not re-entered");
    assert.equal(h.state.seenEntries.length, 1);
    assert.deepEqual(h.state.prompts, ["pal-menu"]);
    assert.equal(second.workspaceDir, dir);
    assert.equal(h.configStore.recentPals[0].launchCount, 2);
    assert.equal(h.configStore.recentPals.length, 1, "no duplicate row");
});

test("the recent menu makes zero server requests and asks only one question", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir })] });
    let serverCallsAtPrompt = null;
    let loginsAtPrompt = null;
    await h.run({
        pickRecentPrompt: async (entries) => {
            serverCallsAtPrompt = h.state.serverCalls;
            loginsAtPrompt = h.state.loginCalls.length;
            h.state.seenEntries = entries;
            return { kind: "pal", entry: entries[0] };
        }
    });
    assert.equal(serverCallsAtPrompt, 0, "the menu is local: no server request before the choice");
    assert.equal(loginsAtPrompt, 0, "the menu is local: no login before the choice");
    assert.deepEqual(h.state.prompts, ["pal-menu"]);
    assert.equal(h.state.serverCalls, 1, "one scoped getPalList after the choice");
});

test("at most five pals are offered, most recent first", async () => {
        const history = Array.from({ length: 8 }, (_, i) => entry({
            palGuid: "GU-" + i, palName: "Pal-" + i, launchCount: i,
            lastLaunchedAt: "2026-09-1" + i + "T00:00:00.000Z"
        }));
        const h = harness({ history });
    await h.run({ pickRecent: () => null });
    assert.equal(h.state.seenEntries.length, 5);
    assert.deepEqual(h.state.seenEntries.map(e => e.palName), ["Pal-7", "Pal-6", "Pal-5", "Pal-4", "Pal-3"]);
    assert.equal(h.configStore.recentPals.length, 8, "storage keeps all (up to the bound)");
});

test("the same pal name in two accounts stays two separate menu rows", async () => {
    const h = harness({
        history: [
            entry({ username: "a@example.com", palGuid: "GA", workspaceDir: "/x/a" }),
            entry({ username: "b@example.com", palGuid: "GB", workspaceDir: "/x/b" })
        ]
    });
    await h.run({ pickRecent: entries => ({ kind: "pal", entry: entries.find(e => e.username === "b@example.com") }), scoped: null, walk: null });
    assert.equal(h.state.seenEntries.length, 2);
    assert.equal(h.state.loginCalls[0].username, "b@example.com");
});

test("Open another Pal runs the original full wizard", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir })] });
    await h.run({ pickRecent: () => ({ kind: "other" }) });
    assert.equal(h.state.selectionCalls, 1, "the wizard's own profile/group/pal flow ran");
    assert.equal(h.state.setupCalls.length, 1);
    assert.equal(h.state.dirDefaults.length, 1, "the wizard asks for a directory as it always did");
});

test("cancelling the recent menu exits cleanly with no server calls and no writes", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir, launchCount: 3 })] });
    const result = await h.run({ pickRecent: () => null });
    assert.equal(result, null);
    assert.equal(h.state.serverCalls, 0);
    assert.equal(h.state.loginCalls.length, 0);
    assert.equal(h.state.setupCalls.length, 0);
    assert.equal(h.configStore.recentPals[0].launchCount, 3, "a cancel is not a launch");
});

test("a failed launch (lock refusal) never touches history", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({
        history: [entry({ workspaceDir: dir, launchCount: 4 })],
        setup: async () => { throw new Error("This pal is locked by Someone — cannot start a session."); }
    });
    await assert.rejects(() => h.run(), /locked by Someone/);
    assert.equal(h.configStore.recentPals[0].launchCount, 4);
    assert.equal(h.configStore.recentPals.length, 1);
    assert.equal(h.state.launches.length, 0, "the agent is not opened when setup fails");
});

test("a failed login (backed out) never touches history", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir })], login: async () => BACK });
    assert.equal(await h.run(), null);
    assert.equal(h.state.setupCalls.length, 0);
    assert.equal(h.configStore.recentPals[0].launchCount, 3);
});

test("corrupted or unreadable history falls back to the wizard", async () => {
    const broken = harness({ history: "not-a-list" });
    await broken.run();
    assert.equal(broken.state.selectionCalls, 1);
    assert.equal(broken.state.seenEntries, null);

    const throwing = harness({ history: [entry()] });
    // The launcher holds the same mocked config object, so an unreadable config is one mutation away.
    require.cache[P.config].exports.get = () => { throw new Error("config unreadable"); };
    await throwing.run();
    assert.equal(throwing.state.selectionCalls, 1, "the wizard still ran");
    assert.equal(throwing.state.seenEntries, null);
});

test("a history write failure is reported but does not break the launch", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir })], failWrite: true });
    const result = await h.run({ autoLaunch: true });
    assert.ok(result, "launch completed");
    assert.equal(h.state.setupCalls.length, 1);
    assert.equal(h.state.launches.length, 1);
    assert.ok(h.state.logs.some(l => /could not save recent-Pal history/.test(l)), h.state.logs.join("\n"));
});

// --- WORKSPACE PATHS ----------------------------------------------------------------------

test("a recent launch reuses the remembered workspace without asking again", async () => {
    const dir = harness().state.ws("projects/Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir })] });
    const result = await h.run();
    assert.equal(h.state.dirDefaults.length, 0, "no directory question on a fast launch");
    assert.equal(h.state.setupCalls[0].workspaceDir, dir);
    assert.equal(result.workspaceDir, dir);
    assert.equal(h.configStore.recentPals[0].workspaceDir, dir, "the exact path is remembered");
});

test("--dir overrides the remembered directory, and is taken as an exact path", async () => {
    const remembered = harness().state.ws("remembered", {});
    const h = harness({ history: [entry({ workspaceDir: remembered })] });
    const explicit = path.join(h.state.root, "explicit", "My Pal (fast)"); // does not exist yet
    await h.run({ workspaceDir: explicit });
    assert.equal(h.state.setupCalls[0].workspaceDir, explicit, "no pal name is appended to an exact --dir path");
    assert.equal(h.state.dirDefaults.length, 0, "--dir means no directory prompt");
    assert.equal(h.state.recoveries.length, 0, "an empty/new folder needs no recovery");
});

test("--dir into a non-empty folder with no PalSync workspace is refused", async () => {
    const h = harness({ history: [entry()] });
    const other = h.state.ws("some-hub-folder");
    fs.writeFileSync(path.join(other, "notes.md"), "my projects index");
    await assert.rejects(() => h.run({ workspaceDir: other }), /will not adopt or overwrite/);
    assert.equal(h.state.setupCalls.length, 0, "nothing was pulled into the folder");
    assert.deepEqual(fs.readdirSync(other), ["notes.md"]);

    // A folder belonging to a different pal is refused too — --dir is not a way around identity.
    const wrong = h.state.ws("wrong-pal", { palGuid: "OTHER-GUID", palName: "MacroWeek" });
    await assert.rejects(() => h.run({ workspaceDir: wrong }), /belongs to a different pal/);
    assert.equal(h.state.setupCalls.length, 0);
});

test("the wizard remembers a relative or ~ path as one exact absolute path", async () => {
    const h = harness({ chooseDir: () => "~/projects/My Pal" });
    await h.run();
    const expected = path.join(os.homedir(), "projects", "My Pal");
    assert.equal(h.state.setupCalls[0].workspaceDir, expected);
    assert.equal(h.configStore.recentPals[0].workspaceDir, expected);
    // and a relative path resolves against the current directory
    const rel = harness({ chooseDir: () => "pals/Relative-Pal" });
    await rel.run();
    assert.equal(rel.state.setupCalls[0].workspaceDir, path.resolve("pals/Relative-Pal"));
});

test("Change workspace directory… updates the remembered path and launches there", async () => {
    const old = harness().state.ws("old", {});
    const h = harness({ history: [entry({ workspaceDir: old })] });
    const changed = h.state.ws("moved/Audithelm-V1", {});
    const result = await h.run({
        pickRecent: () => ({ kind: "change-dir" }),
        pickRecentPal: entries => entries[0],
        chooseDir: () => changed
    });
    assert.deepEqual(h.state.prompts, ["pal-menu", "pal-for-dir", "dir"]);
    assert.equal(h.configStore.recentPals[0].workspaceDir, changed, "the new path is remembered");
    assert.equal(h.state.setupCalls[0].workspaceDir, changed);
    assert.equal(result.workspaceDir, changed);
});

test("a failed launch after Change workspace directory… keeps the previous remembered path", async () => {
    const old = harness().state.ws("old", {});
    const h = harness({
        history: [entry({ workspaceDir: old })],
        setup: async () => { throw new Error("This pal is locked by Someone — cannot start a session."); }
    });
    const changed = h.state.ws("moved/Audithelm-V1", {});
    await assert.rejects(() => h.run({
        pickRecent: () => ({ kind: "change-dir" }),
        pickRecentPal: entries => entries[0],
        chooseDir: () => changed
    }), /locked by Someone/);
    assert.equal(h.configStore.recentPals[0].workspaceDir, old,
        "a launch that never completed does not rewrite the preference");
    assert.equal(h.configStore.recentPals[0].launchCount, 3);
});

test("a missing remembered workspace offers recovery instead of creating a replacement", async () => {
    const gone = path.join(tmpDir(), "deleted", "Audithelm-V1");
    const h = harness({ history: [entry({ workspaceDir: gone })] });
    // (a) quitting leaves everything alone
    assert.equal(await h.run({ recovery: () => null }), null);
    assert.equal(h.state.setupCalls.length, 0);
    assert.equal(fs.existsSync(gone), false, "no folder is recreated behind the user's back");
    assert.match(h.state.recoveries[0], /is gone/);

    // (b) "Choose a different folder…" points the launch at the real location
    const moved = h.state.ws("moved-here", {});
    const result = await h.run({ recovery: () => ({ kind: "choose-dir" }), chooseDir: () => moved });
    assert.equal(h.state.setupCalls[0].workspaceDir, moved);
    assert.equal(result.workspaceDir, moved);
    assert.equal(h.configStore.recentPals[0].workspaceDir, moved, "the new location is remembered");

    // (c) "Open another Pal…" hands over to the full wizard — a fresh harness, since (b) already
    //     remembered a usable folder.
    const goneAgain = harness({ history: [entry({ workspaceDir: gone })] });
    await goneAgain.run({ recovery: () => ({ kind: "other" }) });
    assert.equal(goneAgain.state.selectionCalls, 1);
    assert.equal(goneAgain.state.setupCalls.length, 1);
});

test("a workspace belonging to a different pal is refused, contents untouched", async () => {
    const h = harness();
    const dir = h.state.ws("wrong-pal", { palGuid: "OTHER-GUID", palName: "MacroWeek" });
    fs.writeFileSync(path.join(dir, "keep.txt"), "keep me");
    h.configStore.recentPals = [entry({ workspaceDir: dir })];
    const result = await h.run({ recovery: () => null });
    assert.equal(result, null);
    assert.equal(h.state.setupCalls.length, 0);
    assert.match(h.state.recoveries[0], /belongs to a different pal: "MacroWeek"/);
    assert.equal(fs.readFileSync(path.join(dir, "keep.txt"), "utf8"), "keep me");
});

test("a workspace created on another cloud is refused", async () => {
    const h = harness();
    const dir = h.state.ws("other-cloud", { cloudUrl: "https://secure.nimblewire.net" });
    h.configStore.recentPals = [entry({ workspaceDir: dir })];
    await h.run({ recovery: () => null });
    assert.equal(h.state.setupCalls.length, 0);
    assert.match(h.state.recoveries[0], /nimblewire\.net/);
});

test("a non-empty folder with no PalSync identity is never adopted", async () => {
    const h = harness();
    const dir = h.state.ws("hub-folder");
    fs.writeFileSync(path.join(dir, "notes.md"), "my projects index");
    h.configStore.recentPals = [entry({ workspaceDir: dir })];
    await h.run({ recovery: () => null });
    assert.equal(h.state.setupCalls.length, 0);
    assert.match(h.state.recoveries[0], /will not adopt or overwrite/);
    assert.deepEqual(fs.readdirSync(dir), ["notes.md"]);
});

test("the wizard refuses a mistyped parent folder and re-asks", async () => {
    const h = harness();
    const parent = h.state.ws("projects");
    fs.mkdirSync(path.join(parent, "pal-a"), { recursive: true });
    fs.writeFileSync(path.join(parent, "pal-a", "pal.json"), "{}");
    const safe = path.join(h.state.root, "Audithelm-V1");
    let asked = 0;
    await h.run({ chooseDir: () => (++asked === 1 ? parent : safe) });
    assert.equal(asked, 2, "the refused path is reported and the question comes back");
    assert.ok(h.state.logs.some(l => /will not adopt or overwrite/.test(l)), h.state.logs.join("\n"));
    assert.equal(h.state.setupCalls[0].workspaceDir, safe, "the launch went to the safe folder instead");
    assert.deepEqual(fs.readdirSync(parent), ["pal-a"], "the parent folder was not written into");
});

test("the wizard's refusal cannot be bypassed by typing the same path again", async () => {
    const h = harness();
    const parent = h.state.ws("projects");
    fs.mkdirSync(path.join(parent, "pal-a"), { recursive: true });
    fs.writeFileSync(path.join(parent, "pal-a", "pal.json"), "{}");
    let asked = 0;
    await assert.rejects(
        () => h.run({ chooseDir: () => (++asked <= 4 ? parent : null) }),
        /will not adopt or overwrite/);
    assert.equal(asked, 2, "the same refused path ends the question instead of looping");
    assert.equal(h.state.setupCalls.length, 0, "nothing was ever set up in the parent folder");
    assert.deepEqual(fs.readdirSync(parent), ["pal-a"]);

    // ...and the same for a folder that belongs to another pal
    const other = harness();
    const wrong = other.state.ws("wrong-pal", { palGuid: "OTHER-GUID", palName: "MacroWeek" });
    let askedOther = 0;
    await assert.rejects(
        () => other.run({ chooseDir: () => (++askedOther <= 3 ? wrong : path.join(other.state.root, "safe")) }),
        /belongs to a different pal/);
    assert.equal(askedOther, 2);
    assert.equal(other.state.setupCalls.length, 0, "the other pal's folder was never written into");
});

test("the wizard still creates a brand-new folder, and asks nothing when --dir is given", async () => {
    const h = harness();
    const fresh = path.join(h.state.root, "brand-new", "Audithelm-V1");
    await h.run({ chooseDir: () => fresh });
    assert.equal(h.state.setupCalls[0].workspaceDir, fresh, "a not-yet-existing folder is a normal first checkout");

    const explicit = harness();
    const target = path.join(explicit.state.root, "explicit", "Here");
    await explicit.run({ workspaceDir: target });
    assert.equal(explicit.state.dirDefaults.length, 0, "--dir skips the directory question");
    assert.equal(explicit.state.setupCalls[0].workspaceDir, target);
});

test("a caller with no terminal and no directory seam gets an error, not a hang", async () => {
    const h = harness({ noDirSeam: true });
    await assert.rejects(() => h.run({ nonInteractive: true, noMenuSeam: true, pickAgent: undefined }),
        /no interactive prompt is available/);
    assert.equal(h.state.setupCalls.length, 0);

    // With --dir there is nothing to ask, so the same caller works.
    const explicit = harness({ noDirSeam: true });
    const target = path.join(explicit.state.root, "via-flag");
    await explicit.run({ nonInteractive: true, noMenuSeam: true, pickAgent: undefined, workspaceDir: target });
    assert.equal(explicit.state.setupCalls[0].workspaceDir, target);
});

test("a headless caller never reaches a menu it cannot answer", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir })] });
    // interactive:false with no menu seam: the menu is skipped entirely (no prompt, no server
    // request for the menu itself), and the wizard's own behavior is what remains.
    await h.run({
        nonInteractive: true,
        noMenuSeam: true,
        pickAgent: undefined,
        chooseDir: () => path.join(h.state.root, "fresh")
    });
    assert.equal(h.state.seenEntries, null, "no menu for a caller that cannot answer one");
    assert.equal(h.state.selectionCalls, 1, "the wizard ran instead");
    assert.equal(h.state.setupCalls[0].workspaceDir, path.join(h.state.root, "fresh"));
});

test("a recent launch with no cached credential errors instead of prompting headlessly", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir })] });
    // No cached password, no login seam, no terminal: the fast path must say what to do rather
    // than block on a password prompt nobody can answer.
    require.cache[P.keychain].exports.getPassword = () => null;
    await assert.rejects(
        () => h.run({ nonInteractive: true, noLoginSeam: true }),
        /No cached credential for dev@example\.com @ https:\/\/cloud\.example/);
    assert.equal(h.state.setupCalls.length, 0);
});

test("an existing workspace of the same pal goes through the normal setup path", async () => {
    const h = harness();
    const dir = h.state.ws("mine", {});
    fs.writeFileSync(path.join(dir, "pal.json"), "{}");
    h.configStore.recentPals = [entry({ workspaceDir: dir })];
    await h.run();
    assert.equal(h.state.setupCalls.length, 1, "the shared setup (pull + drift guard + lock) runs");
    assert.equal(h.state.setupCalls[0].workspaceDir, dir);
    assert.equal(h.state.recoveries.length, 0);
});

// --- AUTHENTICATION -----------------------------------------------------------------------

test("a recent launch authenticates with the remembered account and cached credentials", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir })] });
    await h.run();
    assert.equal(h.state.loginCalls.length, 1);
    assert.equal(h.state.loginCalls[0].cloudUrl, "https://cloud.example");
    assert.equal(h.state.loginCalls[0].username, "dev@example.com");
    assert.deepEqual(h.state.prompts, ["pal-menu"], "one question: which pal");
});

test("signing in as a different account never opens the remembered pal", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({
        history: [entry({ workspaceDir: dir })],
        login: async () => ({ session: { username: "other@example.com", userId: "U-2", environment: { url: "https://cloud.example" } }, cloudUrl: "https://cloud.example", username: "other@example.com" })
    });
    await h.run();
    assert.equal(h.state.setupCalls.length, 1, "the wizard ran instead");
    assert.equal(h.state.setupCalls[0].session.username, "other@example.com");
    assert.notEqual(h.state.setupCalls[0].workspaceDir, dir, "another account's pal is never opened here");
    assert.equal(h.state.selectionCalls, 1);
    assert.ok(h.state.logs.some(l => /not the account/.test(l)));
});

test("credentials and tokens never reach the config file", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir })] });
    await h.run();
    const raw = JSON.stringify(h.configStore);
    assert.ok(!/password|token|secret|Basic /i.test(raw), raw);
});

// --- AGENTS -------------------------------------------------------------------------------

test("the remembered agent is reused, with its own prerequisites checked", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir, agent: "pi" })] });
    const result = await h.run({ autoLaunch: true });
    assert.deepEqual(h.state.preflights, ["pi"], "no Claude Code check for a Pi session");
    assert.equal(h.state.agentPicks, 0, "no agent question on a fast launch");
    assert.deepEqual(h.state.launches, [{ agent: "pi", cwd: dir }]);
    assert.equal(result.agent.key, "pi");
});

test("--agent overrides the remembered agent", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir, agent: "pi" })] });
    await h.run({ agent: "codex", autoLaunch: true });
    assert.deepEqual(h.state.preflights, ["codex"]);
    assert.equal(h.state.launches[0].agent, "codex");
});

test("an unavailable remembered agent asks instead of switching silently", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir, agent: "pi" })] });
    await h.run({
        agentOnPath: (cmd) => cmd !== "pi",
        pickAgent: async () => AGENT_LIST.find(a => a.key === "claude"),
        autoLaunch: true
    });
    assert.equal(h.state.agentPicks, 1, "the user is asked");
    assert.ok(h.state.logs.some(l => /not on PATH/.test(l)));
    assert.equal(h.state.launches[0].agent, "claude");

    // and refusing that question cancels cleanly rather than launching anything
    const cancel = harness({ history: [entry({ workspaceDir: dir, agent: "pi" })] });
    const result = await cancel.run({ agentOnPath: () => false, pickAgent: async () => null });
    assert.equal(result, null);
    assert.equal(cancel.state.setupCalls.length, 0);
    assert.equal(cancel.state.launches.length, 0);
});

test("--agent is honoured even when that agent's binary is missing (no silent swap)", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir, agent: "pi" })] });
    await h.run({ agent: "codex", agentOnPath: () => false, autoLaunch: true });
    assert.equal(h.state.agentPicks, 0);
    assert.equal(h.state.launches[0].agent, "codex");
});

test("preflight checks the agent that was chosen, and Pi/Gemini never trigger a Claude install", () => {
    const preflightPath = path.join(__dirname, "..", "src", "preflight.js");
    const runWith = (agent) => spawnSync(process.execPath, ["-e",
        "require(" + JSON.stringify(preflightPath) + ").run({ agent: " + JSON.stringify(agent) + " }).catch(e => { console.error(e); process.exit(3); })"
    ], {
        encoding: "utf8",
        timeout: 20000,
        input: "",
        env: Object.assign({}, process.env, { PATH: "", HOME: tmpDir() })
    });
    for (const agent of ["pi", "codex", "opencode", "gemini", "cursor", "copilot"]) {
        const res = runWith(agent);
        assert.equal(res.status, 0, agent + " should not need Claude Code: " + res.stderr);
        assert.ok(!/npm install -g @anthropic-ai\/claude-code/.test(res.stderr),
            agent + " must never be offered a Claude Code install:\n" + res.stderr);
    }
    assert.match(runWith("pi").stderr, /Pi/);
    assert.match(runWith("gemini").stderr, /Gemini CLI/);
});

// --- REGRESSIONS --------------------------------------------------------------------------

test("--eval bypasses the recent menu entirely and records no history", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const h = harness({ history: [entry({ workspaceDir: dir })] });
    const result = await h.run({
        evalSpec: "01_bench",
        pickRecentPrompt: async () => { throw new Error("the recent menu must be bypassed"); }
    });
    assert.equal(h.state.selectionCalls, 1, "forced-create wizard ran");
    assert.equal(result.evalSpec.key, "01_bench");
    assert.equal(h.configStore.recentPals[0].launchCount, 3, "benchmark pals do not clutter history");
});

test("a recent launch is cheaper than the full wizard in server requests", async () => {
    const dir = harness().state.ws("Audithelm-V1", {});
    const fast = harness({ history: [entry({ workspaceDir: dir })] });
    await fast.run();
    const wizard = harness();
    await wizard.run();
    // The wizard enumerates the whole account (profile → group → pal) before it can show a list;
    // the recent path re-resolves ONE profile/group. Both authenticate exactly once.
    assert.equal(fast.state.serverCalls, 1, "one scoped getPalList");
    assert.equal(fast.state.loginCalls.length, 1);
    assert.equal(wizard.state.selectionCalls, 1);
    assert.ok(wizard.state.serverCalls >= 3, "the wizard tests the picker's enumeration: " + wizard.state.serverCalls);
    assert.ok(fast.state.serverCalls < wizard.state.serverCalls);
});

test("a pal that is gone from the server is reported, and its history row is cleaned up", async () => {
    const h = harness({ history: [entry()], scoped: null, walk: null, recovery: () => null });
    const result = await h.run();
    assert.equal(result, null);
    assert.equal(h.state.setupCalls.length, 0);
    assert.ok(h.state.logs.some(l => /not on https:\/\/cloud\.example for dev@example\.com anymore/.test(l)));
    assert.deepEqual(h.configStore.recentPals, [], "the dead row does not sit in the menu forever");
});

test("a network failure while checking a pal is not reported as a deleted pal", async () => {
    const h = harness({
        history: [entry()],
        resolve: {
            refreshResolvedPal: async () => { throw new Error("getaddrinfo ENOTFOUND cloud.example"); },
            resolveServerPalByGuid: async () => { throw new Error("getaddrinfo ENOTFOUND cloud.example"); }
        }
    });
    await assert.rejects(() => h.run(), /Could not reach https:\/\/cloud\.example to check this Pal: getaddrinfo ENOTFOUND/);
    assert.equal(h.state.setupCalls.length, 0);
    assert.equal(h.configStore.recentPals.length, 1, "a transport failure never deletes history");
    assert.equal(h.configStore.recentPals[0].launchCount, 3, "and never counts as a launch");
    assert.equal(h.state.logs.some(l => /any more/.test(l)), false, "not reported as a deleted pal");
});
