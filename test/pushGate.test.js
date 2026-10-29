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

test("gateLint baseline-diffs inline pal.json dataset shape errors", () => {
    const valid = { datasets: { entry: [{ string: "things", Dataset: { name: "things", fields: {
        DatasetField: [{ fieldName: "thingId", fieldType: "Primary key" }]
    } } }] } };
    const dir = tmpWorkspace({ "pal.json": JSON.stringify(valid) });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, []);

    const wrong = structuredClone(valid);
    wrong.datasets.entry[0].Dataset.fields.DatasetField = [{ name: "thingId", type: "Primary key" }];
    fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(wrong));
    const lint = gateLint(record, dir);
    for (const rule of ["datasetWrongFieldKeys", "datasetFieldMissingName", "datasetFieldMissingType", "datasetNoColumns", "datasetNoPrimaryKey"]) {
        assert.ok(lint.findings.some(finding => finding.rule === rule && /INTRODUCED 1 new/.test(finding.message)), rule);
    }
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint does not re-block a pre-existing inline dataset shape error", () => {
    const wrong = { datasets: { entry: [{ string: "things", Dataset: { name: "things", fields: {
        DatasetField: [{ name: "thingId", type: "Primary key" }]
    } } }] } };
    const dir = tmpWorkspace({ "pal.json": JSON.stringify(wrong) });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, []);

    fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(wrong, null, 2));
    assert.equal(gateLint(record, dir).errors, 0);
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
        "pages/console.html": '<html xmlns:c="contractpal"><body><c:fragment name="nope"/></body></html>',
        "fragments/edited.html": '<c:ignore xmlns:c="contractpal"><p>Before</p></c:ignore>',
    });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));

    fs.writeFileSync(path.join(dir, "fragments", "edited.html"), '<c:ignore xmlns:c="contractpal"><p>After</p></c:ignore>');

    const lint = gateLint(record, dir);
    assert.equal(lint.errors, 1);
    assert.ok(lint.findings.some(f => f.rule === "missingFragment" && f.severity === "error"));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("gateLint blocks a static c:fragment that points at a fragment that is not shipped", () => {
    const dir = tmpWorkspace({
        "pages/console.html": '<c:ignore xmlns:c="contractpal"><c:fragment name="something"/></c:ignore>',
    });
    const record = { fileHashes: {} };
    const lint = gateLint(record, dir);
    assert.ok(lint.findings.some(f => f.rule === "missingFragment" && f.severity === "error"));
    assert.ok(lint.errors > 0);

    // Modified-file path: the cross-file rule must still block when the file has a baseline.
    fs.writeFileSync(path.join(dir, "pages", "console.html"), '<c:ignore xmlns:c="contractpal"><p>ok</p></c:ignore>');
    const clean = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(clean.fileHashes));
    fs.writeFileSync(path.join(dir, "pages", "console.html"), '<c:ignore xmlns:c="contractpal"><c:fragment name="something"/></c:ignore>');
    const edited = gateLint(clean, dir);
    assert.ok(edited.findings.some(f => f.rule === "missingFragment" && f.severity === "error"));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("lintContent emits every rule the registry gates as per-file", () => {
    const { lintContent } = require("../src/core/validate");
    const frag = (body) => '<c:ignore xmlns:c="contractpal">' + body + "</c:ignore>";
    const cases = [
        ["fragments/a.html", frag('<c:a action="">x</c:a>'), "emptyAction"],
        ["fragments/a.html", frag('<c:set name="eq" value="1"/>'), "reservedElWord"],
        ["workflows/a.js", "function run(c) { return pal.getPage('x'); }", "pageResponseSource"],
        ["workflows/a.js", "function run(c) { return c.createAjaxResponse(); }", "ajaxTransport"],
    ];
    for (const [rel, content, rule] of cases) {
        assert.ok(lintContent(rel, content).some(f => f.rule === rule), rule + " must be emitted by lintContent");
    }
});

test("gateLint lints a new library against its host's current globals", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "var notice;\nfunction run(controller) { return controller; }\n"
    });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));
    fs.mkdirSync(path.join(dir, "workflows", "libs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "workflows", "libs", "hist.js"),
        "function f() { notice = 'x'; nope = 1; }\n");
    fs.writeFileSync(path.join(dir, "workflows", "console.js"),
        "//@include(\"libs/hist\");\nvar notice;\nfunction run(controller) { return controller; }\n");
    const lint = gateLint(record, dir);
    const implicit = lint.findings.filter(f => f.rule === "implicitGlobal");
    assert.equal(implicit.length, 1);
    assert.match(implicit[0].message, /nope/);
    fs.rmSync(dir, { recursive: true, force: true });
});
