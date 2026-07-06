"use strict";
// Pure tests for workflow JavaScript lint rules. These catch weak-model failures before a push
// reaches PalBuilder's more permissive compile gate.
const { test } = require("node:test");
const assert = require("node:assert");
const { lintWorkflowJs } = require("../src/core/validate/workflowJs");

test("lintWorkflowJs: duplicate switch action labels are errors", () => {
    const src = [
        "function main() {",
        "  var action = parameters.get('action');",
        "  switch (action) {",
        "    case 'save':",
        "      return 'first';",
        "    case 'delete':",
        "      return 'delete';",
        "    case 'save':",
        "      return 'second';",
        "  }",
        "}"
    ].join("\n");
    const findings = lintWorkflowJs("workflows/main.js", src);
    const dupes = findings.filter(f => f.rule === "duplicateCase");
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].severity, "error");
    assert.equal(dupes[0].line, 8);
    assert.match(dupes[0].message, /duplicate case "save"/i);
    assert.match(dupes[0].message, /first defined on line 4/i);
});

test("lintWorkflowJs: identical labels in different switches are allowed", () => {
    const src = [
        "function main() {",
        "  switch (a) { case 'save': return 1; }",
        "  switch (b) { case 'save': return 2; }",
        "}"
    ].join("\n");
    assert.equal(lintWorkflowJs("workflows/main.js", src).filter(f => f.rule === "duplicateCase").length, 0);
});
