"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { gateLint } = require("../src/core/push");

const FIXTURES = path.join(__dirname, "fixtures");
const goodRoot = path.join(FIXTURES, "goodPals");

function copyFixture(...parts) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-gate-fixture-"));
    fs.cpSync(path.join(FIXTURES, ...parts), workspace, { recursive: true });
    return workspace;
}

for (const name of fs.readdirSync(goodRoot).sort()) {
    test("known-good pal is not blocked: " + name, () => {
        const workspace = copyFixture("goodPals", name);
        const lint = gateLint(null, workspace);
        assert.equal(lint.errors, 0, lint.findings
            .filter(finding => finding.severity === "error")
            .map(finding => finding.rule + " at " + finding.file + ":" + finding.line + " — " + finding.message)
            .join("\n"));
        fs.rmSync(workspace, { recursive: true, force: true });
    });
}

test("valid advisory patterns remain non-blocking", () => {
    const workspace = copyFixture("goodPals", "design-console");
    const lint = gateLint(null, workspace);
    const severities = new Map(lint.findings.map(finding => [finding.rule, finding.severity]));
    assert.equal(lint.errors, 0);
    for (const rule of ["designClassRequired", "debugTagShipped", "duplicateCase"]) {
        assert.equal(severities.get(rule), "warn", rule + " must remain advisory");
    }
    fs.rmSync(workspace, { recursive: true, force: true });
});

test("malformed manifest fixture still trips the entry-shape gate", () => {
    const workspace = copyFixture("badPals", "malformed-manifest");
    const lint = gateLint(null, workspace);
    const finding = lint.findings.find(item => item.rule === "malformedManifestEntry");
    assert.ok(finding, "expected malformedManifestEntry, got: " + lint.findings.map(item => item.rule).join(", "));
    assert.equal(finding.severity, "error");
    assert.ok(lint.errors > 0);
    fs.rmSync(workspace, { recursive: true, force: true });
});
