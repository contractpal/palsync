#!/usr/bin/env node
"use strict";
// Regenerates every impact task's ON arm (eval/impact/<task>/arms/on.md) for pilot generation v1.
//
// Pilot v0's ON arm ORDERED the agent to call pal_context, so its `adoption` gate measured
// compliance, and haiku ignored the order on 2 of 4 ON arms (findings #14/#15). An ON arm that never
// calls the tool is an OFF arm with one extra sentence, which burned two of the three complete pairs.
// v1 removes invocation from the experiment entirely: the facts pal_context WOULD return are injected
// into the arm text, so delivery is guaranteed by construction and the only difference between the
// two arms of a pair is whether the agent HAS the facts. That isolates the question Slices 3-5
// actually depend on -- do these facts reduce exploration -- from the separate question of whether a
// weak model can invoke a deferred MCP tool.
//
// The payload comes from the real implementation run against the task's frozen baseline/ fixture, so
// it is the tool's own output, not a paraphrase. Two deliberate deviations, both pre-registered in
// eval/runs/pilot-v1-preregistration.md:
//   1. `freshness` is stripped. It is provenance (analysisFingerprint, targetHash,
//      lastKnownServerModifiedDate, serverChecked), not information that removes a read, and it is
//      the only per-arm-variable content -- stripping it makes ONE static block valid for every arm
//      of a task.
//   2. A seeded arm workspace merges the fixture's pal.json onto the pulled 26-key manifest, so its
//      analysisFingerprint differs from the fixture's. Everything the payload asserts is derived from
//      markup + the fragments/pages registration sections, which seeding carries over verbatim --
//      verified by diffing an arm workspace's markup set against the fixture (identical modulo the
//      rename under test).
//
// Deterministic: same fixture in, same bytes out. Run it and commit the diff; never hand-edit on.md.
const fs = require("fs");
const path = require("path");
const { buildImpactSnapshot } = require("../src/core/validate/snapshot");
const {
    buildStructuralImpact,
    resolveImpactTarget,
    formatImpactResult
} = require("../src/core/impactContext");

const IMPACT_DIR = path.join(__dirname, "..", "eval", "impact");

function factsFor(taskKey) {
    const taskDir = path.join(IMPACT_DIR, taskKey);
    const config = JSON.parse(fs.readFileSync(path.join(taskDir, "impact.json"), "utf8"));
    const baselineDir = path.join(taskDir, config.baseline);
    const target = config.impactTarget;

    const analysis = buildStructuralImpact(buildImpactSnapshot(baselineDir), null);
    const result = formatImpactResult(resolveImpactTarget(analysis, target));
    if (!result.ran || !result.impact) {
        throw new Error(taskKey + ": pal_context returned an error for " + target + ": " + result.message);
    }
    // A truncated payload would make the injected facts differ from what a live call delivers in a
    // way the arm text cannot signal. All three fixtures are far under the 4096-byte budget; if a
    // fixture ever grows past it, the deviation has to be pre-registered rather than absorbed here.
    const omitted = result.impact.omitted;
    if (Object.values(omitted).some(count => count !== 0)) {
        throw new Error(taskKey + ": payload hit the response budget: " + JSON.stringify(omitted));
    }
    const { freshness, ...facts } = result.impact;
    if (freshness === undefined) throw new Error(taskKey + ": expected a freshness block to strip");
    return { target, json: JSON.stringify(facts) };
}

// Both arms of a v1 pair are told not to call pal_context, so the tool-call count is 0 on each side
// and the pair contrast is exactly facts-vs-no-facts. Without that line the ON arm could add an MCP
// call the OFF arm cannot, which is the confound observation #10 flagged.
function armText(taskKey) {
    const { target, json } = factsFor(taskKey);
    return [
        "Impact-context experiment arm: ON (structural facts injected).",
        "Do not call pal_context with target during this run. The exact facts it would return for " +
            target + " are already below, so neither arm of this pair makes an impact tool call.",
        "These are exact LOCAL structural facts for " + target + ", computed from this workspace" +
            " before any edit. Use their exact contents. Everything under coverage.notAnalyzed is" +
            " UNKNOWN, not empty — it was never checked, so do not treat it as evidence of absence.",
        "",
        json,
        "",
        "Then continue the normal workflow."
    ].join("\n") + "\n";
}

function main() {
    const tasks = fs.readdirSync(IMPACT_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.startsWith("impact_"))
        .map(entry => entry.name)
        .sort();
    if (!tasks.length) throw new Error("No impact tasks found at " + IMPACT_DIR);

    const check = process.argv.includes("--check");
    let drift = 0;
    for (const taskKey of tasks) {
        const armPath = path.join(IMPACT_DIR, taskKey, "arms", "on.md");
        const next = armText(taskKey);
        const current = fs.existsSync(armPath) ? fs.readFileSync(armPath, "utf8") : null;
        if (current === next) {
            process.stdout.write("unchanged  " + taskKey + "\n");
            continue;
        }
        drift++;
        if (check) {
            process.stdout.write("DRIFTED    " + taskKey + " (" + armPath + ")\n");
            continue;
        }
        fs.writeFileSync(armPath, next, "utf8");
        process.stdout.write("wrote      " + taskKey + " (" + Buffer.byteLength(next) + " bytes)\n");
    }
    if (check && drift) {
        process.stderr.write("\n" + drift + " ON arm(s) do not match the fixture-derived facts." +
            " Run without --check to regenerate.\n");
        process.exit(1);
    }
}

if (require.main === module) {
    try { main(); }
    catch (e) { process.stderr.write("gen-impact-arm-facts: " + e.message + "\n"); process.exit(1); }
}

module.exports = { armText, factsFor };
