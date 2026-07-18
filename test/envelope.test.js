"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { buildEnvelope, serializeEnvelope } = require("../src/mcp/envelope");
const { tmpWorkspace, parseEnvelope } = require("./helpers");

test("envelope serialization is byte-identical and keeps the trailer last", () => {
    const ws = tmpWorkspace();
    const source = { ok: false, filesChecked: 1, cacheHits: 0, cacheMisses: 1, findings: [
        { severity: "error", rule: "demo", file: "pages/a.html", line: 2, message: "Remove it. Fix: delete the tag." }
    ] };
    const first = serializeEnvelope(ws, "pal_validate", source);
    const second = serializeEnvelope(ws, "pal_validate", source);
    assert.equal(second.message, first.message);
    const parsed = parseEnvelope(first.message);
    assert.deepStrictEqual(parsed.envelope, first.envelope);
    assert.equal(parsed.envelope.detailsRef, first.detailsRef);
    assert.equal(fs.existsSync(path.join(ws, first.detailsRef)), true);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("truncation collapses repeats without dropping a unique root cause", () => {
    const findings = [];
    for (let line = 1; line <= 20; line++) findings.push({ severity: "error", rule: "same", file: "a.js", line, message: "Same cause" });
    findings.push({ severity: "warn", rule: "unique", file: "b.js", line: 9, message: "Different cause" });
    const envelope = buildEnvelope({ findings, detailsRef: ".agent-work-history/pal_validate/ref.json" }, {
        detail: "full", maxDiagnostics: 2, maxBytes: 1
    });
    assert.equal(envelope.diagnosticCount, 21);
    assert.equal(envelope.uniqueRootCauses, 2);
    assert.deepStrictEqual(envelope.diagnostics.map(item => item.code), ["same", "unique"]);
    assert.deepStrictEqual(envelope.diagnostics.map(item => item.occurrences), [20, 1]);
    assert.ok(envelope.diagnostics.every(item => item.locations.length >= 1));
});

test("diagnostics have a stable severity/file/line/code order", () => {
    const envelope = buildEnvelope({ findings: [
        { severity: "warn", rule: "z", file: "a", line: 1, message: "z" },
        { severity: "error", rule: "b", file: "b", line: 2, message: "b" },
        { severity: "error", rule: "a", file: "b", line: 1, message: "a" }
    ] });
    assert.deepStrictEqual(envelope.diagnostics.map(item => item.code), ["a", "b", "z"]);
});

test("informational server notes do not inflate diagnosticCount", () => {
    const envelope = buildEnvelope({ findings: [
        { severity: "info", code: "workflow", message: "vCPU: 4, batchSize: 100" },
        { severity: "warn", code: "actionable", message: "Review this" }
    ] });
    assert.equal(envelope.diagnosticCount, 1);
    assert.equal(envelope.infoCount, 1);
    assert.equal(envelope.diagnostics.length, 2);
});
