"use strict";
// Eval-harness specs: benchmark scenarios under eval/specs/<key>/ (SPEC.md + EXECUTION.md), plus
// two files shared across all specs (DESIGN_SYSTEM.md, COMPONENTS.md). `--eval` in bin/palsync.js
// picks one of these, forces the launcher's create-new-pal flow with the name prefilled, and
// injectSpec() drops the spec's docs into the workspace root once the pal/workspace exist.
const fs = require("fs");
const path = require("path");
const { Pal } = require("../../lib/pal");
const { manifestPaths } = require("./pull");
const { hashWorkspaceFiles, IN_SCOPE } = require("./workspaceHash");

const SPECS_DIR = path.join(__dirname, "..", "..", "eval", "specs");
const IMPACT_DIR = path.join(__dirname, "..", "..", "eval", "impact");
const SHARED_FILES = ["DESIGN_SYSTEM.md", "COMPONENTS.md"];
const IMPACT_VARIANTS = ["off", "on"];
const IMPACT_SCHEMA = "palsync/impact-eval-spec/1";
const BASELINE_SCHEMA = "palsync/impact-baseline/1";
const ORACLE_SCHEMA = "palsync/impact-oracle/1";
const ORACLE_FIELDS = [
    "acceptanceCommands", "allowedServerTrackedWrites", "firstCorrectWriteDefinition",
    "requiredAbsent", "requiredContentChecks", "requiredPresent", "schema"
];
const ACCEPTANCE_COMMANDS = ["pal_validate", "pal_test", "palsync regression"];
const FIRST_CORRECT_WRITE_DEFINITION = "first write to an allowed path that advances a required check";
const ARM_BLOCK_START = "<!-- palsync evaluator-owned impact arm: start -->";
const ARM_BLOCK_END = "<!-- palsync evaluator-owned impact arm: end -->";

function codePointCompare(a, b) {
    const ac = Array.from(a, c => c.codePointAt(0));
    const bc = Array.from(b, c => c.codePointAt(0));
    for (let i = 0; i < Math.min(ac.length, bc.length); i++) {
        if (ac[i] !== bc[i]) return ac[i] - bc[i];
    }
    return ac.length - bc.length;
}

function readJsonFile(file, label) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); }
    catch (e) { throw new Error("Invalid impact eval " + label + " at " + file + ": " + e.message); }
    try { return { value: JSON.parse(text), text }; }
    catch (e) { throw new Error("Invalid impact eval " + label + " at " + file + ": " + e.message); }
}

function requireRegularFile(file, label) {
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (e) { throw new Error("Invalid impact eval " + label + " at " + file + ": " + e.message); }
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("Invalid impact eval " + label + " at " + file + ": expected a regular file.");
    }
}

function safeRelative(value, label) {
    if (typeof value !== "string" || !value || path.posix.isAbsolute(value) ||
        path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes("\\")) {
        throw new Error("Invalid impact eval " + label + ": expected a relative POSIX path.");
    }
    const parts = value.split("/");
    if (parts.some(part => !part || part === "." || part === ".." || part.startsWith("."))) {
        throw new Error("Invalid impact eval " + label + ": dot and empty path segments are not allowed.");
    }
    return value;
}

function resolveContained(root, value, label) {
    const rel = safeRelative(value, label);
    const resolvedRoot = path.resolve(root);
    let rootStat;
    try { rootStat = fs.lstatSync(resolvedRoot); }
    catch (e) { throw new Error("Invalid impact eval " + label + " root at " + resolvedRoot + ": " + e.message); }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error("Invalid impact eval " + label + " root at " + resolvedRoot + ": symbolic links are not allowed.");
    }

    let realRoot;
    try { realRoot = fs.realpathSync(resolvedRoot); }
    catch (e) { throw new Error("Invalid impact eval " + label + " root at " + resolvedRoot + ": " + e.message); }
    let current = realRoot;
    for (const part of rel.split("/")) {
        const candidate = path.join(current, part);
        let stat;
        try { stat = fs.lstatSync(candidate); }
        catch (e) { throw new Error("Invalid impact eval " + label + " at " + candidate + ": " + e.message); }
        if (stat.isSymbolicLink()) {
            throw new Error("Invalid impact eval " + label + " at " + candidate + ": symbolic links are not allowed.");
        }
        let realCandidate;
        try { realCandidate = fs.realpathSync(candidate); }
        catch (e) { throw new Error("Invalid impact eval " + label + " at " + candidate + ": " + e.message); }
        const fromRoot = path.relative(realRoot, realCandidate);
        if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(".." + path.sep) || path.isAbsolute(fromRoot)) {
            throw new Error("Invalid impact eval " + label + ": path escapes its task directory.");
        }
        current = realCandidate;
    }
    return current;
}

function sameStringArray(actual, expected) {
    return actual.length === expected.length && actual.every((value, i) => value === expected[i]);
}

function validateOraclePathArray(value, label) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error("Invalid impact eval oracle " + label + ": expected a non-empty array.");
    }
    const seen = new Set();
    for (const item of value) {
        const rel = safeRelative(item, "oracle " + label + " path");
        if (rel !== "pal.json" && !IN_SCOPE.includes(rel.split("/")[0])) {
            throw new Error("Invalid impact eval oracle " + label + ": path is outside tracked roots: " + rel + ".");
        }
        if (seen.has(rel)) throw new Error("Invalid impact eval oracle " + label + ": duplicate path: " + rel + ".");
        seen.add(rel);
    }
}

function validateOracle(oraclePath) {
    const oracle = readJsonFile(oraclePath, "oracle").value;
    const fields = oracle && typeof oracle === "object" && !Array.isArray(oracle)
        ? Object.keys(oracle).sort(codePointCompare) : [];
    if (!oracle || oracle.schema !== ORACLE_SCHEMA || !sameStringArray(fields, ORACLE_FIELDS)) {
        throw new Error("Invalid impact eval oracle at " + oraclePath + ": malformed oracle metadata.");
    }

    for (const field of ["allowedServerTrackedWrites", "requiredPresent", "requiredAbsent"]) {
        validateOraclePathArray(oracle[field], field);
    }
    if (!Array.isArray(oracle.requiredContentChecks) || oracle.requiredContentChecks.length === 0) {
        throw new Error("Invalid impact eval oracle requiredContentChecks: expected a non-empty array.");
    }
    for (const [index, check] of oracle.requiredContentChecks.entries()) {
        const checkFields = check && typeof check === "object" && !Array.isArray(check)
            ? Object.keys(check).sort(codePointCompare) : [];
        const expectedFields = checkFields.includes("excludes") ? ["excludes", "includes", "path"] : ["includes", "path"];
        if (!check || !sameStringArray(checkFields, expectedFields) ||
            typeof check.includes !== "string" || check.includes.length === 0) {
            throw new Error("Invalid impact eval oracle requiredContentChecks[" + index + "]: malformed content check.");
        }
        validateOraclePathArray([check.path], "requiredContentChecks[" + index + "]");
        if ("excludes" in check && (!Array.isArray(check.excludes) || check.excludes.length === 0 ||
            check.excludes.some(value => typeof value !== "string" || value.length === 0) ||
            new Set(check.excludes).size !== check.excludes.length)) {
            throw new Error("Invalid impact eval oracle requiredContentChecks[" + index + "]: malformed excludes.");
        }
    }
    if (!Array.isArray(oracle.acceptanceCommands) ||
        !sameStringArray(oracle.acceptanceCommands, ACCEPTANCE_COMMANDS)) {
        throw new Error("Invalid impact eval oracle acceptanceCommands: expected the fixed acceptance command sequence.");
    }
    if (oracle.firstCorrectWriteDefinition !== FIRST_CORRECT_WRITE_DEFINITION) {
        throw new Error("Invalid impact eval oracle firstCorrectWriteDefinition: unexpected scoring definition.");
    }
    return oracle;
}

function scanBaseline(dir) {
    let root;
    try { root = fs.lstatSync(dir); }
    catch (e) { throw new Error("Invalid impact eval baseline at " + dir + ": " + e.message); }
    if (!root.isDirectory() || root.isSymbolicLink()) {
        throw new Error("Invalid impact eval baseline at " + dir + ": expected a regular directory.");
    }

    const files = [];
    function walk(abs, parts) {
        for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
            if (entry.name.startsWith(".")) throw new Error("Invalid impact eval baseline: dot path is not allowed: " + [...parts, entry.name].join("/"));
            const nextParts = [...parts, entry.name];
            const next = path.join(abs, entry.name);
            const stat = fs.lstatSync(next);
            if (stat.isSymbolicLink()) throw new Error("Invalid impact eval baseline: link is not allowed: " + nextParts.join("/"));
            if (stat.isDirectory()) {
                if (nextParts.length === 1 && !IN_SCOPE.includes(entry.name)) {
                    throw new Error("Invalid impact eval baseline: out-of-scope path is not allowed: " + entry.name);
                }
                walk(next, nextParts);
                continue;
            }
            if (!stat.isFile()) throw new Error("Invalid impact eval baseline: non-regular file is not allowed: " + nextParts.join("/"));
            const rel = nextParts.join("/");
            if (rel !== "pal.json" && !IN_SCOPE.includes(nextParts[0])) {
                throw new Error("Invalid impact eval baseline: out-of-scope file is not allowed: " + rel);
            }
            files.push(rel);
        }
    }
    walk(dir, []);
    return files.sort(codePointCompare);
}

function sameStringMap(actual, expected) {
    const aKeys = Object.keys(actual).sort(codePointCompare);
    const eKeys = Object.keys(expected).sort(codePointCompare);
    return aKeys.length === eKeys.length && aKeys.every((key, i) =>
        key === eKeys[i] && actual[key] === expected[key]);
}

function validateBaseline(taskKey, baselineDir, manifestPath) {
    const scanned = scanBaseline(baselineDir);
    if (!scanned.includes("pal.json")) throw new Error("Invalid impact eval " + taskKey + ": baseline is missing pal.json.");

    requireRegularFile(manifestPath, "baseline manifest");
    const manifest = readJsonFile(manifestPath, "baseline manifest").value;
    if (!manifest || manifest.schema !== BASELINE_SCHEMA ||
        !/^sha256:[0-9a-f]{64}$/.test(manifest.fixtureDigest || "") ||
        !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files) ||
        !Array.isArray(manifest.expectedServerPaths)) {
        throw new Error("Invalid impact eval " + taskKey + ": malformed baseline manifest.");
    }
    for (const [rel, digest] of Object.entries(manifest.files)) {
        safeRelative(rel, "baseline manifest file");
        if (!/^[0-9a-f]{64}$/.test(digest)) {
            throw new Error("Invalid impact eval " + taskKey + ": malformed per-file baseline hash for " + rel + ".");
        }
    }
    const expectedFiles = Object.keys(manifest.files).sort(codePointCompare);
    if (expectedFiles.length !== scanned.length || expectedFiles.some((rel, i) => rel !== scanned[i])) {
        throw new Error("Invalid impact eval " + taskKey + ": baseline manifest file set does not match baseline.");
    }

    const hashed = hashWorkspaceFiles(baselineDir);
    if (manifest.fixtureDigest !== "sha256:" + hashed.combined || !sameStringMap(hashed.files, manifest.files)) {
        throw new Error("Invalid impact eval " + taskKey + ": baseline hash mismatch.");
    }

    const palText = fs.readFileSync(path.join(baselineDir, "pal.json"), "utf8");
    let serverPaths;
    try { serverPaths = [...manifestPaths(Pal.fromJson(palText))].sort(codePointCompare); }
    catch (e) { throw new Error("Invalid impact eval " + taskKey + ": malformed baseline pal.json: " + e.message); }
    const declaredPaths = manifest.expectedServerPaths;
    if (declaredPaths.some((rel, i) => safeRelative(rel, "expected server path") !== rel ||
        (i > 0 && codePointCompare(declaredPaths[i - 1], rel) >= 0)) ||
        !sameStringArray(declaredPaths, serverPaths)) {
        throw new Error("Invalid impact eval " + taskKey + ": expectedServerPaths does not match pal.json.");
    }
    const scannedServerPaths = scanned.filter(rel => rel !== "pal.json");
    if (!sameStringArray(declaredPaths, scannedServerPaths)) {
        throw new Error("Invalid impact eval " + taskKey + ": expectedServerPaths does not match the complete baseline file set.");
    }
    return manifest;
}

// One entry per scenario folder that has a SPEC.md. A malformed folder (unreadable SPEC.md) is
// skipped rather than crashing the whole list — the other specs should still be usable.
function listSpecs() {
    let entries = [];
    try {
        entries = fs.readdirSync(SPECS_DIR, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .sort((a, b) => codePointCompare(a.name, b.name));
    } catch (e) { return []; }

    const specs = [];
    for (const entry of entries) {
        const dir = path.join(SPECS_DIR, entry.name);
        const specPath = path.join(dir, "SPEC.md");
        let content;
        try { content = fs.readFileSync(specPath, "utf8"); }
        catch (e) { continue; } // no SPEC.md (or unreadable) — not a scenario folder, skip

        const key = entry.name;
        const palMatch = content.match(/^pal:\s*([^\s(]+)/m);
        const suggestedName = palMatch ? palMatch[1] : key;
        const titleMatch = content.match(/^#\s*SPEC\s*—\s*(.+)$/m);
        const title = titleMatch ? titleMatch[1] : key;
        specs.push({ key, dir, suggestedName, title, description: title });
    }
    return specs;
}

// Impact task directories describe two virtual arms each. Unlike the frozen standard list,
// malformed impact fixtures are fatal: an experiment must never start from ambiguous inputs.
function listImpactSpecs(impactDir = IMPACT_DIR) {
    let entries;
    try { entries = fs.readdirSync(impactDir, { withFileTypes: true }); }
    catch (e) { throw new Error("Unable to list impact eval specs at " + impactDir + ": " + e.message); }

    const specs = [];
    for (const entry of entries.sort((a, b) => codePointCompare(a.name, b.name))) {
        if (!entry.name.startsWith("impact_")) continue;
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
            throw new Error("Invalid impact eval task at " + path.join(impactDir, entry.name) + ": expected a real directory.");
        }
        const dir = path.join(impactDir, entry.name);
        const configPath = resolveContained(dir, "impact.json", "spec");
        requireRegularFile(configPath, "spec");
        const config = readJsonFile(configPath, "spec").value;
        if (!config || config.schema !== IMPACT_SCHEMA || config.key !== entry.name ||
            typeof config.suggestedName !== "string" || !config.suggestedName ||
            typeof config.title !== "string" || !config.title ||
            !Array.isArray(config.variants) || config.variants.length !== 2 ||
            config.variants.some((variant, i) => variant !== IMPACT_VARIANTS[i])) {
            throw new Error("Invalid impact eval spec at " + configPath + ": malformed task metadata.");
        }
        const impactTarget = safeRelative(config.impactTarget, "impactTarget");
        if (!IN_SCOPE.includes(impactTarget.split("/")[0])) {
            throw new Error("Invalid impact eval spec at " + configPath + ": impactTarget is outside tracked roots.");
        }
        const baselineDir = resolveContained(dir, config.baseline, "baseline");
        const baselineManifestPath = resolveContained(dir, config.baselineManifest, "baseline manifest");
        const oraclePath = resolveContained(dir, config.oracle, "oracle");
        const specPath = resolveContained(dir, "SPEC.md", "SPEC.md");
        const executionPath = resolveContained(dir, "EXECUTION.md", "EXECUTION.md");
        for (const [file, label] of [[specPath, "SPEC.md"], [executionPath, "EXECUTION.md"], [oraclePath, "oracle"]]) {
            requireRegularFile(file, label);
        }
        validateOracle(oraclePath);
        const baselineManifestJson = validateBaseline(config.key, baselineDir, baselineManifestPath);
        if (!(impactTarget in baselineManifestJson.files)) {
            throw new Error("Invalid impact eval " + config.key + ": impactTarget is missing from baseline.");
        }

        for (const variant of IMPACT_VARIANTS) {
            const armPath = resolveContained(dir, "arms/" + variant + ".md", variant + " arm");
            requireRegularFile(armPath, variant + " arm");
            specs.push({
                key: config.key + "-" + variant,
                dir,
                suggestedName: config.suggestedName,
                title: config.title,
                description: config.title,
                kind: "impact",
                taskKey: config.key,
                variant,
                impactTarget,
                baselineDir,
                baselineManifestPath,
                oraclePath,
                armPath
            });
        }
    }
    return specs;
}

// Resolve standard aliases first. Impact specs deliberately accept exact virtual keys only: no
// numeric, suggested-name, or bare task aliases can accidentally select an experiment arm.
function resolveSpec(key) {
    const specs = listSpecs();
    const k = String(key);
    let spec = specs.find(s => s.key === k);
    if (!spec) {
        const digits = k.match(/^0*(\d+)$/);
        if (digits) spec = specs.find(s => { const m = s.key.match(/^0*(\d+)/); return m && m[1] === digits[1]; });
    }
    if (!spec) spec = specs.find(s => s.suggestedName === k);
    if (spec) return spec;

    const impactSpecs = listImpactSpecs();
    spec = impactSpecs.find(s => s.key === k);
    if (!spec) {
        throw new Error("Unknown eval spec \"" + key + "\". Available: " +
            specs.concat(impactSpecs).map(s => s.key).join(", ") + ".");
    }
    return spec;
}

// Copy the spec's SPEC.md + EXECUTION.md and the two shared design docs into workspaceDir (flat,
// workspace root). SPEC.md gets its placeholder header filled in and its ../ references to the
// shared docs rewritten to ./ (they now live alongside it, not one directory up). Never overwrites
// an existing file — preserves the workspace's non-destructive rule.
function injectSpec(workspaceDir, spec, { fillValue } = {}) {
    const written = [], skipped = [];

    function writeIfAbsent(name, content) {
        const dest = path.join(workspaceDir, name);
        if (fs.existsSync(dest)) { skipped.push(name); return; }
        fs.writeFileSync(dest, content, "utf8");
        written.push(name);
    }

    let specContent = fs.readFileSync(path.join(spec.dir, "SPEC.md"), "utf8");
    specContent = specContent.replace(/<WORKSPACE[^>]*>/, fillValue);
    specContent = specContent.replace("../DESIGN_SYSTEM.md", "./DESIGN_SYSTEM.md").replace("../COMPONENTS.md", "./COMPONENTS.md");
    writeIfAbsent("SPEC.md", specContent);

    writeIfAbsent("EXECUTION.md", fs.readFileSync(path.join(spec.dir, "EXECUTION.md"), "utf8"));
    for (const name of SHARED_FILES) {
        writeIfAbsent(name, fs.readFileSync(path.join(SPECS_DIR, name), "utf8"));
    }

    return { written, skipped };
}

// Impact injection is all-or-nothing. The evaluator owns exactly these two new root documents;
// baseline files and oracle evidence remain outside the model's task context.
function injectImpactSpec(workspaceDir, spec, { fillValue } = {}) {
    if (!spec || spec.kind !== "impact") throw new Error("Impact eval injection requires a resolved impact spec.");
    const destinations = [path.join(workspaceDir, "SPEC.md"), path.join(workspaceDir, "EXECUTION.md")];
    const occupied = destinations.some(file => {
        try { fs.lstatSync(file); return true; }
        catch (e) { if (e.code === "ENOENT") return false; throw e; }
    });
    if (occupied) {
        throw new Error("Impact eval injection refused: workspace root already contains SPEC.md or EXECUTION.md.");
    }

    const specPath = resolveContained(spec.dir, "SPEC.md", "SPEC.md");
    const executionPath = resolveContained(spec.dir, "EXECUTION.md", "EXECUTION.md");
    const armPath = resolveContained(spec.dir, "arms/" + spec.variant + ".md", spec.variant + " arm");
    let specContent = fs.readFileSync(specPath, "utf8");
    specContent = specContent.replace(/<WORKSPACE[^>]*>/, fillValue);
    const taskExecution = fs.readFileSync(executionPath, "utf8").trimEnd();
    const arm = fs.readFileSync(armPath, "utf8").trim();
    const executionContent = taskExecution + "\n\n" + ARM_BLOCK_START +
        "\n## Evaluator-owned impact arm\n\n" + arm + "\n" + ARM_BLOCK_END + "\n";

    const created = [];
    let openFd = null;
    try {
        for (let i = 0; i < destinations.length; i++) {
            openFd = fs.openSync(destinations[i], "wx");
            created.push(destinations[i]);
            fs.writeFileSync(openFd, i === 0 ? specContent : executionContent, "utf8");
            fs.closeSync(openFd);
            openFd = null;
        }
    } catch (e) {
        if (openFd !== null) {
            try { fs.closeSync(openFd); } catch (closeError) { /* rollback below remains authoritative */ }
        }
        let rollbackError = null;
        for (const file of created.reverse()) {
            try { fs.unlinkSync(file); }
            catch (unlinkError) { rollbackError = rollbackError || unlinkError; }
        }
        if (rollbackError) {
            throw new Error("Impact eval injection failed and task-document rollback failed: " + rollbackError.message + " (original: " + e.message + ")");
        }
        throw new Error("Impact eval injection failed without partial task documents: " + e.message);
    }
    return { written: ["SPEC.md", "EXECUTION.md"], skipped: [] };
}

module.exports = {
    listSpecs, listImpactSpecs, resolveSpec, injectSpec, injectImpactSpec,
    SPECS_DIR, IMPACT_DIR, ARM_BLOCK_START, ARM_BLOCK_END
};
