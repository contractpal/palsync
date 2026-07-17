"use strict";
// Pure tests for workflow JavaScript lint rules. These catch weak-model failures before a push
// reaches PalBuilder's more permissive compile gate.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
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

test("lintWorkflowJs: undeclared run globals are errors", () => {
    const src = [
        "function run(controller) {",
        "  c = controller;",
        "  page = c.getPage('console');",
        "  payload = c.createPayload();",
        "  return page;",
        "}"
    ].join("\n");
    const findings = lintWorkflowJs("workflows/console.js", src);
    const implicit = findings.filter(f => f.rule === "implicitGlobal");
    assert.equal(implicit.length, 3);
    assert.deepEqual(implicit.map(f => f.line), [2, 3, 4]);
    assert.match(implicit[0].message, /Variable <name> not declared|Function run doesn't return value/i);
    assert.match(implicit[0].message, /declare the variable with 'var'/i);
});

test("lintWorkflowJs: top-of-file workflow globals may be assigned in run", () => {
    const src = [
        "var c;",
        "var page;",
        "var payload;",
        "var pal;",
        "var request;",
        "var frag;",
        "var ajax;",
        "",
        "function run(controller) {",
        "  c = controller;",
        "  page = c.getPage('console');",
        "  payload = c.createPayload();",
        "  pal = c.getPal();",
        "  request = c.getRequest();",
        "  frag = 'equipmentList';",
        "  if (request.isAjax()) {",
        "    ajax = c.createAjaxResponse(pal.getAjaxFragment(frag), true);",
        "    ajax.addPayload(payload);",
        "    return ajax;",
        "  }",
        "  payload.set('frag', frag);",
        "  page.addPayload(payload);",
        "  return page;",
        "}"
    ].join("\n");
    assert.equal(lintWorkflowJs("workflows/console.js", src).filter(f => f.rule === "implicitGlobal").length, 0);
});

test("lintWorkflowJs: local run variables may be assigned after declaration", () => {
    const src = [
        "function run(controller) {",
        "  var c = controller;",
        "  var page = c.getPage('console');",
        "  page = c.getPage('console');",
        "  return page;",
        "}"
    ].join("\n");
    assert.equal(lintWorkflowJs("workflows/console.js", src).filter(f => f.rule === "implicitGlobal").length, 0);
});

test("lintWorkflowJs: helper-local declarations do not satisfy run globals", () => {
    const src = [
        "function helper() {",
        "  var c = null;",
        "  return c;",
        "}",
        "function run(controller) {",
        "  c = controller;",
        "  return c.getPage('console');",
        "}"
    ].join("\n");
    const implicit = lintWorkflowJs("workflows/console.js", src).filter(f => f.rule === "implicitGlobal");
    assert.equal(implicit.length, 1);
    assert.equal(implicit[0].line, 6);
});

test("lintWorkflowJs: unsupported String/Array methods are errors", () => {
    const src = [
        "function run(controller) {",
        "  var name = controller.getName().trim();",
        "  var hasName = name.includes('x');",
        "  var first = name.indexOf('x');",
        "  return first;",
        "}"
    ].join("\n");
    const findings = lintWorkflowJs("workflows/main.js", src);
    const banned = findings.filter(f => f.rule === "bannedMethod");
    assert.equal(banned.length, 2);
    assert.ok(banned.every(f => f.severity === "error"));
});

test("lintWorkflowJs: ES3 String methods remain clean", () => {
    const src = "function run(controller) { var name = controller.getName(); return name.substring(0, name.length); }";
    assert.equal(lintWorkflowJs("workflows/main.js", src).filter(f => f.rule === "bannedMethod").length, 0);
});

test("lintWorkflowJs: calling length is a warning; property access is clean", () => {
    const src = "function run(controller) { var s = controller.getName(); return s.length() + s.length; }";
    const findings = lintWorkflowJs("workflows/main.js", src).filter(f => f.rule === "lengthCall");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warn");
    assert.match(findings[0].message, /drop the parentheses/i);
});

test("lintWorkflowJs: findRecord cannot read a column excluded by selectColumns", () => {
    const src = [
        "function load(controller) {",
        "  var view = controller.getPal().getDataView('items');",
        "  var filter = view.createFilter();",
        "  filter.selectColumns(['id', 'name']);",
        "  var record = view.findRecord(filter);",
        "  return record.get('status');",
        "}",
    ].join("\n");
    const findings = lintWorkflowJs("workflows/main.js", src).filter(f => f.rule === "findRecordSelectColumns");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warn");
    assert.equal(findings[0].line, 6);
    assert.match(findings[0].message, /add the column|remove the projection/i);
});

test("lintWorkflowJs: safe and uncertain record lookup paths stay clean", () => {
    const sources = [
        "function f(v) { var q=v.createFilter(); q.selectColumns(['id']); var r=v.findRecord(q); return r.get('id'); }",
        "function f(v) { var r=v.findRecord('id', '1'); return r.get('name'); }",
        "function f(v) { var q=v.createFilter(); q.selectColumns(['id']); var rows=v.getRecords(q); return rows.get('name'); }",
        "function f(v, cols) { var q=v.createFilter(); q.selectColumns(cols); var r=v.findRecord(q); return r.get('name'); }",
        "function f(v) { var q=v.createFilter(); q['selectColumns'](['id']); var r=v.findRecord(q); return r.get('name'); }",
        "function f(v) { var q=v.createFilter(); q.selectColumns(['id']); var r=v.findRecord(q); q=v.createFilter(); return r.get('name'); }",
        "function f(v) { var q=v.createFilter(); var r=v.findRecord(q); q.selectColumns(['id']); return r.get('name'); }",
    ];
    for (const src of sources) {
        assert.equal(lintWorkflowJs("workflows/main.js", src).filter(f => f.rule === "findRecordSelectColumns").length, 0);
    }
});

test("lintWorkflowJs: regression fixture pins the exact rule and severity set", () => {
    const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "workflowJs", "regression.js"), "utf8");
    const findings = lintWorkflowJs("workflows/regression.js", fixture);
    assert.deepEqual(findings.map(f => ({ rule: f.rule, severity: f.severity })), [
        { rule: "findRecordSelectColumns", severity: "warn" },
        { rule: "bannedMethod", severity: "error" },
        { rule: "lengthCall", severity: "warn" },
    ]);
});

test("lintWorkflowJs: unconditional render call after frag-validator handler is flagged", () => {
    const src = [
        "function saveItem() {",
        "  if (c.getData().get('name') === '') {",
        "    frag = 'form';",
        "    return false;",
        "  }",
        "  frag = 'list';",
        "  return true;",
        "}",
        "function getDashboard() {",
        "  frag = 'list';",
        "}",
        "function run(controller) {",
        "  var action = c.getRequest().getData().get('action');",
        "  switch (action) {",
        "    case 'saveItem':",
        "      saveItem();",
        "      getDashboard();",
        "      break;",
        "    default:",
        "      getDashboard();",
        "  }",
        "}"
    ].join("\n");
    const findings = lintWorkflowJs("workflows/main.js", src).filter(f => f.rule === "fragClobber");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "error");
    assert.equal(findings[0].line, 17);
    assert.match(findings[0].message, /frag clobber/i);
    assert.match(findings[0].message, /wrap the follow-up render in the handler's success return/i);
    assert.match(findings[0].message, /if \(saveItem\(\)\) \{ getDashboard\(\); \}/);
});

test("lintWorkflowJs: conditional render call on handler success is not flagged", () => {
    const src = [
        "function saveItem() {",
        "  if (c.getData().get('name') === '') {",
        "    frag = 'form';",
        "    return false;",
        "  }",
        "  frag = 'list';",
        "  return true;",
        "}",
        "function getDashboard() {",
        "  frag = 'list';",
        "}",
        "function run(controller) {",
        "  var action = c.getRequest().getData().get('action');",
        "  switch (action) {",
        "    case 'saveItem':",
        "      if (saveItem()) { getDashboard(); }",
        "      break;",
        "  }",
        "}"
    ].join("\n");
    assert.equal(lintWorkflowJs("workflows/main.js", src).filter(f => f.rule === "fragClobber").length, 0);
});

test("lintWorkflowJs: handler with only one frag assignment does not trigger fragClobber", () => {
    const src = [
        "function saveItem() {",
        "  frag = 'list';",
        "  return true;",
        "}",
        "function getDashboard() {",
        "  frag = 'list';",
        "}",
        "function run(controller) {",
        "  switch (action) {",
        "    case 'saveItem':",
        "      saveItem();",
        "      getDashboard();",
        "      break;",
        "  }",
        "}"
    ].join("\n");
    assert.equal(lintWorkflowJs("workflows/main.js", src).filter(f => f.rule === "fragClobber").length, 0);
});
