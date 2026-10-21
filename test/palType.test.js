"use strict";
// pal.json palType must be an exact server constant. Repros come from the 2026-10-21 eval: two
// hand-written console pages ("console", "CONSOLE") passed local lint and rendered "Console Error".
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { checkPalTypes } = require("../src/core/validate/palJson");
const { validateWorkspace } = require("../src/core/validate");
const { gateLint } = require("../src/core/push");
const { hashWorkspaceFiles } = require("../src/core/workspaceHash");
const baseline = require("../src/core/baseline");
const { tmpWorkspace } = require("./helpers");

function manifest(palType) {
    const page = { name: "console", filename: "console.html" };
    if (palType !== undefined) page.palType = palType;
    return { pages: { entry: [{ string: "console.html", Page: page }] } };
}

const rules = findings => findings.map(f => f.rule);

test("palTypeWeb and palTypeConsole pass", () => {
    assert.deepEqual(checkPalTypes(manifest("palTypeWeb")), []);
    assert.deepEqual(checkPalTypes(manifest("palTypeConsole")), []);
});

test("other vendored server palType constants pass", () => {
    for (const t of ["palTypeCommon", "palTypeRobots", "palTypeServiceRequest", "palTypeHead", "palTypeGrinder"]) {
        assert.deepEqual(checkPalTypes(manifest(t)), [], t);
    }
});

test("eval repros and arbitrary strings are rejected", () => {
    for (const t of ["console", "CONSOLE", "web", "palTypeconsole", "page"]) {
        assert.deepEqual(rules(checkPalTypes(manifest(t))), ["invalidPalType"], t);
    }
});

test("missing palType stays allowed", () => {
    assert.deepEqual(checkPalTypes(manifest(undefined)), []);
    assert.deepEqual(checkPalTypes({ workflows: { entry: { string: "console.js", Workflow: { filename: "console.js" } } } }), []);
});

test("diagnostic names the entry, the bad value, and the accepted values", () => {
    const [f] = checkPalTypes(manifest("console"));
    assert.equal(f.severity, "error");
    assert.match(f.message, /pages\.entry\[0\]\.Page\.palType "console"/);
    assert.match(f.message, /"palTypeWeb" or "palTypeConsole" \(exact case\)/);
});

test("a single-entry section serialized as a bare object is still checked", () => {
    const m = { fragments: { entry: { string: "a.html", Fragment: { filename: "a.html", palType: "CONSOLE" } } } };
    assert.deepEqual(rules(checkPalTypes(m)), ["invalidPalType"]);
});

test("pal_validate path blocks an invalid palType and points at its line", () => {
    const dir = tmpWorkspace({
        "pal.json": JSON.stringify(manifest("CONSOLE"), null, 2),
        "pages/console.html": "<html><body>x</body></html>",
    });
    const result = validateWorkspace(dir);
    const f = result.findings.find(x => x.rule === "invalidPalType");
    assert.ok(f, "invalidPalType reported");
    assert.equal(f.severity, "error");
    assert.ok(result.errors >= 1);
    assert.equal(JSON.stringify(manifest("CONSOLE"), null, 2).split("\n")[f.line - 1].trim(), '"palType": "CONSOLE"');
    fs.rmSync(dir, { recursive: true, force: true });
});

test("push gate blocks an introduced invalid palType before any server call", () => {
    const dir = tmpWorkspace({
        "pal.json": JSON.stringify(manifest("palTypeConsole")),
        "pages/console.html": "<html><body>x</body></html>",
    });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));
    fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(manifest("console")));
    const lint = gateLint(record, dir);
    assert.ok(lint.findings.some(f => f.rule === "invalidPalType" && f.severity === "error"));
    assert.ok(lint.errors >= 1);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("push gate does not block a pre-existing invalid palType in an untouched pal.json", () => {
    const dir = tmpWorkspace({
        "pal.json": JSON.stringify(manifest("console")),
        "pages/console.html": "<html><body>x</body></html>",
    });
    const record = { fileHashes: hashWorkspaceFiles(dir).files };
    baseline.snapshot(dir, Object.keys(record.fileHashes));
    fs.writeFileSync(path.join(dir, "pages", "console.html"), "<html><body>y</body></html>");
    assert.ok(!gateLint(record, dir).findings.some(f => f.rule === "invalidPalType" && f.severity === "error"));
    fs.rmSync(dir, { recursive: true, force: true });
});
