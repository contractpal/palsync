#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PILOT_PATH = path.join(__dirname, "..", "eval", "impact", "pilot.json");
const RESULT_SCHEMA = "palsync/impact-pilot-result/1";
const BENCHMARK_SCHEMA = "palsync/impact-benchmark/1";
const EXPECTED_FACTS = {
    dependencies: 0,
    dependents: 100,
    candidates: 0,
    unresolved: 0,
    possibleDynamicIncoming: 10,
};

function cmpText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(file, label) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); }
    catch (error) { throw new Error(label + " is unreadable: " + error.message); }
    try { return JSON.parse(text); }
    catch (error) { throw new Error(label + " is malformed JSON: " + error.message); }
}

function readRows(file) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); }
    catch (error) { throw new Error("impact rows are unreadable: " + error.message); }
    const rows = [];
    for (const [index, line] of text.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        try { rows.push(JSON.parse(line)); }
        catch (error) { throw new Error("impact row " + (index + 1) + " is malformed JSON: " + error.message); }
    }
    return rows;
}

function sameMap(a, b) {
    if (!isObject(a) || !isObject(b)) return false;
    const ak = Object.keys(a).sort(cmpText);
    const bk = Object.keys(b).sort(cmpText);
    return ak.length === bk.length && ak.every((key, index) => key === bk[index] && a[key] === b[key]);
}

function validHashMap(value) {
    return isObject(value) && Object.keys(value).length > 0 &&
        Object.entries(value).every(([name, digest]) => typeof name === "string" && name.length > 0 &&
            /^[0-9a-f]{64}$/.test(digest));
}

function nonNegativeNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
}

function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function parseScore(value) {
    if (typeof value !== "string" || !/^\d+\/\d+$/.test(value)) return null;
    const [numerator, denominator] = value.split("/").map(Number);
    if (denominator <= 0 || numerator < 0 || numerator > denominator) return null;
    return { numerator, denominator };
}

function getPath(object, parts) {
    let value = object;
    for (const part of parts) value = value && value[part];
    return value;
}

function rowErrors(row, index) {
    const errors = [];
    const at = "row " + (index + 1);
    if (!isObject(row)) return [at + " is not an object"];
    const exp = row.experiment;
    const trajectory = exp && exp.trajectory;
    if (!isObject(exp) || exp.schema !== "palsync/impact-experiment/1") errors.push(at + " has invalid experiment");
    if (!isObject(trajectory) || trajectory.schema !== "palsync/impact-trajectory/1") errors.push(at + " has invalid trajectory");
    for (const field of ["scenario", "model", "harness", "sha"]) {
        if (typeof row[field] !== "string" || !row[field]) errors.push(at + " missing " + field);
    }
    if (isObject(exp)) {
        for (const field of ["pair", "pairOrder", "variant", "taskKey", "orchSkills", "palbuilderSkills", "fixtureDigest"]) {
            if (typeof exp[field] !== "string" || !exp[field]) errors.push(at + " missing experiment." + field);
        }
        if (exp.variant !== "off" && exp.variant !== "on") errors.push(at + " has invalid variant");
        if (exp.pairOrder !== "off-first" && exp.pairOrder !== "on-first") errors.push(at + " has invalid pair order");
        if (!/^sha256:[0-9a-f]{64}$/.test(exp.fixtureDigest) || !validHashMap(exp.fixtureFiles)) {
            errors.push(at + " has invalid fixture evidence");
        }
        if (typeof exp.impactTarget !== "string" || !exp.impactTarget) errors.push(at + " missing experiment.impactTarget");
        if (row.scenario !== exp.taskKey + "-" + exp.variant) errors.push(at + " scenario/task/variant disagree");
    }
    if (isObject(trajectory)) {
        if (trajectory.acceptance !== "pass" && trajectory.acceptance !== "fail") errors.push(at + " has invalid acceptance");
        if (!["pass", "fail", "stale"].includes(trajectory.regression)) errors.push(at + " has invalid regression");
        for (const field of ["targetCalls", "writesOutsideOracle", "pushes", "failedVerificationLoops", "hardRuleViolations", "wallTimeMs", "falseExactReferences"]) {
            if (!nonNegativeInteger(trajectory[field]) || (field === "wallTimeMs" && trajectory[field] === 0)) {
                errors.push(at + " has invalid trajectory." + field);
            }
        }
        if (typeof trajectory.targetBeforeFirstEdit !== "boolean") errors.push(at + " has invalid targetBeforeFirstEdit");
        if (!isObject(trajectory.calls) || ["mcp", "read", "other"].some(field => !nonNegativeInteger(trajectory.calls && trajectory.calls[field]))) {
            errors.push(at + " has invalid call counts");
        }
        const reads = trajectory.readsBeforeFirstCorrectWrite;
        const searches = trajectory.searchesBeforeFirstCorrectWrite;
        if (!((reads === null && searches === null) || (nonNegativeInteger(reads) && nonNegativeInteger(searches)))) {
            errors.push(at + " has invalid pre-correct-write metrics");
        }
        const expectedPrimary = reads === null ? null : reads + searches;
        if (exp && exp.primaryExplorationActions !== expectedPrimary) errors.push(at + " primary metric disagrees with trajectory");
        if (!(trajectory.impactResponseBytes === null || nonNegativeInteger(trajectory.impactResponseBytes))) {
            errors.push(at + " has invalid impactResponseBytes");
        }
        if (exp && exp.variant === "off" && (trajectory.targetCalls !== 0 || trajectory.targetBeforeFirstEdit || trajectory.impactResponseBytes !== null)) {
            errors.push(at + " has contaminated off arm");
        }
    }
    if (!(row.modelUsage === null || (isObject(row.modelUsage) &&
        (row.modelUsage.totalTokens === null || nonNegativeNumber(row.modelUsage.totalTokens))))) {
        errors.push(at + " has invalid model usage");
    }
    return errors;
}

function normalizePilot(pilot) {
    if (!isObject(pilot) || pilot.schema !== "palsync/impact-pilot/1" || !Array.isArray(pilot.pairs) || pilot.pairs.length !== 6) {
        return { errors: ["pilot schedule must contain exactly six pairs"], pairs: [] };
    }
    const errors = [];
    const seen = new Set();
    const pairs = [];
    for (const item of pilot.pairs) {
        if (!isObject(item) || typeof item.pair !== "string" || typeof item.taskKey !== "string" ||
            !Array.isArray(item.order) || item.order.length !== 2 ||
            !((item.order[0] === "off" && item.order[1] === "on") || (item.order[0] === "on" && item.order[1] === "off"))) {
            errors.push("pilot schedule contains a malformed pair");
            continue;
        }
        if (seen.has(item.pair)) errors.push("pilot schedule repeats pair " + item.pair);
        seen.add(item.pair);
        pairs.push(item);
    }
    return { errors, pairs };
}

function evidence(rows, pilot) {
    const normalized = normalizePilot(pilot);
    const errors = normalized.errors.slice();
    rows.forEach((row, index) => errors.push(...rowErrors(row, index)));
    if (rows.length !== 12) errors.push("expected exactly 12 rows, got " + rows.length);

    const grouped = new Map();
    for (const row of rows) {
        const pair = row && row.experiment && row.experiment.pair;
        if (typeof pair !== "string") continue;
        const list = grouped.get(pair) || [];
        list.push(row);
        grouped.set(pair, list);
    }
    const scheduleIds = new Set(normalized.pairs.map(item => item.pair));
    for (const pair of grouped.keys()) if (!scheduleIds.has(pair)) errors.push("unexpected pair " + pair);

    const pairs = [];
    for (const scheduled of normalized.pairs) {
        const pairRows = grouped.get(scheduled.pair) || [];
        const off = pairRows.filter(row => row.experiment && row.experiment.variant === "off");
        const on = pairRows.filter(row => row.experiment && row.experiment.variant === "on");
        if (pairRows.length !== 2 || off.length !== 1 || on.length !== 1) {
            errors.push("pair " + scheduled.pair + " must contain exactly one off and one on row");
            continue;
        }
        const control = off[0];
        const treatment = on[0];
        const expectedOrder = scheduled.order[0] + "-first";
        for (const row of [control, treatment]) {
            if (row.experiment.taskKey !== scheduled.taskKey) errors.push("pair " + scheduled.pair + " task does not match schedule");
            if (row.experiment.pairOrder !== expectedOrder) errors.push("pair " + scheduled.pair + " order does not match schedule");
        }
        for (const parts of [
            ["model"], ["harness"], ["sha"], ["experiment", "orchSkills"],
            ["experiment", "palbuilderSkills"], ["experiment", "fixtureDigest"], ["experiment", "pairOrder"]
        ]) {
            if (getPath(control, parts) !== getPath(treatment, parts)) {
                errors.push("pair " + scheduled.pair + " mismatches " + parts.join("."));
            }
        }
        if (!sameMap(control.experiment.fixtureFiles, treatment.experiment.fixtureFiles)) {
            errors.push("pair " + scheduled.pair + " mismatches experiment.fixtureFiles");
        }
        pairs.push({ scheduled, control, treatment });
    }

    const globalPins = [
        ["model"], ["harness"], ["sha"], ["experiment", "orchSkills"], ["experiment", "palbuilderSkills"]
    ];
    for (const parts of globalPins) {
        const values = new Set(rows.map(row => getPath(row, parts)));
        if (values.size !== 1) errors.push("rows do not share one " + parts.join("."));
    }
    return { errors: [...new Set(errors)].sort(cmpText), pairs, schedulePairs: normalized.pairs.length };
}

function metricValues(pairs, parts) {
    const control = pairs.map(pair => getPath(pair.control, parts));
    const treatment = pairs.map(pair => getPath(pair.treatment, parts));
    if (control.some(value => !nonNegativeNumber(value)) || treatment.some(value => !nonNegativeNumber(value))) return null;
    return { control, treatment, controlMedian: median(control), treatmentMedian: median(treatment) };
}

function metricCheck(id, values, factor) {
    if (!values) return { id, status: "incomplete", actual: null, required: "numeric evidence for all 12 rows" };
    const pass = values.controlMedian === 0
        ? values.treatmentMedian === 0
        : values.treatmentMedian <= values.controlMedian * factor;
    return {
        id,
        status: pass ? "pass" : "fail",
        actual: { controlMedian: values.controlMedian, treatmentMedian: values.treatmentMedian },
        required: values.controlMedian === 0 ? "treatment median = 0" : "treatment median <= control median × " + factor,
    };
}

function benchmarkEvidence(benchmark) {
    if (!isObject(benchmark) || benchmark.schema !== BENCHMARK_SCHEMA ||
        !Number.isInteger(benchmark.iterations) || benchmark.iterations < 1 ||
        !nonNegativeNumber(benchmark.p50Ms) || !nonNegativeNumber(benchmark.p95Ms) ||
        !isObject(benchmark.factCounts) || Object.keys(EXPECTED_FACTS).some(key => benchmark.factCounts[key] !== EXPECTED_FACTS[key]) ||
        !nonNegativeInteger(benchmark.messageBytes) || typeof benchmark.withinByteBudget !== "boolean") {
        return false;
    }
    return true;
}

function checkPilot(rows, benchmark, pilot) {
    const ev = evidence(rows, pilot);
    const checks = [];
    checks.push({
        id: "evidence-completeness",
        status: ev.errors.length ? "incomplete" : "pass",
        actual: ev.errors,
        required: "exact fixed schedule, pair arms, row coherence, and pins",
    });

    const pairs = ev.pairs;
    const scores = pairs.map(pair => ({ control: parseScore(pair.control.score12), treatment: parseScore(pair.treatment.score12) }));
    const scoreIncomplete = pairs.length !== 6 || scores.some(score => !score.control || !score.treatment ||
        score.control.denominator !== score.treatment.denominator);
    const scorePass = !scoreIncomplete && scores.every(score => score.treatment.numerator >= score.control.numerator);
    checks.push({
        id: "score-non-regression",
        status: scoreIncomplete ? "incomplete" : scorePass ? "pass" : "fail",
        actual: scoreIncomplete ? null : scores.map(score => [score.control.numerator, score.treatment.numerator]),
        required: "valid equal-denominator pair scores and treatment numerator >= control",
    });

    const trajectory = row => getPath(row, ["experiment", "trajectory"]) || {};
    // A "stale" regression is an absent verdict, not a failure: it means the agent pushed before
    // running the check, so the freshness gate refused to compare. Such an arm must not count as a
    // regression FAILURE (nothing regressed) and must not silently count as a PASS (nothing was
    // checked). Completion therefore requires acceptance to pass and regression to be anything but
    // an outright fail, with coverage reported separately so a pilot cannot look green while most
    // arms were never regression-checked at all.
    const regressionOk = row => trajectory(row).acceptance === "pass" && trajectory(row).regression !== "fail";
    const treatmentComplete = pairs.length === 6 && pairs.every(pair => regressionOk(pair.treatment));
    checks.push({ id: "treatment-completion", status: pairs.length === 6 ? treatmentComplete ? "pass" : "fail" : "incomplete",
        actual: pairs.filter(pair => regressionOk(pair.treatment)).length,
        required: 6 });

    // Coverage is advisory-but-visible: it never fails the pilot on its own, yet it makes the size
    // of the unchecked population explicit in the result rather than leaving it to be inferred.
    const verdicts = rows.map(row => trajectory(row).regression);
    const staleCount = verdicts.filter(v => v === "stale").length;
    checks.push({
        id: "regression-coverage",
        status: rows.length === 12 ? (staleCount === 0 ? "pass" : "incomplete") : "incomplete",
        actual: { verdicts: rows.length - staleCount, stale: staleCount, of: rows.length },
        required: "every arm runs regression BEFORE its push (EXECUTION.md order); stale arms carry no verdict",
    });

    const falseExactValues = rows.map(row => trajectory(row).falseExactReferences);
    const falseExact = falseExactValues.every(nonNegativeInteger)
        ? falseExactValues.reduce((sum, value) => sum + value, 0) : null;
    checks.push({ id: "false-exact-references", status: falseExact === null ? "incomplete" : falseExact === 0 ? "pass" : "fail",
        actual: falseExact, required: 0 });

    const writeSafety = pairs.length === 6 && pairs.every(pair =>
        nonNegativeInteger(trajectory(pair.treatment).writesOutsideOracle) &&
        nonNegativeInteger(trajectory(pair.control).writesOutsideOracle) &&
        nonNegativeInteger(trajectory(pair.treatment).hardRuleViolations) &&
        nonNegativeInteger(trajectory(pair.control).hardRuleViolations) &&
        trajectory(pair.treatment).writesOutsideOracle <= trajectory(pair.control).writesOutsideOracle &&
        trajectory(pair.treatment).hardRuleViolations <= trajectory(pair.control).hardRuleViolations);
    checks.push({ id: "write-safety", status: pairs.length === 6 ? writeSafety ? "pass" : "fail" : "incomplete",
        actual: writeSafety, required: "treatment <= matched control for outside writes and hard-rule violations" });

    const adopted = pairs.filter(pair => trajectory(pair.treatment).targetCalls === 1 &&
        trajectory(pair.treatment).targetBeforeFirstEdit === true).length;
    checks.push({ id: "adoption", status: pairs.length === 6 ? adopted >= 4 ? "pass" : "fail" : "incomplete",
        actual: adopted, required: 4 });

    const primary = metricValues(pairs, ["experiment", "primaryExplorationActions"]);
    const primaryWins = primary ? primary.control.filter((value, index) => primary.treatment[index] < value).length : null;
    checks.push({ id: "primary-pair-wins", status: primary ? primaryWins >= 4 ? "pass" : "fail" : "incomplete",
        actual: primaryWins, required: 4 });
    const reduction = primary && primary.controlMedian > 0
        ? (primary.controlMedian - primary.treatmentMedian) / primary.controlMedian : null;
    checks.push({ id: "primary-median-reduction", status: reduction === null ? "incomplete" : reduction >= 0.20 ? "pass" : "fail",
        actual: reduction, required: 0.20 });

    const metricDefinitions = [
        ["mcp-non-inferiority", ["experiment", "trajectory", "calls", "mcp"], 1.10],
        ["read-non-inferiority", ["experiment", "trajectory", "calls", "read"], 1.10],
        ["other-non-inferiority", ["experiment", "trajectory", "calls", "other"], 1.10],
        ["failed-loop-non-inferiority", ["experiment", "trajectory", "failedVerificationLoops"], 1.10],
        ["push-non-inferiority", ["experiment", "trajectory", "pushes"], 1.15],
        ["wall-time-non-inferiority", ["experiment", "trajectory", "wallTimeMs"], 1.15],
        ["model-token-non-inferiority", ["modelUsage", "totalTokens"], 1.10],
    ];
    const medians = {
        primaryExplorationActions: primary ? { control: primary.controlMedian, treatment: primary.treatmentMedian } : null,
    };
    for (const [id, parts, factor] of metricDefinitions) {
        const values = metricValues(pairs, parts);
        checks.push(metricCheck(id, values, factor));
        medians[id] = values ? { control: values.controlMedian, treatment: values.treatmentMedian } : null;
    }

    const adoptedRows = pairs.filter(pair => trajectory(pair.treatment).targetCalls === 1 &&
        trajectory(pair.treatment).targetBeforeFirstEdit === true).map(pair => pair.treatment);
    const responseIncomplete = adoptedRows.some(row => !Number.isInteger(row.experiment.trajectory.impactResponseBytes) ||
        row.experiment.trajectory.impactResponseBytes < 0);
    const responsePass = !responseIncomplete && adoptedRows.every(row => row.experiment.trajectory.impactResponseBytes <= 4096);
    checks.push({ id: "response-budget", status: responseIncomplete ? "incomplete" : responsePass ? "pass" : "fail",
        actual: responseIncomplete ? null : Math.max(0, ...adoptedRows.map(row => row.experiment.trajectory.impactResponseBytes)), required: 4096 });

    const benchmarkValid = benchmarkEvidence(benchmark);
    checks.push({ id: "benchmark-input", status: benchmarkValid ? "pass" : "incomplete",
        actual: benchmarkValid ? benchmark.factCounts : null, required: EXPECTED_FACTS });
    checks.push({ id: "benchmark-byte-budget", status: !benchmarkValid ? "incomplete" :
        benchmark.withinByteBudget && benchmark.messageBytes <= 4096 ? "pass" : "fail",
        actual: benchmarkValid ? { withinByteBudget: benchmark.withinByteBudget, messageBytes: benchmark.messageBytes } : null,
        required: { withinByteBudget: true, messageBytesAtMost: 4096 } });
    checks.push({ id: "benchmark-p95", status: !benchmarkValid ? "incomplete" : benchmark.p95Ms <= 100 ? "pass" : "fail",
        actual: benchmarkValid ? benchmark.p95Ms : null, required: 100 });

    let status = "pass";
    if (checks.some(check => check.status === "incomplete")) status = "incomplete";
    else if (checks.some(check => check.status === "fail")) status = "fail";
    return {
        schema: RESULT_SCHEMA,
        status,
        pairs: ev.schedulePairs,
        runs: rows.length,
        checks,
        medians,
        benchmark: benchmarkValid ? {
            schema: benchmark.schema,
            iterations: benchmark.iterations,
            p95Ms: benchmark.p95Ms,
            factCounts: benchmark.factCounts,
            messageBytes: benchmark.messageBytes,
            withinByteBudget: benchmark.withinByteBudget,
        } : {},
    };
}

function exitCode(result) {
    return result.status === "pass" ? 0 : result.status === "fail" ? 1 : 2;
}

function parseArgs(argv) {
    const out = { json: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--json") { out.json = true; continue; }
        if (argv[i] !== "--input" && argv[i] !== "--benchmark") throw new Error("Unknown argument: " + argv[i]);
        if (argv[i + 1] === undefined) throw new Error(argv[i] + " requires a value");
        out[argv[i].slice(2)] = argv[++i];
    }
    if (!out.input || !out.benchmark) throw new Error("Usage: check-impact-pilot --input <jsonl> --benchmark <json> [--json]");
    return out;
}

function runFiles({ input, benchmark }) {
    return checkPilot(readRows(path.resolve(input)), readJson(path.resolve(benchmark), "impact benchmark"),
        readJson(PILOT_PATH, "impact pilot schedule"));
}

function main(argv) {
    const flags = parseArgs(argv);
    const result = runFiles(flags);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return exitCode(result);
}

if (require.main === module) {
    try { process.exitCode = main(process.argv.slice(2)); }
    catch (error) {
        process.stderr.write("check-impact-pilot: " + error.message + "\n");
        process.exitCode = 2;
    }
}

module.exports = { checkPilot, exitCode, median, readRows, runFiles, main };
