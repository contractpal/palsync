"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { validateWorkspace } = require("../src/core/validate");
const { lintMarkup } = require("../src/core/validate/markup");
const { tmpWorkspace } = require("./helpers");

test("design-system workspaces require core-control pb-* classes", () => {
    const dir = tmpWorkspace({
        "DESIGN_SYSTEM.md": "# system",
        "pages/index.html": "<html><body><button>Save</button><input type=\"text\" /></body></html>"
    });
    const findings = validateWorkspace(dir).findings.filter(f => f.rule === "designClassRequired");
    assert.equal(findings.length, 2);
    assert.ok(findings.every(f => f.severity === "error"));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("non-text input types are exempt from the pb-input requirement", () => {
    const dir = tmpWorkspace({
        "DESIGN_SYSTEM.md": "# system",
        "pages/index.html": "<html><body>" +
            "<input type=\"checkbox\" name=\"notify\" />" +
            "<input type=\"range\" name=\"threshold\" />" +
            "<input type=\"hidden\" name=\"id\" />" +
            "<input type=\"submit\" value=\"Go\" />" +
            "</body></html>"
    });
    assert.equal(validateWorkspace(dir).findings.filter(f => f.rule === "designClassRequired").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("core-control classes remain the old clean behavior without a design system", () => {
    const dir = tmpWorkspace({
        "pages/index.html": "<html><body><button>Save</button></body></html>"
    });
    assert.equal(validateWorkspace(dir).findings.filter(f => f.rule === "designClassRequired").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("shipped c:debug is a validation error", () => {
    const dir = tmpWorkspace({
        "pages/index.html": "<html><body><c:debug /></body></html>"
    });
    const findings = validateWorkspace(dir).findings.filter(f => f.rule === "debugTagShipped");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "error");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("core XHTML and c:tag rules emit their load-bearing findings", () => {
    const cases = [
        ["voidNotClosed", "pages/index.html", "<html><body><input name=\"x\"></body></html>"],
        ["unknownCAttr", "pages/index.html", "<c:a action=\"save\" invented=\"x\">Save</c:a>"],
        ["missingRequiredCAttr", "pages/index.html", "<c:if>Shown</c:if>"],
        ["scriptInFragment", "fragments/list.html", "<div><script>init();</script></div>"],
        ["elInInlineScript", "pages/index.html", "<html><script>var x = '${thing}';</script></html>"],
        ["domContentLoadedInFragment", "fragments/list.html", "<div><script>document.addEventListener('DOMContentLoaded', init);</script></div>"]
    ];
    for (const [rule, rel, src] of cases) {
        assert.ok(lintMarkup(rel, src).some(f => f.rule === rule), rule + " should be emitted");
    }
});

test("workspace without c:debug has no shipped-debug finding", () => {
    const dir = tmpWorkspace({ "pages/index.html": "<html><body><p>clean</p></body></html>" });
    assert.equal(validateWorkspace(dir).findings.filter(f => f.rule === "debugTagShipped").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});
