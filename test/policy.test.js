"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const policy = require("../src/core/policy");
const bench = require("../bench/verification-cost");

function reader(values) {
    return (key, fallback) => (values[key] !== undefined ? values[key] : fallback);
}

test("defaults are standard + ask, and older or broken configs fall back per key", () => {
    assert.deepEqual(policy.resolve(reader({}), {}), { verification: "standard", review: "ask" });
    assert.deepEqual(policy.resolve(reader({ review: "off" }), {}), { verification: "standard", review: "off" });
    // A config written by an older build (unknown values, wrong types) must not break a session.
    assert.deepEqual(policy.resolve(reader({ verification: "paranoid", review: 7 }), {}),
        { verification: "standard", review: "ask" });
    assert.equal(policy.summaryLine({ verification: "standard", review: "ask" }),
        "PalSync: Standard checks · Final review: Ask");
});

test("settings persist to ~/.palsync/config.json and survive a reload", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-home-"));
    const realHome = process.env.HOME;
    process.env.HOME = home;
    delete require.cache[require.resolve("../src/platform/config")];
    const config = require("../src/platform/config");
    try {
        policy.set("verification", "thorough", config.set);
        policy.set("review", "auto", config.set);
        const file = path.join(home, ".palsync", "config.json");
        assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { verification: "thorough", review: "auto" });
        assert.deepEqual(policy.resolve(config.get, {}), { verification: "thorough", review: "auto" });
        assert.throws(() => policy.set("verification", "turbo", config.set), /Invalid verification/);
        assert.throws(() => policy.set("speed", "fast", config.set), /Unknown setting/);
    } finally {
        process.env.HOME = realHome;
        delete require.cache[require.resolve("../src/platform/config")];
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test("an env override beats the saved preference", () => {
    const saved = reader({ verification: "fast", review: "off" });
    assert.deepEqual(policy.resolve(saved, { PALSYNC_VERIFICATION: "thorough", PALSYNC_REVIEW: "auto" }),
        { verification: "thorough", review: "auto" });
});

test("risk comes from deterministic facts, not judgment", () => {
    const css = policy.classifyChange({ paths: ["styles/styles.css"], dependents: null });
    assert.equal(css.level, "low");
    assert.equal(css.surface, true);
    assert.equal(css.behavior, false);

    assert.equal(policy.classifyChange({ paths: ["fragments/card.html"], dependents: 0 }).level, "low");
    assert.equal(policy.classifyChange({ paths: ["fragments/card.html"], dependents: 2 }).level, "medium");
    assert.equal(policy.classifyChange({ paths: ["workflows/web.js"], dependents: null }).level, "medium");

    const shared = policy.classifyChange({ paths: ["fragments/nav.html"], dependents: 6 });
    assert.equal(shared.level, "high");
    assert.match(shared.reasons.join(" "), /used in 6 places/);

    assert.equal(policy.classifyChange({ paths: ["datasets/orders.json"], datasetChange: true }).level, "high");
    assert.equal(policy.classifyChange({ paths: Array.from({ length: 8 }, (_, i) => "styles/" + i + ".css") }).level,
        "high", "the documented 8-file boundary is high risk");
    const tunnel = policy.classifyChange({
        paths: ["workflows/bridge.js"],
        manifest: { workflows: { entry: [{ string: "bridge.js", Workflow: { workflowType: 15 } }] } }
    });
    assert.equal(tunnel.level, "high");
});

const surfaceOnly = { surface: true, behavior: false };
const ran = (plan, id) => plan.steps.find(s => s.id === id).run;

test("fast keeps the static safeguards and skips every expensive check", () => {
    const plan = policy.plan(Object.assign({ verification: "fast", risk: "high", hasBaseline: true, publicWeb: true },
        { surface: true, behavior: true }));
    assert.equal(ran(plan, "static"), true, "static validation is never skipped");
    assert.equal(ran(plan, "push"), true, "the push gate is never skipped");
    for (const id of ["compile", "render", "render-mobile", "behavior", "regression", "seo"]) {
        assert.equal(ran(plan, id), false, id + " must not run in Fast mode");
    }
});

test("standard low-risk UI work gets one render and nothing else", () => {
    const plan = policy.plan(Object.assign({ verification: "standard", risk: "low", hasBaseline: true }, surfaceOnly));
    assert.equal(ran(plan, "render"), true);
    for (const id of ["render-mobile", "behavior", "regression"]) {
        assert.equal(ran(plan, id), false, id + " must not run for an isolated presentation change");
    }
    const skipped = plan.steps.find(s => s.id === "regression");
    assert.match(skipped.why, /only affects what you edited/, "the skip is explained in plain language");
});

test("standard escalates with the blast radius", () => {
    const medium = policy.plan({ verification: "standard", risk: "medium", surface: true, behavior: true, hasBaseline: true });
    assert.equal(ran(medium, "compile"), false, "the exercise already starts with a fresh server compile");
    assert.match(medium.steps.find(s => s.id === "compile").why, /separate compile call is not needed/);
    assert.equal(ran(medium, "behavior"), true, "the behavior that changed is tested");
    assert.equal(ran(medium, "regression"), false, "one workflow is not the whole app");

    const high = policy.plan({ verification: "standard", risk: "high", surface: true, behavior: true, hasBaseline: true });
    assert.equal(ran(high, "regression"), true);
    assert.match(high.steps.find(s => s.id === "regression").why, /reaches beyond the file you edited/);

    const noBaseline = policy.plan({ verification: "standard", risk: "high", surface: true, behavior: true });
    assert.equal(ran(noBaseline, "regression"), false, "no baseline means regression cannot apply");
});

test("thorough keeps broad verification without duplicating the exercise compile", () => {
    const plan = policy.plan(Object.assign({ verification: "thorough", risk: "low", hasBaseline: true, publicWeb: true },
        { surface: true, behavior: true }));
    assert.equal(ran(plan, "compile"), false, "the behavior exercise includes compile proof");
    for (const id of ["render", "render-mobile", "behavior", "regression", "seo"]) {
        assert.equal(ran(plan, id), true, id + " must run in Thorough mode");
    }
});

test("an SEO audit is a Thorough-only automatic step", () => {
    const publicVisual = { surface: true, behavior: false, publicWeb: true, risk: "low" };
    assert.equal(ran(policy.plan(Object.assign({ verification: "fast" }, publicVisual)), "seo"), false,
        "Fast never audits SEO");
    const standard = policy.plan(Object.assign({ verification: "standard" }, publicVisual));
    assert.equal(ran(standard, "seo"), false,
        "a padding/layout change on a public page is not an SEO change");
    assert.match(standard.steps.find(s => s.id === "seo").why, /ask for it by name/);
    // Blast radius does not make a presentation edit SEO-relevant either.
    assert.equal(ran(policy.plan({ verification: "standard", risk: "high", surface: true, behavior: true, publicWeb: true }), "seo"),
        false);
    assert.equal(ran(policy.plan(Object.assign({ verification: "thorough" }, publicVisual)), "seo"), true,
        "Thorough still audits an applicable public page");
    assert.equal(ran(policy.plan({ verification: "thorough", surface: true, publicWeb: false }), "seo"), false,
        "a non-public pal is never audited");
});

test("the rendered plan explains the review setting without jargon", () => {
    const change = policy.classifyChange({ paths: ["styles/styles.css"] });
    const plan = policy.plan({ verification: "standard", risk: change.level, surface: change.surface });
    for (const [review, expected] of [["off", /not run: your review setting is Off/],
        ["ask", /offered when the work is done/], ["auto", /runs once at the end/]]) {
        const text = policy.formatPlan({ risk: change.level, reasons: change.reasons, plan },
            { verification: "standard", review });
        assert.match(text, expected);
        assert.doesNotMatch(text, /fanout|strategy level|policy engine/i, "no internal jargon in user-facing text");
    }
});

test("benchmark: standard is materially cheaper than the legacy ladder", () => {
    const result = bench.run();
    const low = result.summary.lowRiskStandard;
    assert.ok(low.callReductionPct >= 50, "low-risk required actions must drop by >=50% (got " + low.callReductionPct + "%)");
    assert.ok(low.qaReductionPct >= 70, "low-risk remote QA actions must drop by >=70% (got " + low.qaReductionPct + "%)");
    const expected = {
        "button-padding": [9, 2, 3, 4],
        "static-copy": [9, 2, 3, 4],
        "responsive-card": [9, 2, 3, 4],
        "form-interaction": [11, 2, 4, 5],
        "workflow-action": [9, 2, 3, 3],
        "shared-fragment": [10, 2, 4, 5]
    };
    for (const row of result.scenarios) {
        assert.deepEqual([row.arms.legacy.calls, row.arms.fast.calls, row.arms.standard.calls,
            row.arms.thorough.calls], expected[row.key], row.key + " structural action counts changed");
        assert.ok(row.arms.standard.calls < row.arms.legacy.calls, row.key + " must not get more expensive");
        assert.ok(row.arms.fast.calls <= row.arms.standard.calls, row.key + " fast <= standard");
        assert.ok(row.arms.thorough.calls >= row.arms.standard.calls, row.key + " thorough >= standard");
    }
    // High-risk work must still be verified: the shared-fragment scenario keeps its regression arm.
    const shared = result.scenarios.find(r => r.key === "shared-fragment");
    assert.ok(shared.arms.standard.qa >= 2, "a shared fragment still gets real verification");
});
