"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { validateWorkspace } = require("../src/core/validate");
const { lintMarkup } = require("../src/core/validate/markup");
const { tmpWorkspace } = require("./helpers");

test("c:debug is ignored by the deployed runtime and never produces a finding", () => {
    const dir = tmpWorkspace({
        "pages/index.html": "<html><body><c:debug /></body></html>"
    });
    assert.deepEqual(validateWorkspace(dir).findings.filter(f => /debug/i.test(f.rule + f.message)), []);
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
