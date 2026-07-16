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

test("CRUD gates require scoped record exercises and grouped state-aware row actions", () => {
    for (const skill of [palLoop, palReview]) {
        assert.match(skill, /\{\{runId\}\}/, "write verification must use unique run data");
        assert.match(skill, /within/, "duplicate row actions must be scoped to the intended record");
    }
    for (const skill of [designBuild, palReview]) {
        assert.match(skill, /pb-row-actions/, "visual build/review must require the shipped row-action group");
        assert.match(skill, /mutually exclusive|only actions valid|only the action valid/i,
            "visual build/review must reject conflicting state transitions");
    }
    assert.match(palLoop, /never convert its own fixes into PASS/i,
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

    assert.match(palLoop, /tr:has\(\[data-label="Name"\]:has-text/);
    assert.match(palLoop, /default list fragment/);
    assert.match(palLoop, /\| Delete \| — \| deleted value \|/);
    for (const skill of [palLoop, designBuild, palReview]) {
        assert.match(skill, /platform.*chrome/is);
        assert.match(skill, /outside `#cp-root`/);
    }

    assert.match(frontend, /Apache Commons JEXL/);
    assert.match(frontend, /\$\{info\.get\('first-name'\)\}/);
});
