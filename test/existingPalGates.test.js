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

test("pal-loop execute procedure moved to references/execute.md with single mandatory read", () => {
    const executePath = path.join(SKILLS, "pal-loop", "references", "execute.md");
    assert.ok(fs.existsSync(executePath), "references/execute.md must exist");
    const execute = fs.readFileSync(executePath, "utf8");
    assert.match(execute, /Foundation task \(T1\)[\s\S]*bash `cp` to copy the matching pal-type template files/,
        "execute reference must carry the T1 template-copy procedure");
    assert.match(execute, /Copy: \*\*\u00a74\*\*, verbatim/,
        "execute reference must carry the \u00a74 copy mapping");
    assert.match(execute, /Layout: \*\*\u00a76\*\* composition/,
        "execute reference must carry the \u00a76 layout mapping");
    assert.match(execute, /SEO head values: \*\*\u00a77\*\* \(web only\)/,
        "execute reference must carry the \u00a77 SEO mapping");
    assert.match(execute, /Schemas: \*\*\u00a78a\*\* \(CREATE\)[\s\S]*\u00a78b[\s\S]*CONSUMED/,
        "execute reference must carry the \u00a78a/\u00a78b schema mapping");
    assert.match(execute, /Before writing, trace the touched flow and stop at the first rung that holds:[\s\S]*\(1\) YAGNI/,
        "execute reference must carry the five restraint-ladder rungs");
    assert.match(execute, /Ladder adapted from Dietrich Gebert/,
        "execute reference must carry the ladder attributions");
    assert.match(execute, /Andrej Karpathy/,
        "execute reference must carry the Karpathy attribution");
    assert.match(execute, /After a multi-block edit call, re-read the changed region before pushing/,
        "execute reference must carry the multi-block re-read rule");
    const refs = palLoop.match(/references\/execute\.md/g) || [];
    assert.equal(refs.length, 1, "pal-loop body must contain exactly one references/execute.md pointer");
    assert.match(palLoop, /mandatory and non-skippable[\s\S]*references\/execute\.md[\s\S]*before[\s\S]*executing the task's build procedure/i,
        "pal-loop body must carry the single mandatory read line for references/execute.md");
    assert.doesNotMatch(palLoop, /Foundation task \(T1\): use bash `cp` to copy the matching pal-type template files/,
        "moved T1 procedure must no longer appear in the body");
    assert.doesNotMatch(palLoop, /Copy: \*\*\u00a74\*\*, verbatim/,
        "moved \u00a74 mapping must no longer appear in the body");
    assert.doesNotMatch(palLoop, /Before writing, trace the touched flow and stop at the first rung that holds:/,
        "moved restraint-ladder rungs must no longer appear in the body");
    assert.doesNotMatch(palLoop, /After a multi-block edit call, re-read the changed region before pushing/,
        "moved multi-block re-read rule must no longer appear in the body");
});

test("pal-loop completion path moved to references/handoff.md, gates stay inline", () => {
    const handoffPath = path.join(SKILLS, "pal-loop", "references", "handoff.md");
    assert.ok(fs.existsSync(handoffPath), "references/handoff.md must exist");
    const handoff = fs.readFileSync(handoffPath, "utf8");
    assert.match(handoff, /dispatch pal-review in a fresh[\s\S]*session\/subagent/,
        "reference must carry reviewer dispatch");
    assert.match(handoff, /palsync completion check/,
        "reference must carry completion check detail");
    assert.match(handoff, /CHANGES-NEEDED/,
        "reference must carry CHANGES-NEEDED handling");
    assert.match(handoff, /Re-review[\s\S]*when the fix tasks are `done`/,
        "reference must carry re-review handling");
    assert.match(handoff, /Start at the last commit where this check passed/,
        "reference must carry bisect start");
    assert.match(handoff, /Walk per-task commits forward/,
        "reference must carry bisect walk");
    assert.match(handoff, /First failing commit → that commit's task is the culprit/,
        "reference must carry bisect culprit");
    assert.match(handoff, /track a counter on the checkpoint line/,
        "reference must carry cadence counter mechanics");
    assert.match(handoff, /`since last review: 2\/3`/, "reference must carry cadence counter example");
    assert.match(handoff, /freshness gate.*stale → returns `\{stale\}`/,
        "reference must carry freshness gate");
    assert.match(palLoop, /"All tasks `done`" ≠ "the build is done"/,
        "body must keep All tasks done ≠ build is done");
    assert.match(palLoop, /Trigger: every task `done`[\s\S]*blocked[\s\S]*needs-frontier[\s\S]*needs-human[\s\S]*human accepted as parked/,
        "body must keep handoff trigger");
    assert.match(palLoop, /Never skip it, and never run it in this same context/,
        "body must keep never skip/never run in same context");
    assert.match(palLoop, /never convert its own fixes into PASS/i,
        "body must keep PASS-laundering prohibition");
    assert.match(palLoop, /qa-report/, "body must keep qa-report pointer");
    assert.match(palLoop, /report-template\.md/, "body must keep report-template pointer");
    assert.match(palLoop, /pal_regression/, "body must keep pal_regression entry");
    assert.match(palLoop, /`caused` empty → pass/, "body must keep caused empty pass");
    assert.match(palLoop, /`inherited`\/`needs_human` never block/, "body must keep inherited never block");
    assert.match(palLoop, /each-task[\s\S]*wait for[\s\S]*human's go-ahead/, "body must keep each-task trigger");
    assert.match(palLoop, /every-N.*pauses at N/, "body must keep every-N trigger");
    assert.match(palLoop, /since last review: <n>\/N/, "body must keep since last review counter name");
    assert.match(palLoop, /Build is NOT complete until every workflow touched this build returns `pal_test`/,"body must keep Build is NOT complete gate");
    const handoffRefs = palLoop.match(/references\/handoff\.md/g) || [];
    assert.equal(handoffRefs.length, 1, "body must contain exactly one references/handoff.md pointer");
    assert.match(palLoop, /mandatory and non-skippable[\s\S]*references\/handoff\.md[\s\S]*at build completion,[\s\S]*before dispatching pal-review/i,
        "body must carry single mandatory read line for handoff");
    assert.doesNotMatch(palLoop, /Cost recording — IF harness is claude-code THEN skip `palsync cost record`/,
        "cost recording detail must no longer appear in body");
    assert.doesNotMatch(palLoop, /Run `palsync review brief`, then \*\*dispatch pal-review/,
        "dispatch detail must no longer appear in body");
    assert.doesNotMatch(palLoop, /\*\*Reviewer says PASS\*\* → run `palsync completion check`/,
        "completion check step must no longer appear in body as numbered step");
    assert.doesNotMatch(palLoop, /Start at the last commit where this check passed/,
        "bisect start must no longer appear in body");
    assert.doesNotMatch(palLoop, /Walk per-task commits forward, re-running the SAME failing check/,
        "bisect walk must no longer appear in body");
    assert.doesNotMatch(palLoop, /track a counter on the checkpoint line[\s\S]*at N, pause like `each-task`/,
        "cadence counter mechanics must no longer appear in body");
});

test("pal-loop verification mechanics moved to references/verify-ladder.md, thresholds stay inline", () => {
    const verifyPath = path.join(SKILLS, "pal-loop", "references", "verify-ladder.md");
    assert.ok(fs.existsSync(verifyPath), "references/verify-ladder.md must exist");
    const verify = fs.readFileSync(verifyPath, "utf8");
    assert.match(verify, /Use standalone `pal_validate` between edits for diagnosis, and never twice without an edit in between/,
        "reference must carry push diagnosis rule");
    assert.match(verify, /mandatory whole-workspace pre-`done` validation[\s\S]*separate completion checkpoint, not a redundant pre-push call/,
        "reference must note pre-done validation is separate checkpoint");
    assert.match(verify, /per-string[\s\S]*found\/missing, not the HTML[\s\S]*selector.*maxChars/,
        "reference must carry WEB per-string and selector/maxChars guidance");
    assert.match(verify, /Inspect the desktop image[\s\S]*archetype rubric/,
        "reference must carry UI rubric critique");
    assert.match(verify, /fix the three highest-impact issues,\s*push, and re-capture/,
        "reference must carry three-issue fix guidance");
    assert.match(verify, /Re-run the task's[\s\S]*behavior check after the last\s+visual edit/,
        "reference must carry re-run behavior check");
    assert.match(palLoop, /A screenshot file path without pixel critique is not\s+review evidence/,
        "body must carry pixel critique requirement");
    assert.match(verify, /pal_screenshot imageless:true/,
        "reference must carry imageless re-check detail");
    assert.match(verify, /Merge same-page assertions into one exercise flow/,
        "reference must carry merge same-page note");
    assert.match(verify, /Mobile screenshots are final-review-only/,
        "reference must carry mobile final-review note");
    assert.match(verify, /pal_sync_datasets.*\u00a78a/,
        "reference must carry pal_sync_datasets \u00a78a note");
    assert.match(verify, /Fix warnings too, or checkpoint why each warning[\s\S]*warnings are allowed to push but never\s+silently ignored/,
        "reference must carry waiver mechanics");
    assert.match(verify, /Errors cannot be waived/,
        "reference must note errors cannot be waived");
    assert.match(palLoop, /Push must[\s\S]*return `ok:true` and `diagnosticCount:0`/,
        "body must keep pal_push threshold");
    assert.match(palLoop, /`pal_test` once per task, after that task's final push \u2192 `ok:true`, `diagnosticCount:0`/,
        "body must keep pal_test threshold");
    assert.match(palLoop, /`pal_fetch` or `pal_preview` with `expect:\[the exact strings the success\s+condition names\]`[\s\S]*\u2192 all found/,
        "body must keep WEB expect threshold");
    assert.match(palLoop, /pal_seo_audit[\s\S]*\u2192[\s\S]*`ok:true`[\s\S]*`diagnosticCount:0`/,
        "body must keep pal_seo_audit threshold");
    assert.match(palLoop, /UI-only task \u2192 one desktop `pal_screenshot`/,
        "body must keep UI-only threshold");
    assert.match(palLoop, /behavior-only[\s\S]*one `pal_exercise`/,
        "body must keep behavior-only threshold");
    assert.match(palLoop, /Screenshots must[\s\S]*have `renderError:null`/,
        "body must keep renderError:null threshold");
    assert.match(palLoop, /`captured:true` \+ `renderError` non-null \u2192 hard FAIL/,
        "body must keep hard FAIL threshold");
    assert.match(palLoop, /Before marking any UI-touching task `done`, run standalone `pal_validate` against the\s+whole workspace/,
        "body must keep whole-workspace validate gate");
    assert.match(palLoop, /Require 0 diagnostics, or individually waive every remaining warning/,
        "body must keep waiver gate");
    assert.match(palLoop, /Errors cannot be waived/,
        "body must keep errors cannot be waived");
    assert.match(palLoop, /pal_preview.*LAST[\s\S]*PUSHED version \u2014 push before verifying/,
        "body must keep LAST PUSHED version rule");
    assert.match(palLoop, /\*\*Done when:\*\* every success-condition clause has current pushed-version evidence and every warning is fixed or explicitly waived/,
        "body must keep Done when clause");
    assert.match(palLoop, /platform.*chrome/,
        "body must keep platform chrome");
    assert.match(palLoop, /outside `#cp-root`/,
        "body must keep outside #cp-root");
    assert.doesNotMatch(palLoop, /Use standalone `pal_validate` between edits for diagnosis, and never twice without an edit in between/,
        "diagnosis rule must no longer appear in body");
    assert.doesNotMatch(palLoop, /The mandatory whole-workspace pre-`done` validation below is a separate completion checkpoint/,
        "separate checkpoint note must no longer appear in body");
    assert.doesNotMatch(palLoop, /This returns per-string found\/missing, not the HTML/,
        "WEB per-string note must no longer appear in body");
    assert.doesNotMatch(palLoop, /Inspect the desktop image[\s\S]*archetype rubric; if the audit\/image exposes a failure, fix the three highest-impact issues/,
        "UI rubric detail must no longer appear in body");
    assert.doesNotMatch(palLoop, /After a single-class\/attribute fix, `pal_push`; if its server notes are clean, skip duplicate `pal_test`/,
        "imageless re-check must no longer appear in body");
    assert.doesNotMatch(palLoop, /Merge same-page assertions into one exercise flow/,
        "merge note must no longer appear in body");
    assert.doesNotMatch(palLoop, /Mobile screenshots are final-review-only/,
        "mobile note must no longer appear in body");
    const palSyncInBody = (palLoop.match(/pal_sync_datasets/g) || []).length;
    assert.equal(palSyncInBody, 1,
        "body must have reduced pal_sync_datasets occurrences (only the execute CREATE note)");
    const verifyRefs = palLoop.match(/references\/verify-ladder\.md/g) || [];
    assert.equal(verifyRefs.length, 2,
        "body must still contain exactly two verify-ladder pointers (preamble + console render)");
    const exerciseRefs = palLoop.match(/exercise-authoring\.md/g) || [];
    assert.equal(exerciseRefs.length, 1,
        "body must still contain exactly one exercise-authoring pointer");
    assert.match(palLoop, /Before UI or exercise verification, read `references\/verify-ladder\.md` for verification mechanics/,
        "strengthened read line must cover moved mechanics");
});

test("pal-loop session start mechanics moved to references/session-start.md, slim start and readiness gate stay inline", () => {
    const sessionPath = path.join(SKILLS, "pal-loop", "references", "session-start.md");
    assert.ok(fs.existsSync(sessionPath), "references/session-start.md must exist");
    const session = fs.readFileSync(sessionPath, "utf8");
    assert.match(session, /Reviewer-dispatch preflight/, "reference must carry reviewer-dispatch preflight");
    assert.match(session, /HUMAN GATE:/, "reference must carry HUMAN GATE handling");
    assert.match(session, /palsync doctor/, "reference must carry palsync doctor handling");
    assert.match(session, /Print only[\s\S]*non-ok rows/, "reference must carry doctor non-ok rows detail");
    assert.match(session, /git init && git add -A && git commit -m "loop start"/, "reference must carry git init/commit mechanics");
    assert.match(session, /git is a LOCAL checkpoint only/, "reference must carry LOCAL checkpoint note");
    assert.match(session, /Load exactly the skills SPEC\.md \u00a79 lists, just in time/, "reference must carry \u00a79 just-in-time skill loading");
    assert.match(session, /pal_status[\s\S]*pal_pull/, "reference must carry pal_status/pal_pull");
    assert.match(session, /Smoke-test before picking work[\s\S]*pal_validate[\s\S]*pal_test/, "reference must carry smoke-test detail");
    assert.match(session, /retry the failing step once, attempt one alternate path/, "reference must carry retry-once alternate-path detail");
    assert.match(session, /record the literal failing command and error text in `--tried`/, "reference must carry literal command and error recording");
    assert.match(session, /needs-frontier[\s\S]*needs[\s\S]*no[\s\S]*--tried/i, "reference must note needs-frontier needs no --tried");
    const sessionStart = palLoop.slice(palLoop.indexOf("## Session start"), palLoop.indexOf("## The task cycle"));
    assert.match(sessionStart, /Slim session start[\s\S]*frontmatter only/i, "session start must keep slim-start bullet");
    assert.match(sessionStart, /Gate — spec must be ready:/, "session start must keep readiness gate");
    assert.match(sessionStart, /status: draft.*STOP.*spec isn't approved/, "readiness gate must keep draft check");
    assert.match(palLoop, /palsync task list \[--ready\]/, "body must keep palsync task list [--ready]");
    assert.match(palLoop, /palsync task <id> <status>/, "body must keep palsync task <id> <status>");
    assert.match(palLoop, /palsync checkpoint "<line>"/, "body must keep palsync checkpoint \"<line>\"");
    assert.match(palLoop, /OFFLINE local helpers/, "body must keep OFFLINE local helpers note");
    assert.match(palLoop, /pal_\*.*MCP tools/, "body must keep pal_* MCP tools note");
    assert.match(palLoop, /Transitions to `blocked`[\s\S]*`needs-human`[\s\S]*`needs-frontier`[\s\S]*require `--reason/, "body must keep --reason gate");
    assert.match(palLoop, /`blocked` and `needs-human` also[\s\S]*require `--tried/, "body must keep --tried gate");
    const sessionRefs = palLoop.match(/references\/session-start\.md/g) || [];
    assert.equal(sessionRefs.length, 1, "body must contain exactly one references/session-start.md pointer");
    assert.match(palLoop, /mandatory and non-skippable[\s\S]*references\/session-start\.md[\s\S]*at session start,[\s\S]*before the first task/i,
        "body must carry single mandatory read line for session-start");
    assert.doesNotMatch(sessionStart, /Reviewer-dispatch preflight at Build Plan time:/, "reviewer preflight detail must no longer appear in body");
    assert.doesNotMatch(sessionStart, /Environment doctor:/, "doctor detail must no longer appear in body");
    assert.doesNotMatch(sessionStart, /Not a git repo → `git init/, "git init detail must no longer appear in body");
    assert.doesNotMatch(sessionStart, /Load exactly the skills SPEC\.md \u00a79 lists, just in time/, "skill-loading detail must no longer appear in body");
    assert.doesNotMatch(sessionStart, /Smoke-test before picking work:/, "smoke-test detail must no longer appear in body");
    assert.doesNotMatch(palLoop, /before either status, retry the failing step once, attempt one/,
        "retry-once procedure must no longer appear in body intro");
});
