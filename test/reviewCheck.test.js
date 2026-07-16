"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { tmpWorkspace } = require("./helpers");
const { checkWorkspace, formatReviewCheck } = require("../src/core/reviewCheck");
const syncCommands = require("../src/cli/syncCommands");

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
    const ws = tmpWorkspace({ "REVIEW.md": REVIEW });
    fs.writeFileSync(path.join(ws, ".palsync.usage.json"), JSON.stringify({ tools: { pal_exercise: { calls: 2, successfulCalls: 1 } } }));
    const result = checkWorkspace(ws);
    assert.equal(result.ok, true);
    assert.equal(result.flags.length, 0);
    assert.match(formatReviewCheck(result), /result: PASS/);
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
