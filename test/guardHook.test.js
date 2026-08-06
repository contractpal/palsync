"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const guard = require("../src/core/guardHook");

const WS = path.resolve("/tmp/palsync-guard-ws");

function evaluate(event, { mode = "claude", cwd } = {}) {
    return guard.evaluate({ mode, cwd, event });
}

function edit(file_path, tool_name = "Edit") {
    return { cwd: WS, tool_name, tool_input: { file_path } };
}

test("1. every file-write tool is denied on the workspace's own record", () => {
    for (const tool of ["Edit", "Write", "MultiEdit"]) {
        const result = evaluate(edit(path.join(WS, ".palsync.json"), tool));
        assert.equal(result.decision.blocked, true);
        assert.equal(result.output.hookSpecificOutput.hookEventName, "PreToolUse");
        assert.equal(result.output.hookSpecificOutput.permissionDecision, "deny");
        assert.match(result.output.hookSpecificOutput.permissionDecisionReason, /filesChecked: 0/);
    }
    // NotebookEdit names its path field differently; a guard that only read file_path would miss it.
    const notebook = evaluate({ cwd: WS, tool_name: "NotebookEdit", tool_input: { notebook_path: ".palsync.json" } });
    assert.equal(notebook.decision.blocked, true);
});

test("2. the same path is recognised however it is spelled", () => {
    for (const target of [".palsync.json", "./.palsync.json", path.join(WS, ".palsync.json"),
        path.join(WS, "pages", "..", ".palsync.json")]) {
        assert.equal(evaluate(edit(target)).decision.blocked, true, target);
    }
});

test("3. a same-named file outside the workspace root stays writable", () => {
    // Only the record at the root drives the push gate. A fixture or backup copy is ordinary content,
    // and blocking it would be a false block -- worse than a missing rule.
    for (const target of ["baseline/.palsync.json", "pages/.palsync.json", ".palsync.json.bak",
        "palsync.json", ".palsync.usage.json"]) {
        assert.equal(evaluate(edit(target)).decision.blocked, false, target);
    }
});

test("4. reads and shell commands are not blocked", () => {
    // Reading the record is legitimate, and the guard deliberately does not parse shell commands:
    // deciding which Bash invocations write would mean guessing. The gap is real and documented.
    assert.equal(evaluate({ cwd: WS, tool_name: "Read", tool_input: { file_path: ".palsync.json" } }).decision.blocked, false);
    assert.equal(evaluate({ cwd: WS, tool_name: "Bash", tool_input: { command: "sed -i s/a/b/ .palsync.json" } }).decision.blocked, false);
});

test("5. an allowed call produces no output at all", () => {
    const result = evaluate(edit("pages/console.html"));
    assert.equal(result.decision.blocked, false);
    assert.equal(result.output, null);
    assert.equal(result.decision.tool, "Edit");
    assert.equal(result.decision.target, "pages/console.html");
});

test("6. json mode returns the decision instead of the Claude envelope", () => {
    const result = evaluate(edit(".palsync.json"), { mode: "json" });
    assert.equal(result.output, result.decision);
    assert.equal(result.output.blocked, true);
});

test("7. an explicit --dir wins over the event cwd", () => {
    // The hook adapter passes --dir through; when it is set, the event's own cwd must not decide.
    const elsewhere = path.resolve("/tmp/palsync-guard-other");
    const result = evaluate({ cwd: elsewhere, tool_name: "Edit", tool_input: { file_path: path.join(WS, ".palsync.json") } },
        { cwd: WS });
    assert.equal(result.decision.blocked, true);
});

test("8. a malformed event never blocks, and a missing cwd throws so the adapter fails open", () => {
    for (const event of [
        { cwd: WS, tool_name: "Edit" },
        { cwd: WS, tool_name: "Edit", tool_input: null },
        { cwd: WS, tool_name: "Edit", tool_input: { file_path: "" } },
        { cwd: WS, tool_name: "Edit", tool_input: { file_path: 42 } },
        { cwd: WS, tool_input: { file_path: ".palsync.json" } },
    ]) {
        assert.equal(evaluate(event).decision.blocked, false, JSON.stringify(event));
    }
    assert.throws(() => evaluate({ tool_name: "Edit", tool_input: { file_path: ".palsync.json" } }), /no cwd/);
});
