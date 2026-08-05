"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
    listImpactSpecs, resolveSpec, injectImpactSpec, IMPACT_DIR, ARM_BLOCK_START, ARM_BLOCK_END
} = require("../src/core/evalSpec");
const { hashWorkspaceFiles } = require("../src/core/workspaceHash");
const { validateWorkspace } = require("../src/core/validate");
const { buildImpactSnapshot } = require("../src/core/validate/snapshot");
const { buildStructuralImpact, resolveImpactTarget } = require("../src/core/impactContext");
const baselineChecker = require("../scripts/hash-impact-baselines");
const { tmpWorkspace } = require("./helpers");

const TASKS = [
    "impact_01_shared_fragment",
    "impact_02_nested_fragment",
    "impact_03_dynamic_fragment"
];
const VIRTUAL_KEYS = TASKS.flatMap(task => [task + "-off", task + "-on"]);

function tempDir(prefix = "palsync-impact-") {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function copyTask(taskKey) {
    const root = tempDir();
    fs.cpSync(path.join(IMPACT_DIR, taskKey), path.join(root, taskKey), { recursive: true });
    return root;
}

function updateJson(file, mutate) {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    mutate(value);
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function filesUnder(dir) {
    const out = [];
    function walk(current, rel) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const childRel = rel ? rel + "/" + entry.name : entry.name;
            if (entry.isDirectory()) walk(path.join(current, entry.name), childRel);
            else out.push(childRel);
        }
    }
    walk(dir, "");
    return out.sort();
}

function withoutArmBlock(content) {
    const start = content.indexOf(ARM_BLOCK_START);
    const end = content.indexOf(ARM_BLOCK_END);
    assert.ok(start >= 0 && end > start, "owned arm block should be present");
    return content.slice(0, start) + "<ARM>" + content.slice(end + ARM_BLOCK_END.length);
}

test("3. listImpactSpecs exposes three tasks as six exact virtual keys", () => {
    const specs = listImpactSpecs();
    assert.deepEqual(specs.map(spec => spec.key), VIRTUAL_KEYS);
    assert.deepEqual([...new Set(specs.map(spec => spec.taskKey))], TASKS);
    for (const spec of specs) {
        assert.equal(spec.kind, "impact");
        assert.ok(path.isAbsolute(spec.dir));
        assert.ok(path.isAbsolute(spec.baselineDir));
        assert.ok(path.isAbsolute(spec.baselineManifestPath));
        assert.ok(path.isAbsolute(spec.oraclePath));
        assert.ok(path.isAbsolute(spec.armPath));
        assert.ok(["off", "on"].includes(spec.variant));
        assert.ok(spec.impactTarget.startsWith("fragments/"));
        assert.equal(resolveSpec(spec.key).key, spec.key);
    }
});

test("4. bare and numeric impact aliases refuse", () => {
    for (const key of TASKS.concat(["impact_01", "6", "06"])) {
        assert.throws(() => resolveSpec(key), /Unknown eval spec/);
    }
});

test("5. arm documents contain only the approved intervention", () => {
    for (const taskKey of TASKS) {
        const off = resolveSpec(taskKey + "-off");
        const on = resolveSpec(taskKey + "-on");
        assert.equal(fs.readFileSync(off.armPath, "utf8"),
            "Impact-context experiment arm: OFF.\n" +
            "Do not call pal_context with target during this run. All other PalSync tools and normal workflow remain unchanged.\n");
        assert.equal(fs.readFileSync(on.armPath, "utf8"),
            "Impact-context experiment arm: ON.\n" +
            "Before the first edit to any server-tracked file, call pal_context once with target=\"" +
            on.impactTarget + "\" and use its exact facts/unknowns. Then continue the normal workflow.\n");
        assert.equal(off.dir, on.dir);
        assert.equal(off.baselineDir, on.baselineDir);
        assert.equal(off.oraclePath, on.oraclePath);
    }
});

test("6. off/on injection differs only inside the evaluator-owned arm block", () => {
    const workspaces = [];
    try {
        for (const taskKey of TASKS) {
            const offWs = tmpWorkspace();
            const onWs = tmpWorkspace();
            workspaces.push(offWs, onWs);
            injectImpactSpec(offWs, resolveSpec(taskKey + "-off"), { fillValue: "workspace-proof" });
            injectImpactSpec(onWs, resolveSpec(taskKey + "-on"), { fillValue: "workspace-proof" });
            assert.equal(fs.readFileSync(path.join(offWs, "SPEC.md"), "utf8"),
                fs.readFileSync(path.join(onWs, "SPEC.md"), "utf8"));
            const offExecution = fs.readFileSync(path.join(offWs, "EXECUTION.md"), "utf8");
            const onExecution = fs.readFileSync(path.join(onWs, "EXECUTION.md"), "utf8");
            assert.notEqual(offExecution, onExecution);
            assert.equal(withoutArmBlock(offExecution), withoutArmBlock(onExecution));
        }
    } finally {
        for (const ws of workspaces) fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("7. impact injection writes only task docs, never oracle or baseline manifest", () => {
    const ws = tmpWorkspace();
    try {
        const result = injectImpactSpec(ws, resolveSpec(VIRTUAL_KEYS[0]), { fillValue: "proof" });
        assert.deepEqual(result, { written: ["SPEC.md", "EXECUTION.md"], skipped: [] });
        assert.deepEqual(filesUnder(ws), ["EXECUTION.md", "SPEC.md"]);
        assert.ok(!fs.existsSync(path.join(ws, "oracle.json")));
        assert.ok(!fs.existsSync(path.join(ws, "baseline-manifest.json")));
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test("dynamic task docs require investigation without disclosing the hidden selector", () => {
    const dir = path.join(IMPACT_DIR, TASKS[2]);
    const docs = ["SPEC.md", "EXECUTION.md"]
        .map(name => fs.readFileSync(path.join(dir, name), "utf8"))
        .join("\n");
    assert.match(docs, /investigate runtime composition/i);
    assert.doesNotMatch(docs, /payload|workflows\/report\.js|\$\{panel\}/i);
});

test("impact injection preflights both docs and rolls back a partial write", () => {
    const spec = resolveSpec(VIRTUAL_KEYS[0]);
    for (const existing of ["SPEC.md", "EXECUTION.md"]) {
        const ws = tmpWorkspace();
        try {
            fs.writeFileSync(path.join(ws, existing), "owned");
            assert.throws(() => injectImpactSpec(ws, spec, { fillValue: "proof" }), /refused/);
            assert.equal(fs.readFileSync(path.join(ws, existing), "utf8"), "owned");
            assert.equal(filesUnder(ws).length, 1);
        } finally { fs.rmSync(ws, { recursive: true, force: true }); }
    }

    const ws = tmpWorkspace();
    const originalOpen = fs.openSync;
    try {
        fs.openSync = function(file, ...args) {
            if (path.basename(file) === "EXECUTION.md") throw new Error("simulated second write failure");
            return originalOpen.call(fs, file, ...args);
        };
        assert.throws(() => injectImpactSpec(ws, spec, { fillValue: "proof" }), /without partial task documents/);
    } finally {
        fs.openSync = originalOpen;
        assert.deepEqual(filesUnder(ws), []);
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("8. malformed impact JSON refuses", () => {
    const root = tempDir();
    try {
        const taskDir = path.join(root, "impact_bad");
        fs.mkdirSync(taskDir);
        fs.writeFileSync(path.join(taskDir, "impact.json"), "{not-json\n");
        assert.throws(() => listImpactSpecs(root), /Invalid impact eval spec.*JSON|Unexpected token|property name/i);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("9. missing and mismatched baseline hashes refuse", () => {
    let root = copyTask(TASKS[0]);
    try {
        fs.rmSync(path.join(root, TASKS[0], "baseline-manifest.json"));
        assert.throws(() => listImpactSpecs(root), /baseline manifest/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }

    root = copyTask(TASKS[0]);
    try {
        fs.appendFileSync(path.join(root, TASKS[0], "baseline", "styles", "styles.css"), "/* drift */\n");
        assert.throws(() => listImpactSpecs(root), /baseline hash mismatch/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("oracle validation rejects incomplete arrays, malformed checks, unsafe paths, and scoring drift", () => {
    const cases = [
        ["missing required array", oracle => { delete oracle.requiredPresent; }, /malformed oracle metadata/],
        ["empty required array", oracle => { oracle.requiredAbsent = []; }, /expected a non-empty array/],
        ["malformed content check", oracle => { oracle.requiredContentChecks[0].includes = ""; }, /malformed content check/],
        ["malformed excludes", oracle => { oracle.requiredContentChecks[0].excludes = [""]; }, /malformed excludes/],
        ["wrong commands", oracle => { oracle.acceptanceCommands = ["pal_validate"]; }, /fixed acceptance command sequence/],
        ["wrong first-write definition", oracle => { oracle.firstCorrectWriteDefinition = "first write"; }, /unexpected scoring definition/],
        ["drive-qualified path", oracle => { oracle.allowedServerTrackedWrites[0] = "C:/outside.html"; }, /relative POSIX path/],
        ["UNC path", oracle => { oracle.requiredPresent[0] = "\\\\server\\share\\outside.html"; }, /relative POSIX path/],
        ["escaping path", oracle => { oracle.requiredAbsent[0] = "fragments/../outside.html"; }, /dot and empty path segments/]
    ];
    for (const [label, mutate, expected] of cases) {
        const root = copyTask(TASKS[0]);
        try {
            updateJson(path.join(root, TASKS[0], "oracle.json"), mutate);
            assert.throws(() => listImpactSpecs(root), expected, label);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
});

test("runtime baseline validation requires every scanned server file in expectedServerPaths", () => {
    const root = copyTask(TASKS[0]);
    try {
        const taskDir = path.join(root, TASKS[0]);
        const baselineDir = path.join(taskDir, "baseline");
        fs.writeFileSync(path.join(baselineDir, "styles", "unregistered.css"), "body {}\n");
        const hashed = hashWorkspaceFiles(baselineDir);
        updateJson(path.join(taskDir, "baseline-manifest.json"), manifest => {
            manifest.fixtureDigest = "sha256:" + hashed.combined;
            manifest.files = hashed.files;
        });
        assert.throws(() => listImpactSpecs(root), /complete baseline file set/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("eval loader and baseline checker reject drive, UNC, and escaping config paths", () => {
    const unsafe = [
        "C:/outside", "C:outside", "\\\\server\\share\\baseline", "//server/share/baseline",
        "nested/../../outside"
    ];
    for (const value of unsafe) {
        const root = copyTask(TASKS[0]);
        try {
            const taskDir = path.join(root, TASKS[0]);
            updateJson(path.join(taskDir, "impact.json"), impact => { impact.baseline = value; });
            assert.throws(() => listImpactSpecs(root), /relative POSIX path|dot and empty path segments|escapes/, value);
            assert.throws(() => baselineChecker.manifestFor(taskDir), /relative POSIX path|dot or empty path segment|escapes/, value);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
});

test("eval loader and baseline checker reject a symlinked parent component", () => {
    const root = copyTask(TASKS[0]);
    try {
        const taskDir = path.join(root, TASKS[0]);
        fs.symlinkSync(taskDir, path.join(taskDir, "linked-parent"), "dir");
        updateJson(path.join(taskDir, "impact.json"), impact => {
            impact.baseline = "linked-parent/baseline";
        });
        assert.throws(() => listImpactSpecs(root), /symbolic link/);
        assert.throws(() => baselineChecker.manifestFor(taskDir), /symbolic link/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("impact-prefixed non-directories are fatal rather than silently skipped", () => {
    const root = tempDir();
    try {
        fs.writeFileSync(path.join(root, "impact_broken"), "not a task directory");
        assert.throws(() => listImpactSpecs(root), /expected a real directory/);
        assert.throws(() => baselineChecker.run("--check", root), /must be a real directory/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("baseline --write rejects a symlink destination without changing its target", () => {
    const root = copyTask(TASKS[0]);
    const outside = tempDir("palsync-impact-outside-");
    try {
        const taskDir = path.join(root, TASKS[0]);
        const manifestPath = path.join(taskDir, "baseline-manifest.json");
        const sentinelPath = path.join(outside, "sentinel.json");
        const sentinel = "external sentinel\n";
        fs.writeFileSync(sentinelPath, sentinel);
        fs.rmSync(manifestPath);
        fs.symlinkSync(sentinelPath, manifestPath);

        assert.throws(() => baselineChecker.run("--write", root), /symbolic link/);
        assert.equal(fs.readFileSync(sentinelPath, "utf8"), sentinel);
        assert.ok(fs.lstatSync(manifestPath).isSymbolicLink());
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test("10. manifest hashes are raw hex and deep-equal hashWorkspaceFiles output", () => {
    for (const taskKey of TASKS) {
        const spec = resolveSpec(taskKey + "-off");
        const manifest = JSON.parse(fs.readFileSync(spec.baselineManifestPath, "utf8"));
        const hashed = hashWorkspaceFiles(spec.baselineDir);
        assert.match(manifest.fixtureDigest, /^sha256:[0-9a-f]{64}$/);
        assert.deepEqual(manifest.files, hashed.files);
        for (const digest of Object.values(manifest.files)) assert.match(digest, /^[0-9a-f]{64}$/);
    }
});

test("11. baseline hash checker passes fixtures and detects drift", () => {
    baselineChecker.run("--check");
    const root = tempDir();
    try {
        fs.cpSync(IMPACT_DIR, root, { recursive: true });
        fs.appendFileSync(path.join(root, TASKS[1], "baseline", "styles", "styles.css"), "/* drift */\n");
        assert.throws(() => baselineChecker.run("--check", root), /manifest\(s\) drifted/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("baseline checker rejects dot, linked, and out-of-scope paths", () => {
    for (const entry of [".hidden", "notes"]) {
        const root = tempDir();
        try {
            fs.mkdirSync(path.join(root, entry));
            assert.throws(() => baselineChecker.scanBaseline(root), /dot path|out-of-scope path/);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
    const root = tempDir();
    try {
        fs.mkdirSync(path.join(root, "fragments"));
        fs.writeFileSync(path.join(root, "outside.html"), "x");
        fs.symlinkSync(path.join(root, "outside.html"), path.join(root, "fragments", "linked.html"));
        assert.throws(() => baselineChecker.scanBaseline(root), /link is not allowed/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("12. package files include eval/impact", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    assert.ok(pkg.files.includes("eval/impact/"));
});

test("fixed task contracts and clean baselines hold", () => {
    const expectedLiteralCounts = new Map([
        ["impact_01_shared_fragment", 3],
        ["impact_02_nested_fragment", 2]
    ]);
    for (const [taskKey, count] of expectedLiteralCounts) {
        const spec = resolveSpec(taskKey + "-off");
        const identity = spec.impactTarget.slice("fragments/".length).replace(/\.html$/, "");
        const markup = filesUnder(spec.baselineDir)
            .filter(rel => /^(pages|fragments)\/.+\.html$/.test(rel))
            .map(rel => fs.readFileSync(path.join(spec.baselineDir, ...rel.split("/")), "utf8"))
            .join("\n");
        const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        assert.equal((markup.match(new RegExp('c:fragment\\s+name="' + escaped + '"', "g")) || []).length, count);
    }

    const dynamic = resolveSpec("impact_03_dynamic_fragment-off");
    const page = fs.readFileSync(path.join(dynamic.baselineDir, "pages", "report.html"), "utf8");
    const workflow = fs.readFileSync(path.join(dynamic.baselineDir, "workflows", "report.js"), "utf8");
    assert.match(page, /c:fragment name="\$\{panel\}"/);
    assert.doesNotMatch(page, /components\/dynamic\/summary/);
    assert.match(workflow, /payload\.set\("panel", "components\/dynamic\/summary"\)/);
    const impact = resolveImpactTarget(buildStructuralImpact(buildImpactSnapshot(dynamic.baselineDir)), dynamic.impactTarget);
    assert.deepEqual(impact.directDependents, []);
    assert.equal(impact.coverage.possibleDynamicIncoming, 1);
    assert.doesNotMatch(JSON.stringify(impact), /workflows\/report\.js/);

    for (const taskKey of TASKS) {
        const copy = tempDir();
        try {
            fs.cpSync(path.join(IMPACT_DIR, taskKey, "baseline"), copy, { recursive: true });
            const validation = validateWorkspace(copy);
            assert.equal(validation.errors, 0, taskKey + " errors");
            assert.equal(validation.warnings, 0, taskKey + " warnings");
        } finally { fs.rmSync(copy, { recursive: true, force: true }); }
    }
});
