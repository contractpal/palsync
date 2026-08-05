#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pal } = require("../lib/pal");
const { manifestPaths } = require("../src/core/pull");
const { hashWorkspaceFiles, IN_SCOPE } = require("../src/core/workspaceHash");

const ROOT = path.resolve(__dirname, "..", "eval", "impact");
const SPEC_SCHEMA = "palsync/impact-eval-spec/1";
const MANIFEST_SCHEMA = "palsync/impact-baseline/1";
const HASH_RE = /^[0-9a-f]{64}$/;

function codePointCompare(a, b) {
    const ac = Array.from(a, c => c.codePointAt(0));
    const bc = Array.from(b, c => c.codePointAt(0));
    for (let i = 0; i < Math.min(ac.length, bc.length); i++) {
        if (ac[i] !== bc[i]) return ac[i] - bc[i];
    }
    return ac.length - bc.length;
}

function parseJson(file, label) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); }
    catch (e) { throw new Error(label + " is unreadable at " + file + ": " + e.message); }
    try { return JSON.parse(text); }
    catch (e) { throw new Error(label + " is malformed at " + file + ": " + e.message); }
}

function safeRelative(value, label) {
    if (typeof value !== "string" || !value || path.posix.isAbsolute(value) ||
        path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes("\\")) {
        throw new Error(label + " must be a relative POSIX path.");
    }
    const parts = value.split("/");
    if (parts.some(part => !part || part === "." || part === ".." || part.startsWith("."))) {
        throw new Error(label + " contains a dot or empty path segment: " + value);
    }
    return value;
}

function resolveContained(root, value, label, { allowMissingFinal = false } = {}) {
    const rel = safeRelative(value, label);
    const resolvedRoot = path.resolve(root);
    let rootStat;
    try { rootStat = fs.lstatSync(resolvedRoot); }
    catch (e) { throw new Error(label + " root is unreadable at " + resolvedRoot + ": " + e.message); }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error(label + " root must be a regular directory; symbolic links are not allowed: " + resolvedRoot);
    }

    let realRoot;
    try { realRoot = fs.realpathSync(resolvedRoot); }
    catch (e) { throw new Error(label + " root is unreadable at " + resolvedRoot + ": " + e.message); }
    const parts = rel.split("/");
    let current = realRoot;
    for (let i = 0; i < parts.length; i++) {
        const candidate = path.join(current, parts[i]);
        let stat;
        try { stat = fs.lstatSync(candidate); }
        catch (e) {
            if (allowMissingFinal && i === parts.length - 1 && e.code === "ENOENT") return candidate;
            throw new Error(label + " is unreadable at " + candidate + ": " + e.message);
        }
        if (stat.isSymbolicLink()) {
            throw new Error(label + " contains a symbolic link: " + candidate);
        }
        let realCandidate;
        try { realCandidate = fs.realpathSync(candidate); }
        catch (e) { throw new Error(label + " is unreadable at " + candidate + ": " + e.message); }
        const fromRoot = path.relative(realRoot, realCandidate);
        if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(".." + path.sep) || path.isAbsolute(fromRoot)) {
            throw new Error(label + " escapes its task directory: " + value);
        }
        current = realCandidate;
    }
    return current;
}

function writeManifestAtomic(file, content) {
    const temp = path.join(path.dirname(file), "." + path.basename(file) + "." +
        process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp");
    let fd = null;
    try {
        fd = fs.openSync(temp, "wx");
        fs.writeFileSync(fd, content, "utf8");
        fs.closeSync(fd);
        fd = null;
        fs.renameSync(temp, file);
    } catch (e) {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (closeError) { /* cleanup below remains authoritative */ }
        }
        try { fs.unlinkSync(temp); }
        catch (cleanupError) {
            if (cleanupError.code !== "ENOENT") {
                throw new Error("Manifest write failed and temporary-file cleanup failed: " + cleanupError.message + " (original: " + e.message + ")");
            }
        }
        throw e;
    }
}

function scanBaseline(dir) {
    let root;
    try { root = fs.lstatSync(dir); }
    catch (e) { throw new Error("Baseline is unreadable at " + dir + ": " + e.message); }
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Baseline must be a regular directory: " + dir);

    const files = [];
    function walk(abs, parts) {
        for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
            const nextParts = parts.concat(entry.name);
            const rel = nextParts.join("/");
            if (entry.name.startsWith(".")) throw new Error("Baseline dot path is not allowed: " + rel);
            const next = path.join(abs, entry.name);
            const stat = fs.lstatSync(next);
            if (stat.isSymbolicLink()) throw new Error("Baseline link is not allowed: " + rel);
            if (stat.isDirectory()) {
                if (nextParts.length === 1 && !IN_SCOPE.includes(entry.name)) {
                    throw new Error("Baseline out-of-scope path is not allowed: " + rel);
                }
                walk(next, nextParts);
                continue;
            }
            if (!stat.isFile()) throw new Error("Baseline non-regular file is not allowed: " + rel);
            if (rel !== "pal.json" && !IN_SCOPE.includes(nextParts[0])) {
                throw new Error("Baseline out-of-scope file is not allowed: " + rel);
            }
            files.push(rel);
        }
    }
    walk(dir, []);
    return files.sort(codePointCompare);
}

function manifestFor(taskDir) {
    const impactPath = resolveContained(taskDir, "impact.json", "impact.json");
    const impact = parseJson(impactPath, "impact.json");
    if (!impact || impact.schema !== SPEC_SCHEMA || impact.key !== path.basename(taskDir)) {
        throw new Error("impact.json metadata does not match task directory: " + taskDir);
    }
    const baselineDir = resolveContained(taskDir, impact.baseline, "impact baseline");
    const manifestPath = resolveContained(taskDir, impact.baselineManifest, "impact baselineManifest", { allowMissingFinal: true });
    const scanned = scanBaseline(baselineDir);
    if (!scanned.includes("pal.json")) throw new Error("Baseline is missing pal.json: " + baselineDir);

    const hashed = hashWorkspaceFiles(baselineDir);
    const hashKeys = Object.keys(hashed.files).sort(codePointCompare);
    if (hashKeys.length !== scanned.length || hashKeys.some((rel, i) => rel !== scanned[i])) {
        throw new Error("hashWorkspaceFiles omitted or added a baseline path in " + baselineDir);
    }
    const files = {};
    for (const rel of hashKeys) {
        const digest = hashed.files[rel];
        if (!HASH_RE.test(digest)) throw new Error("Unexpected per-file hash for " + rel + ": " + digest);
        files[rel] = digest;
    }

    const palText = fs.readFileSync(path.join(baselineDir, "pal.json"), "utf8");
    let expectedServerPaths;
    try { expectedServerPaths = [...manifestPaths(Pal.fromJson(palText))].sort(codePointCompare); }
    catch (e) { throw new Error("Baseline pal.json is invalid in " + taskDir + ": " + e.message); }
    for (const rel of expectedServerPaths) safeRelative(rel, "manifest server path");
    const trackedFiles = scanned.filter(rel => rel !== "pal.json");
    if (trackedFiles.length !== expectedServerPaths.length || trackedFiles.some((rel, i) => rel !== expectedServerPaths[i])) {
        throw new Error("Baseline regular files do not exactly match pal.json registrations in " + taskDir);
    }

    return {
        manifestPath,
        value: {
            schema: MANIFEST_SCHEMA,
            fixtureDigest: "sha256:" + hashed.combined,
            files,
            expectedServerPaths
        }
    };
}

function taskDirs(root = ROOT) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); }
    catch (e) { throw new Error("Impact eval root is unreadable at " + root + ": " + e.message); }
    const tasks = [];
    for (const entry of entries.sort((a, b) => codePointCompare(a.name, b.name))) {
        if (!entry.name.startsWith("impact_")) continue;
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
            throw new Error("Impact eval task must be a real directory: " + path.join(root, entry.name));
        }
        tasks.push(path.join(root, entry.name));
    }
    return tasks;
}

function run(mode, root = ROOT) {
    if (mode !== "--write" && mode !== "--check") {
        throw new Error("Usage: node scripts/hash-impact-baselines.js --write|--check");
    }
    let drift = 0;
    for (const dir of taskDirs(root)) {
        const generated = manifestFor(dir);
        const expectedText = JSON.stringify(generated.value, null, 2) + "\n";
        if (mode === "--write") {
            writeManifestAtomic(generated.manifestPath, expectedText);
            process.stdout.write("wrote " + path.relative(process.cwd(), generated.manifestPath) + "\n");
            continue;
        }
        let actualText = null;
        try { actualText = fs.readFileSync(generated.manifestPath, "utf8"); }
        catch (e) { if (e.code !== "ENOENT") throw e; }
        if (actualText !== expectedText) {
            drift++;
            process.stderr.write("baseline manifest drift: " + path.relative(process.cwd(), generated.manifestPath) + "\n");
        }
    }
    if (drift) throw new Error(drift + " impact baseline manifest(s) drifted; run with --write after reviewing fixture changes.");
    if (mode === "--check") process.stdout.write("impact baseline manifests are reproducible\n");
}

if (require.main === module) {
    try { run(process.argv[2]); }
    catch (e) { process.stderr.write(e.message + "\n"); process.exitCode = 1; }
}

module.exports = { codePointCompare, scanBaseline, manifestFor, run };
