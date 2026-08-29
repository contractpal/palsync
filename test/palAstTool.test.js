"use strict";
// pal_ast TOOL-WRAPPER tests. The core function was covered by palAst.test.js while the advertised
// MCP tool threw on every call (envelopeProjection was defined but not exported), so these cross the
// descriptor from TOOLS -- the seam that includes envelope shaping -- using the same runner stub.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const palAst = require("../src/core/palAst");
const { TOOLS } = require("../src/mcp/tools");
const { tmpWorkspace, parseEnvelope } = require("./helpers");

const tool = TOOLS.find(item => item.name === "pal_ast");

const FORM_HTML = '<div>\n  <c:a href="/y">Skip</c:a>\n</div>\n';
const MANIFEST = JSON.stringify({ palName: "Demo", pages: { entry: ["pages/form.html"] } }, null, 2) + "\n";

function workspace() {
    return tmpWorkspace({ "pal.json": MANIFEST, "pages/form.html": FORM_HTML });
}

function match(ws, rel, text, replacement) {
    const content = fs.readFileSync(path.join(ws, rel), "utf8");
    const start = content.indexOf(text);
    assert.ok(start >= 0, rel + " must contain its match text");
    return {
        text,
        range: {
            byteOffset: { start, end: start + text.length },
            start: { line: 1, column: 2 },
            end: { line: 1, column: 2 + text.length }
        },
        file: rel,
        lines: text,
        charCount: { leading: 0, trailing: 0 },
        language: "Html",
        metaVariables: { single: {}, multi: {}, transformed: {} },
        ...(replacement === undefined ? {} : { replacement })
    };
}

function stubRunner(matches) {
    palAst._setRunnerForTests(() => ({ status: 0, stdout: JSON.stringify(matches), stderr: "" }));
}

beforeEach(() => {
    palAst._setResolutionForTests({ path: "stub-binary", viaPath: false });
    palAst._setRunnerForTests();
});
afterEach(() => {
    palAst._resetResolution();
    palAst._setRunnerForTests();
});

test("search through the MCP wrapper returns location-addressed astMatch diagnostics", async () => {
    const ws = workspace();
    stubRunner([match(ws, "pages/form.html", '<c:a href="/y">Skip</c:a>')]);
    const result = await tool.run({ workspaceDir: ws }, { lang: "html", pattern: '<c:a href="$H">$A</c:a>' });
    const { envelope } = parseEnvelope(result.message);
    assert.equal(envelope.ok, true);
    const hits = envelope.diagnostics.filter(d => d.code === "astMatch");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].file, "pages/form.html");
    assert.equal(hits[0].line, 2);
    assert.match(hits[0].message, /Skip/);
    assert.equal(result.matches.length, 1);
});

test("a refusal through the wrapper is a non-throwing ok:false envelope carrying the guidance", async () => {
    const ws = workspace();
    stubRunner([]);
    const result = await tool.run({ workspaceDir: ws }, { lang: "html", pattern: "^<c:a.*$" });
    const { envelope } = parseEnvelope(result.message);
    assert.equal(envelope.ok, false);
    const refusals = envelope.diagnostics.filter(d => d.code === "astRefused");
    assert.equal(refusals.length, 1);
    assert.match(refusals[0].message, /grep\/read/);
    assert.equal(result.refused, true);
    assert.equal(result.error.code, "regex-pattern");
});

test("a rewrite preview through the wrapper exposes astChange diagnostics and the diff summary", async () => {
    const ws = workspace();
    const replacement = '<c:a href="/y" confirm="1">Skip</c:a>';
    stubRunner([match(ws, "pages/form.html", '<c:a href="/y">Skip</c:a>', replacement)]);
    const result = await tool.run(
        { workspaceDir: ws },
        {
            mode: "rewrite",
            lang: "html",
            pattern: '<c:a href="$H">$A</c:a>',
            rewrite: '<c:a href="$H" confirm="1">$A</c:a>'
        }
    );
    const { envelope } = parseEnvelope(result.message);
    assert.equal(envelope.ok, true);
    const changes = envelope.diagnostics.filter(d => d.code === "astChange");
    assert.equal(changes.length, 1);
    assert.equal(changes[0].file, "pages/form.html");
    assert.equal(envelope.summary.filesChanged, 1);
    assert.match(envelope.summary.diff, /confirm="1"/);
    assert.equal(fs.readFileSync(path.join(ws, "pages/form.html"), "utf8"), FORM_HTML, "preview must not write");
});

test("apply:true through the MCP wrapper writes the file and returns the applied summary in the envelope", async () => {
    const ws = workspace();
    const replacement = '<c:a href="/y" confirm="1">Skip</c:a>';
    const m = match(ws, "pages/form.html", '<c:a href="/y">Skip</c:a>', replacement);
    stubRunner([m]);
    const preview = await tool.run({ workspaceDir: ws }, { mode: "rewrite", lang: "html", pattern: '<c:a href="$H">$A</c:a>', rewrite: '<c:a href="$H" confirm="1">$A</c:a>' });
    assert.equal(preview.preview.filesChanged, 1);
    stubRunner([m]);
    const result = await tool.run({ workspaceDir: ws }, { mode: "rewrite", lang: "html", pattern: '<c:a href="$H">$A</c:a>', rewrite: '<c:a href="$H" confirm="1">$A</c:a>', apply: true });
    assert.equal(result.applied.filesChanged, 1);
    assert.equal(result.applied.matchesApplied, 1);
    const { envelope } = parseEnvelope(result.message);
    assert.equal(envelope.summary.filesChanged, 1);
    assert.equal(envelope.summary.matchesApplied, 1);
    assert.ok(fs.readFileSync(path.join(ws, "pages/form.html"), "utf8").includes('confirm="1"'));
});
