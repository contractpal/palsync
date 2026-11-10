"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SKILLS = path.join(__dirname, "..", "bundled-context", "skills");
const palFix = fs.readFileSync(path.join(SKILLS, "pal-fix", "SKILL.md"), "utf8");
const palLoop = fs.readFileSync(path.join(SKILLS, "pal-loop", "SKILL.md"), "utf8");
const palReview = fs.readFileSync(path.join(SKILLS, "pal-review", "SKILL.md"), "utf8");
const workflow = fs.readFileSync(path.join(SKILLS, "palbuilder-workflow", "SKILL.md"), "utf8");
const consoleWorkflow = fs.readFileSync(path.join(SKILLS, "palbuilder-workflow", "references", "console.md"), "utf8");
const es3 = fs.readFileSync(path.join(SKILLS, "palbuilder-core", "references", "es3-cheatsheet.md"), "utf8");
const data = fs.readFileSync(path.join(SKILLS, "palbuilder-data", "SKILL.md"), "utf8");
const datasets = fs.readFileSync(path.join(SKILLS, "palbuilder-data", "references", "datasets.md"), "utf8");
const frontend = fs.readFileSync(path.join(SKILLS, "palbuilder-frontend", "SKILL.md"), "utf8");
const exerciseAuthoring = fs.readFileSync(path.join(SKILLS, "shared", "references", "exercise-authoring.md"), "utf8");
const palSpec = fs.readFileSync(path.join(SKILLS, "pal-spec", "SKILL.md"), "utf8");
const routing = fs.readFileSync(path.join(__dirname, "..", "bundled-context", "CLAUDE.md"), "utf8");
const verifyMechanics = fs.readFileSync(path.join(SKILLS, "pal-loop", "references", "verify-mechanics.md"), "utf8");
const verificationPolicy = fs.readFileSync(path.join(SKILLS, "shared", "references", "verification.md"), "utf8");
const execute = fs.readFileSync(path.join(SKILLS, "pal-loop", "references", "execute.md"), "utf8");
const specReview = fs.readFileSync(path.join(SKILLS, "pal-spec", "references", "spec-review.md"), "utf8");
const seo = fs.readFileSync(path.join(SKILLS, "palbuilder-seo", "SKILL.md"), "utf8");

test("pal-fix proves the fix proportionally instead of running the whole ladder", () => {
    assert.match(palFix, /Verification is proportional, not optional/, "pal-fix defers to the policy");
    assert.match(palFix, /shared\/references\/verification\.md/, "pal-fix points at the one policy");
    for (const tool of ["pal_push", "pal_test", "pal_screenshot", "pal_exercise", "pal_regression"]) {
        assert.match(palFix, new RegExp(tool), "pal-fix must still name " + tool);
    }
    assert.match(palFix, /re-run the step-1 reproduction/, "fix proof must use the repro tool");
    assert.match(palFix, /Do not add unrelated screenshots, exercises, or server tests/,
        "an ordinary fix must not drag in unrelated proof");
    assert.match(palFix, /only when the fix reaches beyond itself/i,
        "regression must be conditional, not automatic");
    assert.match(palFix, /## The enhancement loop/);
    assert.match(palFix, /new page or screen, a new dataset or schema change[\s\S]*permission or security redesign/,
        "pal-fix escalates scope that needs a goal");
});

test("pal-init is gone from the bundled lifecycle", () => {
    assert.ok(!fs.existsSync(path.join(SKILLS, "pal-init")), "the pal-init skill must not ship");
    for (const [label, text] of [["pal-fix", palFix], ["pal-loop", palLoop], ["pal-spec", palSpec], ["routing contract", routing]]) {
        assert.doesNotMatch(text, /pal-init/, label + " must not route work through pal-init");
    }
    assert.doesNotMatch(palSpec, /MAP\.md/, "existing-pal specs must not require or generate a MAP.md");
});

test("GOAL mode replaces the task table in every active lifecycle skill", () => {
    for (const [label, text] of [["pal-loop", palLoop], ["pal-spec", palSpec], ["pal-review", palReview], ["routing", routing]]) {
        assert.doesNotMatch(text, /EXECUTION\.md|SPEC\.md|palsync task|session-summary|spec-lint|specLint/,
            label + " must not reference the retired task/spec machinery");
    }
    assert.match(palSpec, /^## 2\. Write GOAL\.md/m);
    assert.match(palSpec, /^## Acceptance checks/m);
    assert.match(palSpec, /^## Fixed contracts/m);
    assert.match(palSpec, /^## Non-goals/m);
    assert.match(palSpec, /keep the headings exact/i);
    assert.match(palSpec, /`pal_goal_lint`/);
    assert.match(palSpec, /status: draft/);
    assert.match(palSpec, /script-verified/);
    assert.match(palSpec, /review-only/);
});

test("pal-spec reviews checks in a fresh context before the user approves", () => {
    assert.match(palSpec, /#####? 3\. Check review \(gate\)|## 3\. Check review/i);
    assert.match(palSpec, /references\/spec-review\.md/);
    assert.match(palSpec, /fresh-context review/);
    assert.match(palSpec, /When the user approves, set `status: approved`/);
    assert.match(palSpec, /approval is the contract/);
    assert.match(palSpec, /Never weaken or delete a check to finish/);
    assert.match(specReview, /Review the acceptance checks of a PalBuilder pal/);
    assert.match(specReview, /GOAL\.md/);
    assert.match(specReview, /Do not edit files/);
    assert.match(specReview, /`pal_goal_lint`/);
});

test("pal-loop builds with one writer, verifies in a fresh context, and stops after three rounds", () => {
    assert.match(palLoop, /approved \*\*GOAL\.md\*\* is the contract/);
    assert.match(palLoop, /One writer\s+at a time in a checkout/);
    assert.match(palLoop, /Reuse the \*\*same builder\*\* for fixes/);
    assert.match(palLoop, /\*\*new\*\* subagent with no conversation history/);
    assert.match(palLoop, /After \*\*three\*\* verify rounds/);
    assert.match(palLoop, /## Blockers/);
    assert.match(palLoop, /Never weaken a check to pass/);
    assert.match(palLoop, /Runtime tools verify the pushed version: push before runtime checks/);
    assert.match(palLoop, /off\*\* → finish; \*\*ask\*\* → offer a final review; \*\*auto\*\* → run one/);
    assert.match(palLoop, /palsync completion check/);
    assert.match(palLoop, /Never stash, reset, or discard uncommitted work/,
        "pal-loop must commit a fresh pal-spec approval, never stash it");
});

test("pal-loop loads execution and verification mechanics on demand", () => {
    assert.match(palLoop, /references\/execute\.md/);
    assert.match(palLoop, /references\/verify-mechanics\.md/);
    assert.match(palLoop, /shared\/references\/verification\.md/);
    for (const pattern of [/New pal — template copy/, /Restraint ladder/, /Prefactor when the structure fights the change/,
        /Multi-block edit re-read/]) {
        assert.match(execute, pattern);
    }
    assert.match(execute, /Copy: the words in `## Fixed contracts`/);
    for (const pattern of [/Push \/ validate/, /WEB page checks/, /Screenshots/, /Exercises/, /Warnings/]) {
        assert.match(verifyMechanics, pattern);
    }
    assert.match(verifyMechanics, /to check is decided in/, "mechanics must not restate the policy");
    assert.match(verifyMechanics, /console-chrome-exception\.md/);
    assert.match(verificationPolicy, /do not call `pal_test` first/);
    assert.match(verificationPolicy, /With a GOAL\.md, the work is complete when every scripted acceptance check passes/);
});

test("review runs once at the end and never mid-build", () => {
    assert.match(palReview, /thorough \*\*final\*\* review[\s\S]*user requests it[\s\S]*Automatic/,
        "pal-review must identify itself as an optional or Automatic final review");
    assert.match(palReview, /never mid-build/);
    assert.match(palLoop, /### 6\. Done[\s\S]*follow\s+the `review` setting/);
    for (const [label, text] of [["pal-loop", palLoop], ["routing", routing], ["verification policy", verificationPolicy]]) {
        assert.doesNotMatch(text, /review cadence|each-task|every-N|mandatory review|final reviewer/i,
            label + " must not revive the old review schedule");
    }
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

    assert.match(exerciseAuthoring, /tr:has\(\[data-label="Name"\]:has-text/);
    assert.match(exerciseAuthoring, /not rendered by the default fragment/);
    assert.match(exerciseAuthoring, /\| Delete \| — \| unique deleted value \|/);
    assert.match(palReview, /platform.*chrome/is);
    assert.match(palReview, /outside `#cp-root`/);

    assert.match(frontend, /Apache Commons JEXL/);
    assert.match(frontend, /\$\{info\.get\('first-name'\)\}/);
});

test("pal-loop retains structural-safety and verification invariants", () => {
    for (const [label, text] of [["pal-loop", palLoop], ["pal-fix", palFix]]) {
        assert.match(text, /pal_impact/, label + " must route impact analysis");
    }
    assert.match(palFix, /silent for new files/i, "impact analysis is silent for new files");
    assert.match(palLoop, /Review its diff yourself \(`git\s+diff`\)/);
    assert.match(palLoop, /A claim without tool evidence is not a pass/);
    assert.match(palLoop, /Never create or alter a dataset the goal says the pal only consumes/);
    assert.match(palLoop, /Never invent\s+PalBuilder syntax from generic web knowledge/);
});

test("CRUD gates route scoped record exercises and fresh re-review", () => {
    assert.match(palLoop, /references\/verify-mechanics\.md/, "pal-loop must load its verification owner");
    assert.match(verifyMechanics, /exercise-authoring\.md/, "verification must route exercise mechanics to their owner");
    for (const text of [exerciseAuthoring, palReview]) {
        assert.match(text, /\{\{runId\}\}/, "write verification must use unique run data");
        assert.match(text, /within/, "duplicate row actions must be scoped to the intended record");
    }
    assert.match(palReview, /shared wrapper/, "visual review must require a shared row-action wrapper");
    assert.match(palReview, /mutually exclusive|only actions valid|only the action valid/i,
        "visual review must reject conflicting state transitions");
    assert.match(palReview, /fresh session or subagent/);
    assert.match(palReview, /re-review/);
});

test("active instructions do not duplicate push validation, compile, or render passes", () => {
    for (const [label, text] of [["execute", execute], ["SEO", seo]]) {
        assert.doesNotMatch(text, /pal_validate[^\n]*(?:→|before)[^\n]*pal_push|validate before every push/i,
            label + " must not require validate immediately before push");
    }
    assert.match(verificationPolicy, /do not call `pal_test` first/);
});

test("code-care wording stays pinned: prefactor question, advisory code health, leave-no-worse", () => {
    assert.match(palReview, /Code health \(advisory/);
    assert.match(palReview, /never changes the verdict/i);
    assert.match(palReview, /review brief's\s+DUPLICATE\s+CODE\s+block:\s+for\s+each\s+span,\s+note\s+a\s+shared\s+helper\/fragment\s+or\s+say\s+why\s+the\s+repetition\s+is\s+fine/);
    assert.match(palReview, /## Rules[\s\S]*I'd have done it differently/);
    assert.match(routing, /leave the code you touch no worse/i);
});

test("planning separates product authority from implementation; small enhancements stay lightweight", () => {
    assert.match(palSpec, /Ask about business policy; decide engineering defaults/);
    assert.match(palSpec, /HERE'S WHAT I'LL BUILD[\s\S]*I need your answer on/, "LOCK is a plain-English summary");
    assert.match(palSpec, /no dataset, workflow, or\s+file names/i);
    assert.match(palSpec, /change to a check sentence, the outcome, or a fixed contract is the user's/i);
    assert.match(palLoop, /Never change a check sentence, the outcome, or a fixed contract/);
    assert.match(palLoop, /Never edit a check sentence, the outcome, or a fixed contract without the user/);
    assert.match(execute, /Prefactor when the structure fights the change[\s\S]*Never refactor unrelated code/);
    assert.match(execute, /reread your diff[\s\S]*not a separate review/);
    assert.match(routing, /Comments say \*why\*, not \*what\*[\s\S]*1–2 lines/, "one comment rule, always on");
    for (const [label, text] of [["pal-loop", palLoop], ["pal-fix", palFix], ["pal-spec", palSpec], ["execute", execute]]) {
        assert.doesNotMatch(text, /Comments say/, label + " must not duplicate the comment rule");
    }
});
