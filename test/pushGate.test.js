"use strict";
// The push gate has a per-file "new errors only" path. Cross-file contracts that are only
// advisory remain visible but must not block a push.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { gateLint } = require("../src/core/push");
const { hashWorkspaceFiles } = require("../src/core/workspaceHash");
const baseline = require("../src/core/baseline");
const { tmpWorkspace } = require("./helpers");

test("gateLint surfaces but does not block current workspace-level list/DataList contract warnings", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "function run(controller) {",
            "    var pal = controller.getPal();",
            "    var filter = pal.getDataSet('equipment').createFilter();",
            "    var rows = pal.getDataSet('equipment').getRecords(filter, 'items');",
            "    payload.addDataList(rows);",
            "}",
        ].join("\n"),
        "fragments/list.html": "<c:ignore xmlns:c=\"contractpal\"><c:list name=\"items\" id=\"item\">${item.name}</c:list></c:ignore>",
    });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));

    fs.writeFileSync(path.join(dir, "workflows", "console.js"), [
        "function run(controller) {",
        "    var payload = controller.createPayload();",
        "    payload.set('frag', 'list');",
        "}",
    ].join("\n"));

    const lint = gateLint(record, dir);
    assert.equal(lint.errors, 0);
    const finding = lint.findings.find(f => f.rule === "listNameContract");
    assert.equal(finding?.severity, "warn");
    assert.match(finding.message, /items/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint surfaces default-routed actions as advisory warnings", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "function run(controller) {",
            "    var action = controller.getRequest().getParameter('action');",
            "    switch (action) {",
            "        case 'list': break;",
            "        default: break;",
            "    }",
            "}",
        ].join("\n"),
        "fragments/list.html": '<c:ignore xmlns:c="contractpal"><c:a action="edit">Edit</c:a></c:ignore>',
    });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));

    const lint = gateLint(record, dir);
    assert.equal(lint.errors, 0, "default routing is advisory and must not block push");
    const finding = lint.findings.find(f => f.rule === "actionRouted");
    assert.equal(finding?.severity, "warn");
    assert.match(finding.message, /default/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint surfaces a workflow warning without increasing errors", () => {
    const dir = tmpWorkspace({
        "workflows/main.js": "function run(controller) { var s = controller.getName(); return s.length(); }",
    });
    const record = { fileHashes: {} };
    const lint = gateLint(record, dir);
    assert.equal(lint.errors, 0);
    assert.equal(lint.warnings, 1);
    assert.equal(lint.findings[0].rule, "lengthCall");
    assert.equal(lint.findings[0].severity, "warn");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint does not re-block a pre-existing per-file error in an untouched file", () => {
    const dir = tmpWorkspace({
        "fragments/legacy.html": '<c:ignore xmlns:c="contractpal"><c:a href="?action=save">Save</c:a></c:ignore>',
        "fragments/edited.html": '<c:ignore xmlns:c="contractpal"><p>Before</p></c:ignore>',
    });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));

    fs.writeFileSync(path.join(dir, "fragments", "edited.html"), '<c:ignore xmlns:c="contractpal"><p>After</p></c:ignore>');

    const lint = gateLint(record, dir);
    assert.equal(lint.errors, 0);
    assert.equal(lint.findings.some(f => f.rule === "hrefAction"), false);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint baseline-diffs per-file contract errors in a touched file", () => {
    const original = '<c:ignore xmlns:c="contractpal"><c:a href="?action=save">Save</c:a></c:ignore>';
    const dir = tmpWorkspace({ "fragments/form.html": original });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));

    fs.writeFileSync(path.join(dir, "fragments", "form.html"), original.replace("</c:ignore>", "<p>Clean edit</p></c:ignore>"));
    assert.equal(gateLint(record, dir).errors, 0, "preserving the baseline error must not block");

    fs.writeFileSync(path.join(dir, "fragments", "form.html"), original.replace(
        "</c:ignore>",
        '<c:a href="?action=delete">Delete</c:a></c:ignore>'
    ));
    const lint = gateLint(record, dir);
    assert.equal(lint.errors, 1);
    assert.equal(lint.findings[0].rule, "hrefAction");
    assert.match(lint.findings[0].message, /INTRODUCED 1 new/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint baseline-diffs unknown pal.json keys instead of treating them as workspace contracts", () => {
    const dir = tmpWorkspace({ "pal.json": JSON.stringify({ layuot: {} }) });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, []); // production serverPaths omits pal.json; snapshot must add it

    fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify({ layuot: {} }, null, 2));
    assert.equal(gateLint(record, dir).errors, 0, "the pre-existing unknown key must not block");

    fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify({ layuot: {}, stlyes: {} }, null, 2));
    const lint = gateLint(record, dir);
    assert.equal(lint.errors, 1);
    assert.equal(lint.findings[0].rule, "unknownPalJsonKey");
    assert.match(lint.findings[0].message, /INTRODUCED 1 new/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint baseline-diffs introduced manifest filename errors", () => {
    const original = JSON.stringify({
        fragments: { entry: [{ string: "x.html", Fragment: { name: "x", filename: "x.html" } }] }
    });
    const dir = tmpWorkspace({ "pal.json": original, "fragments/x.html": "<div>x</div>" });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));
    const changed = JSON.parse(original);
    changed.fragments.entry[0].Fragment.filename = "fragments/x.html";
    fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(changed));
    const lint = gateLint(record, dir);
    assert.ok(lint.findings.some(f => f.rule === "bannedFilenamePrefix" && f.severity === "error"));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("cache write failure cannot hide an introduced pal.json gate error", () => {
    const dir = tmpWorkspace({ "pal.json": JSON.stringify({ layuot: {} }) });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, []);
    fs.writeFileSync(path.join(dir, ".palsync", "cache"), "blocks cache directory creation");
    fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify({ layuot: {}, stlyes: {} }, null, 2));
    const lint = gateLint(record, dir);
    assert.equal(lint.errors, 1);
    assert.equal(lint.findings[0].rule, "unknownPalJsonKey");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint still blocks a pre-existing cross-file contract error in current form", () => {
    const dir = tmpWorkspace({
        "pages/console.html": '<html xmlns:c="contractpal"><body><c:fragment name="${frag}"/></body></html>',
        "workflows/console.js": "function run(controller) { var payload = controller.createPayload(); payload.set('main', 'list'); }",
        "fragments/edited.html": '<c:ignore xmlns:c="contractpal"><p>Before</p></c:ignore>',
    });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));

    fs.writeFileSync(path.join(dir, "fragments", "edited.html"), '<c:ignore xmlns:c="contractpal"><p>After</p></c:ignore>');

    const lint = gateLint(record, dir);
    assert.equal(lint.errors, 1);
    assert.ok(lint.findings.some(f => f.rule === "fragmentBinding" && f.severity === "error"));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint blocks a bare text input added to a design-system workspace", () => {
    const dir = tmpWorkspace({ "DESIGN_SYSTEM.md": "# system" });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));

    fs.mkdirSync(path.join(dir, "fragments"), { recursive: true });
    fs.writeFileSync(path.join(dir, "fragments", "form.html"),
        '<c:ignore xmlns:c="contractpal"><input type="text" /></c:ignore>');

    const lint = gateLint(record, dir);
    assert.equal(lint.errors, 1);
    assert.ok(lint.findings.some(f => f.rule === "designClassRequired" && f.severity === "error"));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint permits the same bare text input without a design system", () => {
    const dir = tmpWorkspace();
    const record = { fileHashes: {} };

    fs.mkdirSync(path.join(dir, "fragments"), { recursive: true });
    fs.writeFileSync(path.join(dir, "fragments", "form.html"),
        '<c:ignore xmlns:c="contractpal"><input type="text" /></c:ignore>');

    const lint = gateLint(record, dir);
    assert.equal(lint.errors, 0);
    assert.equal(lint.findings.some(f => f.rule === "designClassRequired"), false);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint does not re-block a baseline design-class error in a modified file", () => {
    const original = '<c:ignore xmlns:c="contractpal"><input type="text" /></c:ignore>';
    const dir = tmpWorkspace({
        "DESIGN_SYSTEM.md": "# system",
        "fragments/form.html": original,
    });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));

    fs.writeFileSync(path.join(dir, "fragments", "form.html"),
        original.replace("</c:ignore>", "<p>Clean edit</p></c:ignore>"));

    const lint = gateLint(record, dir);
    assert.equal(lint.errors, 0, "the pre-existing designClassRequired error must not block");
    assert.equal(lint.findings.some(f => f.rule === "designClassRequired"), false);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint surfaces pbSection and pbUndefinedClass warnings without blocking", () => {
    const dir = tmpWorkspace({
        "styles/styles.css": ".pb-btn {}",
        "fragments/screen.html": '<c:ignore xmlns:c="contractpal"><div class="pb-invented">Screen</div></c:ignore>',
    });
    const record = { fileHashes: {} };

    const lint = gateLint(record, dir);
    const byRule = new Map(lint.findings.map(f => [f.rule, f]));
    assert.equal(lint.errors, 0);
    for (const rule of ["pbSection", "pbUndefinedClass"]) {
        assert.equal(byRule.get(rule)?.severity, "warn", "expected advisory " + rule + " finding");
    }
    fs.rmSync(dir, { recursive: true, force: true });
});
