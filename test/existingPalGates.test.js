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

    // Exercise authoring moved to shared reference in pal-loop trim — body now carries mandatory read; verify detail in the reference.
    assert.match(exerciseAuthoring, /tr:has\(\[data-label="Name"\]:has-text/);
    assert.match(exerciseAuthoring, /not rendered by the default fragment/);
    assert.match(exerciseAuthoring, /\| Delete \| — \| unique deleted value \|/);
    for (const skill of [palLoop, designBuild, palReview]) {
        assert.match(skill, /platform.*chrome/is);
        assert.match(skill, /outside `#cp-root`/);
    }

    assert.match(frontend, /Apache Commons JEXL/);
    assert.match(frontend, /\$\{info\.get\('first-name'\)\}/);
});

test("pal-loop routes to structural tools and countable handoff with slim session start", () => {
    // pal_impact mandatory in loop, fix, and init (brownfield) — silent for new files
    for (const [label, text] of [["pal-loop", palLoop], ["pal-fix", palFix], ["pal-init", palInit]]) {
        assert.match(text, /pal_impact[\s\S]*mandatory before editing an existing page or fragment[\s\S]*other\s+files\s+reference/i,
            label + " must require pal_impact before editing a referenced existing page/fragment");
        assert.match(text, /silent for new files/i,
            label + " must exempt new files from pal_impact");
    }
    // pal_ast: search-is-free, apply:true earned narrow
    assert.match(palLoop, /pal_ast[\s\S]*mode:"search"[\s\S]*free/i, "pal_ast search must be free");
    assert.match(palLoop, /pal_ast[\s\S]*whenever\s+the\s+task\s+touches[\s\S]*class,[\s\S]*attribute[\s\S]*other\s+consumers/i,
        "pal_ast search must trigger on class/attribute/function with other consumers");
    assert.match(palLoop, /three\s+or\s+more\s+files[\s\S]*spec\s+ref/i, "apply:true must require three or more files named by spec ref");
    assert.match(palLoop, /dry-run[\s\S]*diff[\s\S]*recorded\s+on\s+the\s+checkpoint\s+line/i, "apply:true must require a dry-run whose diff is recorded on the checkpoint line");
    assert.match(palLoop, /followed\s+by\s+one[\s\S]*pal_push/i, "apply:true must be followed by one pal_push");
    assert.match(palLoop, /Never use[\s\S]*apply:true[\s\S]*copy or design change|Never for a copy or design change/i,
        "must forbid codemodding copy or design changes");
    // task cycle obtains ticket + spliced spec + §11 from ready print
    assert.match(palLoop, /palsync task list --ready.*prints the ready ticket/i, "task cycle must obtain ticket from ready print");
    assert.match(palLoop, /verbatim body of each SPEC\.md section.*spec ref.*names/i, "must splice spec ref sections verbatim");
    assert.match(palLoop, /verbatim body of \u00a711/i, "must splice \u00a711 verbatim");
    assert.match(palLoop, /do not open EXECUTION\.md or re-read SPEC\.md for it/i, "must forbid per-task SPEC re-read");
    // slim session start — frontmatter only + last session summary + Blockers, no §2/§11 read
    const sessionStart = palLoop.slice(palLoop.indexOf("## Session start"), palLoop.indexOf("## The task cycle"));
    assert.match(sessionStart, /Slim session start[\s\S]*frontmatter only/i, "session start must be slim frontmatter-only");
    assert.match(sessionStart, /last session summary line and Blockers/i, "session start must read last session summary and Blockers");
    assert.match(sessionStart, /do not read \u00a72 or \u00a711[\s\S]*session start/i, "must state \u00a72/\u00a711 not read at session start");
    assert.match(sessionStart, /\u00a711 arrives with every ticket/i, "must note \u00a711 arrives with every ticket");
    assert.match(sessionStart, /\u00a72 arrives only when[\s\S]*spec ref[\s\S]*names it/i, "must note \u00a72 arrives only via spec ref");
    assert.doesNotMatch(sessionStart, /SPEC\.md \*\*\u00a72 Decisions/, "must not instruct a \u00a72 session-start read");
    assert.doesNotMatch(sessionStart, /SPEC\.md \*\*\u00a711 Constraints/, "must not instruct a \u00a711 session-start read");
    // countable handoff — three triggers, cheap exemption, checkpoint counter, four steps, no auto-continuation
    assert.match(palLoop, /three\s+tasks[\s\S]*done[\s\S]*in\s+this\s+session/i, "handoff must trigger at three tasks done");
    assert.match(palLoop, /frontier[\s\S]*tier[\s\S]*task[\s\S]*completing/i, "handoff must trigger on any frontier-tier task completing");
    assert.match(palLoop, /consumed\s+both[\s\S]*verification\s+retries/i, "handoff must trigger when a task consumed both verification retries");
    assert.match(palLoop, /cheap[\s\S]*tier\s+tasks\s+do\s+not\s+increment/i, "cheap-tier tasks must not increment handoff counter");
    assert.match(palLoop, /session tasks: 2\/3/, "handoff counter must ride the checkpoint line as session tasks: 2/3");
    assert.match(palLoop, /finish the current task, leave nothing[\s\S]*in_progress[\s\S]*commit[\s\S]*session summary[\s\S]*stop[\s\S]*fresh session/is,
        "handoff must be finish task, nothing in_progress, commit, summary, stop, fresh session");
    assert.match(palLoop, /dispatching the next task to a fresh subagent[\s\S]*satisfies[\s\S]*handoff/is,
        "dispatching to a fresh subagent must satisfy the handoff boundary");
    assert.match(palLoop, /Do not[\s\S]*auto-continue via the Claude Stop hook or the Pi queue/i,
        "must forbid auto-continuation via Stop hook or Pi queue");
});
