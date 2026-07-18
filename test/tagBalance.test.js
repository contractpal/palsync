"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { lintTagBalance } = require("../src/core/validate/tagBalance");

test("stray closing tags are rejected", () => {
    const findings = lintTagBalance("fragments/list.html", "<div></span></div>");
    assert.ok(findings.some(f => f.rule === "strayCloseTag"));
});

test("unclosed opening tags are rejected", () => {
    const findings = lintTagBalance("pages/index.html", "<html><body><section></body></html>");
    assert.ok(findings.some(f => f.rule === "unclosedTag"));
});
