"use strict";
// C3 -- non-blocking post-write feedback. The contract under test is as much about what this hook
// REFUSES to do (block, fail the write, re-report old problems, speak when it has nothing) as about
// what it reports.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const hook = require("../src/core/postWriteHook");
const { hashWorkspaceFiles } = require("../src/core/workspaceHash");
const baseline = require("../src/core/baseline");
const { tmpWorkspace } = require("./helpers");

const CLEAN = '<c:ignore xmlns:c="contractpal"><p>Before</p></c:ignore>';
const WITH_ERROR = '<c:ignore xmlns:c="contractpal"><c:a href="?action=save">Save</c:a></c:ignore>';

// A workspace with a push-gate record and a baseline snapshot -- the state gateLint needs to tell a
// net-new error from an inherited one.
function workspace(files) {
    const dir = tmpWorkspace(files);
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));
    fs.writeFileSync(path.join(dir, ".palsync.json"), JSON.stringify(record));
    return dir;
}

function edit(dir, file_path, tool_name = "Edit") {
    return hook.evaluate({ mode: "claude", cwd: dir, event: { cwd: dir, tool_name, tool_input: { file_path } } });
}

test("1. a net-new push-gate error after an Edit becomes immediate feedback", () => {
    const dir = workspace({ "fragments/form.html": CLEAN });
    fs.writeFileSync(path.join(dir, "fragments", "form.html"), WITH_ERROR);

    const result = edit(dir, "fragments/form.html");
    const errors = result.result.findings.filter(f => f.severity === "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].rule, "hrefAction");
    // The official non-blocking shape: additionalContext, and nothing that could fail the tool call.
    assert.equal(result.output.hookSpecificOutput.hookEventName, "PostToolUse");
    assert.match(result.output.hookSpecificOutput.additionalContext, /ERROR \(must fix before push\)/);
    assert.match(result.output.hookSpecificOutput.additionalContext, /fragments\/form\.html/);
    assert.equal(result.output.hookSpecificOutput.permissionDecision, undefined);
    assert.equal(result.output.decision, undefined);
    assert.equal(result.output.hookSpecificOutput.additionalContext.includes(hook.TRAILER), true);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("2. a pre-existing error in the edited file does not resurface as this edit's fault", () => {
    // gateLint's baseline diff is the whole reason C3 uses it instead of validateWorkspace: editing a
    // legacy-bad file must not dump its inherited errors on the agent that touched one line.
    const dir = workspace({ "fragments/form.html": WITH_ERROR });
    fs.writeFileSync(path.join(dir, "fragments", "form.html"),
        WITH_ERROR.replace("</c:ignore>", "<p>Clean edit</p></c:ignore>"));

    const result = edit(dir, "fragments/form.html");
    assert.equal(result.result.findings.filter(f => f.severity === "error").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("3. findings for other files are not attributed to this write", () => {
    const dir = workspace({ "fragments/a.html": CLEAN, "fragments/b.html": CLEAN });
    fs.writeFileSync(path.join(dir, "fragments", "a.html"), WITH_ERROR);
    fs.writeFileSync(path.join(dir, "fragments", "b.html"), WITH_ERROR);

    const result = edit(dir, "fragments/b.html");
    assert.equal(result.result.findings.every(f => f.file === "fragments/b.html"), true);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("4b. workspace-scope rules never appear, on any write", () => {
    // pbSection is gate "workspace-warning": it describes the workspace's current form, so it fires
    // identically after every edit until fixed elsewhere. Right for one push report, noise per write.
    const dir = workspace({ "fragments/form.html": CLEAN });
    fs.writeFileSync(path.join(dir, "fragments", "form.html"), CLEAN.replace("Before", "After"));
    assert.equal(edit(dir, "fragments/form.html").result.findings.some(f => f.rule === "pbSection"), false);

    fs.writeFileSync(path.join(dir, "fragments", "fresh.html"), CLEAN);
    assert.equal(edit(dir, "fragments/fresh.html").result.findings.some(f => f.rule === "pbSection"), false);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("4c. a per-file warning is reported once on a new file and not re-reported as inherited", () => {
    // debugTagShipped is gate "per-file" and advisory. On a newly added file it is this write's news;
    // once it sits in the baseline, editing that file again must not repeat it.
    const withDebug = '<div><c:debug/><p>Hello</p></div>';
    const dir = workspace({ "pages/home.html": withDebug });
    fs.writeFileSync(path.join(dir, "pages", "fresh.html"), withDebug);
    const added = edit(dir, "pages/fresh.html", "Write");
    assert.equal(added.result.findings.some(f => f.rule === "debugTagShipped" && f.severity === "warn"), true);

    fs.writeFileSync(path.join(dir, "pages", "home.html"), withDebug.replace("Hello", "Changed"));
    const inherited = edit(dir, "pages/home.html");
    assert.equal(inherited.result.findings.some(f => f.rule === "debugTagShipped"), false);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("4. a clean edit says nothing at all", () => {
    const dir = workspace({ "fragments/form.html": CLEAN });
    fs.writeFileSync(path.join(dir, "fragments", "form.html"),
        CLEAN.replace("Before", "After"));

    const result = edit(dir, "fragments/form.html");
    assert.equal(result.result.text, null);
    assert.equal(result.output, null, "silence must be silence -- no empty context block");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("5. writes the push gate would never lint are ignored", () => {
    const dir = workspace({ "fragments/form.html": CLEAN });
    fs.writeFileSync(path.join(dir, "fragments", "form.html"), WITH_ERROR);
    for (const target of ["SPEC.md", "notes/plan.md", "baseline/baseline.json",
        path.join(dir, "..", "outside.html"), "/etc/hosts"]) {
        const result = edit(dir, target);
        assert.equal(result.result.file, null, target);
        assert.equal(result.output, null, target);
    }
    // Reads and shell writes are out of scope by design -- the push gate is the backstop for those.
    assert.equal(edit(dir, "fragments/form.html", "Read").result.file, null);
    assert.equal(hook.evaluate({ mode: "claude", cwd: dir,
        event: { cwd: dir, tool_name: "Bash", tool_input: { command: "sed -i s/a/b/ fragments/form.html" } } }).output, null);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("6. tracked paths are recognised however they are spelled, and pal.json counts", () => {
    const dir = workspace({ "pages/home.html": CLEAN, "pal.json": JSON.stringify({ pages: {} }) });
    for (const target of ["pages/home.html", "./pages/home.html", path.join(dir, "pages", "home.html"),
        path.join(dir, "fragments", "..", "pages", "home.html")]) {
        assert.equal(hook.scopedRelPath(dir, target), "pages/home.html", target);
    }
    assert.equal(hook.scopedRelPath(dir, "pal.json"), "pal.json");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("7. a workspace with no push-gate record stays silent", () => {
    // Without fileHashes gateLint falls back to a whole-workspace validate, which would report
    // problems in files this edit never touched. Silence is the correct answer, not a fallback.
    const dir = tmpWorkspace({ "fragments/form.html": WITH_ERROR });
    const result = edit(dir, "fragments/form.html");
    assert.equal(result.result.findings.length, 0);
    assert.equal(result.output, null);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("8. output is bounded and truncation is declared, never silent", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
        severity: "error", file: "fragments/form.html", line: i + 1, rule: "hrefAction",
        message: "action link must post through a form, not an href query string",
    }));
    const text = hook.buildText(many);
    assert.ok(Buffer.byteLength(text, "utf8") <= hook.MAX_BYTES, "must respect the 600-byte budget");
    assert.match(text, /more not shown; run palsync validate/);
    assert.equal(text.split("\n").filter(l => l.startsWith("- ERROR")).length <= hook.MAX_FINDINGS, true);
});

test("9. errors are ordered before warnings", () => {
    const text = hook.buildText([
        { severity: "warn", file: "pages/home.html", line: 3, rule: "designClassRequired", message: "missing pb-* class" },
        { severity: "error", file: "pages/home.html", line: 9, rule: "hrefAction", message: "action link" },
    ]);
    const lines = text.split("\n").filter(l => l.startsWith("- "));
    assert.match(lines[0], /^- ERROR/);
    assert.match(lines[1], /^- warning/);
});

test("10. a missing cwd throws so the CLI adapter can fail open", () => {
    assert.throws(() => hook.evaluate({ mode: "claude", cwd: undefined, event: { tool_name: "Edit", tool_input: {} } }),
        /no cwd/);
});
