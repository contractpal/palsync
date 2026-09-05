"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SKILLS = path.join(__dirname, "..", "bundled-context", "skills");
const palFix = fs.readFileSync(path.join(SKILLS, "pal-fix", "SKILL.md"), "utf8");
const palInit = fs.readFileSync(path.join(SKILLS, "pal-init", "SKILL.md"), "utf8");
const palLoop = fs.readFileSync(path.join(SKILLS, "pal-loop", "SKILL.md"), "utf8");
const palReview = fs.readFileSync(path.join(SKILLS, "pal-review", "SKILL.md"), "utf8");
const designBuild = fs.readFileSync(path.join(SKILLS, "design-build", "SKILL.md"), "utf8");
const workflow = fs.readFileSync(path.join(SKILLS, "palbuilder-workflow", "SKILL.md"), "utf8");
const consoleWorkflow = fs.readFileSync(path.join(SKILLS, "palbuilder-workflow", "references", "console.md"), "utf8");
const es3 = fs.readFileSync(path.join(SKILLS, "palbuilder-core", "references", "es3-cheatsheet.md"), "utf8");
const data = fs.readFileSync(path.join(SKILLS, "palbuilder-data", "SKILL.md"), "utf8");
const datasets = fs.readFileSync(path.join(SKILLS, "palbuilder-data", "references", "datasets.md"), "utf8");
const frontend = fs.readFileSync(path.join(SKILLS, "palbuilder-frontend", "SKILL.md"), "utf8");
const exerciseAuthoring = fs.readFileSync(path.join(SKILLS, "shared", "references", "exercise-authoring.md"), "utf8");
const verifyLadder = fs.readFileSync(path.join(SKILLS, "pal-loop", "references", "verify-ladder.md"), "utf8");
const handoff = fs.readFileSync(path.join(SKILLS, "pal-loop", "references", "handoff.md"), "utf8");

test("pal-fix skips spec ceremony, not verification gates", () => {
    assert.match(palFix, /not gate-light/, "pal-fix must explicitly keep the proof ladder");
    for (const tool of [
        "pal_validate",
        "pal_push",
        "pal_test",
        "pal_screenshot",
        "pal_exercise",
        "pal_regression"
    ]) {
        assert.match(palFix, new RegExp(tool), "pal-fix must name " + tool);
    }
    assert.match(palFix, /step-1 reproduction must now pass/, "fix proof must use the repro tool");
});

test("pal-init handoff requires the existing-pal verification floor", () => {
    assert.match(palInit, /Existing-pal verification floor/, "pal-init must define the handoff gate floor");
    assert.match(palInit, /EXECUTION\.md must include verification tasks\/criteria/, "handoff must force explicit tasks");
    for (const tool of [
        "pal_validate",
        "pal_push",
        "pal_sync_datasets",
        "pal_test",
        "pal_fetch",
        "pal_preview",
        "pal_screenshot",
        "pal_exercise",
        "pal_regression"
    ]) {
        assert.match(palInit, new RegExp(tool), "pal-init handoff must name " + tool);
    }
    assert.match(palInit, /if stale, stop and refresh Step 3/, "stale baselines must block regression claims");
});

test("CRUD gates route scoped record exercises and fresh re-review", () => {
    assert.match(palLoop, /references\/verify-ladder\.md/, "pal-loop must load its verification owner");
    assert.match(verifyLadder, /exercise-authoring\.md/, "verification must route exercise mechanics to their owner");
    for (const text of [exerciseAuthoring, palReview]) {
        assert.match(text, /\{\{runId\}\}/, "write verification must use unique run data");
        assert.match(text, /within/, "duplicate row actions must be scoped to the intended record");
    }
    for (const skill of [designBuild, palReview]) {
        assert.match(skill, /pb-row-actions/, "visual build/review must require the shipped row-action group");
        assert.match(skill, /mutually exclusive|only actions valid|only the action valid/i,
            "visual build/review must reject conflicting state transitions");
    }
    assert.match(palLoop, /fresh-context `pal-review` is mandatory/, "completion requires independent review");
    assert.match(handoff, /start a fresh review cycle/i,
        "review fixes must return to a fresh independent reviewer");
});

test("platform dialect guidance covers the equipment-checkout failure modes", () => {
    assert.match(consoleWorkflow, /var c, pal, page, payload, request, frag/);
    assert.match(consoleWorkflow, /pal = c\.getPal\(\)/);
    assert.match(consoleWorkflow, /var ds = pal\.getDataSet/);
    assert.match(workflow, /not automatically available magic globals/);

    assert.match(es3, /Global vs local variables/);
    assert.match(es3, /EL operators are not workflow JS functions/);
    assert.match(es3, /Unavailable String and Array prototype methods/);
    assert.match(es3, /text\.indexOf\(part\) >= 0/);

    assert.match(data, /c\.getDateUtil\(\)\.createDate\(\)/);
    assert.match(datasets, /deleteRecord.*primary-key id, not a record object/is);
    assert.match(datasets, /ds\.deleteRecord\(equipmentId\.toString\(\)\)/);

    // Exercise authoring moved to shared reference in pal-loop trim — body now carries mandatory read; verify detail in the reference.
    assert.match(exerciseAuthoring, /tr:has\(\[data-label="Name"\]:has-text/);
    assert.match(exerciseAuthoring, /not rendered by the default fragment/);
    assert.match(exerciseAuthoring, /\| Delete \| — \| unique deleted value \|/);
    for (const skill of [designBuild, palReview]) {
        assert.match(skill, /platform.*chrome/is);
        assert.match(skill, /outside `#cp-root`/);
    }
    assert.match(palLoop, /references\/verify-ladder\.md/, "pal-loop must load screenshot verification on demand");
    assert.match(verifyLadder, /console-chrome-exception\.md/);

    assert.match(frontend, /Apache Commons JEXL/);
    assert.match(frontend, /\$\{info\.get\('first-name'\)\}/);
});

test("pal-loop retains structural-safety and countable-handoff invariants", () => {
    for (const [label, text] of [["pal-loop", palLoop], ["pal-fix", palFix], ["pal-init", palInit]]) {
        assert.match(text, /pal_impact/, label + " must route impact analysis");
        assert.match(text, /silent for new\s+files/i, label + " must exempt new files from impact analysis");
    }
    assert.match(palLoop, /free `pal_ast` `mode:"search"`/i);
    assert.match(palLoop, /three or more spec-ref-named files[\s\S]*dry run[\s\S]*checkpointed[\s\S]*one `pal_push`/i);
    assert.match(palLoop, /palsync task list --ready[\s\S]*spliced SPEC sections[\s\S]*§11 constraints/i);
    assert.match(palLoop, /three non-cheap completed tasks[\s\S]*frontier task[\s\S]*both verification retries/i);
    assert.match(palLoop, /session tasks:\s*<n>\/3[\s\S]*cheap tasks do not increment/i);
    assert.match(palLoop, /Do not auto-continue[\s\S]*Claude Stop hook or Pi queue/i);
});
test("pal-loop loads execution mechanics at Execute", () => {
    const execute = fs.readFileSync(path.join(SKILLS, "pal-loop", "references", "execute.md"), "utf8");
    for (const pattern of [/Foundation task \(T1\)/, /Copy: \*\*§4\*\*/, /Restraint ladder/, /Multi-block edit re-read/]) {
        assert.match(execute, pattern);
    }
    assert.match(palLoop, /### 4\. Execute[\s\S]*references\/execute\.md/);
    assert.doesNotMatch(palLoop, /Foundation task \(T1\): use bash `cp`/);
});
test("pal-loop triggers the owned completion protocol", () => {
    for (const pattern of [/dispatch pal-review in a fresh/, /palsync completion check/, /CHANGES-NEEDED/, /Re-review/, /pal_regression/]) {
        assert.match(handoff, pattern);
    }
    assert.match(palLoop, /### 8\. Complete \/ handoff[\s\S]*fresh-context `pal-review` is mandatory/);
    assert.match(palLoop, /current review[\s\S]*palsync completion check/);
});
test("pal-loop loads verification mechanics at Verify", () => {
    for (const pattern of [/Push diagnosis/, /WEB page verification/, /UI by task type/, /Console render/, /Exercise authoring/, /Warning waiver mechanics/]) {
        assert.match(verifyLadder, pattern);
    }
    assert.match(palLoop, /### 5\. Verify[\s\S]*references\/verify-ladder\.md/);
    assert.match(palLoop, /every[\s\S]*success-condition clause[\s\S]*current tool evidence/i);
    assert.match(palLoop, /Runtime tools verify the pushed version/);
});
test("pal-loop loads startup mechanics at Start", () => {
    const session = fs.readFileSync(path.join(SKILLS, "pal-loop", "references", "session-start.md"), "utf8");
    for (const pattern of [/Reviewer-dispatch preflight/, /Environment doctor/, /Git init/, /Just-in-time skill loading/, /Smoke-test before picking work/]) {
        assert.match(session, pattern);
    }
    assert.match(palLoop, /### 1\. Start[\s\S]*references\/session-start\.md/);
    assert.match(palLoop, /approved and reality-checked[\s\S]*workspace is viable/);
});
