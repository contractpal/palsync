#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { parseTasks } = require("../src/core/taskState");
const {
    TOOL_EVIDENCE_FILE, readToolEvidence, filterToolEvidence, phaseTotals
} = require("../src/core/usage");
const { FILENAME: PALSYNC_FILE } = require("../src/core/palsyncfile");

const SCENARIOS = {
    "01": "01_crud_equipment_checkout",
    "02": "02_data_structures_company_directory",
    "03": "03_console_tx_service_requests",
    "04": "04_interpal_tunnels_partner_bridge",
    "05": "05_marketing_website",
};

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { return null; }
}

function parseArgs(argv) {
    const flags = { dir: process.cwd(), output: path.join(__dirname, "..", "eval", "scores.jsonl") };
    const accepted = [
        "--dir", "--output", "--model", "--harness", "--scenario", "--variant", "--pair",
        "--pair-order", "--orch-skills", "--palbuilder-skills", "--trajectory", "--transcript"
    ];
    for (let i = 0; i < argv.length; i++) {
        const name = argv[i];
        if (!accepted.includes(name)) throw new Error("Unknown argument: " + name);
        if (argv[i + 1] === undefined) throw new Error(name + " requires a value");
        flags[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++i];
    }
    return flags;
}

function toolSuccessfulCalls(usage, name) {
    const value = usage && usage.tools && usage.tools[name] && usage.tools[name].successfulCalls;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function inferScenario(workspaceDir) {
    const match = path.basename(workspaceDir).match(/^(0[1-5])_/);
    return match && SCENARIOS[match[1]];
}

function reviewFields(review) {
    const text = String(review || "");
    const verdict = text.match(/^\s*(?:#{1,6}\s*)?verdict\s*:\s*(PASS|CHANGES-NEEDED|BROKEN)\b/im);
    const score = text.match(/(?:\*\*)?Total(?:\*\*)?\s*:\s*(\d+)\s*\/\s*(\d+)/i) ||
        text.match(/§\s*12[^\n]*?\b(\d+)\s*\/\s*(\d+)/i);
    return {
        verdict: verdict ? verdict[1].toUpperCase() : "BROKEN",
        score12: score ? score[1] + "/" + score[2] : null,
    };
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strictFile(file, label) {
    try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile()) throw new Error(label + " is not a regular file: " + file);
        return fs.readFileSync(file);
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

function strictJson(file, label) {
    const bytes = strictFile(file, label);
    if (bytes === null) return { exists: false, value: null, bytes: null };
    try { return { exists: true, value: JSON.parse(bytes.toString("utf8")), bytes }; }
    catch (error) { throw new Error("Malformed " + label + " JSON at " + file + ": " + error.message); }
}

function requireString(value, label) {
    if (typeof value !== "string" || !value.trim()) throw new Error(label + " must be a non-empty string");
}

function requireCount(value, label, { nullable = false, positive = false } = {}) {
    if (nullable && value === null) return;
    if (!Number.isInteger(value) || value < (positive ? 1 : 0)) {
        throw new Error(label + " must be " + (nullable ? "null or " : "") +
            (positive ? "a positive integer" : "a non-negative integer"));
    }
}

function requireExactKeys(value, expected, label) {
    if (!isObject(value)) throw new Error(label + " must be an object");
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
        throw new Error(label + " must contain exactly: " + expected.join(", "));
    }
}

function validateTrajectory(value) {
    const fields = [
        "schema", "acceptance", "regression", "targetCalls", "targetBeforeFirstEdit",
        "readsBeforeFirstCorrectWrite", "searchesBeforeFirstCorrectWrite", "writesOutsideOracle",
        "calls", "pushes", "failedVerificationLoops", "hardRuleViolations", "wallTimeMs",
        "falseExactReferences", "impactResponseBytes"
    ];
    requireExactKeys(value, fields, "impact trajectory");
    if (value.schema !== "palsync/impact-trajectory/1") throw new Error("Invalid impact trajectory schema");
    for (const field of ["acceptance", "regression"]) {
        if (value[field] !== "pass" && value[field] !== "fail") {
            throw new Error("impact trajectory " + field + " must be pass or fail");
        }
    }
    requireCount(value.targetCalls, "impact trajectory targetCalls");
    if (typeof value.targetBeforeFirstEdit !== "boolean") {
        throw new Error("impact trajectory targetBeforeFirstEdit must be boolean");
    }
    requireCount(value.readsBeforeFirstCorrectWrite, "impact trajectory readsBeforeFirstCorrectWrite", { nullable: true });
    requireCount(value.searchesBeforeFirstCorrectWrite, "impact trajectory searchesBeforeFirstCorrectWrite", { nullable: true });
    if ((value.readsBeforeFirstCorrectWrite === null) !== (value.searchesBeforeFirstCorrectWrite === null)) {
        throw new Error("impact trajectory correct-write metrics must both be integers or both be null");
    }
    for (const field of [
        "writesOutsideOracle", "pushes", "failedVerificationLoops", "hardRuleViolations",
        "falseExactReferences"
    ]) requireCount(value[field], "impact trajectory " + field);
    requireCount(value.wallTimeMs, "impact trajectory wallTimeMs", { positive: true });
    requireCount(value.impactResponseBytes, "impact trajectory impactResponseBytes", { nullable: true });
    requireExactKeys(value.calls, ["mcp", "read", "other"], "impact trajectory calls");
    for (const field of ["mcp", "read", "other"]) requireCount(value.calls[field], "impact trajectory calls." + field);
    if (value.targetCalls === 0 && (value.targetBeforeFirstEdit || value.impactResponseBytes !== null)) {
        throw new Error("impact trajectory target evidence is incoherent with zero targetCalls");
    }
    if (value.targetCalls > 0 && value.impactResponseBytes === null) {
        throw new Error("impact trajectory impactResponseBytes is required when targetCalls is positive");
    }
    return value;
}

function codePointCompare(a, b) {
    const ac = Array.from(a, c => c.codePointAt(0));
    const bc = Array.from(b, c => c.codePointAt(0));
    for (let i = 0; i < Math.min(ac.length, bc.length); i++) {
        if (ac[i] !== bc[i]) return ac[i] - bc[i];
    }
    return ac.length - bc.length;
}

function sameArray(actual, expected) {
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function sameMap(actual, expected) {
    const actualKeys = Object.keys(actual).sort(codePointCompare);
    const expectedKeys = Object.keys(expected).sort(codePointCompare);
    return sameArray(actualKeys, expectedKeys) &&
        actualKeys.every(key => actual[key] === expected[key]);
}

function validateHashMap(value, label) {
    if (!isObject(value) || Object.keys(value).length === 0) {
        throw new Error(label + " must be a non-empty object");
    }
    for (const [name, digest] of Object.entries(value)) {
        requireString(name, label + " filename");
        if (!/^[0-9a-f]{64}$/.test(digest)) {
            throw new Error(label + " hash must be 64 lowercase hex: " + name);
        }
    }
}

function validateReceipt(receipt) {
    const fields = [
        "schema", "evalKey", "taskKey", "variant", "fixtureDigest", "fixtureFiles",
        "palGuid", "serverMarker", "serverPaths", "localHash", "fileHashes", "lint", "push", "seededAt"
    ];
    requireExactKeys(receipt, fields, "impact start receipt");
    if (receipt.schema !== "palsync/impact-start/1") throw new Error("Invalid impact start receipt schema");
    for (const field of ["evalKey", "taskKey", "palGuid", "serverMarker"]) {
        requireString(receipt[field], "impact start receipt " + field);
    }
    if (receipt.variant !== "off" && receipt.variant !== "on") {
        throw new Error("impact start receipt variant must be off or on");
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(receipt.fixtureDigest)) {
        throw new Error("impact start receipt fixtureDigest must be sha256:<64 lowercase hex>");
    }
    if (!/^[0-9a-f]{64}$/.test(receipt.localHash)) {
        throw new Error("impact start receipt localHash must be 64 lowercase hex");
    }
    if (receipt.fixtureDigest !== "sha256:" + receipt.localHash) {
        throw new Error("impact start receipt fixtureDigest and localHash must agree");
    }

    validateHashMap(receipt.fixtureFiles, "impact start receipt fixtureFiles");
    validateHashMap(receipt.fileHashes, "impact start receipt fileHashes");
    const fixtureKeys = Object.keys(receipt.fixtureFiles).sort(codePointCompare);
    const fileHashKeys = Object.keys(receipt.fileHashes).sort(codePointCompare);
    if (!sameArray(fixtureKeys, fileHashKeys) ||
        fixtureKeys.some(name => receipt.fixtureFiles[name] !== receipt.fileHashes[name])) {
        throw new Error("impact start receipt fileHashes must deep-equal fixtureFiles");
    }

    if (!Array.isArray(receipt.serverPaths) ||
        receipt.serverPaths.some(serverPath => typeof serverPath !== "string" || !serverPath)) {
        throw new Error("impact start receipt serverPaths must be an array of non-empty strings");
    }
    const expectedServerPaths = fixtureKeys.filter(name => name !== "pal.json");
    if (!sameArray(receipt.serverPaths, expectedServerPaths)) {
        throw new Error("impact start receipt serverPaths must be code-point-sorted fixture keys minus pal.json");
    }

    requireExactKeys(receipt.lint, ["errors", "warnings"], "impact start receipt lint");
    if (receipt.lint.errors !== 0 || receipt.lint.warnings !== 0) {
        throw new Error("impact start receipt lint must be exactly 0 errors and 0 warnings");
    }
    requireExactKeys(receipt.push, ["pushed", "newMarker"], "impact start receipt push");
    if (receipt.push.pushed !== true || receipt.push.newMarker !== receipt.serverMarker) {
        throw new Error("impact start receipt push must be pushed true with newMarker matching serverMarker");
    }
    requireString(receipt.seededAt, "impact start receipt seededAt");
    const seededAt = new Date(receipt.seededAt);
    if (Number.isNaN(seededAt.valueOf()) || seededAt.toISOString() !== receipt.seededAt) {
        throw new Error("impact start receipt seededAt must be a valid ISO timestamp");
    }
    return receipt;
}

function validatePalsyncUsage(result) {
    if (!result.exists) return { calls: null, returnedBytes: null, estimatedTokens: null };
    if (!isObject(result.value)) throw new Error("Malformed impact palsync usage root: expected an object");
    const mappings = [
        ["totalCalls", "calls"], ["totalReturnedBytes", "returnedBytes"], ["totalTokens", "estimatedTokens"]
    ];
    const out = {};
    for (const [source, target] of mappings) {
        const value = result.value[source];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
            throw new Error("Impact palsync usage " + source + " must be a finite non-negative number");
        }
        out[target] = value;
    }
    return out;
}

function validateModelUsage(result) {
    if (!result.exists) return null;
    const root = result.value;
    let entries;
    if (Array.isArray(root)) entries = root;
    else if (isObject(root) && Object.prototype.hasOwnProperty.call(root, "entries")) {
        if (!Array.isArray(root.entries)) throw new Error("Malformed impact session-cost root: entries must be an array");
        entries = root.entries;
    } else if (isObject(root) && (Object.prototype.hasOwnProperty.call(root, "model") ||
        Object.prototype.hasOwnProperty.call(root, "provider"))) entries = [root];
    else throw new Error("Malformed impact session-cost root");
    if (entries.length === 0) return null;

    const currencies = new Set();
    for (const [index, entry] of entries.entries()) {
        if (!isObject(entry)) throw new Error("Impact session-cost entry " + index + " must be an object");
        requireString(entry.model, "impact session-cost entry " + index + " model");
        requireString(entry.provider, "impact session-cost entry " + index + " provider");
        for (const field of ["tokensIn", "tokensCached", "tokensOut"]) {
            requireCount(entry[field], "impact session-cost entry " + index + " " + field);
        }
        if (entry.cost != null && entry.cost !== "") {
            if (typeof entry.cost !== "number" || !Number.isFinite(entry.cost) || entry.cost < 0) {
                throw new Error("impact session-cost entry " + index + " cost must be a finite non-negative number");
            }
            requireString(entry.currency, "impact session-cost entry " + index + " currency");
            currencies.add(entry.currency.trim());
        }
    }
    if (currencies.size > 1) throw new Error("Impact session-cost currencies must all agree");
    const total = phaseTotals(entries).total;
    return {
        tokensIn: total.tokensIn,
        tokensCached: total.tokensCached,
        tokensOut: total.tokensOut,
        totalTokens: total.tokensIn + total.tokensOut,
        cost: total.hasCost ? total.cost : null,
        currency: total.hasCost ? [...currencies][0] : null,
    };
}

function sha256(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

function buildImpactFields({ workspaceDir, scenario, record, variant, pair, pairOrder,
    orchSkills, palbuilderSkills, trajectory, transcript }) {
    const required = { variant, pair, pairOrder, orchSkills, palbuilderSkills, trajectory, transcript };
    for (const [name, value] of Object.entries(required)) requireString(value, "Impact --" + name.replace(/[A-Z]/g, c => "-" + c.toLowerCase()));
    if (!scenario) throw new Error("Impact --scenario is required");
    if (variant !== "off" && variant !== "on") throw new Error("Impact --variant must be off or on");
    if (pairOrder !== "off-first" && pairOrder !== "on-first") {
        throw new Error("Impact --pair-order must be off-first or on-first");
    }
    if (!/^[^@\s]+@[0-9a-f]{7,40}$/.test(orchSkills)) {
        throw new Error("Impact --orch-skills must be <branch@sha> with a 7-40 character lowercase hex SHA");
    }
    const palbuilderMatch = palbuilderSkills.match(/^([^@\s]+)@([0-9a-f]{7,40}|\d{4}-\d{2}-\d{2})$/);
    if (!palbuilderMatch) {
        throw new Error("Impact --palbuilder-skills must be <name@sha-or-date> with a lowercase 7-40 character hex SHA or YYYY-MM-DD");
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(palbuilderMatch[2])) {
        const date = new Date(palbuilderMatch[2] + "T00:00:00.000Z");
        if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== palbuilderMatch[2]) {
            throw new Error("Impact --palbuilder-skills date must be a valid YYYY-MM-DD");
        }
    }

    const receiptResult = strictJson(path.join(workspaceDir, ".palsync", "impact-start.json"), "impact start receipt");
    if (!receiptResult.exists) throw new Error("Impact start receipt is required");
    const receipt = validateReceipt(receiptResult.value);
    if (!isObject(record)) throw new Error("Impact current Pal record is required");
    requireString(record.palGuid, "impact current Pal GUID");

    const spec = require("../src/core/evalSpec").resolveSpec(scenario);
    if (spec.kind !== "impact" || receipt.evalKey !== scenario || receipt.evalKey !== spec.key ||
        receipt.taskKey !== spec.taskKey || receipt.variant !== variant || spec.variant !== variant ||
        receipt.palGuid !== record.palGuid) {
        throw new Error("Impact receipt, scenario, spec, variant, and current Pal must agree");
    }
    const baselineResult = strictJson(spec.baselineManifestPath, "impact baseline manifest");
    const baseline = baselineResult.value;
    if (!baselineResult.exists || !isObject(baseline) ||
        receipt.fixtureDigest !== baseline.fixtureDigest ||
        !isObject(baseline.files) || !sameMap(receipt.fixtureFiles, baseline.files) ||
        !Array.isArray(baseline.expectedServerPaths) ||
        !sameArray(receipt.serverPaths, baseline.expectedServerPaths)) {
        throw new Error("Impact start receipt must match the committed baseline manifest");
    }

    const trajectoryResult = strictJson(path.resolve(trajectory), "impact trajectory");
    if (!trajectoryResult.exists) throw new Error("Impact trajectory file is required");
    const trajectoryValue = validateTrajectory(trajectoryResult.value);
    if (variant === "off" && (trajectoryValue.targetCalls !== 0 ||
        trajectoryValue.targetBeforeFirstEdit !== false || trajectoryValue.impactResponseBytes !== null)) {
        throw new Error("Impact off arm contains target-call contamination");
    }
    const transcriptBytes = strictFile(path.resolve(transcript), "impact transcript");
    if (transcriptBytes === null) throw new Error("Impact transcript file is required");

    const usageResult = strictJson(path.join(workspaceDir, ".palsync.usage.json"), "impact palsync usage");
    const sessionCostResult = strictJson(path.join(workspaceDir, ".palsync", "session-cost.json"), "impact session-cost");
    const primary = trajectoryValue.readsBeforeFirstCorrectWrite === null ? null :
        trajectoryValue.readsBeforeFirstCorrectWrite + trajectoryValue.searchesBeforeFirstCorrectWrite;
    return {
        experiment: {
            schema: "palsync/impact-experiment/1",
            pair,
            pairOrder,
            variant,
            taskKey: spec.taskKey,
            impactTarget: spec.impactTarget,
            orchSkills,
            palbuilderSkills,
            fixtureDigest: receipt.fixtureDigest,
            fixtureFiles: { ...receipt.fixtureFiles },
            startMarker: receipt.serverMarker,
            startPalGuid: receipt.palGuid,
            trajectory: trajectoryValue,
            primaryExplorationActions: primary,
            trajectoryFile: { name: path.basename(path.resolve(trajectory)), sha256: sha256(trajectoryResult.bytes) },
            transcriptFile: { name: path.basename(path.resolve(transcript)), sha256: sha256(transcriptBytes) },
        },
        palsyncUsage: validatePalsyncUsage(usageResult),
        modelUsage: validateModelUsage(sessionCostResult),
    };
}

function buildRow({ workspaceDir, model, harness, scenario, variant, pair, pairOrder,
    orchSkills, palbuilderSkills, trajectory, transcript, now = new Date(), repoDir = path.join(__dirname, "..") }) {
    workspaceDir = path.resolve(workspaceDir);
    const receipt = readJson(path.join(workspaceDir, ".palsync", "impact-start.json"));
    const impact = (receipt && receipt.schema === "palsync/impact-start/1") ||
        (typeof scenario === "string" && scenario.startsWith("impact_"));
    const usage = readJson(path.join(workspaceDir, ".palsync.usage.json")) || {};
    const record = readJson(path.join(workspaceDir, PALSYNC_FILE));
    const evidenceFile = path.join(workspaceDir, TOOL_EVIDENCE_FILE);
    const evidenceAvailable = fs.existsSync(evidenceFile);
    const evidence = evidenceAvailable ? readToolEvidence(workspaceDir) : [];
    const currentEvidence = (tool) => filterToolEvidence(
        evidence, tool, record && record.palGuid, record && record.lastModifiedDate);
    const sessionCost = readJson(path.join(workspaceDir, ".palsync", "session-cost.json"));
    const costModel = sessionCost && Array.isArray(sessionCost.entries) && sessionCost.entries[0] && sessionCost.entries[0].model;
    const impactCostEntry = impact && (Array.isArray(sessionCost) ? sessionCost[0] :
        (sessionCost && Array.isArray(sessionCost.entries) ? sessionCost.entries[0] : sessionCost));
    const impactCostModel = impactCostEntry && impactCostEntry.model;
    const execution = fs.readFileSync(path.join(workspaceDir, "EXECUTION.md"), "utf8");
    const tasks = parseTasks(execution);
    if (!tasks.ok) throw new Error("Cannot parse EXECUTION.md: " + tasks.error);
    let review = "";
    try { review = fs.readFileSync(path.join(workspaceDir, "REVIEW.md"), "utf8"); } catch (error) {}
    const reviewResult = reviewFields(review);
    const started = usage.startedAt && new Date(usage.startedAt);
    const date = started && !Number.isNaN(started.valueOf()) ? started : now;
    const resolvedScenario = scenario || inferScenario(workspaceDir);
    const resolvedModel = model || costModel || impactCostModel;
    if (!resolvedScenario) throw new Error("Cannot infer scenario; pass --scenario");
    if (!resolvedModel) throw new Error("Cannot infer model; pass --model");
    if (!harness) throw new Error("Pass --harness (for example claude-code, pi, or opencode)");
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();
    const row = {
        date: date.toISOString().slice(0, 10),
        sha,
        scenario: resolvedScenario,
        model: resolvedModel,
        harness,
        verdict: reviewResult.verdict,
        tasksDone: tasks.rows.filter(row => row.status === "done").length,
        tasksTotal: tasks.rows.length,
        pushOk: evidenceAvailable
            ? currentEvidence("pal_push").length > 0
            : toolSuccessfulCalls(usage, "pal_push") > 0,
        exerciseCount: evidenceAvailable
            ? currentEvidence("pal_exercise").length
            : toolSuccessfulCalls(usage, "pal_exercise"),
        score12: reviewResult.score12,
    };
    if (impact) Object.assign(row, buildImpactFields({
        workspaceDir, scenario: resolvedScenario, record, variant, pair, pairOrder,
        orchSkills, palbuilderSkills, trajectory, transcript
    }));
    return row;
}

function main(argv) {
    const flags = parseArgs(argv);
    const row = buildRow({
        workspaceDir: flags.dir,
        model: flags.model,
        harness: flags.harness,
        scenario: flags.scenario,
        variant: flags.variant,
        pair: flags.pair,
        pairOrder: flags.pairOrder,
        orchSkills: flags.orchSkills,
        palbuilderSkills: flags.palbuilderSkills,
        trajectory: flags.trajectory,
        transcript: flags.transcript,
    });
    const output = path.resolve(flags.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.appendFileSync(output, JSON.stringify(row) + "\n");
    process.stdout.write(JSON.stringify(row) + "\n");
}

if (require.main === module) {
    try { main(process.argv.slice(2)); }
    catch (error) {
        process.stderr.write("record-eval: " + error.message + "\n");
        process.exitCode = 1;
    }
}

module.exports = { buildRow, inferScenario, reviewFields };
