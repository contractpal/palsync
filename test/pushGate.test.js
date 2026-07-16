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
    assert.equal(lint.warnings, 1);
    assert.equal(lint.findings[0].rule, "listNameContract");
    assert.equal(lint.findings[0].severity, "warn");
    assert.match(lint.findings[0].message, /items/);
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
    assert.equal(lint.findings[0].rule, "fragmentBinding");
    fs.rmSync(dir, { recursive: true, force: true });
});
