"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { tmpWorkspace } = require("./helpers");
const { checkWorkspace, formatReviewCheck, buildReviewBrief, formatReviewBrief } = require("../src/core/reviewCheck");
const { hashWorkspaceFiles } = require("../src/core/workspaceHash");
const { version: PACKAGE_VERSION } = require("../package.json");
const syncCommands = require("../src/cli/syncCommands");
const contextInject = require("../src/launcher/contextInject");

const REVIEW = `# REVIEW — demo
verdict: PASS
## §5 action trace
| action (§5) | evidence | result |
| --- | --- | --- |
| Create equipment | proof-1 | PASS |
## Conformance
| criterion (§) | result | evidence |
| §12 HAPPY-PATH create | PASS | proof-1 |
`;

test("PASS review with an empty ledger is flagged and capped", () => {
    const ws = tmpWorkspace({ "REVIEW.md": REVIEW, ".palsync.usage.json": JSON.stringify({ tools: {} }) });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.flags.length, 2);
    assert.equal(result.verdictMustChange, true);
    assert.match(formatReviewCheck(result), /PASS WITHOUT EXERCISE EVIDENCE/);
    assert.match(formatReviewCheck(result), /PASS must be changed to CHANGES-NEEDED/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("PASS review is clean with successful pal_exercise evidence", () => {
    const ws = tmpWorkspace({
        ".palsync.usage.json": JSON.stringify({ tools: { pal_exercise: { calls: 2, successfulCalls: 1 } } })
    });
    fs.writeFileSync(path.join(ws, "REVIEW.md"), REVIEW);
    const result = checkWorkspace(ws);
    assert.equal(result.ok, true);
    assert.equal(result.flags.length, 0);
    assert.match(formatReviewCheck(result), new RegExp("^palsync " + PACKAGE_VERSION + " review check"));
    assert.match(formatReviewCheck(result), /result: PASS/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("review check fails and names unpushed server-tracked files", () => {
    const ws = tmpWorkspace({
        "REVIEW.md": REVIEW,
        "pal.json": "{}",
        "styles/styles.css": ":root { --ds-bg: white; }",
        ".palsync.usage.json": JSON.stringify({ tools: { pal_exercise: { calls: 1, successfulCalls: 1 } } })
    });
    const baseline = hashWorkspaceFiles(ws).files;
    fs.writeFileSync(path.join(ws, ".palsync.json"), JSON.stringify({ fileHashes: baseline }));
    fs.writeFileSync(path.join(ws, "styles/styles.css"), ":root { --ds-bg: black; }");
    const result = checkWorkspace(ws);
    const output = formatReviewCheck(result);
    assert.equal(result.ok, false);
    assert.equal(result.localDrift.dirty, true);
    assert.match(output, /modified: styles\/styles\.css/);
    assert.match(output, /push, then re-capture evidence/);
    assert.match(output, /result: FAIL/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("BIAS WARNING prevents a PASS verdict", () => {
    const ws = tmpWorkspace({
        "REVIEW.md": "BIAS WARNING: review ran in build context\n" + REVIEW,
        ".palsync.usage.json": JSON.stringify({ tools: { pal_exercise: { calls: 1, successfulCalls: 1 } } })
    });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.biasWarning, true);
    assert.match(formatReviewCheck(result), /BIAS WARNING present/);
    assert.match(formatReviewCheck(result), /REVIEW\.md declares PASS while bias-capped — edit the verdict to CHANGES-NEEDED\./);
    assert.match(formatReviewCheck(result), /result: FAIL/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("bias-capped PASS is detected under a decorated heading verdict", () => {
    const ws = tmpWorkspace({
        "REVIEW.md": "BIAS WARNING: review ran in build context\n" +
            REVIEW.replace("verdict: PASS", "## Verdict: PASS ✅"),
        ".palsync.usage.json": JSON.stringify({ tools: { pal_exercise: { calls: 1, successfulCalls: 1 } } })
    });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.verdictMustChange, true);
    assert.match(formatReviewCheck(result), /REVIEW\.md declares PASS while bias-capped/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("review check rejects a REVIEW.md older than current evidence", () => {
    const ws = tmpWorkspace({
        ".palsync.usage.json": JSON.stringify({ tools: { pal_exercise: { calls: 1, successfulCalls: 1 } } }),
        "REVIEW.md": REVIEW,
    });
    const later = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(ws, ".palsync.usage.json"), later, later);
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.staleReview, true);
    assert.match(formatReviewCheck(result), /REVIEW\.md is stale.*\.palsync\.usage\.json/s);
    assert.match(formatReviewCheck(result), /result: FAIL/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("review check CLI returns nonzero when evidence is absent", async () => {
    const ws = tmpWorkspace({ "REVIEW.md": REVIEW, ".palsync.usage.json": JSON.stringify({ tools: {} }) });
    const oldLog = console.log;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));
    try { assert.equal(await syncCommands.run("review", ["check", "--dir", ws]), 1); }
    finally { console.log = oldLog; }
    assert.match(output.join("\n"), /result: FAIL/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("review completion gate is identical across claude-code, pi, and opencode", async () => {
    const outputs = [];
    const missingOutputs = [];
    for (const agent of ["claude", "pi", "opencode"]) {
        const ws = tmpWorkspace({});
        await contextInject.inject(ws, { palName: "Demo", agent });
        fs.writeFileSync(path.join(ws, ".palsync.usage.json"), JSON.stringify({
            tools: { pal_exercise: { calls: 1, successfulCalls: 1 } }
        }));
        fs.writeFileSync(path.join(ws, "REVIEW.md"), REVIEW);
        const managedDoc = fs.readFileSync(path.join(ws, agent === "claude" ? "CLAUDE.palsync.md" : "AGENTS.md"), "utf8");
        assert.match(managedDoc, /Completion gate \(identical in Claude Code, Pi, and OpenCode\)[\s\S]*palsync review check/);

        const oldLog = console.log;
        const logged = [];
        console.log = (...args) => logged.push(args.join(" "));
        try { assert.equal(await syncCommands.run("review", ["check", "--dir", ws]), 0, agent); }
        finally { console.log = oldLog; }
        outputs.push(logged.join("\n"));

        fs.rmSync(path.join(ws, "REVIEW.md"));
        const missing = [];
        console.log = (...args) => missing.push(args.join(" "));
        try { assert.equal(await syncCommands.run("review", ["check", "--dir", ws]), 1, agent); }
        finally { console.log = oldLog; }
        missingOutputs.push(missing.join("\n"));
        fs.rmSync(ws, { recursive: true, force: true });
    }
    assert.equal(new Set(outputs).size, 1);
    assert.match(outputs[0], /result: PASS/);
    assert.equal(new Set(missingOutputs).size, 1);
    assert.match(missingOutputs[0], /REVIEW\.md not found/);
    assert.match(missingOutputs[0], /result: FAIL/);
});

test("review brief renders sidecar evidence and explicit coverage gaps", () => {
    const execution = `## Tasks
| id | task | status |
| --- | --- | --- |
| T1 | Build | done |
| T2 | Verify | todo |
`;
    const ws = tmpWorkspace({
        "EXECUTION.md": execution,
        ".palsync.usage.json": JSON.stringify({ tools: {
            pal_exercise: { calls: 3, successfulCalls: 2 },
            pal_push: { calls: 1, successfulCalls: 1 }
        } })
    });
    fs.mkdirSync(path.join(ws, ".palsync"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".palsync/session-cost.json"), JSON.stringify({ entries: [
        { model: "builder", provider: "test", tokensIn: 10, tokensCached: 2, tokensOut: 3, cost: 0.01, currency: "USD", phase: "build" },
        { model: "reviewer", provider: "test", tokensIn: 4, tokensOut: 1, cost: 0.02, currency: "USD", phase: "review" }
    ] }));
    const output = formatReviewBrief(buildReviewBrief(ws));
    assert.equal(output, `palsync ${PACKAGE_VERSION} review brief
EVIDENCE LEDGER
usage sidecar: available
tool calls (successful/total):
  pal_exercise: 2/3
  pal_test: 0/0
  pal_push: 1/1
  pal_screenshot: 0/0
session cost sidecar: available
  total: in=14 cached=2 out=4 cost=0.0300 USD
  build: in=10 cached=2 out=3 cost=0.0100 USD
  review: in=4 cached=0 out=1 cost=0.0200 USD
  other: not available
EXECUTION.md tasks: 2 total
  todo: 1
  in_progress: 0
  done: 1
  blocked: 0
  needs-frontier: 0
  needs-human: 0
NO EVIDENCE — open source only for these:
- SPEC requirements not represented by the tool and task tallies above
- action-to-workflow-to-data traces not proven by a named exercise result
- implementation constraints and workflow-payload-to-fragment contracts`);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("review brief reports absent sidecars without failing", async () => {
    const ws = tmpWorkspace({});
    const output = formatReviewBrief(buildReviewBrief(ws));
    assert.match(output, /usage sidecar: not available/);
    assert.match(output, /pal_exercise: not available/);
    assert.match(output, /session cost sidecar: not available/);
    assert.match(output, /EXECUTION\.md tasks: not available/);
    assert.match(output, new RegExp("^palsync " + PACKAGE_VERSION + " review brief"));

    const oldLog = console.log;
    const logged = [];
    console.log = (...args) => logged.push(args.join(" "));
    try { assert.equal(await syncCommands.run("review", ["brief", "--dir", ws]), 0); }
    finally { console.log = oldLog; }
    assert.match(logged.join("\n"), /EVIDENCE LEDGER/);
    fs.rmSync(ws, { recursive: true, force: true });
});
