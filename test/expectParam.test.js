"use strict";
// §1 token-efficient verification: expect (verdict-only string checks), selector (region
// extraction), maxChars (truncation), and the repeated-finding cap. All pure — no server needed.
const { test } = require("node:test");
const assert = require("node:assert");
const { checkExpect, extractSelector } = require("../src/core/preview");
const { capRepeats } = require("../src/core/findingCap");
const { formatExpect, htmlRegionResult } = require("../src/mcp/tools");

const HTML = [
    "<html>",
    "<head><title>Widgets</title></head>",
    "<body>",
    '  <nav class="main-nav top"><a href="/about">About</a></nav>',
    '  <main id="content">',
    "    <h1>Buy Widgets Today</h1>",
    "    <p>Best widgets in town.</p>",
    "  </main>",
    "</body>",
    "</html>"
].join("\n");

test("checkExpect: hit reports found + the matched line; miss reports not found", () => {
    const r = checkExpect(HTML, ["Buy Widgets Today", "Nonexistent String"]);
    assert.equal(r.pass, false);
    assert.deepEqual(r.results[0], { string: "Buy Widgets Today", found: true, matchedLine: "<h1>Buy Widgets Today</h1>" });
    assert.deepEqual(r.results[1], { string: "Nonexistent String", found: false, matchedLine: null });
});

test("checkExpect: pass is true only when every string is found", () => {
    assert.equal(checkExpect(HTML, ["Widgets", "Best widgets"]).pass, true);
    assert.equal(checkExpect(HTML, []).pass, true); // vacuously
});

test("extractSelector: by class returns that element's outerHTML", () => {
    assert.equal(extractSelector(HTML, ".main-nav"), '<nav class="main-nav top"><a href="/about">About</a></nav>');
});

test("extractSelector: by id, by tag, and no-match", () => {
    assert.ok(extractSelector(HTML, "#content").startsWith('<main id="content">'));
    assert.ok(extractSelector(HTML, "#content").trim().endsWith("</main>"));
    assert.equal(extractSelector(HTML, "h1"), "<h1>Buy Widgets Today</h1>");
    assert.equal(extractSelector(HTML, "#missing"), null);
    assert.equal(extractSelector(HTML, ".no-such-class"), null);
});

test("extractSelector: tag.class combined selector", () => {
    assert.equal(extractSelector(HTML, "nav.main-nav"), '<nav class="main-nav top"><a href="/about">About</a></nav>');
    assert.equal(extractSelector(HTML, "nav.absent"), null);
});

test("capRepeats: keeps first N per key, counts the overflow", () => {
    const findings = [
        { rule: "imgAlt" }, { rule: "imgAlt" }, { rule: "imgAlt" }, { rule: "imgAlt" }, { rule: "imgAlt" },
        { rule: "title" }
    ];
    const { shown, more } = capRepeats(findings, f => f.rule, 3);
    assert.equal(shown.filter(f => f.rule === "imgAlt").length, 3);
    assert.equal(shown.filter(f => f.rule === "title").length, 1);
    assert.deepEqual(more, [{ key: "imgAlt", count: 2 }]);
});

test("capRepeats: nothing collapsed when under the cap", () => {
    const { shown, more } = capRepeats([{ rule: "a" }, { rule: "b" }], f => f.rule, 3);
    assert.equal(shown.length, 2);
    assert.deepEqual(more, []);
});

test("htmlRegionResult: maxChars truncates the inlined body and flags it, no html field", () => {
    const res = { html: "x".repeat(5000), status: 200, contentType: "text/html", title: "T", bytes: 5000 };
    const out = htmlRegionResult(res, { headline: "Fetched a", filePrefix: "t-", guid: "g", maxChars: 100 });
    assert.ok(!("html" in out), "raw html must not be returned");
    assert.match(out.message, /first 100 of 5000 bytes/);
});

test("htmlRegionResult: selector extracts the region; miss reports and inlines nothing", () => {
    const res = { html: "<body><nav id=\"m\">HI</nav></body>", status: 200, contentType: "text/html", title: "T", bytes: 33 };
    const hit = htmlRegionResult(res, { headline: "Fetched a", filePrefix: "t-", guid: "g", selector: "#m" });
    assert.match(hit.message, /selected markup/);
    assert.match(hit.message, /<nav id="m">HI<\/nav>/);
    const miss = htmlRegionResult(res, { headline: "Fetched a", filePrefix: "t-", guid: "g", selector: "#absent" });
    assert.match(miss.message, /matched nothing/);
    assert.equal(miss.htmlFile, null);
});

test("formatExpect: verdict line + per-string marks, no page body", () => {
    const chk = checkExpect("<h1>Hi There</h1>", ["Hi There", "Bye"]);
    const msg = formatExpect("Fetched x", { status: 200, bytes: 17 }, chk);
    assert.match(msg, /1 of 2 expected string\(s\) MISSING/);
    assert.match(msg, /✓ found "Hi There"/);
    assert.match(msg, /✗ MISSING "Bye"/);
    // shows the single matched line for context (bounded), not the whole page body.
    assert.ok(msg.length < 300, "verdict is compact, not the page body");
});
