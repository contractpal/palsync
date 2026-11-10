"use strict";
// Offline checks for the goal-only eval: the hidden oracle must be valid exercise steps, and the
// scorer's pure helpers must behave. No server, no credentials, no workspace setup.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { validateSteps, validateInitial, lintSteps } = require("../src/core/exercise");
const {
    claimedDone, falseDone, sourceContains, claudeResultFields, exerciseDialogs, hasDialog
} = require("../scripts/score-goal-eval");
const { tmpWorkspace } = require("./helpers");

const ORACLE_FILE = path.join(__dirname, "..", "eval", "goal", "01_equipment_checkout", "oracle.json");
const CHECK_KINDS = new Set(["exercise", "source-contains", "validate", "test", "human"]);

function readOracle() {
    return JSON.parse(fs.readFileSync(ORACLE_FILE, "utf8"));
}

test("oracle.json parses and every exercise check passes step validation", () => {
    const oracle = readOracle();
    assert.equal(oracle.schema, "palsync/goal-oracle/1");
    assert.ok(Array.isArray(oracle.checks) && oracle.checks.length > 0, "oracle has checks");
    const seen = new Set();
    for (const check of oracle.checks) {
        assert.ok(typeof check.id === "string" && check.id, "every check has an id");
        assert.ok(!seen.has(check.id), "duplicate check id " + check.id);
        seen.add(check.id);
        assert.ok(Number.isInteger(check.goal), check.id + " has an integer goal");
        assert.ok(CHECK_KINDS.has(check.kind), check.id + " has a known kind");
        if (check.kind !== "exercise") continue;
        assert.ok(Array.isArray(check.steps) && check.steps.length > 0, check.id + " has steps");
        assert.deepEqual(validateSteps(check.steps), [], check.id + " steps must be valid");
        if (check.initial !== undefined) {
            assert.deepEqual(validateInitial(check.initial), [], check.id + " initial must be valid");
        }
    }
});

test("oracle exercise checks pass the absent/expect misuse rule", () => {
    // An absent value that is a substring of an expected or filled value can never disappear.
    // runExercise treats this lint error as invalid steps, so the oracle must not contain one.
    for (const check of readOracle().checks) {
        if (check.kind !== "exercise") continue;
        const errors = lintSteps(check.steps).errors
            .filter(message => /absent value .* is a substring/.test(message));
        assert.deepEqual(errors, [], check.id + " must not assert an impossible absence");
    }
});

test("oracle exercise checks carry no preflight lint errors", () => {
    // runExercise refuses steps with lint errors before it opens a browser, so an oracle check
    // with one could never pass, whatever the build.
    for (const check of readOracle().checks) {
        if (check.kind !== "exercise") continue;
        assert.deepEqual(lintSteps(check.steps).errors, [], check.id + " must have no preflight lint error");
    }
});

test("claimedDone reads the last non-empty RESULT line", () => {
    assert.equal(claimedDone("working...\nRESULT: DONE"), true);
    assert.equal(claimedDone("RESULT: DONE\r\n\r\n"), true);
    assert.equal(claimedDone("  RESULT: DONE  "), true);
    assert.equal(claimedDone("RESULT: DONE\nRESULT: BLOCKED - no credentials"), false);
    assert.equal(claimedDone("RESULT: BLOCKED - no credentials"), false);
    assert.equal(claimedDone("there is no result line"), false);
    assert.equal(claimedDone(""), false);
    assert.equal(claimedDone(null), false);
    assert.equal(claimedDone(undefined), false);
});

test("falseDone is true only for a DONE claim with a failed oracle check", () => {
    assert.equal(falseDone(true, 9, 10), true);
    assert.equal(falseDone(true, 10, 10), false);
    assert.equal(falseDone(false, 0, 10), false);
    assert.equal(falseDone(null, 0, 10), false);
    assert.equal(falseDone(true, 0, 0), false);
});

test("claudeResultFields tolerates absent cost fields", () => {
    const full = claudeResultFields({
        result: "done\nRESULT: DONE",
        total_cost_usd: 1.25,
        duration_ms: 1234,
        num_turns: 7
    });
    assert.deepEqual(full, { claimedDone: true, costUsd: 1.25, durationMs: 1234, numTurns: 7 });

    const missing = claudeResultFields({ result: "RESULT: BLOCKED - no creds" });
    assert.deepEqual(missing, { claimedDone: false, costUsd: null, durationMs: null, numTurns: null });
    assert.deepEqual(claudeResultFields(null),
        { claimedDone: false, costUsd: null, durationMs: null, numTurns: null });
});

test("exercise dialog helpers read accepted dialogs from step results", () => {
    const result = {
        steps: [
            { step: 1, pass: true },
            { step: 2, pass: true, dialogs: ["confirm: Delete this item? This cannot be undone."] }
        ]
    };
    assert.deepEqual(exerciseDialogs(result), ["confirm: Delete this item? This cannot be undone."]);
    assert.equal(hasDialog(result, "Delete this item? This cannot be undone."), true);
    assert.equal(hasDialog(result, "some other dialog"), false);
    assert.deepEqual(exerciseDialogs(null), []);
});

test("sourceContains reads pal source and skips docs, dot dirs, and node_modules", () => {
    const text = "No equipment yet. Add your first item to get started.";
    const ws = tmpWorkspace({
        "workflows/console.js": "var empty = \"" + text + "\";\n",
        "GOAL.md": text,
        "NOTES.md": text,
        ".eval/claude-result.json": JSON.stringify({ result: text }),
        ".palsync/tool-evidence.jsonl": text,
        "node_modules/pkg/index.js": text,
        "plans/PLAN.md": "quoted only in a model-written plan"
    });
    try {
        assert.equal(sourceContains(ws, text), "workflows/console.js");
        assert.equal(sourceContains(ws, "text that exists only in GOAL.md"), null);
        assert.equal(sourceContains(ws, ""), null);
        assert.equal(sourceContains(ws, "quoted only in a model-written plan"), null);
    } finally {
        fs.rmSync(ws, { recursive: true, force: true });
    }
});
