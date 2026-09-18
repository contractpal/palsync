"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { lintSpec } = require("../src/core/specLint");

const SPEC = `# SPEC — Contract
status: approved
reality_check: pass
spec version: 1
mode: lite

## 3. Sitemap
home

## 4. Copy
copy

## 11. Constraints
never

## 12. Acceptance criteria
- pal_validate 0 errors
- pal_test ok
- nav links route
`;
const EXEC = `# EXECUTION — Contract
spec: SPEC.md (status: approved)
spec version: 1

## Tasks
| id | task | tier | spec ref | depends | status | success condition |
| T1 | foundation | cheap | §3 | — | todo | pal_validate 0 errors; pal_test ok |
| T2 | page | standard | §4 | T1 | todo | preview home |

## Checkpoints
## Blockers
`;

function lint(exec) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-contract-"));
    try {
        fs.writeFileSync(path.join(dir, "EXECUTION.md"), exec);
        return lintSpec(SPEC, { workspaceDir: dir, hasBaseline: false });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function hard(exec) { return lint(exec).findings.filter(f => f.severity === "HARD_FLAG" && f.section === "EXECUTION.md"); }

test("valid SPEC + EXECUTION contract passes joint deterministic validation", () => {
    assert.deepEqual(hard(EXEC), []);
});

test("missing or malformed execution cannot receive joint approval", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-contract-"));
    try {
        assert.match(lintSpec(SPEC, { workspaceDir: dir, hasBaseline: false }).findings[0].summary, /required before/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    assert.match(hard("# EXECUTION\n\n## Tasks\nno table\n")[0].summary, /needs a ## Tasks table/);
});

test("joint validation rejects invalid references, dependencies, cycles, duplicate IDs, and empty success", () => {
    assert.match(hard(EXEC.replace("| T2 | page | standard | §4 | T1 | todo | preview home |", "| T2 | page | standard | §99 | T1 | todo | preview home |"))[0].summary, /does not resolve/);
    assert.match(hard(EXEC.replace("| T2 | page | standard | §4 | T1 | todo | preview home |", "| T2 | page | standard | §4 | T9 | todo | preview home |"))[0].summary, /missing task/);
    assert.ok(hard(EXEC.replace("| T1 | foundation | cheap | §3 | — | todo | pal_validate 0 errors; pal_test ok |", "| T1 | foundation | cheap | §3 | T2 | todo | pal_validate 0 errors; pal_test ok |")).some(f => /cycle/.test(f.summary)));
    assert.ok(hard(EXEC.replace("| T2 | page | standard | §4 | T1 | todo | preview home |", "| T1 | page | standard | §4 | T1 | todo | preview home |")).some(f => /duplicated/.test(f.summary)));
    assert.ok(hard(EXEC.replace("| T2 | page | standard | §4 | T1 | todo | preview home |", "| T2 | page | standard | §4 | T1 | todo | — |")).some(f => /empty success/.test(f.summary)));
});

test("dependency IDs are case-insensitive and foundation success covers both required checks", () => {
    const caseVariant = EXEC.replace("| T2 | page | standard | §4 | T1 | todo | preview home |", "| T2 | page | standard | §4 | t1 | todo | preview home |");
    assert.deepEqual(hard(caseVariant), []);
    assert.ok(hard(EXEC.replace("pal_validate 0 errors; pal_test ok", "pal_validate 0 errors")).some(f => /pal_test/.test(f.summary)));
    assert.ok(hard(EXEC.replace("pal_validate 0 errors; pal_test ok", "pal_test ok")).some(f => /pal_validate/.test(f.summary)));
});

test("ordinary brownfield first tasks do not acquire new foundation checks", () => {
    const brownfield = EXEC.replace("foundation", "rename existing fragment")
        .replace("pal_validate 0 errors; pal_test ok", "fragment renamed");
    assert.deepEqual(hard(brownfield), []);
});
