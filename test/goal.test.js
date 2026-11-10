"use strict";
// GOAL.md parsing/linting and the pal_exercise {check} resolution errors. No server is used:
// every pal_exercise case here fails before runExercise.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");
const { parseGoal, readGoal, lintGoal, digestScript } = require("../src/core/goal");
const { TOOLS } = require("../src/mcp/tools");

function goal({ status = "approved", checks = "", tail = "" } = {}) {
    return "# GOAL — Camera desk\n\nstatus: " + status + "\n\n## Outcome\nShip the camera request flow.\n\n" +
        "## Acceptance checks\n" + checks + "\n## Constraints\nNo production writes.\n" + tail;
}

const SCRIPT_A1 = `

### A1 — Create a request
A request is created and appears in the list.

\`\`\`json
{ "workflow": "console", "steps": [ { "click": "New request", "expect": ["Request saved"] } ] }
\`\`\`
`;

const REVIEW_A2 = `

### A2 — Looks professional
A human judges the screen professional.
`;

test("parseGoal: approved goal with a scripted and a review-only check", () => {
    const parsed = parseGoal(goal({ checks: SCRIPT_A1 + REVIEW_A2, tail: "\n## Blockers\n- BLOCKED A2: owner must judge the screen || tried: captured desktop and mobile screenshots\n" }));
    assert.equal(parsed.ok, true, parsed.error);
    assert.equal(parsed.status, "approved");
    assert.equal(parsed.checks.length, 2);
    assert.deepStrictEqual(parsed.checks.map(check => check.id), ["A1", "A2"]);
    assert.equal(parsed.checks[0].title, "Create a request");
    assert.match(parsed.checks[0].sentence, /A request is created and appears in the list/);
    assert.ok(parsed.checks[0].script);
    assert.equal(parsed.checks[0].script.workflow, "console");
    assert.equal(parsed.checks[0].scriptError, null);
    assert.match(parsed.checks[0].scriptDigest, /^[0-9a-f]{64}$/);
    assert.equal(parsed.checks[1].script, null);
    assert.equal(parsed.checks[1].scriptError, null);
    assert.deepStrictEqual(parsed.blockers, {
        A2: { reason: "owner must judge the screen", tried: "captured desktop and mobile screenshots" }
    });
});

test("parseGoal: status is case-insensitive and accepted dashes mark the check title", () => {
    const enDash = goal({ checks: "\n### B1 – First\nSentence.\n" }).replace("status: approved", "STATUS: Approved");
    assert.equal(parseGoal(enDash).status, "approved");
    assert.equal(parseGoal(enDash).checks[0].id, "B1");
    assert.equal(parseGoal(enDash).checks[0].title, "First");
    const hyphen = goal({ checks: "\n### B2 - Second\nSentence.\n" });
    assert.equal(parseGoal(hyphen).checks[0].id, "B2");
    assert.equal(parseGoal(hyphen).checks[0].title, "Second");
});

test("parseGoal: invalid and duplicate check ids are errors", () => {
    const invalid = parseGoal(goal({ checks: "\n### 1 — Bad id\nSentence.\n" }));
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.some(error => /Invalid acceptance-check id/.test(error)));
    const duplicate = parseGoal(goal({ checks: "\n### A1 — One\nOne.\n\n### A1 — Two\nTwo.\n" }));
    assert.equal(duplicate.ok, false);
    assert.ok(duplicate.errors.some(error => /Duplicate acceptance-check id A1/.test(error)));
    assert.equal(parseGoal(goal({ checks: "\n### A1\nNo title.\n" })).ok, false);
});

test("parseGoal: script shape and exercise-step validation are parse errors", () => {
    const badJson = parseGoal(goal({ checks: "\n### A1 — T\nS.\n\n```json\n{ not json }\n```\n" }));
    assert.match(badJson.checks[0].scriptError, /invalid JSON/);
    const unknownKey = parseGoal(goal({ checks: "\n### A1 — T\nS.\n\n```json\n{ \"steps\": [ { \"click\": \"Save\" } ], \"extra\": true }\n```\n" }));
    assert.match(unknownKey.checks[0].scriptError, /unknown key/);
    const emptySteps = parseGoal(goal({ checks: "\n### A1 — T\nS.\n\n```json\n{ \"steps\": [] }\n```\n" }));
    assert.match(emptySteps.checks[0].scriptError, /non-empty array/);
    const badStep = parseGoal(goal({ checks: "\n### A1 — T\nS.\n\n```json\n{ \"steps\": [ {} ] }\n```\n" }));
    assert.match(badStep.checks[0].scriptError, /does nothing/);
    const badInitial = parseGoal(goal({ checks: "\n### A1 — T\nS.\n\n```json\n{ \"steps\": [ { \"click\": \"Save\" } ], \"initial\": { \"page\": \"/x\" } }\n```\n" }));
    assert.match(badInitial.checks[0].scriptError, /initial\.expect/);
    const badWorkflow = parseGoal(goal({ checks: "\n### A1 — T\nS.\n\n```json\n{ \"workflow\": \"mobile\", \"steps\": [ { \"click\": \"Save\" } ] }\n```\n" }));
    assert.match(badWorkflow.checks[0].scriptError, /workflow must be/);
});

test("script digests are canonical and change with the script", () => {
    const one = parseGoal(goal({ checks: SCRIPT_A1 })).checks[0].scriptDigest;
    const reordered = parseGoal(goal({ checks: `

### A1 — Create a request
A request is created and appears in the list.

\`\`\`json
{"steps":[{"expect":["Request saved"],"click":"New request"}],"workflow":"console"}
\`\`\`
` })).checks[0].scriptDigest;
    assert.equal(one, reordered);
    assert.notEqual(one, digestScript({ workflow: "console", steps: [{ click: "New request", expect: ["Other"] }] }));
});

test("parseGoal: blocker lines are read only inside ## Blockers and are validated", () => {
    const elsewhere = parseGoal(goal({ checks: REVIEW_A2, tail: "\n## Notes\n- BLOCKED A2: not read here || tried: nothing\n" }));
    assert.deepStrictEqual(elsewhere.blockers, {});
    assert.equal(elsewhere.ok, true);

    const unknown = parseGoal(goal({ checks: REVIEW_A2, tail: "\n## Blockers\n- BLOCKED A9: reason || tried: effort\n" }));
    assert.equal(unknown.ok, false);
    assert.ok(unknown.errors.some(error => /unknown acceptance check A9/.test(error)));

    const noTried = parseGoal(goal({ checks: REVIEW_A2, tail: "\n## Blockers\n- BLOCKED A2: reason ||\n" }));
    assert.equal(noTried.ok, false);
    assert.ok(noTried.errors.some(error => /Malformed blocker line/.test(error)));

    const emptyReason = parseGoal(goal({ checks: REVIEW_A2, tail: "\n## Blockers\n- BLOCKED A2:  || tried: effort\n" }));
    assert.equal(emptyReason.ok, false);
    assert.ok(emptyReason.errors.some(error => /non-empty reason/.test(error)));
});

test("readGoal: absent GOAL.md is null; present GOAL.md carries its path", () => {
    const absent = tmpWorkspace();
    assert.equal(readGoal(absent), null);
    fs.rmSync(absent, { recursive: true, force: true });
    const ws = tmpWorkspace({ "GOAL.md": goal({ status: "draft" }) });
    const parsed = readGoal(ws);
    assert.equal(parsed.status, "draft");
    assert.equal(parsed.path, path.join(ws, "GOAL.md"));
    fs.rmSync(ws, { recursive: true, force: true });
});

test("lintGoal: draft status is a warning, zero checks is an error", () => {
    const draft = lintGoal(goal({ status: "draft" }));
    assert.ok(draft.some(finding => finding.severity === "warn" && /status is draft/.test(finding.message)));
    assert.ok(draft.some(finding => finding.severity === "error" && /no acceptance checks/.test(finding.message)));
});

test("lintGoal: no scripted check warns that the gate cannot verify anything", () => {
    const findings = lintGoal(goal({ checks: REVIEW_A2 }));
    assert.ok(findings.some(finding =>
        finding.severity === "warn" &&
        finding.message === "no check is script-verified; the completion gate cannot verify anything"));
});

test("lintGoal: script errors are errors; step-linter findings keep their severity", () => {
    const invalid = lintGoal(goal({ checks: "\n### A1 — T\nS.\n\n```json\n{ \"steps\": [] }\n```\n" }));
    assert.ok(invalid.some(finding => finding.severity === "error" && finding.check === "A1" && /non-empty array/.test(finding.message)));

    const errorStep = lintGoal(goal({ checks: "\n### A1 — T\nS.\n\n```json\n{ \"steps\": [ { \"click\": \"Delete\" } ] }\n```\n" }));
    assert.ok(errorStep.some(finding => finding.severity === "error" && finding.check === "A1" && /appears in every row/.test(finding.message)));

    const warningStep = lintGoal(goal({ checks: "\n### A1 — T\nS.\n\n```json\n{ \"steps\": [ { \"click\": \"Save\", \"within\": \"div:has-text(\\\"thing\\\")\" } ] }\n```\n" }));
    assert.ok(warningStep.some(finding => finding.severity === "warn" && finding.check === "A1" && /:has-text/.test(finding.message)));
});

// ---- pal_exercise {check}: all failures resolve before runExercise (no server) ----

function exerciseTool() {
    const tool = TOOLS.find(value => value.name === "pal_exercise");
    assert.ok(tool, "missing pal_exercise");
    return tool;
}

async function resolveCheck(ws, args) {
    return exerciseTool().run({ workspaceDir: ws, session: null, record: { palGuid: "PAL-1", lastModifiedDate: "M1" } }, args);
}

test("pal_exercise check: explicit exercise arguments are rejected", async () => {
    const ws = tmpWorkspace({ "GOAL.md": goal({ checks: SCRIPT_A1 }) });
    const result = await resolveCheck(ws, { check: "A1", steps: [{ click: "Save" }] });
    assert.equal(result.ran, false);
    assert.match(result.message, /omit steps/);
    const withWorkflow = await resolveCheck(ws, { check: "A1", workflow: "console" });
    assert.equal(withWorkflow.ran, false);
    assert.match(withWorkflow.message, /omit steps/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_exercise check: missing GOAL.md, unknown id, review-only, and invalid script errors", async () => {
    const absent = tmpWorkspace();
    assert.match((await resolveCheck(absent, { check: "A1" })).message, /no GOAL\.md/);
    fs.rmSync(absent, { recursive: true, force: true });

    const ws = tmpWorkspace({ "GOAL.md": goal({ checks: SCRIPT_A1 + REVIEW_A2 }) });
    assert.match((await resolveCheck(ws, { check: "A3" })).message, /no acceptance check "A3".*known ids: A1, A2/);
    assert.match((await resolveCheck(ws, { check: "A2" })).message, /no exercise script/);
    fs.rmSync(ws, { recursive: true, force: true });

    const broken = tmpWorkspace({ "GOAL.md": goal({ checks: "\n### A1 — T\nS.\n\n```json\n{ \"steps\": [] }\n```\n" }) });
    assert.match((await resolveCheck(broken, { check: "A1" })).message, /invalid script: steps must be a non-empty array/);
    fs.rmSync(broken, { recursive: true, force: true });
});

test("pal_goal_lint: no GOAL.md is reported without an error", async () => {
    const ws = tmpWorkspace();
    const tool = TOOLS.find(value => value.name === "pal_goal_lint");
    const result = await tool.run({ workspaceDir: ws }, {});
    assert.equal(result.ran, true);
    assert.match(result.message, /No GOAL\.md/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_goal_lint: findings and summary come from GOAL.md", async () => {
    const ws = tmpWorkspace({ "GOAL.md": goal({ status: "draft", checks: REVIEW_A2 }) });
    const tool = TOOLS.find(value => value.name === "pal_goal_lint");
    const result = await tool.run({ workspaceDir: ws }, {});
    assert.equal(result.ran, true);
    assert.equal(result.errors, 0);
    assert.ok(result.warnings >= 2);
    assert.match(result.message, /GOAL LINT: 0 error, 2 warn/);
    assert.match(result.message, /\[warn\] GOAL\.md: status is draft/);
    assert.match(result.message, /no check is script-verified/);
    fs.rmSync(ws, { recursive: true, force: true });
});
