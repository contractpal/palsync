"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { seedImpactBaseline, RECEIPT_PATH } = require("../src/core/impactEval");
const evalSpec = require("../src/core/evalSpec");
const { validateWorkspace } = require("../src/core/validate");
const workspaceHash = require("../src/core/workspaceHash");
const { writeIfChanged } = require("../src/core/atomicWrite");

function tempDir(t, prefix = "palsync-impact-eval-") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function copySpec(t, key = "impact_01_shared_fragment-on") {
    const source = evalSpec.resolveSpec(key);
    const root = tempDir(t, "palsync-impact-spec-");
    const dir = path.join(root, source.taskKey);
    fs.cpSync(source.dir, dir, { recursive: true });
    return {
        ...source,
        dir,
        baselineDir: path.join(dir, "baseline"),
        baselineManifestPath: path.join(dir, "baseline-manifest.json"),
        oraclePath: path.join(dir, "oracle.json"),
        armPath: path.join(dir, "arms", source.variant + ".md")
    };
}

// What `pal_pull` actually writes for a freshly created Pal: the registration sections plus the
// server-owned structure the fixture does not model. The old harness wrote the literal string
// "old manifest\n" here, so no test ever constructed a real Pal from the staged workspace — which
// is exactly why seeding could clobber layout/id and only fail against the live server.
// Shapes copied from a real `pal_pull` of a freshly created Pal — note the sections the platform
// serializes as an EMPTY STRING rather than { entry: [] } (fonts, automatedScripts,
// mobileConfigurations, desktopBindings, trashCan, releaseNotes, secureFields) and folders as
// { Folder: [] }. Guessing { entry: [] } for those trips the manifest shape validator, so this
// mirrors the server verbatim instead.
function pulledManifest(workspaceDir) {
    const empty = () => ({ entry: [] });
    return {
        layout: {
            name: "fresh", category: "fresh", description: "fresh",
            inheritanceEnabled: false, inheritConsole: false, inheritWeb: false,
            inheritTransaction: false, inheritUser: false, properties: "", roles: "",
            auditDocumentView: false, workflowVersion: 1, consoleControlled: false,
            mobileAccessType: 0, groupAccessOnly: false
        },
        documents: empty(), emails: empty(), images: empty(), pages: empty(), fragments: empty(),
        styles: empty(), wizards: empty(), workflows: empty(), scripts: empty(),
        fonts: "",
        datasets: empty(), dataviews: empty(), data: empty(), datalists: empty(),
        attachments: empty(),
        automatedScripts: "", mobileConfigurations: "", desktopBindings: "",
        folders: { Folder: [] },
        trashCan: "", releaseNotes: "", secureFields: "",
        id: "F".repeat(64),
        path: workspaceDir,
        environment: { url: "https://cloud.example.test", platformVersion: "" }
    };
}

function makeSeedHarness(t) {
    const workspaceDir = tempDir(t, "palsync-impact-workspace-");
    fs.mkdirSync(path.join(workspaceDir, "fragments"), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "fragments", "old.html"), "old tracked bytes\n");
    fs.writeFileSync(path.join(workspaceDir, "pal.json"), JSON.stringify(pulledManifest(workspaceDir), null, 2) + "\n");
    fs.writeFileSync(path.join(workspaceDir, "KEEP.md"), "untracked root file\n");
    const spec = copySpec(t);
    const manifest = JSON.parse(fs.readFileSync(spec.baselineManifestPath, "utf8"));
    const record = {
        palGuid: "PAL-FRESH-1",
        workspaceDir,
        lastModifiedDate: "marker-before",
        username: "owner@example.test",
        cloudUrl: "https://cloud.example.test"
    };
    const setupResult = { locked: true, workspaceDir, record };
    const session = { username: "owner@example.test", password: "TOP-SECRET", apiToken: "TOKEN-SECRET" };
    const persisted = [];
    const deps = {
        push: async function (actualSession, actualRecord, actualWorkspace) {
            assert.equal(arguments.length, 3, "seed push must use default safe options");
            assert.strictEqual(actualSession, session);
            assert.strictEqual(actualRecord, record);
            assert.equal(actualWorkspace, workspaceDir);
            record.lastModifiedDate = "marker-after";
            return {
                pushed: true,
                newMarker: "marker-after",
                serverPaths: [...manifest.expectedServerPaths]
            };
        }
    };
    async function persist(dir, value) {
        persisted.push({ dir, value: JSON.parse(JSON.stringify(value)) });
    }
    return {
        workspaceDir, spec, manifest, record, setupResult, session, persisted, deps, persist,
        args(overrides = {}) {
            return {
                session,
                workspaceDir,
                createdPalGuid: record.palGuid,
                setupResult,
                record,
                spec,
                persist,
                deps,
                ...overrides
            };
        }
    };
}

function receiptFile(h) {
    return path.join(h.workspaceDir, RECEIPT_PATH);
}

async function expectSeedFailure(h, pattern, overrides = {}) {
    await assert.rejects(seedImpactBaseline(h.args(overrides)), pattern);
}

test("seedImpactBaseline verifies, stages, pushes, refreshes, persists, then atomically receipts", async t => {
    const h = makeSeedHarness(t);
    const calls = [];
    let hashCalls = 0;
    h.deps.hashWorkspaceFiles = dir => {
        hashCalls++;
        if (hashCalls === 1) {
            calls.push("verify");
            assert.equal(path.resolve(dir), path.resolve(h.spec.baselineDir));
            assert.equal(fs.readFileSync(path.join(h.workspaceDir, "fragments", "old.html"), "utf8"), "old tracked bytes\n");
        } else {
            assert.equal(path.resolve(dir), path.resolve(h.workspaceDir));
            assert.equal(fs.existsSync(path.join(h.workspaceDir, "fragments", "old.html")), false);
            calls.push("clear tracked");
            assert.deepEqual(
                fs.readFileSync(path.join(h.workspaceDir, "fragments", "shared", "navbar.html")),
                fs.readFileSync(path.join(h.spec.baselineDir, "fragments", "shared", "navbar.html"))
            );
            calls.push("copy");
            calls.push("hash");
        }
        return workspaceHash.hashWorkspaceFiles(dir);
    };
    h.deps.validateWorkspace = dir => { calls.push("validate"); return validateWorkspace(dir); };
    const basePush = h.deps.push;
    h.deps.push = async function () { calls.push("push"); return basePush(...arguments); };
    h.deps.hashWorkspace = dir => { calls.push("refresh localHash"); return workspaceHash.hashWorkspace(dir); };
    h.deps.hashPaths = (dir, paths) => { calls.push("refresh fileHashes"); return workspaceHash.hashPaths(dir, paths); };
    h.persist = async (dir, record) => {
        calls.push("persist");
        h.persisted.push({ dir, value: JSON.parse(JSON.stringify(record)) });
    };
    h.deps.writeIfChanged = async (file, content) => {
        calls.push(file.endsWith(path.join("baseline", "baseline.json")) ? "regression baseline" : "receipt");
        return writeIfChanged(file, content);
    };

    const receipt = await seedImpactBaseline(h.args({ persist: h.persist }));

    // The regression baseline is written after the record is persisted and before the receipt, so
    // its `mapped` marker is the one the push actually returned.
    assert.deepEqual(calls, [
        "verify", "clear tracked", "copy", "hash", "validate", "push",
        "refresh localHash", "refresh fileHashes", "persist", "regression baseline", "receipt"
    ]);
    assert.equal(fs.readFileSync(path.join(h.workspaceDir, "KEEP.md"), "utf8"), "untracked root file\n");
    assert.equal(h.persisted.length, 1);
    assert.equal(h.persisted[0].dir, h.workspaceDir);
    assert.equal(h.record.lastModifiedDate, "marker-after");
    assert.equal(h.record.localHash, workspaceHash.hashWorkspace(h.workspaceDir));
    assert.deepEqual(h.record.fileHashes, workspaceHash.hashPaths(h.workspaceDir, h.manifest.expectedServerPaths));
    assert.deepEqual(JSON.parse(fs.readFileSync(receiptFile(h), "utf8")), receipt);
    assert.equal(receipt.fixtureDigest, h.manifest.fixtureDigest);
    assert.deepEqual(receipt.fixtureFiles, h.manifest.files);
    assert.equal(receipt.serverMarker, "marker-after");
    assert.deepEqual(receipt.serverPaths, h.manifest.expectedServerPaths);
    assert.deepEqual(receipt.push, { pushed: true, newMarker: "marker-after" });
    assert.deepEqual(receipt.lint, { errors: 0, warnings: 0 });
    assert.match(receipt.seededAt, /^\d{4}-\d\d-\d\dT/);

    const serialized = JSON.stringify(receipt);
    for (const forbidden of [h.workspaceDir, h.session.username, h.session.password, h.session.apiToken, h.record.cloudUrl]) {
        assert.equal(serialized.includes(forbidden), false, "receipt must omit " + forbidden);
    }
    assert.equal(Object.prototype.hasOwnProperty.call(receipt, "workspaceDir"), false);
});

// Regression: the first live arm failed with `save-rejected` and an empty validation list because
// seeding overwrote the 26-key pulled manifest with the fixture's 10 registration sections, leaving
// the Pal with no layout and no id. Assert the merge from the workspace side — a real Pal must be
// constructible from the staged manifest, the fixture's sections must be exact, and every
// server-owned key must survive.
test("seedImpactBaseline merges fixture sections onto the pulled manifest instead of replacing it", async t => {
    const h = makeSeedHarness(t);
    const pulled = JSON.parse(fs.readFileSync(path.join(h.workspaceDir, "pal.json"), "utf8"));
    const fixture = JSON.parse(fs.readFileSync(path.join(h.spec.baselineDir, "pal.json"), "utf8"));

    const receipt = await seedImpactBaseline(h.args());

    const staged = JSON.parse(fs.readFileSync(path.join(h.workspaceDir, "pal.json"), "utf8"));
    for (const key of ["layout", "id", "path", "environment", "folders", "trashCan", "secureFields"]) {
        assert.deepEqual(staged[key], pulled[key], "seeding must preserve server-owned key " + key);
    }
    for (const key of Object.keys(fixture)) {
        assert.deepEqual(staged[key], fixture[key], "seeding must apply fixture section " + key);
    }
    // The whole point: the staged manifest has to be a Pal the server can actually save, and it
    // must track exactly the paths the fixture manifest promises.
    const { Pal } = require("../lib/pal");
    const { manifestPaths } = require("../src/core/pull");
    const pal = await Pal.fromPath(h.workspaceDir);
    assert.ok(pal.layout, "staged Pal must carry a layout or the server refuses the save");
    assert.deepEqual([...manifestPaths(pal)].sort(), [...h.manifest.expectedServerPaths].sort());
    assert.deepEqual(receipt.manifest.fixtureSections, Object.keys(fixture).sort());
    assert.ok(receipt.manifest.preservedServerKeys.includes("layout"));
    assert.equal(receipt.manifest.preservedServerKeys.includes("pages"), false);
});

// pal_regression is one of the oracle's acceptance commands, so seeding must leave a baseline it
// can actually read — otherwise it answers "does not apply" on every arm and the recorded verdict
// would have to be invented.
test("seedImpactBaseline writes a regression baseline pal_regression can read", async t => {
    const h = makeSeedHarness(t);
    const receipt = await seedImpactBaseline(h.args());

    const { readBaseline } = require("../src/core/regression");
    const baseline = readBaseline(h.workspaceDir);
    assert.equal(baseline.mapped, "marker-after", "mapped must be the post-push server marker");
    assert.deepEqual(baseline.validate, { errors: 0, warnings: 0 });
    assert.deepEqual(baseline.known_issues, []);
    // Deliberately absent: pre-push, the server still holds baseline code, so these arms would
    // compare the baseline against itself and manufacture guaranteed passes.
    assert.equal(Object.prototype.hasOwnProperty.call(baseline, "test"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(baseline, "pages"), false);
    assert.deepEqual(receipt.regressionBaseline,
        { path: "baseline/baseline.json", mapped: "marker-after", arms: ["validate"] });
    // baseline/ is outside the pushed roots, so it must not have become a tracked server path.
    assert.equal(receipt.serverPaths.some(p => p.startsWith("baseline/")), false);
});

test("seedImpactBaseline refuses a pulled manifest that is unusable or carries no server layout", async t => {
    await t.test("unparseable", async t2 => {
        const h = makeSeedHarness(t2);
        fs.writeFileSync(path.join(h.workspaceDir, "pal.json"), "not json\n");
        await expectSeedFailure(h, /parseable pulled pal\.json/);
    });
    await t.test("missing layout", async t2 => {
        const h = makeSeedHarness(t2);
        const pulled = JSON.parse(fs.readFileSync(path.join(h.workspaceDir, "pal.json"), "utf8"));
        delete pulled.layout;
        fs.writeFileSync(path.join(h.workspaceDir, "pal.json"), JSON.stringify(pulled) + "\n");
        await expectSeedFailure(h, /server-owned layout/);
    });
    await t.test("absent", async t2 => {
        const h = makeSeedHarness(t2);
        fs.rmSync(path.join(h.workspaceDir, "pal.json"));
        await expectSeedFailure(h, /freshly pulled pal\.json/);
    });
});

test("seedImpactBaseline refuses unproved freshness, mismatched paths, or a missing setup lock before deletion", async t => {
    const cases = [
        ["opened existing Pal", h => ({ createdPalGuid: null }), /fresh-created Pal GUID/],
        ["different created GUID", h => ({ createdPalGuid: "PAL-OTHER" }), /fresh-created Pal GUID/],
        ["record GUID mismatch", h => ({ record: { ...h.record, palGuid: "PAL-OTHER" } }), /fresh-created Pal GUID/],
        ["setup GUID mismatch", h => ({ setupResult: { ...h.setupResult, record: { ...h.record, palGuid: "PAL-OTHER" } } }), /fresh-created Pal GUID/],
        ["workspace mismatch", h => ({ setupResult: { ...h.setupResult, workspaceDir: h.workspaceDir + "-other" } }), /workspace paths/],
        ["lock not held", h => ({ setupResult: { ...h.setupResult, locked: false } }), /held lock/]
    ];
    for (const [name, overrides, pattern] of cases) {
        await t.test(name, async t2 => {
            const h = makeSeedHarness(t2);
            await expectSeedFailure(h, pattern, overrides(h));
            assert.equal(fs.readFileSync(path.join(h.workspaceDir, "fragments", "old.html"), "utf8"), "old tracked bytes\n");
            assert.equal(h.persisted.length, 0);
        });
    }
});

test("seedImpactBaseline refuses a changed fixture hash before deletion", async t => {
    const h = makeSeedHarness(t);
    fs.appendFileSync(path.join(h.spec.baselineDir, "fragments", "shared", "navbar.html"), "changed");
    await expectSeedFailure(h, /fixture hash mismatch/);
    assert.equal(fs.readFileSync(path.join(h.workspaceDir, "fragments", "old.html"), "utf8"), "old tracked bytes\n");
});

test("seedImpactBaseline refuses baseline links, dot paths, extra files, and out-of-scope paths before deletion", async t => {
    const cases = [
        ["link", h => fs.symlinkSync("navbar.html", path.join(h.spec.baselineDir, "fragments", "shared", "alias.html")), /symbolic link/],
        ["dot path", h => fs.writeFileSync(path.join(h.spec.baselineDir, ".hidden"), "x"), /dot path/],
        ["extra tracked file", h => fs.writeFileSync(path.join(h.spec.baselineDir, "fragments", "extra.html"), "x"), /file set/],
        ["out-of-scope file", h => fs.writeFileSync(path.join(h.spec.baselineDir, "README.md"), "x"), /outside tracked roots/]
    ];
    for (const [name, mutate, pattern] of cases) {
        await t.test(name, async t2 => {
            const h = makeSeedHarness(t2);
            mutate(h);
            await expectSeedFailure(h, pattern);
            assert.equal(fs.readFileSync(path.join(h.workspaceDir, "fragments", "old.html"), "utf8"), "old tracked bytes\n");
        });
    }
});

test("seedImpactBaseline refuses any lint error and never pushes", async t => {
    const h = makeSeedHarness(t);
    let pushed = false;
    h.deps.validateWorkspace = () => ({ errors: 1, warnings: 0 });
    h.deps.push = async () => { pushed = true; };
    await expectSeedFailure(h, /expected 0 errors and 0 warnings/);
    assert.equal(pushed, false);
});

test("seedImpactBaseline refuses any lint warning and never pushes", async t => {
    const h = makeSeedHarness(t);
    let pushed = false;
    h.deps.validateWorkspace = () => ({ errors: 0, warnings: 1 });
    h.deps.push = async () => { pushed = true; };
    await expectSeedFailure(h, /expected 0 errors and 0 warnings/);
    assert.equal(pushed, false);
});

test("seedImpactBaseline surfaces push validation refusal without persistence or receipt", async t => {
    const h = makeSeedHarness(t);
    h.deps.push = async () => ({ pushed: false, refused: "validation", lint: { errors: 1, warnings: 0 } });
    await expectSeedFailure(h, /push refused: validation/);
    assert.equal(h.persisted.length, 0);
    assert.equal(fs.existsSync(receiptFile(h)), false);
});

// Finding #11: a save-rejected baseline push reported only `refused: "save-rejected"` and threw away the
// server's own notes, while `palsync push` prints them in full. The failure lands AFTER a fresh Pal
// exists on the server, so this one message is the whole diagnosis -- an activation key without the
// Console Workflow entitlement rejects the fixture here and looked like every other refusal.
test("seedImpactBaseline surfaces the server's validation notes on a save-rejected push", async t => {
    const h = makeSeedHarness(t);
    h.deps.push = async () => ({
        pushed: false, refused: "save-rejected",
        validation: [
            { group: "Workflow", object: "console", message: "Activation key does not allow Console Workflow" },
            { group: "Workflow", object: "console", message: "Activation key does not allow Console Workflow" },
            { group: "Page", object: "settings", message: "Tag script is not allowed" },
        ],
        lint: { errors: 0, warnings: 2 },
    });
    await expectSeedFailure(h, /Activation key does not allow Console Workflow/);
    await expectSeedFailure(h, /Tag script is not allowed/);
    // Duplicate notes are grouped with a count rather than repeated, and the pre-push lint totals ride
    // along so a warning-only push still explains itself.
    await expectSeedFailure(h, /\(x2\)/);
    await expectSeedFailure(h, /Pre-push lint: 0 error\(s\), 2 warning\(s\)/);
    assert.equal(h.persisted.length, 0);
    assert.equal(fs.existsSync(receiptFile(h)), false);
});

test("seedImpactBaseline reports a bare refusal when the push carries no diagnostics", async t => {
    const h = makeSeedHarness(t);
    h.deps.push = async () => ({ pushed: false, refused: "save-rejected" });
    await expectSeedFailure(h, /push refused: save-rejected$/);
});

test("seedImpactBaseline refuses missing, incomplete, or extra authoritative server paths", async t => {
    const cases = [
        ["missing array", () => null, /authoritative serverPaths/],
        ["missing path", h => h.manifest.expectedServerPaths.slice(1), /do not exactly match/],
        ["extra path", h => [...h.manifest.expectedServerPaths, "pages/extra.html"], /do not exactly match/]
    ];
    for (const [name, paths, pattern] of cases) {
        await t.test(name, async t2 => {
            const h = makeSeedHarness(t2);
            h.deps.push = async () => {
                h.record.lastModifiedDate = "marker-after";
                return { pushed: true, newMarker: "marker-after", serverPaths: paths(h) };
            };
            await expectSeedFailure(h, pattern);
            assert.equal(h.persisted.length, 0);
        });
    }
});

test("seedImpactBaseline refuses unchanged fallback and marker/record disagreement", async t => {
    const cases = [
        ["unchanged fallback", h => ({ pushed: true, newMarker: "marker-before", serverPaths: h.manifest.expectedServerPaths })],
        ["record disagreement", h => ({ pushed: true, newMarker: "marker-after", serverPaths: h.manifest.expectedServerPaths })]
    ];
    for (const [name, result] of cases) {
        await t.test(name, async t2 => {
            const h = makeSeedHarness(t2);
            h.deps.push = async () => {
                if (name === "unchanged fallback") h.record.lastModifiedDate = "marker-before";
                else h.record.lastModifiedDate = "different-record-marker";
                return result(h);
            };
            await expectSeedFailure(h, /authoritative changed server marker/);
            assert.equal(h.persisted.length, 0);
        });
    }
});

async function withMockedLauncher(mocks, fn) {
    const launcherPath = require.resolve("../src/launcher/index");
    const moduleMocks = new Map([
        [require.resolve("../src/auth/credentials"), { login: mocks.login }],
        [require.resolve("../src/launcher/selection"), { runSelection: mocks.runSelection }],
        [require.resolve("../src/core/createPal"), { createNewPal: mocks.createNewPal }],
        [require.resolve("../src/launcher/agents"), mocks.agents],
        [require.resolve("../src/launcher/workspace"), mocks.workspace],
        [require.resolve("../src/core/evalSpec"), mocks.evalSpec],
        [require.resolve("../src/core/impactEval"), { seedImpactBaseline: mocks.seedImpactBaseline }],
        [require.resolve("../src/core/lock"), { releaseByGuid: mocks.releaseByGuid }]
    ]);
    const saved = new Map([[launcherPath, require.cache[launcherPath]]]);
    for (const [file, exports] of moduleMocks) {
        saved.set(file, require.cache[file]);
        require.cache[file] = { id: file, filename: file, loaded: true, exports };
    }
    delete require.cache[launcherPath];
    try { return await fn(require(launcherPath)); }
    finally {
        delete require.cache[launcherPath];
        for (const [file, cached] of saved) {
            if (cached) require.cache[file] = cached;
            else delete require.cache[file];
        }
    }
}

function launcherHarness(t, { kind = "impact", mode = "create", autoLaunch = true } = {}) {
    const dir = tempDir(t, "palsync-impact-launcher-");
    const spec = kind === "impact" ? copySpec(t) : {
        key: "01_standard", suggestedName: "standard", kind: undefined, dir
    };
    const calls = [];
    const session = { username: "owner@example.test", userId: "USER-1" };
    const record = { palGuid: "PAL-FRESH-1", workspaceDir: dir, lastModifiedDate: "before" };
    const setupResult = { locked: true, workspaceDir: dir, record };
    let launched = 0;
    let seeded = 0;
    let released = 0;
    const selection = mode === "create" ? {
        mode: "create",
        profile: { profileId: "PROFILE-1" },
        groups: [{ groupId: "GROUP-1" }],
        details: { name: "impact", description: "", category: "Other" },
        activationKey: "KEY-1"
    } : { profile: { profileId: "PROFILE-1" }, pal: { guid: "PAL-EXISTING", name: "existing" } };
    const mocks = {
        login: async () => ({ session, cloudUrl: "https://cloud.example.test" }),
        runSelection: async () => selection,
        createNewPal: async () => ({ guid: "PAL-FRESH-1", name: "impact" }),
        agents: {
            AGENTS: [{ key: "claude", label: "Claude" }],
            resolve: () => ({ key: "claude", label: "Claude" }),
            pick: async () => ({ key: "claude", label: "Claude" }),
            launch: () => { launched++; calls.push("launch"); return { pid: 1 }; }
        },
        workspace: {
            defaultWorkspaceDir: () => dir,
            setup: async () => { fs.mkdirSync(dir, { recursive: true }); calls.push("setup"); return setupResult; }
        },
        evalSpec: {
            listSpecs: () => [spec],
            resolveSpec: () => spec,
            injectSpec: () => { calls.push("inject standard"); return { written: ["SPEC.md"], skipped: [] }; },
            injectImpactSpec: (workspaceDir, actualSpec, options) => {
                calls.push("inject impact");
                return evalSpec.injectImpactSpec(workspaceDir, actualSpec, options);
            }
        },
        seedImpactBaseline: async args => {
            seeded++;
            calls.push("seed");
            assert.equal(args.createdPalGuid, "PAL-FRESH-1");
            assert.equal(args.record.palGuid, "PAL-FRESH-1");
            assert.equal(args.setupResult.locked, true);
            assert.equal(args.workspaceDir, dir);
            return { schema: "palsync/impact-start/1" };
        },
        releaseByGuid: async (actualSession, guid) => {
            released++;
            calls.push("release");
            assert.strictEqual(actualSession, session);
            assert.equal(guid, record.palGuid);
        }
    };
    async function run(overrides = {}) {
        return withMockedLauncher(mocks, ({ run: launcherRun }) => launcherRun({
            evalSpec: kind ? spec.key : undefined,
            agent: "claude",
            chooseWorkspaceDir: async () => dir,
            autoLaunch,
            ...overrides
        }));
    }
    return {
        dir, spec, calls, mocks, run,
        get launched() { return launched; },
        get seeded() { return seeded; },
        get released() { return released; }
    };
}

test("launcher orders impact setup, seed, exact injection, then launch with the fresh GUID", async t => {
    const h = launcherHarness(t);
    const result = await h.run();
    assert.deepEqual(h.calls, ["setup", "seed", "inject impact", "launch"]);
    assert.equal(h.seeded, 1);
    assert.equal(h.launched, 1);
    assert.ok(fs.readFileSync(path.join(h.dir, "EXECUTION.md"), "utf8").includes("Evaluator-owned impact arm"));
    assert.equal(result.evalSpec.key, h.spec.key);
});

test("standard eval and normal launcher flows bypass impact seeding", async t => {
    await t.test("standard eval", async t2 => {
        const h = launcherHarness(t2, { kind: "standard" });
        await h.run();
        assert.deepEqual(h.calls, ["setup", "inject standard", "launch"]);
        assert.equal(h.seeded, 0);
    });
    await t.test("normal launcher", async t2 => {
        const h = launcherHarness(t2, { kind: null });
        await h.run();
        assert.deepEqual(h.calls, ["setup", "launch"]);
        assert.equal(h.seeded, 0);
    });
});

test("launcher pre-existing task docs prevent impact seed/push entirely and release the lock", async t => {
    for (const name of ["SPEC.md", "EXECUTION.md"]) {
        await t.test(name, async t2 => {
            const h = launcherHarness(t2);
            h.mocks.workspace.setup = async () => {
                fs.mkdirSync(h.dir, { recursive: true });
                fs.writeFileSync(path.join(h.dir, name), "occupied");
                h.calls.push("setup");
                return { locked: true, workspaceDir: h.dir, record: { palGuid: "PAL-FRESH-1", workspaceDir: h.dir } };
            };
            await assert.rejects(h.run(), /partial eval Pal must be discarded manually/);
            assert.equal(h.seeded, 0);
            assert.equal(h.launched, 0);
            assert.equal(h.released, 1);
            assert.deepEqual(h.calls, ["setup", "release"]);
        });
    }
});

test("task document appearing between preflight and injection is refused, rolled back, released, and never launched", async t => {
    const h = launcherHarness(t);
    h.mocks.seedImpactBaseline = async () => {
        h.calls.push("seed");
        fs.writeFileSync(path.join(h.dir, "SPEC.md"), "raced");
    };
    await assert.rejects(h.run(), /workspace root already contains SPEC\.md or EXECUTION\.md/);
    assert.equal(h.launched, 0);
    assert.equal(h.released, 1);
    assert.deepEqual(h.calls, ["setup", "seed", "inject impact", "release"]);
    assert.equal(fs.readFileSync(path.join(h.dir, "SPEC.md"), "utf8"), "raced");
    assert.equal(fs.existsSync(path.join(h.dir, "EXECUTION.md")), false);
});

test("any post-setup impact failure best-effort releases by GUID and never launches", async t => {
    const h = launcherHarness(t);
    h.mocks.seedImpactBaseline = async () => { h.calls.push("seed"); throw new Error("push marker unproved"); };
    await assert.rejects(h.run(), /partial eval Pal must be discarded manually.*push marker unproved/);
    assert.equal(h.launched, 0);
    assert.equal(h.released, 1);
    assert.deepEqual(h.calls, ["setup", "seed", "release"]);
    assert.equal(fs.existsSync(path.join(h.dir, "SPEC.md")), false);
    assert.equal(fs.existsSync(path.join(h.dir, "EXECUTION.md")), false);
});
