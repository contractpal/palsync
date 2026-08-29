"use strict";
// Session-summary CLI: offline derived counts, session numbering, mode, next inference,
// malformed handling, atomic single write, help/dispatch.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");

const EXEC_BASE = `# EXECUTION — demo
spec: SPEC.md (status: approved)   mode: lite

## Build plan
Leaf-first.

## Tasks
| id | task | tier | spec ref | depends | status | success condition |
| T1 | scaffold | cheap | §3 | — | done | ok |
| T2 | page | frontier | §4 | T1 | todo | ok |
| T3 | other | standard | §4 | T1 | todo | ok |
| T4 | blocked one | standard | §4 | T2 | blocked | ok |
| T5 | frontier one | standard | §4 | T2 | needs-frontier | ok |
| T6 | human one | standard | §4 | T2 | needs-human | ok |

## Checkpoints
- T1 scaffolded

## Blockers
- BLOCKED T4 [blocked]: waiting || tried: retried once
- BLOCKED T5 [needs-frontier]: needs stronger model
- BLOCKED T6 [needs-human]: need owner || tried: retried once
`;

const EXEC_SINGLE_READY = `# EXECUTION — demo
spec: SPEC.md (status: approved)   mode: full

## Build plan

## Tasks
| id | task | tier | spec ref | depends | status | success condition |
| T1 | first | cheap | §3 | — | done | ok |
| T2 | second | standard | §4 | T1 | todo | ok |
| T3 | third | standard | §4 | T2 | todo | ok |

## Checkpoints
- T1 done

## Blockers
`;

const EXEC_MULTI_READY = `# EXECUTION — demo
spec: SPEC.md (status: approved)   mode: lite

## Build plan

## Tasks
| id | task | tier | spec ref | depends | status | success condition |
| T1 | done | cheap | §3 | — | done | ok |
| T2 | ready A | standard | §4 | T1 | todo | ok |
| T3 | ready B | standard | §4 | T1 | todo | ok |

## Checkpoints
- T1 done

## Blockers
`;

const EXEC_ALL_DONE = `# EXECUTION — demo
spec: SPEC.md (status: approved)   mode: lite

## Build plan

## Tasks
| id | task | tier | spec ref | depends | status | success condition |
| T1 | a | cheap | §3 | — | done | ok |
| T2 | b | standard | §4 | T1 | done | ok |

## Checkpoints
- T1 done
- T2 done

## Blockers
`;

function readExec(ws) {
    return fs.readFileSync(path.join(ws, "EXECUTION.md"), "utf8");
}

test("session number increments from prior canonical lines", async () => {
    const ws = tmpWorkspace({ "EXECUTION.md": EXEC_SINGLE_READY });
    const ts = require("../src/core/taskState");
    // add an existing session line as if a prior session already ran
    const withOne = ts.appendCheckpoint(readExec(ws), "== session 1 (2026-01-01), mode full: 1 done, 0 blocked, 0 needs-frontier, 0 needs-human. Next: T2").text;
    fs.writeFileSync(path.join(ws, "EXECUTION.md"), withOne);
    const sync = require("../src/cli/syncCommands");
    const beforeCalls = [];
    const origWrite = ts.writeExecution;
    let writeCount = 0;
    ts.writeExecution = (file, text) => { writeCount++; beforeCalls.push(text); return origWrite(file, text); };
    try {
        assert.equal(await sync.run("session-summary", ["--dir", ws]), 0);
        assert.equal(writeCount, 1, "must write EXECUTION.md exactly once");
        const after = readExec(ws);
        assert.match(after, /== session 2 \(/);
        assert.match(after, /- == session 2 \([^)]+\), mode [^:]+:[^\n]*\n   Next: T2/);
        assert.doesNotMatch(after, /== session 1.*== session 1/m);
        // second increment should be 3
        assert.equal(await sync.run("session-summary", ["--next", "review blockers / clear human gates", "--dir", ws]), 0);
        const after2 = readExec(ws);
        assert.match(after2, /== session 3 \(/);
        assert.match(after2, /- == session 3 \([^)]+\), mode [^:]+:[^\n]*\n   Next: review blockers \/ clear human gates/);
    } finally {
        ts.writeExecution = origWrite;
        fs.rmSync(ws, { recursive: true, force: true });
        delete require.cache[require.resolve("../src/cli/syncCommands")];
    }
});

test("derived status counts are exact and mode full|lite both work", async () => {
    for (const mode of ["full", "lite"]) {
        const ws = tmpWorkspace({ "EXECUTION.md": EXEC_BASE });
        const sync = require("../src/cli/syncCommands");
        delete require.cache[require.resolve("../src/cli/syncCommands")];
        const fresh = require("../src/cli/syncCommands");
        // EXEC_BASE has 1 done, 1 blocked, 1 needs-frontier, 1 needs-human, plus 2 todo -> ready tasks T2 and T3 (both depend on T1 done, so multiple ready)
        // Use explicit next to avoid ambiguity, and explicit mode
        const code = await fresh.run("session-summary", ["--mode", mode, "--next", "T2", "--dir", ws]);
        assert.equal(code, 0);
        const after = readExec(ws);
        assert.match(after, new RegExp("mode " + mode + ": 1 done, 1 blocked, 1 needs-frontier, 1 needs-human"));
        // No sidecar file must be created
        assert.equal(fs.existsSync(path.join(ws, ".palsync", "session-summary.json")), false);
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("mode is inferred from EXECUTION.md when not supplied", async () => {
    const ws = tmpWorkspace({ "EXECUTION.md": EXEC_SINGLE_READY });
    const sync = require("../src/cli/syncCommands");
    assert.equal(await sync.run("session-summary", ["--dir", ws]), 0);
    const after = readExec(ws);
    // EXEC_SINGLE_READY header says mode: full, so inferred mode should be full
    assert.match(after, /mode full:/);
    fs.rmSync(ws, { recursive: true, force: true });
    delete require.cache[require.resolve("../src/cli/syncCommands")];
});

test("mode missing and not supplied fails without writing", async () => {
    const noMode = EXEC_SINGLE_READY.replace("mode: full", "mode: ");
    const ws = tmpWorkspace({ "EXECUTION.md": noMode });
    const before = readExec(ws);
    const sync = require("../src/cli/syncCommands");
    const code = await sync.run("session-summary", ["--dir", ws]);
    assert.equal(code, 1);
    assert.equal(readExec(ws), before, "file must be unchanged on failure");
    // explicit invalid mode also fails without writing
    const code2 = await sync.run("session-summary", ["--mode", "unknown", "--dir", ws]);
    assert.equal(code2, 1);
    assert.equal(readExec(ws), before);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("next inferred when single ready task is unambiguous", async () => {
    const ws = tmpWorkspace({ "EXECUTION.md": EXEC_SINGLE_READY });
    const sync = require("../src/cli/syncCommands");
    assert.equal(await sync.run("session-summary", ["--dir", ws]), 0);
    const after = readExec(ws);
    // EXEC_SINGLE_READY has exactly one ready task: T2 (T1 done, T2 depends T1, T3 depends T2)
    assert.match(after, /Next: T2/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("next explicit override is used and ambiguous without explicit fails", async () => {
    const ws = tmpWorkspace({ "EXECUTION.md": EXEC_MULTI_READY });
    const sync = require("../src/cli/syncCommands");
    const before = readExec(ws);
    // multiple ready (T2 and T3) without --next should fail and not write
    assert.equal(await sync.run("session-summary", ["--dir", ws]), 1);
    assert.equal(readExec(ws), before);
    // with explicit --next it succeeds
    assert.equal(await sync.run("session-summary", ["--next", "review blockers / clear human gates", "--dir", ws]), 0);
    const after = readExec(ws);
    assert.match(after, /Next: review blockers \/ clear human gates/);
    // also test --next= form
    const ws2 = tmpWorkspace({ "EXECUTION.md": EXEC_MULTI_READY });
    assert.equal(await sync.run("session-summary", ["--next=custom next text", "--dir", ws2]), 0);
    assert.match(readExec(ws2), /Next: custom next text/);
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(ws2, { recursive: true, force: true });
});

test("no ready task without explicit next fails", async () => {
    const ws = tmpWorkspace({ "EXECUTION.md": EXEC_ALL_DONE });
    const sync = require("../src/cli/syncCommands");
    const before = readExec(ws);
    assert.equal(await sync.run("session-summary", ["--dir", ws]), 1);
    assert.equal(readExec(ws), before);
    // explicit next makes it succeed
    assert.equal(await sync.run("session-summary", ["--next", "review blockers / clear human gates", "--dir", ws]), 0);
    assert.match(readExec(ws), /Next: review blockers/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("malformed and missing EXECUTION.md fail without changing file", async () => {
    const sync = require("../src/cli/syncCommands");
    // missing file
    const wsMissing = tmpWorkspace({});
    assert.equal(await sync.run("session-summary", ["--dir", wsMissing]), 1);
    assert.equal(fs.existsSync(path.join(wsMissing, "EXECUTION.md")), false);
    fs.rmSync(wsMissing, { recursive: true, force: true });
    // malformed table
    const wsBad = tmpWorkspace({ "EXECUTION.md": "## Tasks\nnot a table\n\n## Checkpoints\n" });
    const before = readExec(wsBad);
    assert.equal(await sync.run("session-summary", ["--dir", wsBad]), 1);
    assert.equal(readExec(wsBad), before);
    fs.rmSync(wsBad, { recursive: true, force: true });
    // missing Checkpoints section also fails without write
    const wsNoCp = tmpWorkspace({ "EXECUTION.md": "## Tasks\n| id | status |\n| T1 | done |\n" });
    const before2 = readExec(wsNoCp);
    assert.equal(await sync.run("session-summary", ["--dir", wsNoCp]), 1);
    assert.equal(readExec(wsNoCp), before2);
    fs.rmSync(wsNoCp, { recursive: true, force: true });
});

test("atomic single write: only one writeExecution call and no sidecar", async () => {
    const ws = tmpWorkspace({ "EXECUTION.md": EXEC_SINGLE_READY });
    const ts = require("../src/core/taskState");
    const orig = ts.writeExecution;
    let count = 0;
    ts.writeExecution = (file, text) => { count++; return orig(file, text); };
    const sync = require("../src/cli/syncCommands");
    try {
        assert.equal(await sync.run("session-summary", ["--dir", ws]), 0);
        assert.equal(count, 1);
        assert.equal(fs.existsSync(path.join(ws, ".palsync/session-summary.json")), false);
        // content should contain exactly one new checkpoint line beyond the original
        const lines = readExec(ws).split("\n");
        const sessionLines = lines.filter(l => /== session/.test(l));
        assert.equal(sessionLines.length, 1);
    } finally {
        ts.writeExecution = orig;
        fs.rmSync(ws, { recursive: true, force: true });
        delete require.cache[require.resolve("../src/cli/syncCommands")];
    }
});

test("counts cannot be fabricated via caller flags", async () => {
    const ws = tmpWorkspace({ "EXECUTION.md": EXEC_SINGLE_READY });
    const sync = require("../src/cli/syncCommands");
    const before = readExec(ws);
    // Attempt to pass a fake count flag should be rejected as unknown flag
    assert.equal(await sync.run("session-summary", ["--done", "99", "--dir", ws]), 1);
    assert.equal(readExec(ws), before);
    assert.equal(await sync.run("session-summary", ["--blocked", "5", "--dir", ws]), 1);
    assert.equal(readExec(ws), before);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("help and dispatch registration including underscore normalization", async () => {
    const sync = require("../src/cli/syncCommands");
    const { USAGE } = sync;
    assert.match(USAGE, /palsync session-summary/);
    assert.match(USAGE, /--mode full\|lite/);
    assert.match(USAGE, /--next/);
    // bin dispatcher contains session-summary
    const bin = fs.readFileSync(path.join(__dirname, "..", "bin", "palsync.js"), "utf8");
    assert.match(bin, /"session-summary"/);
    // help flag
    const ws = tmpWorkspace({ "EXECUTION.md": EXEC_SINGLE_READY });
    let out = "";
    const origLog = console.log;
    console.log = (...args) => { out += args.join(" ") + "\n"; };
    try {
        assert.equal(await sync.run("session-summary", ["--help", "--dir", ws]), 0);
        assert.match(out, /Usage: palsync session-summary/);
        assert.equal(readExec(ws), EXEC_SINGLE_READY, "help must not modify file");
        // underscore normalization: session_summary should also dispatch
        out = "";
        assert.equal(await sync.run("session_summary", ["--dir", ws]), 0);
        assert.match(readExec(ws), /== session 1/);
    } finally {
        console.log = origLog;
        fs.rmSync(ws, { recursive: true, force: true });
    }
    // unknown flag should fail with usage
    const ws2 = tmpWorkspace({ "EXECUTION.md": EXEC_SINGLE_READY });
    const before = readExec(ws2);
    assert.equal(await sync.run("session-summary", ["--unknown", "--dir", ws2]), 1);
    assert.equal(readExec(ws2), before);
    fs.rmSync(ws2, { recursive: true, force: true });
});

test("adversarial --next containing session marker is rejected and does not affect numbering", async () => {
    const ws = tmpWorkspace({ "EXECUTION.md": EXEC_SINGLE_READY });
    const before = readExec(ws);
    const sync = require("../src/cli/syncCommands");
    const code = await sync.run("session-summary", ["--next", "== session 999", "--dir", ws]);
    assert.equal(code, 1, "--next containing canonical session marker must be rejected");
    assert.equal(readExec(ws), before, "file must be unchanged after rejected adversarial next");
    // Also verify deriveSessionNumber ignores inline fake marker not at checkpoint start
    const ts = require("../src/core/taskState");
    const fakeText = EXEC_SINGLE_READY + "\nSome prose == session 999 should not count\n";
    assert.equal(ts.deriveSessionNumber(fakeText), 1, "inline fake session marker must not increment number");
    assert.equal(ts.deriveSessionNumber(before + "\n- == session 1 (2026-01-01), mode full: 0 done"), 2);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("existing checkpoint text and blockers survive byte-for-byte outside appended line", async () => {
    const ws = tmpWorkspace({ "EXECUTION.md": EXEC_SINGLE_READY });
    const before = readExec(ws);
    const sync = require("../src/cli/syncCommands");
    assert.equal(await sync.run("session-summary", ["--dir", ws]), 0);
    const after = readExec(ws);
    // Original checkpoint and blockers must remain verbatim; only the new session line is added
    assert.ok(after.includes("- T1 done"));
    assert.ok(after.includes("## Blockers"));
    // Lines before Checkpoints are unchanged
    const beforePrefix = before.split("## Checkpoints")[0];
    const afterPrefix = after.split("## Checkpoints")[0];
    assert.equal(afterPrefix, beforePrefix);
    // Blockers tail after the session line should still contain the original tail (empty in this fixture)
    assert.ok(after.includes("## Blockers"));
    fs.rmSync(ws, { recursive: true, force: true });
});
