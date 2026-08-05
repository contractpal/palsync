"use strict";
const fs = require("fs");
const path = require("path");
const { constants } = require("fs");
const { Pal } = require("../../lib/pal");
const { manifestPaths } = require("./pull");
const { validateWorkspace } = require("./validate");
const { push } = require("./push");
const { hashWorkspace, hashWorkspaceFiles, hashPaths, IN_SCOPE } = require("./workspaceHash");
const palsyncfile = require("./palsyncfile");
const { writeIfChanged } = require("./atomicWrite");

const RECEIPT_PATH = path.join(".palsync", "impact-start.json");
const BASELINE_SCHEMA = "palsync/impact-baseline/1";

function codePointCompare(a, b) {
    const ac = Array.from(a, c => c.codePointAt(0));
    const bc = Array.from(b, c => c.codePointAt(0));
    for (let i = 0; i < Math.min(ac.length, bc.length); i++) {
        if (ac[i] !== bc[i]) return ac[i] - bc[i];
    }
    return ac.length - bc.length;
}

function sameArray(actual, expected) {
    return actual.length === expected.length && actual.every((value, i) => value === expected[i]);
}

function sameMap(actual, expected) {
    if (!actual || typeof actual !== "object" || Array.isArray(actual) ||
        !expected || typeof expected !== "object" || Array.isArray(expected)) return false;
    const actualKeys = Object.keys(actual).sort(codePointCompare);
    const expectedKeys = Object.keys(expected).sort(codePointCompare);
    return sameArray(actualKeys, expectedKeys) &&
        actualKeys.every(key => actual[key] === expected[key]);
}

function safeRelative(value, label) {
    if (typeof value !== "string" || !value || path.posix.isAbsolute(value) ||
        path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes("\\")) {
        throw new Error("Impact baseline " + label + " must be a relative POSIX path.");
    }
    const parts = value.split("/");
    if (parts.some(part => !part || part === "." || part === ".." || part.startsWith("."))) {
        throw new Error("Impact baseline " + label + " contains a dot or empty path segment.");
    }
    if (value !== "pal.json" && !IN_SCOPE.includes(parts[0])) {
        throw new Error("Impact baseline " + label + " is outside tracked roots: " + value + ".");
    }
    return value;
}

function scanRegularBaseline(baselineDir) {
    const root = fs.lstatSync(baselineDir);
    if (!root.isDirectory() || root.isSymbolicLink()) {
        throw new Error("Impact baseline root must be a real directory.");
    }

    const files = [];
    function walk(abs, parts) {
        for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
            const relParts = [...parts, entry.name];
            const rel = relParts.join("/");
            if (entry.name.startsWith(".")) throw new Error("Impact baseline dot path refused: " + rel + ".");
            const file = path.join(abs, entry.name);
            const stat = fs.lstatSync(file);
            if (stat.isSymbolicLink()) throw new Error("Impact baseline symbolic link refused: " + rel + ".");
            if (stat.isDirectory()) {
                if (relParts.length === 1 && !IN_SCOPE.includes(entry.name)) {
                    throw new Error("Impact baseline path is outside tracked roots: " + rel + ".");
                }
                walk(file, relParts);
            } else if (stat.isFile()) {
                safeRelative(rel, "file");
                files.push(rel);
            } else {
                throw new Error("Impact baseline non-regular file refused: " + rel + ".");
            }
        }
    }
    walk(baselineDir, []);
    return files.sort(codePointCompare);
}

function readAndVerifyBaseline(spec, hashFiles) {
    if (typeof spec.baselineDir !== "string" || typeof spec.baselineManifestPath !== "string") {
        throw new Error("Impact eval is missing its resolved baseline paths.");
    }
    const manifestStat = fs.lstatSync(spec.baselineManifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
        throw new Error("Impact baseline manifest must be a regular file without links.");
    }
    const manifest = JSON.parse(fs.readFileSync(spec.baselineManifestPath, "utf8"));
    if (!manifest || manifest.schema !== BASELINE_SCHEMA ||
        !/^sha256:[0-9a-f]{64}$/.test(manifest.fixtureDigest || "") ||
        !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files) ||
        !Array.isArray(manifest.expectedServerPaths)) {
        throw new Error("Impact baseline manifest is malformed.");
    }

    const scanned = scanRegularBaseline(spec.baselineDir);
    if (!scanned.includes("pal.json")) throw new Error("Impact baseline is missing pal.json.");
    for (const [rel, digest] of Object.entries(manifest.files)) {
        safeRelative(rel, "manifest file");
        if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("Impact baseline has a malformed file hash: " + rel + ".");
    }
    const declaredFiles = Object.keys(manifest.files).sort(codePointCompare);
    if (!sameArray(scanned, declaredFiles)) {
        throw new Error("Impact baseline file set does not match its manifest (extra or missing file).");
    }

    const hashed = hashFiles(spec.baselineDir);
    if (manifest.fixtureDigest !== "sha256:" + hashed.combined || !sameMap(hashed.files, manifest.files)) {
        throw new Error("Impact baseline fixture hash mismatch.");
    }

    const expectedServerPaths = manifest.expectedServerPaths.map(rel => safeRelative(rel, "expected server path"));
    if (expectedServerPaths.some((rel, i) => rel === "pal.json" ||
        (i > 0 && codePointCompare(expectedServerPaths[i - 1], rel) >= 0))) {
        throw new Error("Impact baseline expectedServerPaths must be unique and code-point sorted.");
    }
    let palPaths;
    try {
        palPaths = [...manifestPaths(Pal.fromJson(fs.readFileSync(path.join(spec.baselineDir, "pal.json"), "utf8")))]
            .sort(codePointCompare);
    } catch (e) {
        throw new Error("Impact baseline pal.json is invalid: " + e.message);
    }
    if (!sameArray(expectedServerPaths, palPaths) ||
        !sameArray(expectedServerPaths, scanned.filter(rel => rel !== "pal.json"))) {
        throw new Error("Impact baseline expectedServerPaths do not match pal.json and the complete fixture.");
    }
    return { manifest, files: scanned };
}

function assertRegularSourcePath(root, rel) {
    let current = root;
    for (const part of rel.split("/")) {
        current = path.join(current, part);
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) throw new Error("Impact baseline symbolic link refused during copy: " + rel + ".");
        if (current !== path.join(root, ...rel.split("/")) && !stat.isDirectory()) {
            throw new Error("Impact baseline copy parent is not a directory: " + rel + ".");
        }
    }
    const stat = fs.lstatSync(current);
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("Impact baseline copy source is not a regular file: " + rel + ".");
    }
    return current;
}

function clearTrackedWorkspace(workspaceDir) {
    for (const root of IN_SCOPE) fs.rmSync(path.join(workspaceDir, root), { recursive: true, force: true });
    fs.rmSync(path.join(workspaceDir, "pal.json"), { force: true });
}

function copyBaseline(workspaceDir, baselineDir, files) {
    for (const rel of files) {
        const source = assertRegularSourcePath(baselineDir, rel);
        const destination = path.join(workspaceDir, ...rel.split("/"));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const fd = fs.openSync(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        let bytes;
        try {
            if (!fs.fstatSync(fd).isFile()) throw new Error("Impact baseline source changed during copy: " + rel + ".");
            bytes = fs.readFileSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.writeFileSync(destination, bytes, { flag: "wx" });
    }
}

// The freshly pulled manifest owns Pal structure the fixture deliberately does not model — layout,
// id, path, environment, documents, folders, trashCan, releaseNotes, secureFields. Replacing
// pal.json with the fixture's registration-only sections produced a Pal with no layout and no id:
// push.js builds the save from `Pal.fromPath`, so the server got a structurally invalid Pal and
// refused it as `save-rejected` with an EMPTY validation list, while ensureWebRegistration and
// ensureConsoleRegistration both early-return on `!pal.layout` and so never wired an entry point.
// The fixture therefore owns exactly the sections it declares; every other pulled key survives
// verbatim.
function readPulledManifest(workspaceDir) {
    try {
        return fs.readFileSync(path.join(workspaceDir, "pal.json"), "utf8");
    } catch (e) {
        throw new Error("Impact baseline seeding requires the freshly pulled pal.json: " + e.message);
    }
}

function mergeBaselineManifest(pulledRaw, fixtureRaw) {
    let pulled;
    try { pulled = JSON.parse(pulledRaw); }
    catch (e) { throw new Error("Impact baseline seeding requires a parseable pulled pal.json: " + e.message); }
    if (!pulled || typeof pulled !== "object" || Array.isArray(pulled)) {
        throw new Error("Impact baseline seeding requires a pulled pal.json object.");
    }
    if (!Object.prototype.hasOwnProperty.call(pulled, "layout")) {
        throw new Error("Impact baseline seeding requires the pulled pal.json to carry a server-owned layout.");
    }
    const fixture = JSON.parse(fixtureRaw);
    const owned = key => Object.prototype.hasOwnProperty.call(fixture, key);
    return {
        merged: { ...pulled, ...fixture },
        pulled,
        fixture,
        fixtureSections: Object.keys(fixture).sort(codePointCompare),
        preservedServerKeys: Object.keys(pulled).filter(key => !owned(key)).sort(codePointCompare)
    };
}

// Verify what actually landed on disk, not what we intended to write: the fixture's sections must
// survive byte-for-byte (the agent has to start from the frozen baseline) and no server-owned key
// may be dropped (the defect above). manifestPaths on the merged Pal must still resolve to exactly
// the fixture's declared paths, so a fresh Pal that unexpectedly tracks files fails loudly here
// instead of pushing content the manifest never promised.
function assertStagedManifest(workspaceDir, merge, expectedServerPaths) {
    const written = fs.readFileSync(path.join(workspaceDir, "pal.json"), "utf8");
    let parsed;
    try { parsed = JSON.parse(written); }
    catch (e) { throw new Error("Staged impact manifest is not parseable JSON: " + e.message); }
    for (const key of merge.fixtureSections) {
        if (JSON.stringify(parsed[key]) !== JSON.stringify(merge.fixture[key])) {
            throw new Error("Staged impact manifest lost fixture section " + key + ".");
        }
    }
    for (const key of merge.preservedServerKeys) {
        if (JSON.stringify(parsed[key]) !== JSON.stringify(merge.pulled[key])) {
            throw new Error("Staged impact manifest dropped server-owned key " + key + ".");
        }
    }
    let palPaths;
    try { palPaths = [...manifestPaths(Pal.fromJson(written))].sort(codePointCompare); }
    catch (e) { throw new Error("Staged impact manifest is not a valid Pal: " + e.message); }
    if (!sameArray(palPaths, expectedServerPaths)) {
        throw new Error("Staged impact manifest tracks paths the fixture does not declare: " +
            palPaths.join(", ") + ".");
    }
}

function assertSeedPreconditions({ workspaceDir, createdPalGuid, setupResult, record, spec }) {
    if (!spec || spec.kind !== "impact") throw new Error("Impact baseline seeding requires an impact spec.");
    if (!createdPalGuid || !record || !setupResult || !setupResult.record ||
        createdPalGuid !== record.palGuid || createdPalGuid !== setupResult.record.palGuid) {
        throw new Error("Impact baseline seeding requires proof of this invocation's fresh-created Pal GUID.");
    }
    if (setupResult.locked !== true) throw new Error("Impact baseline seeding requires setup's held lock.");
    const dirs = [workspaceDir, setupResult.workspaceDir, record.workspaceDir];
    if (dirs.some(dir => typeof dir !== "string") ||
        dirs.map(dir => path.resolve(dir)).some(dir => dir !== path.resolve(workspaceDir))) {
        throw new Error("Impact baseline workspace paths do not match setup's locked workspace.");
    }
}

async function seedImpactBaseline({
    session,
    workspaceDir,
    createdPalGuid,
    setupResult,
    record,
    spec,
    persist = palsyncfile.write,
    deps = {}
}) {
    const validate = deps.validateWorkspace || validateWorkspace;
    const pushBaseline = deps.push || push;
    const workspaceHash = deps.hashWorkspace || hashWorkspace;
    const workspaceFileHash = deps.hashWorkspaceFiles || hashWorkspaceFiles;
    const pathHashes = deps.hashPaths || hashPaths;
    const atomicWrite = deps.writeIfChanged || writeIfChanged;

    assertSeedPreconditions({ workspaceDir, createdPalGuid, setupResult, record, spec });
    const verified = readAndVerifyBaseline(spec, workspaceFileHash);
    const pulledManifestRaw = readPulledManifest(workspaceDir);

    clearTrackedWorkspace(workspaceDir);
    copyBaseline(workspaceDir, spec.baselineDir, verified.files.filter(rel => rel !== "pal.json"));

    const merge = mergeBaselineManifest(pulledManifestRaw,
        fs.readFileSync(path.join(spec.baselineDir, "pal.json"), "utf8"));
    fs.writeFileSync(path.join(workspaceDir, "pal.json"),
        JSON.stringify(merge.merged, null, 2) + "\n", { flag: "wx" });
    assertStagedManifest(workspaceDir, merge, verified.manifest.expectedServerPaths);

    // pal.json intentionally differs from the frozen fixture now — it carries this Pal's
    // server-owned identity — so the byte-equality guarantee covers every other staged file, with
    // the manifest itself pinned structurally by assertStagedManifest above.
    const staged = workspaceFileHash(workspaceDir);
    const expectedStaged = { ...verified.manifest.files };
    const stagedTracked = { ...staged.files };
    delete expectedStaged["pal.json"];
    delete stagedTracked["pal.json"];
    if (!sameMap(stagedTracked, expectedStaged)) {
        throw new Error("Staged impact baseline does not exactly match the verified fixture.");
    }

    const lint = validate(workspaceDir);
    if (!lint || lint.errors !== 0 || lint.warnings !== 0) {
        throw new Error("Impact baseline lint refused: expected 0 errors and 0 warnings, got " +
            (lint && lint.errors) + " errors and " + (lint && lint.warnings) + " warnings.");
    }

    const prePushMarker = record.lastModifiedDate;
    const pushResult = await pushBaseline(session, record, workspaceDir);
    if (!pushResult || pushResult.pushed !== true) {
        throw new Error("Impact baseline push refused" +
            (pushResult && pushResult.refused ? ": " + pushResult.refused : "."));
    }
    if (!Array.isArray(pushResult.serverPaths)) {
        throw new Error("Impact baseline push did not return authoritative serverPaths.");
    }
    const serverPaths = [...pushResult.serverPaths].sort(codePointCompare);
    if (!sameArray(serverPaths, verified.manifest.expectedServerPaths)) {
        throw new Error("Impact baseline push serverPaths do not exactly match the fixture manifest.");
    }
    const newMarker = pushResult.newMarker;
    if (typeof newMarker !== "string" || !newMarker || newMarker === prePushMarker ||
        newMarker !== record.lastModifiedDate) {
        throw new Error("Impact baseline push did not return an authoritative changed server marker.");
    }

    record.localHash = workspaceHash(workspaceDir);
    record.fileHashes = pathHashes(workspaceDir, pushResult.serverPaths);
    await persist(workspaceDir, record);

    const receipt = {
        schema: "palsync/impact-start/1",
        evalKey: spec.key,
        taskKey: spec.taskKey,
        variant: spec.variant,
        fixtureDigest: verified.manifest.fixtureDigest,
        fixtureFiles: { ...verified.manifest.files },
        manifest: {
            mode: "fixture-sections-merged-onto-pulled",
            fixtureSections: [...merge.fixtureSections],
            preservedServerKeys: [...merge.preservedServerKeys]
        },
        palGuid: record.palGuid,
        serverMarker: newMarker,
        serverPaths,
        localHash: record.localHash,
        fileHashes: { ...record.fileHashes },
        lint: { errors: 0, warnings: 0 },
        push: { pushed: true, newMarker },
        seededAt: new Date().toISOString()
    };
    await atomicWrite(path.join(workspaceDir, RECEIPT_PATH), JSON.stringify(receipt, null, 2) + "\n");
    return receipt;
}

module.exports = { seedImpactBaseline, RECEIPT_PATH };
