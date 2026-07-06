"use strict";
// The push gate has a per-file "new errors only" path, but cross-file contracts must still be
// evaluated against the whole current workspace. This catches the failure mode where pal_validate
// found a broken c:list/DataList contract and pal_push force:true still saved.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { gateLint } = require("../src/core/push");
const { hashWorkspaceFiles } = require("../src/core/workspaceHash");
const baseline = require("../src/core/baseline");
const { tmpWorkspace } = require("./helpers");

test("gateLint blocks current workspace-level list/DataList contract errors", () => {
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
    assert.equal(lint.errors, 1);
    assert.equal(lint.findings[0].rule, "listNameContract");
    assert.match(lint.findings[0].message, /items/);
    fs.rmSync(dir, { recursive: true, force: true });
});
