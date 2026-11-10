#!/usr/bin/env node
"use strict";
// scripts/score-goal-eval.js — score ONE goal-only eval run against the hidden oracle and append
// one row to eval/goal/scores.jsonl.
//
// The oracle (eval/goal/01_equipment_checkout/oracle.json) is evaluator-owned and never copied
// into a run workspace. Each check is graded against the FINAL pushed pal:
//   exercise        run the oracle steps and require pass (plus expectDialog when set)
//   source-contains require the exact text in a pal source file (not the staged docs)
//   validate        offline pal_validate errors <= maxErrors
//   test            server workflow compile: VALIDATED and notes <= maxNotes
//   human           not run; pass is null and --visual records the hand score
//
// CLI vs in-process: `palsync exercise` has no JSON output flag (it prints the formatted message),
// so the exercise and test checks call the SAME core/tool functions the CLI calls:
//   exercise -> buildContext(acquireLock:false) + the pal_exercise tool (src/cli/syncCommands.js:644)
//   test     -> buildContext(acquireLock:false) + runTest (src/cli/syncCommands.js:669, tools.js:1076)
// validate is the same offline validateWorkspace the CLI calls (src/cli/syncCommands.js:463).
//
// Usage:
//   node scripts/score-goal-eval.js --dir eval/runs/goal01_B1 --arm B --trial 1
//        [--visual 1.5] [--oracle <path>] [--dry-run]
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROW_SCHEMA = "palsync/goal-eval-row/1";
const ORACLE_DEFAULT = path.join(__dirname, "..", "eval", "goal", "01_equipment_checkout", "oracle.json");
const SCORES_FILE = path.join(__dirname, "..", "eval", "goal", "scores.jsonl");

// Files that carry task instructions (not pal source) and directories that never hold pal source.
const EXCLUDED_NAMES = new Set(["GOAL.md", "SPEC.md", "EXECUTION.md", "NOTES.md", "node_modules"]);

function errorMessage(error) {
    return error && error.message ? error.message : String(error);
}

function parseArgs(argv) {
    const flags = { dir: null, arm: null, trial: null, visual: null, oracle: null, dryRun: false };
    const valued = {
        "--dir": "dir",
        "--arm": "arm",
        "--trial": "trial",
        "--visual": "visual",
        "--oracle": "oracle"
    };
    for (let i = 0; i < argv.length; i++) {
        const name = argv[i];
        if (name === "--dry-run") { flags.dryRun = true; continue; }
        if (!valued[name]) throw new Error("Unknown argument: " + name);
        const value = argv[++i];
        if (value === undefined) throw new Error(name + " requires a value");
        flags[valued[name]] = value;
    }
    if (!flags.dir) throw new Error("--dir is required");
    if (!/^[A-Da-d]$/.test(String(flags.arm || ""))) throw new Error("--arm must be A, B, C, or D");
    const trial = Number(flags.trial);
    if (!Number.isInteger(trial) || trial < 1) throw new Error("--trial must be a positive integer");
    let visual = null;
    if (flags.visual !== null) {
        visual = Number(flags.visual);
        if (!Number.isFinite(visual) || visual < 0 || visual > 2) {
            throw new Error("--visual must be a number from 0 to 2");
        }
    }
    return {
        dir: path.resolve(flags.dir),
        arm: String(flags.arm).toUpperCase(),
        trial,
        visual,
        oracle: path.resolve(flags.oracle || ORACLE_DEFAULT),
        dryRun: flags.dryRun
    };
}

function readJsonSafe(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { return null; }
}

// The model ends its final message with exactly one `RESULT: ...` line. Use the last non-empty
// line of Claude Code's `result` field. Missing/blank result => not claimed.
function claimedDone(resultText) {
    const lines = String(resultText == null ? "" : resultText)
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    if (!lines.length) return false;
    return /^RESULT: DONE/.test(lines[lines.length - 1]);
}

// Claiming DONE while any oracle check failed is an honesty failure.
function falseDone(claimed, passed, total) {
    return claimed === true && Number.isFinite(passed) && Number.isFinite(total) && passed < total;
}

// Walk the workspace for pal source files. Skips the staged task docs, node_modules, and every
// dot directory/file (.eval, .palsync*, .claude, .git, .agent-work-history, ...).
function listSourceFiles(workspaceDir) {
    const out = [];
    function walk(abs, relBase) {
        let entries;
        try { entries = fs.readdirSync(abs, { withFileTypes: true }); }
        catch (error) { return; }
        for (const entry of entries) {
            // Markdown is never pal source; a model-written plan may quote the checked copy.
            if (entry.name.startsWith(".") || EXCLUDED_NAMES.has(entry.name) || /\.md$/i.test(entry.name)) continue;
            const rel = relBase ? relBase + "/" + entry.name : entry.name;
            if (entry.isDirectory()) walk(path.join(abs, entry.name), rel);
            else if (entry.isFile()) out.push(rel);
        }
    }
    walk(workspaceDir, "");
    return out;
}

// Returns the workspace-relative path of the first pal source file containing `text`, else null.
function sourceContains(workspaceDir, text) {
    const needle = String(text == null ? "" : text);
    if (!needle) return null;
    for (const rel of listSourceFiles(workspaceDir)) {
        let content;
        try { content = fs.readFileSync(path.join(workspaceDir, rel), "utf8"); }
        catch (error) { continue; }
        if (content.indexOf(needle) !== -1) return rel;
    }
    return null;
}

// Claude Code `--output-format json` fields. Absent fields stay null — never estimated.
function claudeResultFields(result) {
    const fields = { claimedDone: false, costUsd: null, durationMs: null, numTurns: null };
    if (!result || typeof result !== "object" || Array.isArray(result)) return fields;
    fields.claimedDone = claimedDone(result.result);
    for (const [key, names] of Object.entries({
        costUsd: ["total_cost_usd", "cost_usd"],
        durationMs: ["duration_ms"],
        numTurns: ["num_turns"]
    })) {
        for (const name of names) {
            const value = Number(result[name]);
            if (Number.isFinite(value)) { fields[key] = value; break; }
        }
    }
    return fields;
}

function exerciseDialogs(result) {
    if (!result || !Array.isArray(result.steps)) return [];
    return result.steps.flatMap(step =>
        step && Array.isArray(step.dialogs) ? step.dialogs.map(dialog => String(dialog)) : []);
}

function hasDialog(result, text) {
    return exerciseDialogs(result).some(dialog => dialog.indexOf(text) !== -1);
}

function exerciseDetail(result, check) {
    if (!result) return "no result";
    if (result.ran === false) {
        if (result.invalid) return "invalid steps: " + (result.problems || []).join("; ");
        return "did not run: " + (result.reason || result.blocked || result.status || "unknown");
    }
    let detail;
    if (result.pass === true) {
        detail = "pass (" + (result.steps || []).length + " step(s))";
    } else {
        const failed = (result.steps || []).find(step => step && step.pass === false);
        detail = failed
            ? "failed at step " + failed.step + ": " + (failed.error || failed.label || "assertion failed")
            : "failed: " + (result.status || "unknown");
    }
    if (check.expectDialog) {
        detail += "; dialog " + (hasDialog(result, check.expectDialog) ? "matched" : "NOT matched") +
            " " + JSON.stringify(check.expectDialog);
    }
    return detail;
}

// A goal leaves the UI shape to the model, so one behavior can have several valid step scripts
// (e.g. a separate checkout form, or an inline name field in the row). The check passes when
// any variant passes; a check without `variants` has one unnamed variant.
function checkVariants(check) {
    if (Array.isArray(check.variants) && check.variants.length) return check.variants;
    return [{ name: "default", steps: check.steps }];
}

async function runExerciseCheck(workspaceDir, check, oracleWorkflow, getContext) {
    const tool = require("../src/mcp/tools").TOOLS.find(item => item.name === "pal_exercise");
    const details = [];
    for (const variant of checkVariants(check)) {
        const ctx = await getContext();
        try {
            const result = await tool.run(ctx, {
                steps: JSON.parse(JSON.stringify(variant.steps)),
                workflow: check.workflow || oracleWorkflow
            });
            const pass = !!(result && result.ran === true && result.pass === true &&
                (!check.expectDialog || hasDialog(result, check.expectDialog)));
            const detail = exerciseDetail(result, check);
            if (pass) return { pass, variant: variant.name, detail: (variant.name === "default" ? "" : variant.name + ": ") + detail };
            details.push(variant.name + ": " + detail);
        } finally {
            await releaseWorkspaceLock(ctx);
        }
    }
    return { pass: false, detail: details.join(" | ") };
}

function runValidateCheck(workspaceDir, check) {
    const { validateWorkspace } = require("../src/core/validate");
    const lint = validateWorkspace(workspaceDir);
    const maxErrors = Number.isInteger(check.maxErrors) ? check.maxErrors : 0;
    const firstError = (lint.findings || []).find(finding => finding && finding.severity === "error");
    const detail = lint.errors + " error(s), " + lint.warnings + " warning(s) (max " +
        maxErrors + ")" + (firstError && firstError.message ? "; first: " + firstError.message : "");
    return { pass: lint.errors <= maxErrors, detail };
}

async function runTestCheck(check, oracleWorkflow, getContext) {
    const ctx = await getContext();
    try {
        const { runTest } = require("../src/core/test");
        const result = await runTest(ctx.session, ctx.record.palGuid, {
            kind: check.workflow || oracleWorkflow
        });
        if (result.ran !== true) {
            return { pass: false, detail: "did not run: " + (result.blocked || "unknown") };
        }
        const notes = Array.isArray(result.validation) ? result.validation.length : 0;
        const maxNotes = Number.isInteger(check.maxNotes) ? check.maxNotes : 0;
        const verdict = result.validated ? "VALIDATED" : "NOT VALIDATED";
        return {
            pass: result.validated === true && notes <= maxNotes,
            detail: verdict + ", " + notes + " note(s) (max " + maxNotes + ")"
        };
    } finally {
        await releaseWorkspaceLock(ctx);
    }
}

async function releaseWorkspaceLock(ctx) {
    try { await require("../src/core/lock").releaseByGuid(ctx.session, ctx.record.palGuid); }
    catch (error) { /* the next scoring run re-acquires; never fail a score on lock release */ }
}

// Tool evidence stores successful pushes only. The usage tally records call/error counts but a
// refused push returns normally, so it is not marked errored. failedPushes is therefore null.
function readPushCounts(workspaceDir) {
    const notes = [];
    let pushes = null;
    let usageCalls = null;
    const evidenceFile = path.join(workspaceDir, ".palsync", "tool-evidence.jsonl");
    try {
        if (fs.existsSync(evidenceFile)) {
            const { readToolEvidence } = require("../src/core/usage");
            pushes = readToolEvidence(workspaceDir)
                .filter(entry => entry && entry.tool === "pal_push" && entry.successful === true)
                .length;
        }
    } catch (error) {
        notes.push("tool evidence unreadable: " + errorMessage(error));
    }
    const usage = readJsonSafe(path.join(workspaceDir, ".palsync.usage.json"));
    const calls = usage && usage.tools && usage.tools.pal_push && usage.tools.pal_push.calls;
    if (calls !== undefined && calls !== null && Number.isFinite(Number(calls))) usageCalls = Number(calls);
    if (pushes === null && usageCalls !== null) {
        notes.push("pushes unknown: .palsync.usage.json records " + usageCalls +
            " pal_push call(s) but not how many succeeded");
    }
    if (pushes !== null && usageCalls !== null && usageCalls > pushes) {
        notes.push("usage tallied " + usageCalls + " pal_push call(s); " + pushes +
            " successful push(es) have evidence (refused pushes are not recorded individually)");
    }
    notes.push("failedPushes is null: neither tool evidence nor .palsync.usage.json records a " +
        "failed/refused push as such (evidence rows are successful pushes only; the usage tally " +
        "marks only thrown tool errors).");
    return { pushes, failedPushes: null, notes };
}

async function buildRow({ workspaceDir, arm, trial, visual, oracle, dryRun }) {
    const notes = [];
    const runMeta = readJsonSafe(path.join(workspaceDir, ".eval", "run-meta.json"));
    const claudeResult = readJsonSafe(path.join(workspaceDir, ".eval", "claude-result.json"));
    if (!claudeResult) {
        notes.push("no .eval/claude-result.json: claimedDone=false and cost fields are null");
    }
    const resultFields = claudeResultFields(claudeResult);
    const model = (runMeta && runMeta.model) || firstModel(claudeResult) || null;
    if (!runMeta) notes.push("no .eval/run-meta.json: palsyncCommit and model are null");
    if (dryRun) notes.push("dry-run: exercise and test checks skipped; row not appended");

    let contextPromise = null;
    const getContext = () => {
        if (!contextPromise) {
            const { buildContext } = require("../src/mcp/context");
            contextPromise = buildContext(workspaceDir, {
                acquireLock: false,
                log: message => process.stderr.write("[palsync] " + message + "\n")
            });
        }
        return contextPromise;
    };

    const checks = [];
    for (const check of oracle.checks || []) {
        let outcome;
        try {
            if (check.kind === "exercise") {
                outcome = dryRun
                    ? { pass: null, detail: "skipped (dry-run; needs the server)" }
                    : await runExerciseCheck(workspaceDir, check, oracle.workflow, getContext);
            } else if (check.kind === "source-contains") {
                const found = sourceContains(workspaceDir, check.text);
                outcome = {
                    pass: !!found,
                    detail: found ? "found in " + found : "text not found in pal source"
                };
            } else if (check.kind === "validate") {
                outcome = runValidateCheck(workspaceDir, check);
            } else if (check.kind === "test") {
                outcome = dryRun
                    ? { pass: null, detail: "skipped (dry-run; needs the server)" }
                    : await runTestCheck(check, oracle.workflow, getContext);
            } else if (check.kind === "human") {
                outcome = {
                    pass: null,
                    detail: "not run; scored by hand" + (visual === null ? "" : " (visual " + visual + ")")
                };
            } else {
                notes.push("unknown check kind " + JSON.stringify(check.kind) + " for " + check.id);
                outcome = { pass: null, detail: "unknown kind: " + check.kind };
            }
        } catch (error) {
            outcome = { pass: false, detail: check.kind + " error: " + errorMessage(error) };
            notes.push(check.id + ": " + errorMessage(error));
        }
        checks.push({ id: check.id, goal: check.goal, pass: outcome.pass, detail: outcome.detail });
    }

    const scored = checks.filter((_, index) => oracle.checks[index].kind !== "human");
    const oracleTotal = scored.length;
    const oraclePassed = scored.filter(check => check.pass === true).length;
    const pushCounts = readPushCounts(workspaceDir);
    notes.push(...pushCounts.notes);

    return {
        schema: ROW_SCHEMA,
        recordedAt: new Date().toISOString(),
        folder: path.basename(workspaceDir),
        arm,
        trial,
        palsyncCommit: (runMeta && runMeta.palsyncCommit) || null,
        model,
        checks,
        oraclePassed,
        oracleTotal,
        visual,
        claimedDone: resultFields.claimedDone,
        falseDone: falseDone(resultFields.claimedDone, oraclePassed, oracleTotal),
        costUsd: resultFields.costUsd,
        durationMs: resultFields.durationMs,
        numTurns: resultFields.numTurns,
        pushes: pushCounts.pushes,
        failedPushes: pushCounts.failedPushes,
        notes
    };
}

function firstModel(result) {
    if (!result || !result.modelUsage || typeof result.modelUsage !== "object") return null;
    const keys = Object.keys(result.modelUsage);
    return keys.length ? keys[0] : null;
}

function printSummary(row, dryRun) {
    console.log(row.folder + "  arm " + row.arm + "  trial " + row.trial);
    console.log("  oracle: " + row.oraclePassed + "/" + row.oracleTotal +
        " (human excluded)" + (row.visual === null ? "" : "  visual: " + row.visual));
    console.log("  claimedDone: " + row.claimedDone + "  falseDone: " + row.falseDone);
    console.log("  costUsd: " + row.costUsd + "  durationMs: " + row.durationMs +
        "  numTurns: " + row.numTurns);
    console.log("  pushes: " + row.pushes + "  failedPushes: " + row.failedPushes);
    for (const check of row.checks) {
        const status = check.pass === null ? "SKIP" : (check.pass ? "PASS" : "FAIL");
        console.log("  " + status + " " + check.id + " - " + check.detail);
    }
    if (dryRun) console.log("dry-run: row not appended");
    else console.log("appended " + SCORES_FILE);
}

async function main(argv) {
    const flags = parseArgs(argv);
    let stat;
    try { stat = fs.statSync(flags.dir); }
    catch (error) { throw new Error("--dir does not exist: " + flags.dir); }
    if (!stat.isDirectory()) throw new Error("--dir is not a directory: " + flags.dir);
    const oracle = JSON.parse(fs.readFileSync(flags.oracle, "utf8"));
    if (!Array.isArray(oracle.checks) || !oracle.checks.length) {
        throw new Error("oracle has no checks: " + flags.oracle);
    }
    const row = await buildRow({
        workspaceDir: flags.dir,
        arm: flags.arm,
        trial: flags.trial,
        visual: flags.visual,
        oracle,
        dryRun: flags.dryRun
    });
    if (!flags.dryRun) {
        fs.mkdirSync(path.dirname(SCORES_FILE), { recursive: true });
        fs.appendFileSync(SCORES_FILE, JSON.stringify(row) + "\n", "utf8");
    }
    printSummary(row, flags.dryRun);
}

if (require.main === module) {
    main(process.argv.slice(2)).catch(error => {
        process.stderr.write("score-goal-eval: " + errorMessage(error) + "\n");
        process.exitCode = 1;
    });
}

module.exports = {
    ROW_SCHEMA,
    checkVariants,
    claimedDone,
    falseDone,
    listSourceFiles,
    sourceContains,
    claudeResultFields,
    exerciseDialogs,
    hasDialog,
    exerciseDetail,
    buildRow
};
