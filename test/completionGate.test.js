"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");
const completionGate = require("../src/core/completionGate");
const { claudeStopOutput } = require("../src/core/completionHook");
const { run, runHookCommand } = require("../src/cli/syncCommands");
const usage = require("../src/core/usage");
const { parseGoal } = require("../src/core/goal");

function writeReview(ws, verdict = "PASS") {
    fs.writeFileSync(path.join(ws, "REVIEW.md"), `# REVIEW\nverdict: ${verdict}\n## §12 visual\n| criterion | result |\n|---|---|\n| copy matches | PASS |\n`);
}

function goalText(status = "approved", blocker = "") {
    return `# GOAL — Camera desk

status: ${status}

## Outcome
Ship the request flow.

## Acceptance checks

### A1 — Create a request
A request is created and appears in the list.

\`\`\`json
{ "workflow": "console", "steps": [ { "click": "New request", "expect": ["Request saved"] } ] }
\`\`\`

### A2 — Looks professional
A human judges the screen professional.

## Blockers
${blocker}
`;
}

function goalWorkspace({ status = "approved", blocker = "", record = { palGuid: "PAL-1", lastModifiedDate: "M1" } } = {}) {
    const files = { "GOAL.md": goalText(status, blocker) };
    if (record) files[".palsync.json"] = JSON.stringify(record);
    return tmpWorkspace(files);
}

function addCheckEvidence(ws, { id = "A1", digest, marker = "M1", sourceDigest } = {}) {
    const current = parseGoal(fs.readFileSync(path.join(ws, "GOAL.md"), "utf8"));
    return usage.appendToolEvidence(ws, {
        tool: "pal_exercise", palGuid: "PAL-1", marker, sourceDigest,
        check: id, scriptDigest: digest || current.checks.find(check => check.id === id).scriptDigest,
        runId: "run-goal-1", kind: "console", mode: "browser"
    });
}

function verifiedGoalWorkspace(options) {
    const ws = goalWorkspace(options);
    addCheckEvidence(ws);
    return ws;
}

function addCleanScreenshots(ws) {
    for (const viewportName of ["desktop", "mobile"]) {
        assert.equal(usage.appendToolEvidence(ws, {
            tool: "pal_screenshot", palGuid: "PAL-1", marker: "M1",
            route: "/", viewportName, renderClean: true
        }), true);
    }
}

test("completion without a GOAL.md is not applicable and never blocks", () => {
    const absent = tmpWorkspace();
    const gate = completionGate.checkWorkspace(absent);
    assert.equal(gate.state, "NOT_APPLICABLE");
    assert.equal(gate.allow, true);
    assert.match(gate.message, /No GOAL\.md; completion enforcement does not apply/);
    assert.equal(claudeStopOutput(gate), null, "no GOAL.md must not block the Stop hook");
    fs.rmSync(absent, { recursive: true, force: true });
});

test("goal mode: an unapproved GOAL.md allows work", () => {
    const ws = goalWorkspace({ status: "draft" });
    const gate = completionGate.checkWorkspace(ws, { review: "off" });
    assert.equal(gate.state, "NOT_APPLICABLE");
    assert.equal(gate.allow, true);
    assert.match(gate.message, /not approved yet/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("goal mode: a malformed or checkless GOAL.md blocks", () => {
    const broken = goalWorkspace();
    fs.writeFileSync(path.join(broken, "GOAL.md"), goalText().replace('"steps": [ { "click": "New request", "expect": ["Request saved"] } ]', '"steps": []'));
    assert.equal(completionGate.checkWorkspace(broken, { review: "off" }).state, "MALFORMED_GOAL");
    fs.rmSync(broken, { recursive: true, force: true });

    const checkless = tmpWorkspace({ "GOAL.md": "# GOAL — X\n\nstatus: approved\n\n## Outcome\nNothing.\n" });
    assert.equal(completionGate.checkWorkspace(checkless, { review: "off" }).state, "MALFORMED_GOAL");
    fs.rmSync(checkless, { recursive: true, force: true });
});

test("goal mode: an unverified scripted check blocks completion", () => {
    const ws = goalWorkspace();
    const gate = completionGate.checkWorkspace(ws, { review: "off" });
    assert.equal(gate.state, "UNVERIFIED_CHECKS");
    assert.equal(gate.allow, false);
    assert.match(gate.message, /A1 \(run pal_exercise \{"check":"A1"\}\)/);
    assert.match(gate.message, /goes back to the builder/);
    assert.match(gate.message, /## Blockers/);
    assert.deepStrictEqual(gate.checks, [
        { id: "A1", scripted: true, verified: false, blocked: false },
        { id: "A2", scripted: false, verified: false, blocked: false }
    ]);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("goal mode: a stale script digest or old pushed version does not verify", () => {
    const stale = goalWorkspace();
    addCheckEvidence(stale, { digest: "0".repeat(64) });
    assert.equal(completionGate.checkWorkspace(stale, { review: "off" }).state, "UNVERIFIED_CHECKS");
    fs.rmSync(stale, { recursive: true, force: true });

    const oldVersion = goalWorkspace({ record: { palGuid: "PAL-1", lastModifiedDate: "M2" } });
    addCheckEvidence(oldVersion, { marker: "M1" });
    assert.equal(completionGate.checkWorkspace(oldVersion, { review: "off" }).state, "UNVERIFIED_CHECKS");
    fs.rmSync(oldVersion, { recursive: true, force: true });
});

test("goal mode: a blocked check hands off, and all verified checks complete", () => {
    const blocked = goalWorkspace({ blocker: "- BLOCKED A1: owner-only data is missing || tried: reran the exercise after a push" });
    const blockedGate = completionGate.checkWorkspace(blocked, { review: "off" });
    assert.equal(blockedGate.state, "BLOCKED_HANDOFF");
    assert.equal(blockedGate.allow, true);
    assert.equal(blockedGate.completionPassed, false);
    assert.deepStrictEqual(blockedGate.checks.map(check => check.blocked), [true, false]);
    const blockedText = completionGate.formatCompletion(blockedGate);
    assert.match(blockedText, /verify by review: A2/);
    fs.rmSync(blocked, { recursive: true, force: true });

    const verified = goalWorkspace();
    addCheckEvidence(verified);
    const gate = completionGate.checkWorkspace(verified, { review: "off" });
    assert.equal(gate.state, "COMPLETE");
    assert.equal(gate.allow, true);
    assert.equal(gate.completionPassed, true);
    assert.deepStrictEqual(gate.checks, [
        { id: "A1", scripted: true, verified: true, blocked: false },
        { id: "A2", scripted: false, verified: false, blocked: false }
    ]);
    assert.match(completionGate.formatCompletion(gate), /verify by review: A2/);
    fs.rmSync(verified, { recursive: true, force: true });
});

test("goal mode: review=auto still requires a fresh PASS review after all checks verify", () => {
    const ws = goalWorkspace();
    addCheckEvidence(ws);
    assert.equal(completionGate.checkWorkspace(ws, { review: "auto" }).state, "REVIEW_FAILED");
    addCleanScreenshots(ws);
    writeReview(ws, "PASS");
    const gate = completionGate.checkWorkspace(ws, { review: "auto" });
    assert.equal(gate.state, "COMPLETE");
    assert.equal(gate.allow, true);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("review=auto: all-done completion requires a current explicit PASS review", () => {
    const ws = verifiedGoalWorkspace();
    // A PASS review also needs durable clean desktop+mobile render evidence; without these rows
    // the gate would (correctly) stay REVIEW_FAILED even after the PASS verdict lands.
    addCleanScreenshots(ws);
    assert.equal(completionGate.checkWorkspace(ws, { review: "auto" }).state, "REVIEW_FAILED");
    writeReview(ws, "CHANGES-NEEDED");
    assert.equal(completionGate.checkWorkspace(ws, { review: "auto" }).state, "REVIEW_FAILED");
    writeReview(ws, "PASS");
    const complete = completionGate.checkWorkspace(ws, { review: "auto" });
    assert.equal(complete.state, "COMPLETE");
    assert.equal(complete.allow, true);
    assert.equal(complete.completionPassed, true);
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(ws, "GOAL.md"), future, future);
    assert.equal(completionGate.checkWorkspace(ws, { review: "auto" }).state, "REVIEW_FAILED");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("malformed GOAL deterministically fails plain CLI", async () => {
    const ws = goalWorkspace();
    fs.writeFileSync(path.join(ws, "GOAL.md"), goalText().replace('"steps": [ { "click": "New request", "expect": ["Request saved"] } ]', '"steps": []'));
    const gate = completionGate.checkWorkspace(ws);
    assert.equal(gate.state, "MALFORMED_GOAL");
    assert.equal(gate.allow, false);
    const oldLog = console.log; console.log = () => {};
    try { assert.equal(await run("completion", ["check", "--dir", ws]), 1); }
    finally { console.log = oldLog; fs.rmSync(ws, { recursive: true, force: true }); }
});

test("Claude Stop output uses block decision JSON, while hook exceptions fail open", async () => {
    const output = claudeStopOutput({ allow: false, message: "Review missing" });
    assert.deepEqual(output, { decision: "block", reason: "Review missing" });
    assert.equal(claudeStopOutput({ allow: true }), null);

    const ws = verifiedGoalWorkspace();
    const oldLog = console.log, oldError = console.error; const logged = [];
    console.log = value => logged.push(value); console.error = () => {};
    process.env.PALSYNC_REVIEW = "auto";
    try {
        assert.equal(await runHookCommand(["completion", "--mode", "claude"], JSON.stringify({ cwd: ws })), 0);
        assert.deepEqual(JSON.parse(logged.pop()), { decision: "block", reason: completionGate.checkWorkspace(ws, { review: "auto" }).message });
        assert.equal(await runHookCommand(["completion", "--mode", "claude"], "{bad"), 0);
    } finally {
        delete process.env.PALSYNC_REVIEW;
        console.log = oldLog; console.error = oldError; fs.rmSync(ws, { recursive: true, force: true });
    }
});

// This REPLACES a test that pinned the opposite behavior (blocking again with stop_hook_active: true).
// It was changed on evidence, not preference. Live incident: a `/doctor` session in a pal workspace hit
// the gate on leftover state from an earlier build, correctly surfaced the blocker and asked the owner
// two questions -- and because the hook re-fired anyway, the agent concluded the only way to end its
// turn was to obey, then launched a fresh pal-review subagent that began running `palsync exercise`
// against a build nobody had asked it to touch. Re-blocking did not buy enforcement; it coerced
// unattended, lock-taking work and punished exactly the behavior the ethos asks for.
test("the completion gate blocks once per stop chain, then yields without going silent", async () => {
    const ws = verifiedGoalWorkspace();
    process.env.PALSYNC_REVIEW = "auto";
    const message = completionGate.checkWorkspace(ws, { review: "auto" }).message;
    const oldLog = console.log, oldError = console.error; const logged = [];
    console.log = value => logged.push(value); console.error = () => {};
    try {
        // Second and later fires: the host says it is ALREADY continuing because of a stop hook, which
        // is the documented signal a hook must honour so it cannot run indefinitely.
        assert.equal(await runHookCommand(["completion", "--mode", "claude"],
            JSON.stringify({ cwd: ws, stop_hook_active: true })), 0);
        const yielded = JSON.parse(logged.pop());
        assert.equal(yielded.decision, undefined, "must not block a second time");
        assert.equal(yielded.reason, undefined);
        // Yielding must not read as passing: the unmet gate stays visible.
        assert.match(yielded.systemMessage, /UNMET/);
        assert.ok(yielded.systemMessage.includes(message));
    } finally {
        delete process.env.PALSYNC_REVIEW;
        console.log = oldLog; console.error = oldError; fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("a passing gate stays silent whether or not the hook is already continuing", () => {
    for (const alreadyContinuing of [false, true]) {
        assert.equal(claudeStopOutput({ allow: true }, { alreadyContinuing }), null);
    }
});

test("the review-failed message states scope so it cannot conscript an unrelated session", () => {
    const ws = verifiedGoalWorkspace();
    const gate = completionGate.checkWorkspace(ws, { review: "auto" });
    assert.equal(gate.state, "REVIEW_FAILED");
    assert.equal(gate.allow, false);
    // What is unmet, and what satisfies it.
    assert.match(gate.message, /your review preference is Automatic/);
    assert.match(gate.message, /REVIEW\.md result: PASS/);
    // The anti-conscription clause: a session doing something else must report and stop, not start a
    // review on its own initiative. This is the sentence whose absence caused the incident.
    assert.match(gate.message, /If it is not/);
    assert.match(gate.message, /Do not start a review on your own initiative/);
    fs.rmSync(ws, { recursive: true, force: true });
});

// Review is a preference, not a lifecycle law: off/ask complete without a review, and a leftover
// REVIEW.md from an earlier build cannot trap an unrelated session.
test("review=off and review=ask complete without any review", () => {
    for (const review of ["off", "ask"]) {
        const ws = verifiedGoalWorkspace();
        const gate = completionGate.checkWorkspace(ws, { review });
        assert.equal(gate.state, "COMPLETE");
        assert.equal(gate.allow, true);
        assert.equal(gate.completionPassed, true);
        assert.match(gate.message, /All scripted acceptance checks are verified\./);
        assert.match(gate.message, review === "ask" ? /Ask me/ : /Off/);
        assert.equal(claudeStopOutput(gate), null, "a satisfied gate never blocks Stop");
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("stale review state cannot trap completion when review is not automatic", () => {
    for (const review of ["off", "ask"]) {
        const ws = verifiedGoalWorkspace();
        writeReview(ws, "CHANGES-NEEDED");
        const future = new Date(Date.now() + 2000);
        fs.utimesSync(path.join(ws, "GOAL.md"), future, future);
        assert.equal(completionGate.checkWorkspace(ws, { review }).state, "COMPLETE");
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("review never becomes a requirement while goal checks are unverified", () => {
    for (const review of ["off", "ask", "auto"]) {
        const ws = goalWorkspace();
        const gate = completionGate.checkWorkspace(ws, { review });
        assert.equal(gate.state, "UNVERIFIED_CHECKS");
        assert.equal(gate.allow, false);
        assert.doesNotMatch(gate.message, /review/i, "an unverified goal is never asked for a review");
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("an explicit review mode overrides the saved preference", () => {
    const ws = verifiedGoalWorkspace();
    process.env.PALSYNC_REVIEW = "auto";
    try {
        assert.equal(completionGate.checkWorkspace(ws).state, "REVIEW_FAILED", "env override applies");
        assert.equal(completionGate.checkWorkspace(ws, { review: "off" }).state, "COMPLETE", "explicit argument wins");
    } finally {
        delete process.env.PALSYNC_REVIEW;
        fs.rmSync(ws, { recursive: true, force: true });
    }
});
