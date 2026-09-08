#!/usr/bin/env node
"use strict";
// Speed regression suite for the verification policy.
//
// It measures the WORK PalSync mandates for a realistic one-task build: required workflow actions
// and how many leave the machine for a Pal/server, browser, or independent-review round trip. This
// is a structural proxy, not elapsed-time or raw tool-call telemetry. In particular, a final review
// counts as one required action even though the reviewer may make several tool calls, so the legacy
// arm is conservative. Live wall-clock numbers require the provisioned eval harness (eval/run.md).
// This suite catches policy-cost regressions deterministically in CI in under a second.
//
//   node bench/verification-cost.js            table
//   node bench/verification-cost.js --json     machine-readable
const policy = require("../src/core/policy");

// Round trips that leave the machine (server compile, render, browser drive, regression sweep,
// SEO fetch). These dominate a task's wall clock; static checks do not.
const NETWORK_STEPS = new Set(["push", "compile", "render", "render-mobile", "behavior", "regression", "seo"]);
// QA round trips only: the push itself is the work, not verification of it.
const QA_STEPS = new Set(["compile", "render", "render-mobile", "behavior", "regression", "seo"]);

// Legacy requirements are taken from commit 173e5fb^: pal-loop/SKILL.md and its session-start.md,
// verify-ladder.md, and handoff.md references. For a one-task build they required startup doctor +
// pal_status + pal_validate + pal_test; per-task whole-workspace validate, push, workflow compile,
// desktop UI proof, behavior proof, and baseline regression where applicable; then mobile UI proof
// and mandatory independent review at completion. The conditional steps below mirror those branches
// rather than charging every scenario for every possible check.
const LEGACY_STARTUP = ["doctor", "pal_status", "pal_validate", "pal_test"];
function legacyPlan(scenario) {
    const steps = ["pal_validate", "pal_push"];
    if (scenario.behavior) steps.push("pal_test");
    if (scenario.surface) steps.push("pal_screenshot");
    if (scenario.surface) steps.push("pal_screenshot(mobile)");
    if (scenario.behavior) steps.push("pal_exercise");
    if (scenario.hasBaseline) steps.push("pal_regression");
    if (scenario.publicWeb) steps.push("pal_seo_audit");
    steps.push("pal-review");           // mandatory final review, every build
    return steps;
}
const LEGACY_NETWORK = new Set(["pal_status", "pal_test", "pal_push", "pal_screenshot",
    "pal_screenshot(mobile)", "pal_exercise", "pal_regression", "pal_seo_audit", "pal-review"]);
const LEGACY_QA = new Set(["pal_test", "pal_screenshot", "pal_screenshot(mobile)", "pal_exercise",
    "pal_regression", "pal_seo_audit", "pal-review"]);

const SCENARIOS = [
    { key: "button-padding", label: "Change button padding",
      paths: ["styles/styles.css"], surface: true, behavior: false, risk: "low" },
    { key: "static-copy", label: "Change a static heading",
      paths: ["pages/home.html"], surface: true, behavior: false, risk: "low" },
    { key: "responsive-card", label: "Adjust a responsive card layout",
      paths: ["fragments/card.html", "styles/styles.css"], surface: true, behavior: false, risk: "low" },
    { key: "form-interaction", label: "Modify one form interaction",
      paths: ["fragments/form.html", "workflows/console.js"], surface: true, behavior: true, risk: "medium" },
    { key: "workflow-action", label: "Change one workflow action",
      paths: ["workflows/console.js"], surface: false, behavior: true, risk: "medium" },
    { key: "shared-fragment", label: "Modify a shared fragment",
      paths: ["fragments/nav.html"], surface: true, behavior: false, risk: "high", hasBaseline: true }
];

function measure(scenario) {
    const legacy = legacyPlan(scenario);
    const arms = {
        legacy: {
            calls: LEGACY_STARTUP.length + legacy.length,
            network: LEGACY_STARTUP.filter(s => LEGACY_NETWORK.has(s)).length +
                legacy.filter(s => LEGACY_NETWORK.has(s)).length,
            qa: LEGACY_STARTUP.filter(s => LEGACY_QA.has(s)).length +
                legacy.filter(s => LEGACY_QA.has(s)).length,
            review: true
        }
    };
    for (const verification of policy.VERIFICATION_LEVELS) {
        const plan = policy.plan({
            verification,
            risk: scenario.risk,
            surface: !!scenario.surface,
            behavior: !!scenario.behavior,
            hasBaseline: !!scenario.hasBaseline,
            publicWeb: !!scenario.publicWeb
        });
        const run = plan.steps.filter(s => s.run);
        arms[verification] = {
            // Startup adds nothing unconditionally now; static checks are folded into push.
            calls: run.length,
            network: run.filter(s => NETWORK_STEPS.has(s.id)).length,
            qa: run.filter(s => QA_STEPS.has(s.id)).length,
            review: false   // default review=ask: offered, not run
        };
    }
    return { key: scenario.key, label: scenario.label, risk: scenario.risk, arms };
}

function summarize(rows) {
    const low = rows.filter(r => r.risk === "low");
    const sum = (list, arm, field) => list.reduce((n, r) => n + r.arms[arm][field], 0);
    const drop = (before, after) => before === 0 ? 0 : Math.round(((before - after) / before) * 100);
    return {
        lowRiskStandard: {
            callReductionPct: drop(sum(low, "legacy", "calls"), sum(low, "standard", "calls")),
            networkReductionPct: drop(sum(low, "legacy", "network"), sum(low, "standard", "network")),
            qaReductionPct: drop(sum(low, "legacy", "qa"), sum(low, "standard", "qa"))
        },
        allStandard: {
            callReductionPct: drop(sum(rows, "legacy", "calls"), sum(rows, "standard", "calls")),
            networkReductionPct: drop(sum(rows, "legacy", "network"), sum(rows, "standard", "network")),
            qaReductionPct: drop(sum(rows, "legacy", "qa"), sum(rows, "standard", "qa"))
        }
    };
}

function run() {
    const rows = SCENARIOS.map(measure);
    return { schema: "palsync/verification-cost/1", scenarios: rows, summary: summarize(rows) };
}

function format(result) {
    const head = ["scenario", "risk", "legacy", "fast", "standard", "thorough"];
    const lines = [head.join(" | "), head.map(() => "---").join(" | ")];
    for (const row of result.scenarios) {
        lines.push([
            row.label, row.risk,
            row.arms.legacy.calls + " (" + row.arms.legacy.network + " net)",
            row.arms.fast.calls + " (" + row.arms.fast.network + " net)",
            row.arms.standard.calls + " (" + row.arms.standard.network + " net)",
            row.arms.thorough.calls + " (" + row.arms.thorough.network + " net)"
        ].join(" | "));
    }
    lines.push("");
    lines.push("Low-risk Standard vs legacy: " + result.summary.lowRiskStandard.callReductionPct +
        "% fewer required actions, " + result.summary.lowRiskStandard.qaReductionPct + "% fewer remote QA actions.");
    lines.push("All scenarios, Standard vs legacy: " + result.summary.allStandard.callReductionPct +
        "% fewer required actions, " + result.summary.allStandard.qaReductionPct + "% fewer remote QA actions.");
    return lines.join("\n");
}

if (require.main === module) {
    const result = run();
    process.stdout.write(process.argv.includes("--json")
        ? JSON.stringify(result, null, 2) + "\n"
        : format(result) + "\n");
}

module.exports = { run, format, SCENARIOS, measure };
