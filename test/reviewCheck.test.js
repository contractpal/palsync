"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { tmpWorkspace } = require("./helpers");
const {
    checkReview, checkWorkspace, formatReviewCheck, buildReviewBrief, formatReviewBrief
} = require("../src/core/reviewCheck");
const usage = require("../src/core/usage");
const { hashWorkspaceFiles } = require("../src/core/workspaceHash");
const { version: PACKAGE_VERSION } = require("../package.json");
const syncCommands = require("../src/cli/syncCommands");
const contextInject = require("../src/launcher/contextInject");

const PAL_GUID = "PAL-1";
const MARKER = "M1";
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

function record(overrides = {}) {
    return Object.assign({ palGuid: PAL_GUID, lastModifiedDate: MARKER }, overrides);
}

function appendEvidence(ws, tool = "pal_exercise", overrides = {}) {
    assert.equal(usage.appendToolEvidence(ws, Object.assign({
        tool, palGuid: PAL_GUID, marker: MARKER
    }, overrides)), true);
}

// One clean desktop+mobile pair for a route — the durable render evidence a PASS review needs.
function screenshotEntries(route = "/", overrides = {}) {
    return [
        Object.assign({ tool: "pal_screenshot", route, viewportName: "desktop", renderClean: true }, overrides),
        Object.assign({ tool: "pal_screenshot", route, viewportName: "mobile", renderClean: true }, overrides)
    ];
}

// PASS verdict with no declared behavior rows — isolates the responsive gate from exercise flags.
const NO_BEHAVIOR_REVIEW = "# Review\n\n## Verdict\n\n**result: PASS**\n";

function evidenceWorkspace({ review = REVIEW, entries = [], files = {}, usageLedger } = {}) {
    const ws = tmpWorkspace(Object.assign({
        ".palsync.json": JSON.stringify(record())
    }, files));
    if (usageLedger) fs.writeFileSync(path.join(ws, usage.USAGE_FILE), JSON.stringify(usageLedger));
    for (const entry of entries) appendEvidence(ws, entry.tool, entry);
    fs.writeFileSync(path.join(ws, "REVIEW.md"), review);
    return ws;
}

test("PASS review with no current-version evidence is flagged and capped", () => {
    const ws = evidenceWorkspace();
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.flags.length, 2);
    assert.equal(result.verdictMustChange, true);
    assert.match(formatReviewCheck(result), /PASS WITHOUT EXERCISE EVIDENCE/);
    assert.match(formatReviewCheck(result), /PASS must be changed to CHANGES-NEEDED/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("decorated PASS with no declared behavior needs no ritual exercise, only render evidence", () => {
    const ws = evidenceWorkspace({ review: NO_BEHAVIOR_REVIEW, entries: screenshotEntries() });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, true);
    assert.equal(result.flags.length, 0);
    assert.equal(result.verdict, "PASS");
    assert.equal(result.responsive.complete, true);
    assert.match(formatReviewCheck(result), /exercise evidence for current pushed source: none/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("CHANGES-NEEDED fails even when visual §12 rows pass", () => {
    const review = `# REVIEW
verdict: CHANGES-NEEDED
## §12 acceptance
| criterion | result | evidence |
|---|---|---|
| Create | PASS | CLI exercise |
`;
    const ws = evidenceWorkspace({ review });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "CHANGES-NEEDED");
    assert.equal(result.verdictMustChange, false);
    assert.equal(result.flags.length, 0);
    assert.match(formatReviewCheck(result), /explicit independent PASS is required/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("incidental PASS prose and CHANGES-NEEDED discussion do not declare PASS", () => {
    for (const review of [
        "## Notes\nThe PASS criteria require substantive exercise evidence.\nverdict: CHANGES-NEEDED\n",
        "verdict: CHANGES-NEEDED\n\nA future result may be PASS after fixes.\n",
        "verdict: CHANGES-NEEDED\n\nUse `result: PASS` only after exercise.\n"
    ]) {
        const result = checkReview(review, { entries: [], palGuid: PAL_GUID, marker: MARKER });
        assert.equal(result.verdictMustChange, false, review);
        assert.equal(result.verdict, "CHANGES-NEEDED", review);
        assert.equal(result.ok, false, review);
    }
});

test("current-marker evidence passes and stale-marker evidence does not", () => {
    const current = evidenceWorkspace({ entries: [{ tool: "pal_exercise" }, ...screenshotEntries()] });
    assert.equal(checkWorkspace(current).ok, true);

    const stale = evidenceWorkspace({ entries: [{ tool: "pal_exercise", marker: "OLD" }] });
    const staleResult = checkWorkspace(stale);
    assert.equal(staleResult.ok, false);
    assert.equal(staleResult.exercises, 0);

    fs.rmSync(current, { recursive: true, force: true });
    fs.rmSync(stale, { recursive: true, force: true });
});

test("unchanged marker evidence remains valid across a simulated new MCP session", () => {
    const ws = evidenceWorkspace({
        entries: [{ tool: "pal_exercise" }, ...screenshotEntries()],
        usageLedger: { pid: -1, startedAt: "old-session", tools: { pal_exercise: { calls: 0 } } }
    });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, true);
    assert.equal(result.exercises, 1);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("review check fails and names unpushed server-tracked files", () => {
    const ws = tmpWorkspace({
        "pal.json": "{}",
        "styles/styles.css": ":root { --ds-bg: white; }"
    });
    const baseline = hashWorkspaceFiles(ws).files;
    fs.writeFileSync(path.join(ws, ".palsync.json"), JSON.stringify(record({ fileHashes: baseline })));
    appendEvidence(ws);
    fs.writeFileSync(path.join(ws, "REVIEW.md"), REVIEW);
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

test("BIAS WARNING prevents a PASS verdict with valid exercise evidence", () => {
    const ws = evidenceWorkspace({
        review: "BIAS WARNING: review ran in build context\n" + REVIEW,
        entries: [{ tool: "pal_exercise" }]
    });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.biasWarning, true);
    assert.match(formatReviewCheck(result), /BIAS WARNING present/);
    assert.match(formatReviewCheck(result), /REVIEW\.md declares PASS while bias-capped/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("bias-capped PASS is detected under a decorated heading verdict", () => {
    const ws = evidenceWorkspace({
        review: "BIAS WARNING: review ran in build context\n" + REVIEW.replace("verdict: PASS", "## Verdict: PASS ✅"),
        entries: [{ tool: "pal_exercise" }]
    });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.verdictMustChange, true);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("freshness ignores telemetry but tracks sync, execution, and tool evidence", () => {
    for (const source of [usage.TOOL_EVIDENCE_FILE, ".palsync.json", "EXECUTION.md"]) {
        const ws = evidenceWorkspace({ entries: [{ tool: "pal_exercise" }], files: source === "EXECUTION.md" ? { "EXECUTION.md": "## Tasks\n| id | status |\n| T1 | done |\n" } : {} });
        if (source === usage.TOOL_EVIDENCE_FILE) appendEvidence(ws);
        const later = new Date(Date.now() + 2000);
        fs.utimesSync(path.join(ws, source), later, later);
        const result = checkWorkspace(ws);
        assert.equal(result.ok, false, source);
        assert.equal(result.staleReview, true, source);
        assert.match(formatReviewCheck(result), new RegExp("REVIEW\\.md is stale.*" + path.basename(source).replace(".", "\\."), "s"));
        fs.rmSync(ws, { recursive: true, force: true });
    }
    const telemetry = evidenceWorkspace({ entries: [{ tool: "pal_exercise" }, ...screenshotEntries()], usageLedger: { tools: {} } });
    const later = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(telemetry, usage.USAGE_FILE), later, later);
    assert.equal(checkWorkspace(telemetry).ok, true);
    fs.rmSync(telemetry, { recursive: true, force: true });
});

test("source digest survives marker changes but never crosses Pal identity", () => {
    const ws = evidenceWorkspace({
        entries: [
            { tool: "pal_exercise", marker: "OLD", sourceDigest: "DIGEST" },
            ...screenshotEntries("/", { marker: "OLD", sourceDigest: "DIGEST" })
        ],
        files: { ".palsync.json": JSON.stringify(record({ lastModifiedDate: "NEW", localHash: "DIGEST", fileHashes: {} })) }
    });
    assert.equal(checkWorkspace(ws).ok, true);
    fs.writeFileSync(path.join(ws, usage.TOOL_EVIDENCE_FILE), "");
    appendEvidence(ws, "pal_exercise", { palGuid: "PAL-2", marker: "NEW", sourceDigest: "DIGEST" });
    fs.writeFileSync(path.join(ws, "REVIEW.md"), REVIEW);
    assert.equal(checkWorkspace(ws).ok, false);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("missing reviewer verdict fails even without declared behavior", () => {
    const ws = evidenceWorkspace({ review: "# REVIEW\n## §12 visual\n| criterion | result |\n|---|---|\n| copy | PASS |\n" });
    const result = checkWorkspace(ws);
    assert.equal(result.verdict, "MISSING/UNKNOWN");
    assert.equal(result.ok, false);
    assert.match(formatReviewCheck(result), /explicit independent PASS is required/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("review check CLI returns nonzero when evidence is absent", async () => {
    const ws = evidenceWorkspace();
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
        fs.writeFileSync(path.join(ws, ".palsync.json"), JSON.stringify(record()));
        appendEvidence(ws);
        for (const entry of screenshotEntries()) appendEvidence(ws, entry.tool, entry);
        fs.writeFileSync(path.join(ws, "REVIEW.md"), REVIEW);
        const managedDoc = fs.readFileSync(path.join(ws, agent === "claude" ? "CLAUDE.palsync.md" : "AGENTS.md"), "utf8");
        assert.match(managedDoc, /Completion gate[\s\S]*palsync completion check/);

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
    assert.match(outputs[0], /exercise evidence for current pushed source: available/);
    assert.doesNotMatch(outputs[0], /successful pal_exercise calls|\b\d+\/\d+\b/);
    assert.match(outputs[0], /result: PASS/);
    assert.equal(new Set(missingOutputs).size, 1);
    assert.match(missingOutputs[0], /REVIEW\.md not found/);
});

test("review brief and check agree while CLI-only evidence never renders N/0", () => {
    const execution = `## Tasks
| id | task | status |
| --- | --- | --- |
| T1 | Build | done |
| T2 | Verify | todo |
`;
    const ws = evidenceWorkspace({
        entries: [
            { tool: "pal_exercise", runId: "one" },
            { tool: "pal_exercise", runId: "two" },
            { tool: "pal_push" }
        ],
        files: { "EXECUTION.md": execution },
        usageLedger: { tools: {
            pal_exercise: { calls: 0 }, pal_push: { calls: 0 }, pal_test: { calls: 2 }
        } }
    });
    fs.mkdirSync(path.join(ws, ".palsync"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".palsync/session-cost.json"), JSON.stringify({ entries: [
        { model: "builder", provider: "test", tokensIn: 10, tokensCached: 2, tokensOut: 3, cost: 0.01, currency: "USD", phase: "build" },
        { model: "reviewer", provider: "test", tokensIn: 4, tokensOut: 1, cost: 0.02, currency: "USD", phase: "review" }
    ] }));
    const brief = buildReviewBrief(ws);
    const output = formatReviewBrief(brief);
    assert.equal(checkWorkspace(ws).exercises, brief.evidence.pal_exercise);
    assert.equal(output, `palsync ${PACKAGE_VERSION} review brief
EVIDENCE LEDGER
tool evidence sidecar: available
current-version successful evidence:
  exercise evidence for current pushed source: available
  legacy source marker: M1
  pal_push: 1
RESPONSIVE COVERAGE
  none recorded
MCP usage sidecar: available
MCP attempts this session:
  pal_exercise: 0
  pal_test: 2
  pal_push: 0
  pal_screenshot: 0
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
    assert.doesNotMatch(output, /\b\d+\/0\b/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("review brief reports evidence and usage sidecars independently", async () => {
    const ws = tmpWorkspace({ ".palsync.json": JSON.stringify(record()) });
    const output = formatReviewBrief(buildReviewBrief(ws));
    assert.match(output, /tool evidence sidecar: not available/);
    assert.match(output, /current-version successful evidence:\n  exercise evidence for current pushed source: none\n  pal_push: 0/);
    assert.match(output, /RESPONSIVE COVERAGE\n  none recorded/);
    assert.match(output, /MCP usage sidecar: not available/);
    assert.match(output, /pal_exercise: not available/);
    assert.match(output, /session cost sidecar: not available/);
    assert.match(output, /EXECUTION\.md tasks: not available/);

    const oldLog = console.log;
    const logged = [];
    console.log = (...args) => logged.push(args.join(" "));
    try { assert.equal(await syncCommands.run("review", ["brief", "--dir", ws]), 0); }
    finally { console.log = oldLog; }
    assert.match(logged.join("\n"), /EVIDENCE LEDGER/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("desktop-only clean capture fails PASS with incomplete viewport coverage, without exercise flags", () => {
    const ws = evidenceWorkspace({
        review: NO_BEHAVIOR_REVIEW,
        entries: [{ tool: "pal_screenshot", route: "/", viewportName: "desktop", renderClean: true }]
    });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.responsive.code, "PASS WITH INCOMPLETE VIEWPORT COVERAGE");
    assert.equal(result.verdictMustChange, true);
    assert.equal(result.flags.length, 0);
    const output = formatReviewCheck(result);
    assert.match(output, /PASS WITH INCOMPLETE VIEWPORT COVERAGE/);
    assert.match(output, /\/ — desktop: clean, mobile: missing/);
    assert.match(output, /re-run pal-review and overwrite REVIEW\.md — new evidence makes the existing review stale/);
    assert.doesNotMatch(output, /HUMAN GATE/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("PASS with zero screenshot rows fails as PASS WITHOUT RESPONSIVE EVIDENCE and names the escape", () => {
    const ws = evidenceWorkspace({ review: NO_BEHAVIOR_REVIEW });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.responsive.code, "PASS WITHOUT RESPONSIVE EVIDENCE");
    assert.equal(result.verdictMustChange, true);
    const output = formatReviewCheck(result);
    assert.match(output, /PASS WITHOUT RESPONSIVE EVIDENCE/);
    assert.match(output, /screenshot unavailable, that is recorded and downgrades to a human gate/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("audit findings on clean captures stay advisory and never cap the verdict", () => {
    const ws = evidenceWorkspace({
        review: NO_BEHAVIOR_REVIEW,
        entries: screenshotEntries("/", { auditErrors: 1, auditRules: ["unstyledLink", "horizontalOverflow"] })
    });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, true);
    assert.equal(result.verdictMustChange, false);
    assert.equal(result.responsive.auditErrorTotal, 2);
    assert.match(formatReviewCheck(result), /ADVISORY: design audit findings on \/: unstyledLink, horizontalOverflow/);
    assert.match(formatReviewCheck(result), /result: PASS/);
    fs.rmSync(ws, { recursive: true, force: true });
});

// A row can carry an audit error COUNT with no rule ids (older evidence, a truncated rule list, an
// audit that could not name what it counted). Dropping the route from the advisory block would hide
// real findings from the reviewer, so the count is reported with the route and explicit
// "identifiers unavailable" wording — still advisory: ok/verdictMustChange must not move.
test("audit errors with no rule ids still produce a per-route advisory naming the route and count", () => {
    const ws = evidenceWorkspace({
        review: NO_BEHAVIOR_REVIEW,
        entries: screenshotEntries("/orders", { auditErrors: 2, auditRules: [] })
    });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, true);
    assert.equal(result.verdictMustChange, false);
    assert.equal(result.responsive.auditErrorTotal, 4); // 2 per viewport
    assert.deepEqual(result.responsive.auditRuleIds, []);
    const output = formatReviewCheck(result);
    assert.match(output, /ADVISORY: design audit findings on \/orders: 4 audit error\(s\) recorded; rule identifiers unavailable in the recorded evidence\./);
    assert.match(output, /result: PASS/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("a route with neither rule ids nor audit errors produces no advisory line", () => {
    const ws = evidenceWorkspace({ review: NO_BEHAVIOR_REVIEW, entries: screenshotEntries("/quiet") });
    const output = formatReviewCheck(checkWorkspace(ws));
    assert.doesNotMatch(output, /ADVISORY/);
    assert.match(output, /result: PASS/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("a later render-error capture overwrites a prior clean pass for the same route and viewport", () => {
    const ws = evidenceWorkspace({
        review: NO_BEHAVIOR_REVIEW,
        entries: [
            { tool: "pal_screenshot", route: "/", viewportName: "desktop", renderClean: true, ts: "2026-07-30T00:00:01.000Z" },
            { tool: "pal_screenshot", route: "/", viewportName: "mobile", renderClean: true, ts: "2026-07-30T00:00:02.000Z" },
            { tool: "pal_screenshot", route: "/", viewportName: "mobile", renderClean: false, ts: "2026-07-30T00:00:03.000Z" }
        ]
    });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.responsive.code, "PASS WITH INCOMPLETE VIEWPORT COVERAGE");
    assert.match(formatReviewCheck(result), /\/ — desktop: clean, mobile: render-error/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("a push changing the source digest invalidates prior screenshot evidence", () => {
    const ws = evidenceWorkspace({
        review: NO_BEHAVIOR_REVIEW,
        entries: screenshotEntries("/", { sourceDigest: "OLD" }),
        files: { ".palsync.json": JSON.stringify(record({ localHash: "NEW", fileHashes: {} })) }
    });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.responsive.anyEvidence, false);
    assert.equal(result.responsive.code, "PASS WITHOUT RESPONSIVE EVIDENCE");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("durable unavailable and testing-disabled signals degrade to a human gate when nothing captured cleanly", () => {
    for (const signal of [
        { tool: "pal_screenshot", route: "/", viewportName: null, renderClean: false, unavailable: true },
        { tool: "pal_screenshot", route: "/", viewportName: null, renderClean: false, unavailable: true, testingDisabled: true }
    ]) {
        const ws = evidenceWorkspace({ review: NO_BEHAVIOR_REVIEW, entries: [signal] });
        const result = checkWorkspace(ws);
        assert.equal(result.ok, true, JSON.stringify(signal));
        assert.equal(result.responsiveHumanGate, true);
        assert.equal(result.responsive.code, undefined);
        assert.match(formatReviewCheck(result), /HUMAN GATE: screenshot capture unavailable on this machine \(or automated testing is off\); a person must confirm the 390px layout\./);
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("a signal row plus one clean capture is a hard incomplete failure, never a human gate", () => {
    const ws = evidenceWorkspace({
        review: NO_BEHAVIOR_REVIEW,
        entries: [
            { tool: "pal_screenshot", route: "/", viewportName: null, renderClean: false, unavailable: true, testingDisabled: true },
            { tool: "pal_screenshot", route: "/", viewportName: "desktop", renderClean: true }
        ]
    });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, false);
    assert.equal(result.responsive.code, "PASS WITH INCOMPLETE VIEWPORT COVERAGE");
    assert.equal(result.responsiveHumanGate, undefined);
    assert.doesNotMatch(formatReviewCheck(result), /HUMAN GATE/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("signal rows never leak into the route map once complete clean coverage exists", () => {
    const ws = evidenceWorkspace({
        review: NO_BEHAVIOR_REVIEW,
        entries: [
            { tool: "pal_screenshot", route: "/", viewportName: null, renderClean: false, unavailable: true },
            ...screenshotEntries()
        ]
    });
    const result = checkWorkspace(ws);
    assert.equal(result.ok, true);
    assert.equal(result.responsive.complete, true);
    assert.equal(result.responsiveHumanGate, undefined);
    assert.doesNotMatch(formatReviewCheck(result), /HUMAN GATE/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("checkReview without an evidence array never evaluates the responsive gate", () => {
    const result = checkReview(NO_BEHAVIOR_REVIEW);
    assert.equal(result.responsive, undefined);
    assert.equal(result.ok, true);
    assert.equal(result.verdictMustChange, false);
});
