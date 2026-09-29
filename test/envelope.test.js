"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { buildEnvelope, serializeEnvelope, modelView } = require("../src/mcp/envelope");
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
    assert.deepStrictEqual(parsed.envelope, modelView(first.envelope));
    assert.equal(parsed.trailer, "Full result: " + first.detailsRef);
    assert.equal(first.envelope.detailsRef, first.detailsRef, "the structured envelope keeps its fixed shape");
    const artifact = path.join(ws, first.detailsRef);
    assert.equal(fs.existsSync(artifact), true);
    assert.equal(first.rawBytes, fs.statSync(artifact).size, "usage bytes share the artifact's canonical serialization");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("the model view drops duplicated and null fields but keeps every root cause", () => {
    const envelope = buildEnvelope({ ok: false, filesChecked: 1, cacheHits: 0, cacheMisses: 1, findings: [
        { severity: "error", rule: "demo", file: "pages/a.html", line: 2, message: "Remove it. Fix: delete the tag." },
        { severity: "warn", rule: "own", file: "b.js", line: 3, message: "Explicit fix.", fix: "Do this." },
        { severity: "warn", rule: "none", file: "c.js", line: 4, message: "No fix here." }
    ], detailsRef: ".agent-work-history/pal_validate/ref.json" });
    const view = modelView(envelope);
    assert.deepStrictEqual(Object.keys(view), ["ok", "filesChecked", "diagnosticCount", "infoCount", "uniqueRootCauses", "diagnostics"]);
    assert.deepStrictEqual(view.diagnostics.map(item => [item.code, item.message, item.fix, item.locations]), [
        ["demo", "Remove it.", "delete the tag.", [{ file: "pages/a.html", line: 2 }]],
        ["own", "Explicit fix.", "Do this.", [{ file: "b.js", line: 3 }]],
        ["none", "No fix here.", undefined, [{ file: "c.js", line: 4 }]]
    ]);
    assert.equal(envelope.diagnostics[0].message, "Remove it. Fix: delete the tag.", "the structured envelope is not mutated");
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
