"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const pilot = require("../eval/impact/pilot.json");
const { checkPilot, exitCode } = require("../scripts/check-impact-pilot");

const ROWS_FILE = path.join(__dirname, "fixtures", "impact-pilot-pass.jsonl");
const BENCHMARK_FILE = path.join(__dirname, "fixtures", "impact-benchmark-pass.json");
const CHECKER = path.join(__dirname, "..", "scripts", "check-impact-pilot.js");

function rows() {
    return fs.readFileSync(ROWS_FILE, "utf8").trim().split("\n").map(JSON.parse);
}

function benchmark() {
    return JSON.parse(fs.readFileSync(BENCHMARK_FILE, "utf8"));
}

function check(mutator, benchmarkMutator) {
    const input = rows();
    const bench = benchmark();
    if (mutator) mutator(input);
    if (benchmarkMutator) benchmarkMutator(bench);
    return checkPilot(input, bench, structuredClone(pilot));
}

function named(result, id) {
    const value = result.checks.find(item => item.id === id);
    assert.ok(value, id);
    return value;
}

function treatments(input) {
    return input.filter(row => row.experiment.variant === "on");
}

function controls(input) {
    return input.filter(row => row.experiment.variant === "off");
}

function setPrimary(row, value) {
    row.experiment.trajectory.readsBeforeFirstCorrectWrite = value;
    row.experiment.trajectory.searchesBeforeFirstCorrectWrite = 0;
    row.experiment.primaryExplorationActions = value;
}

function setNonAdopted(row) {
    row.experiment.trajectory.targetCalls = 0;
    row.experiment.trajectory.targetBeforeFirstEdit = false;
    row.experiment.trajectory.impactResponseBytes = null;
}

test("1. all-pass fixture returns pass and CLI exits 0", () => {
    const result = check();
    assert.strictEqual(result.status, "pass");
    assert.strictEqual(exitCode(result), 0);
    assert.strictEqual(result.pairs, 6);
    assert.strictEqual(result.runs, 12);
    const cli = childProcess.spawnSync(process.execPath, [
        CHECKER, "--input", ROWS_FILE, "--benchmark", BENCHMARK_FILE, "--json",
    ], { encoding: "utf8" });
    assert.strictEqual(cli.status, 0, cli.stderr);
    assert.strictEqual(JSON.parse(cli.stdout).status, "pass");
});

test("2. three of six adoptions fail", () => {
    const result = check(input => treatments(input).slice(3).forEach(setNonAdopted));
    assert.strictEqual(named(result, "adoption").status, "fail");
    assert.strictEqual(named(result, "adoption").actual, 3);
    assert.strictEqual(result.status, "fail");
    assert.strictEqual(exitCode(result), 1);
});

test("3. four of six exact-one-call adoptions pass", () => {
    const result = check(input => treatments(input).slice(4).forEach(setNonAdopted));
    assert.strictEqual(named(result, "adoption").status, "pass");
    assert.strictEqual(named(result, "adoption").actual, 4);
});

test("4. two target calls are non-adoption rather than discarded evidence", () => {
    const result = check(input => {
        const row = treatments(input)[0];
        row.experiment.trajectory.targetCalls = 2;
    });
    assert.strictEqual(named(result, "adoption").status, "pass");
    assert.strictEqual(named(result, "adoption").actual, 4);
    assert.notStrictEqual(result.status, "incomplete");
});

test("5. exactly twenty percent median primary reduction passes", () => {
    const result = check();
    assert.strictEqual(named(result, "primary-median-reduction").status, "pass");
    assert.strictEqual(named(result, "primary-median-reduction").actual, 0.2);
    assert.deepStrictEqual(result.medians.primaryExplorationActions, { control: 10, treatment: 8 });
});

test("6. primary median and matched-pair win thresholds both fail below their boundary", async t => {
    await t.test("nineteen-point-nine-nine percent median reduction", () => {
        const result = check(input => {
            controls(input).forEach(row => setPrimary(row, 10000));
            treatments(input).forEach(row => setPrimary(row, 8001));
        });
        assert.strictEqual(named(result, "primary-median-reduction").status, "fail");
        assert.strictEqual(named(result, "primary-median-reduction").actual, 0.1999);
    });
    await t.test("only three matched treatment wins", () => {
        const result = check(input => treatments(input).slice(3).forEach(row => setPrimary(row, 10)));
        assert.strictEqual(named(result, "primary-pair-wins").status, "fail");
        assert.strictEqual(named(result, "primary-pair-wins").actual, 3);
    });
});

test("7. zero control primary median is incomplete", () => {
    const result = check(input => input.forEach(row => setPrimary(row, 0)));
    assert.strictEqual(named(result, "primary-median-reduction").status, "incomplete");
    assert.strictEqual(result.status, "incomplete");
    assert.strictEqual(exitCode(result), 2);
});

test("8. invalid score ranges and mismatched pair denominators are incomplete", async t => {
    for (const [label, mutate] of [
        ["zero denominator", input => { input[0].score12 = "10/0"; }],
        ["numerator above denominator", input => { input[0].score12 = "11/10"; }],
        ["mismatched denominators", input => { treatments(input)[0].score12 = "10/11"; }],
    ]) await t.test(label, () => {
        const result = check(mutate);
        assert.strictEqual(named(result, "score-non-regression").status, "incomplete");
        assert.strictEqual(result.status, "incomplete");
    });
    await t.test("lower treatment numerator is a complete threshold failure", () => {
        const result = check(input => { treatments(input)[0].score12 = "9/10"; });
        assert.strictEqual(named(result, "score-non-regression").status, "fail");
        assert.strictEqual(result.status, "fail");
    });
});

test("9. treatment outside writes or hard-rule violations fail safety", async t => {
    for (const field of ["writesOutsideOracle", "hardRuleViolations"]) await t.test(field, () => {
        const result = check(input => { treatments(input)[0].experiment.trajectory[field] = 1; });
        assert.strictEqual(named(result, "write-safety").status, "fail");
    });
});

test("10. each call-family threshold fails independently", async t => {
    for (const [field, id] of [["mcp", "mcp-non-inferiority"], ["read", "read-non-inferiority"], ["other", "other-non-inferiority"]]) {
        await t.test(field, () => {
            const result = check(input => treatments(input).forEach(row => { row.experiment.trajectory.calls[field] = 12; }));
            assert.strictEqual(named(result, id).status, "fail");
        });
    }
    await t.test("failed loops with nonzero control", () => {
        const result = check(input => {
            controls(input).forEach(row => { row.experiment.trajectory.failedVerificationLoops = 10; });
            treatments(input).forEach(row => { row.experiment.trajectory.failedVerificationLoops = 12; });
        });
        assert.strictEqual(named(result, "failed-loop-non-inferiority").status, "fail");
    });
});

test("11. zero-control non-inferiority requires treatment zero", () => {
    const result = check(input => {
        controls(input).forEach(row => { row.experiment.trajectory.calls.mcp = 0; });
        treatments(input).forEach(row => { row.experiment.trajectory.calls.mcp = 1; });
    });
    assert.strictEqual(named(result, "mcp-non-inferiority").status, "fail");
    assert.match(named(result, "mcp-non-inferiority").required, /treatment median = 0/);
});

test("12. push and wall-time fifteen-percent boundaries are inclusive", async t => {
    for (const [field, id, control, passing, failing] of [
        ["pushes", "push-non-inferiority", 20, 23, 24],
        ["wallTimeMs", "wall-time-non-inferiority", 1000, 1150, 1151],
    ]) await t.test(field, () => {
        const pass = check(input => {
            controls(input).forEach(row => { row.experiment.trajectory[field] = control; });
            treatments(input).forEach(row => { row.experiment.trajectory[field] = passing; });
        });
        assert.strictEqual(named(pass, id).status, "pass");
        const fail = check(input => {
            controls(input).forEach(row => { row.experiment.trajectory[field] = control; });
            treatments(input).forEach(row => { row.experiment.trajectory[field] = failing; });
        });
        assert.strictEqual(named(fail, id).status, "fail");
    });
});

test("13. null model-token evidence is incomplete", () => {
    const result = check(input => { treatments(input)[0].modelUsage = null; });
    assert.strictEqual(named(result, "model-token-non-inferiority").status, "incomplete");
    assert.strictEqual(result.status, "incomplete");
});

test("14. cached tokens are ignored and model-token ten-percent boundary is inclusive", async t => {
    await t.test("cached tokens have no separate gate", () => {
        const result = check(input => input.forEach(row => { row.modelUsage.tokensCached = 999999999; }));
        assert.strictEqual(named(result, "model-token-non-inferiority").status, "pass");
        assert.strictEqual(result.status, "pass");
    });
    await t.test("total tokens pass at ten percent and fail above", () => {
        const pass = check(input => treatments(input).forEach(row => { row.modelUsage.totalTokens = 110; }));
        assert.strictEqual(named(pass, "model-token-non-inferiority").status, "pass");
        const fail = check(input => treatments(input).forEach(row => { row.modelUsage.totalTokens = 111; }));
        assert.strictEqual(named(fail, "model-token-non-inferiority").status, "fail");
    });
});

test("15. mismatched pair or global pins are incomplete", async t => {
    for (const [label, mutate] of [
        ["model", input => { treatments(input)[0].model = "other-model"; }],
        ["fixture files", input => { treatments(input)[0].experiment.fixtureFiles["pal.json"] = "f".repeat(64); }],
        ["skills", input => { treatments(input)[0].experiment.orchSkills = "other@def5678"; }],
    ]) await t.test(label, () => {
        const result = check(mutate);
        assert.strictEqual(named(result, "evidence-completeness").status, "incomplete");
        assert.strictEqual(result.status, "incomplete");
    });
});

test("16. duplicate or missing arms are incomplete", async t => {
    await t.test("missing", () => {
        const result = check(input => { input.pop(); });
        assert.strictEqual(result.status, "incomplete");
    });
    await t.test("duplicate", () => {
        const result = check(input => {
            const on = input.findIndex(row => row.experiment.variant === "on");
            input[on] = structuredClone(input[on - 1]);
        });
        assert.strictEqual(result.status, "incomplete");
    });
});

test("17. a wrong pilot pair schedule is incomplete", () => {
    const result = check(input => { input[0].experiment.pair = "unexpected-pair"; });
    assert.strictEqual(named(result, "evidence-completeness").status, "incomplete");
    assert.strictEqual(result.status, "incomplete");
});

test("18. treatment acceptance or regression failure fails completion", async t => {
    for (const field of ["acceptance", "regression"]) await t.test(field, () => {
        const result = check(input => { treatments(input)[0].experiment.trajectory[field] = "fail"; });
        assert.strictEqual(named(result, "treatment-completion").status, "fail");
    });
});

// A stale regression is an absent verdict, not a failure. pal_regression refuses to compare once
// the server marker moves, so an arm whose agent pushed first genuinely has nothing to report. It
// must not fail completion (nothing regressed) and must not vanish (nothing was checked) — coverage
// carries the unchecked population so a pilot cannot read green while most arms went unverified.
test("18b. a stale regression withholds a verdict without failing completion", async t => {
    await t.test("completion still passes", () => {
        const result = check(input => { treatments(input)[0].experiment.trajectory.regression = "stale"; });
        assert.strictEqual(named(result, "treatment-completion").status, "pass");
    });
    await t.test("coverage reports it and goes incomplete", () => {
        const result = check(input => { treatments(input)[0].experiment.trajectory.regression = "stale"; });
        const coverage = named(result, "regression-coverage");
        assert.strictEqual(coverage.status, "incomplete");
        assert.deepEqual(coverage.actual, { verdicts: 11, stale: 1, of: 12 });
    });
    await t.test("a clean pilot reports full coverage", () => {
        assert.strictEqual(named(check(), "regression-coverage").status, "pass");
        assert.deepEqual(named(check(), "regression-coverage").actual, { verdicts: 12, stale: 0, of: 12 });
    });
    await t.test("an outright regression failure still fails completion", () => {
        const result = check(input => { treatments(input)[0].experiment.trajectory.regression = "fail"; });
        assert.strictEqual(named(result, "treatment-completion").status, "fail");
    });
});

test("19. any false exact reference fails", () => {
    const result = check(input => { treatments(input)[0].experiment.trajectory.falseExactReferences = 1; });
    assert.strictEqual(named(result, "false-exact-references").status, "fail");
});

test("20. adopted response bytes pass at 4096 and fail at 4097", () => {
    const pass = check(input => treatments(input).filter(row => row.experiment.trajectory.targetCalls === 1)
        .forEach(row => { row.experiment.trajectory.impactResponseBytes = 4096; }));
    assert.strictEqual(named(pass, "response-budget").status, "pass");
    const fail = check(input => { treatments(input)[0].experiment.trajectory.impactResponseBytes = 4097; });
    assert.strictEqual(named(fail, "response-budget").status, "fail");
});

test("21. adopted null or non-integer response evidence is incomplete", async t => {
    for (const value of [null, 1.5]) await t.test(String(value), () => {
        const result = check(input => { treatments(input)[0].experiment.trajectory.impactResponseBytes = value; });
        assert.strictEqual(named(result, "response-budget").status, "incomplete");
        assert.strictEqual(result.status, "incomplete");
    });
});

test("22. benchmark facts and p95 boundary are exact", async t => {
    const atBoundary = check();
    assert.strictEqual(named(atBoundary, "benchmark-p95").status, "pass");
    const over = check(null, value => { value.p95Ms = 100.001; });
    assert.strictEqual(named(over, "benchmark-p95").status, "fail");
    await t.test("invalid facts", () => {
        const result = check(null, value => { value.factCounts.dependents = 99; });
        assert.strictEqual(named(result, "benchmark-input").status, "incomplete");
        assert.strictEqual(result.status, "incomplete");
    });
    await t.test("byte budget failure", () => {
        const result = check(null, value => { value.withinByteBudget = false; });
        assert.strictEqual(named(result, "benchmark-byte-budget").status, "fail");
    });
});

test("23. checker output is byte-identical in-process and across CLI invocations", () => {
    const first = JSON.stringify(check(), null, 2) + "\n";
    const second = JSON.stringify(check(), null, 2) + "\n";
    assert.strictEqual(second, first);
    const args = [CHECKER, "--input", ROWS_FILE, "--benchmark", BENCHMARK_FILE, "--json"];
    const firstCli = childProcess.spawnSync(process.execPath, args, { encoding: "utf8" });
    const secondCli = childProcess.spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.strictEqual(firstCli.status, 0, firstCli.stderr);
    assert.strictEqual(secondCli.status, 0, secondCli.stderr);
    assert.strictEqual(secondCli.stdout, firstCli.stdout);
});

// Arms recorded across a fix cannot share a repo HEAD: every between-arm commit in the real pilot
// was scoring-only (record-eval, the trajectory extractor, this checker), none of which ships in the
// installed harness the arm runs. Pinning `sha` made the pilot unfinishable. What must stay constant
// is the harness, and orchSkills/palbuilderSkills pin that — so those two must still hard-fail.
test("24. rows recorded at different repo shas still complete; harness pins still bind", async t => {
    await t.test("differing sha across all rows is not an error", () => {
        const result = check(input => {
            input.forEach((row, index) => { row.sha = "abcdef" + index; });
        });
        assert.strictEqual(named(result, "evidence-completeness").status, "pass");
        assert.strictEqual(result.status, "pass");
    });

    await t.test("differing sha within one pair is not an error", () => {
        const result = check(input => { input[0].sha = "0000000"; });
        assert.strictEqual(named(result, "evidence-completeness").status, "pass");
    });

    await t.test("sha is still required on every row", () => {
        const result = check(input => { input[0].sha = ""; });
        assert.strictEqual(named(result, "evidence-completeness").status, "incomplete");
    });

    for (const field of ["orchSkills", "palbuilderSkills"]) {
        await t.test("differing " + field + " is still incomplete", () => {
            const result = check(input => { input[0].experiment[field] = "main@0000000"; });
            assert.strictEqual(named(result, "evidence-completeness").status, "incomplete");
        });
    }
});
