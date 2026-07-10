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
