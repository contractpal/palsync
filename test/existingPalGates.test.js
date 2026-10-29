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
const verifyLadder = fs.readFileSync(path.join(SKILLS, "pal-loop", "references", "verify-mechanics.md"), "utf8");
const handoff = fs.readFileSync(path.join(SKILLS, "pal-loop", "references", "handoff.md"), "utf8");
const sessionStart = fs.readFileSync(path.join(SKILLS, "pal-loop", "references", "session-start.md"), "utf8");
const verificationPolicy = fs.readFileSync(path.join(SKILLS, "shared", "references", "verification.md"), "utf8");
const delegation = fs.readFileSync(path.join(SKILLS, "pal-loop", "references", "delegation.md"), "utf8");
const seo = fs.readFileSync(path.join(SKILLS, "palbuilder-seo", "SKILL.md"), "utf8");
const specTemplate = fs.readFileSync(path.join(SKILLS, "pal-spec", "references", "spec-template.md"), "utf8");

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
});

test("pal-init is gone from the bundled lifecycle", () => {
    assert.ok(!fs.existsSync(path.join(SKILLS, "pal-init")), "the pal-init skill must not ship");
    for (const [label, text] of [["pal-fix", palFix], ["pal-loop", palLoop], ["pal-spec", palSpec], ["routing contract", routing]]) {
        assert.doesNotMatch(text, /pal-init/, label + " must not route work through pal-init");
    }
    assert.doesNotMatch(palSpec, /MAP\.md is ground truth/, "existing-pal specs must not require a MAP.md");
    assert.match(palSpec, /A `MAP\.md` may be read/, "MAP.md is optional, never generated");
});

test("CRUD gates route scoped record exercises and fresh re-review", () => {
    assert.match(palLoop, /references\/verify-mechanics\.md/, "pal-loop must load its verification owner");
    assert.match(verifyLadder, /exercise-authoring\.md/, "verification must route exercise mechanics to their owner");
    for (const text of [exerciseAuthoring, palReview]) {
        assert.match(text, /\{\{runId\}\}/, "write verification must use unique run data");
        assert.match(text, /within/, "duplicate row actions must be scoped to the intended record");
    }
    assert.match(palReview, /shared wrapper/, "visual review must require a shared row-action wrapper");
    assert.match(palReview, /mutually exclusive|only actions valid|only the action valid/i,
        "visual review must reject conflicting state transitions");
    assert.match(palLoop, /no review pause between tasks/i, "review never runs between tasks");
    assert.match(handoff, /independent re-review that policy asked for/i,
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
    assert.match(palReview, /platform.*chrome/is);
    assert.match(palReview, /outside `#cp-root`/);
    assert.match(palLoop, /references\/verify-mechanics\.md/, "pal-loop must load screenshot verification on demand");
    assert.match(verifyLadder, /console-chrome-exception\.md/);

    assert.match(frontend, /Apache Commons JEXL/);
    assert.match(frontend, /\$\{info\.get\('first-name'\)\}/);
});

test("pal-loop retains structural-safety and countable-handoff invariants", () => {
    for (const [label, text] of [["pal-loop", palLoop], ["pal-fix", palFix]]) {
        assert.match(text, /pal_impact/, label + " must route impact analysis");
        assert.match(text, /silent for new\s+files/i, label + " must exempt new files from impact analysis");
    }
    assert.match(palLoop, /free `pal_ast` `mode:"search"`/i);
    assert.match(palLoop, /three or more spec-ref-named files[\s\S]*dry run[\s\S]*checkpointed[\s\S]*one `pal_push`/i);
    assert.match(palLoop, /palsync task list --ready[\s\S]*spliced SPEC sections[\s\S]*§11 constraints/i);
    assert.match(palLoop, /End the session when the user asks[\s\S]*only terminally blocked tasks remain/i);
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
test("pal-loop completion follows the review setting, and only at the end", () => {
    for (const pattern of [/dispatch \*\*one\*\* `pal-review`/, /palsync completion check/, /CHANGES-NEEDED/, /Re-review/, /pal_regression/]) {
        assert.match(handoff, pattern);
    }
    assert.match(handoff, /only if `baseline\/baseline\.json` exists AND the change was high risk/,
        "regression at completion must be conditional");
    assert.match(palLoop, /### 8\. Complete[\s\S]*follow the `review` setting/);
    assert.match(palLoop, /\*\*off\*\* → finish[\s\S]*\*\*ask\*\* → offer[\s\S]*\*\*auto\*\* → dispatch/);
    assert.match(palReview, /thorough \*\*final\*\* review[\s\S]*user requests it[\s\S]*Automatic/,
        "pal-review must identify itself as an optional or Automatic final review");
    for (const [label, text] of [["pal-loop", palLoop], ["handoff", handoff],
        ["session start", sessionStart], ["routing", routing], ["verification policy", verificationPolicy]]) {
        assert.doesNotMatch(text, /review cadence|each-task|every-N|mandatory review|final reviewer/i,
            label + " must not revive the old review schedule");
    }
});
test("active instructions do not duplicate push validation, compile, or render passes", () => {
    for (const [label, text] of [["delegation", delegation], ["SEO", seo], ["spec template", specTemplate]]) {
        assert.doesNotMatch(text, /pal_validate[^\n]*(?:→|before)[^\n]*pal_push|validate before every push/i,
            label + " must not require validate immediately before push");
    }
    assert.match(delegation, /exercise starts with a fresh server compile/);
    assert.match(verificationPolicy, /do not call `pal_test` first/);
});

test("pal-loop loads verification mechanics at Verify and policy from one place", () => {
    for (const pattern of [/Push \/ validate/, /WEB page checks/, /Screenshots/, /Exercises/, /Warnings/]) {
        assert.match(verifyLadder, pattern);
    }
    assert.match(verifyLadder, /to check is decided in/, "mechanics must not restate the policy");
    assert.match(palLoop, /### 5\. Verify[\s\S]*references\/verify-mechanics\.md/);
    assert.match(palLoop, /### 5\. Verify[\s\S]*shared\/references\/verification\.md/);
    assert.match(palLoop, /every[\s\S]*success-condition clause[\s\S]*current tool evidence/i);
    assert.match(palLoop, /Runtime tools verify the pushed version/);
});
test("session start is minimal: no unconditional doctor, smoke test, or render baseline", () => {
    const session = fs.readFileSync(path.join(SKILLS, "pal-loop", "references", "session-start.md"), "utf8");
    for (const pattern of [/status-transition procedure/i, /Environment doctor/, /Git checkpoint/, /Just-in-time skill loading/]) {
        assert.match(session, pattern);
    }
    assert.match(session, /not as a session ritual/, "doctor is conditional");
    assert.doesNotMatch(session, /Smoke-test before picking work/, "the smoke test is gone");
    assert.match(palLoop, /### 1\. Start[\s\S]*references\/session-start\.md/);
    assert.match(palLoop, /Do \*\*not\*\* run broad health checks just because a session started/);
    assert.match(palLoop, /Never `git stash`, reset, or discard uncommitted work/,
        "pal-loop must commit a fresh pal-spec approval, never stash it");
    assert.match(palLoop, /Do not run\s*\n?`pal_test` or capture render baselines before a task needs them/);
});
test("code-care wording stays pinned: prefactor question, advisory code health, leave-no-worse", () => {
    assert.match(palSpec, /what would make this change easy/i);
    assert.match(palSpec, /DECISION: prefactor/);
    assert.match(palReview, /Code health \(advisory/);
    assert.match(palReview, /never changes the verdict/i);
    assert.match(palReview, /review brief's\s+DUPLICATE\s+CODE\s+block:\s+for\s+each\s+span,\s+note\s+a\s+shared\s+helper\/fragment\s+or\s+say\s+why\s+the\s+repetition\s+is\s+fine/);
    assert.match(palReview, /## Rules[\s\S]*I'd have done it differently/);
    assert.match(routing, /leave the code you touch no worse/i);
});
test("planning separates product authority from implementation; small enhancements stay lightweight", () => {
    const amendment = fs.readFileSync(path.join(SKILLS, "pal-spec", "references", "amendment-path.md"), "utf8");
    const execute = fs.readFileSync(path.join(SKILLS, "pal-loop", "references", "execute.md"), "utf8");
    assert.match(palSpec, /Ask about business policy; decide engineering defaults/);
    assert.match(palSpec, /HERE'S WHAT I'LL BUILD[\s\S]*I need your answer on/, "LOCK is a plain-English summary");
    assert.match(palSpec, /No dataset, workflow, or file names/);
    assert.match(specTemplate, /product contract[\s\S]*§12[\s\S]*initial technical plan/i);
    assert.match(amendment, /Product change → amendment[\s\S]*Implementation change → no amendment, no version bump/);
    assert.match(amendment, /Never rewrite a `done` row[\s\S]*never make a\s+success condition weaker/);
    assert.match(amendment, /Unsure which kind → treat it as product/);
    assert.match(palLoop, /implementation change recorded in \*\*EXECUTION\.md\*\* — no amendment/);
    assert.match(palLoop, /Never silently edit SPEC\.md/, "the amendment invariant survives");
    assert.match(palFix, /## The enhancement loop/);
    assert.match(palFix, /new page or screen, a new dataset or schema change[\s\S]*permission or security redesign/);
    assert.match(routing, /small, bounded enhancement → `pal-fix`/);
    assert.match(execute, /Prefactor when the structure fights the change[\s\S]*Never refactor unrelated code/);
    assert.match(execute, /reread your diff[\s\S]*not a separate review/);
    assert.match(routing, /Comments say \*why\*, not \*what\*[\s\S]*1–2 lines/, "one comment rule, always on");
    for (const [label, text] of [["pal-loop", palLoop], ["pal-fix", palFix], ["pal-spec", palSpec], ["execute", execute]]) {
        assert.doesNotMatch(text, /Comments say/, label + " must not duplicate the comment rule");
    }
});
