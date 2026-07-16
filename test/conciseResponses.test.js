"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { formatValidation } = require("../src/core/validate");
const { formatSeoAudit } = require("../src/core/seoAudit");
const { TOOLS, safeTestResult, formatPushValidationRefusal } = require("../src/mcp/tools");
const { tmpWorkspace } = require("./helpers");

test("lint formatting groups remediation but retains every rule, fix, and location", () => {
    const findings = [];
    for (let i = 1; i <= 30; i++) {
        findings.push({ severity: "error", rule: "debugTagShipped", file: "pages/demo.html", line: i,
            message: "Remove c:debug before shipping; debug output is shared." });
    }
    findings.push({ severity: "warn", rule: "customControlCss", file: "styles/app.css", line: 7,
        message: "Use the design-system control class instead." });
    const result = { findings, errors: 30, warnings: 1, filesChecked: 2 };
    const output = formatValidation(result);
    for (const finding of findings) {
        assert.match(output, new RegExp(finding.rule));
        assert.ok(output.includes(finding.file + ":" + finding.line));
        assert.ok(output.includes(finding.message));
    }
    assert.match(output, /29 repeated remediation line\(s\) grouped; every location retained/);
    assert.ok(Buffer.byteLength(output) < 1800, "grouped response stays below 1.8 KB");
});

test("pal_validate ends with a recoverable workspace-relative full-result artifact", async () => {
    const ws = tmpWorkspace({ "pages/demo.html": "<c:debug />\n" });
    const tool = TOOLS.find(value => value.name === "pal_validate");
    const result = await tool.run({ workspaceDir: ws }, {});
    const match = result.message.match(/Full result: (\.agent-work-history\/[^\n]+)$/);
    assert.ok(match, "stable trailer is the final line");
    const artifact = path.join(ws, ...match[1].split("/"));
    assert.equal(fs.existsSync(artifact), true);
    const raw = JSON.parse(fs.readFileSync(artifact, "utf8"));
    assert.deepStrictEqual(raw.findings, result.findings);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_test sanitization removes every credential-bearing field", () => {
    const safe = safeTestResult({ ran: true, rawToken: "secret-token", _previewUrl: "https://example.test/?token=secret", validated: true });
    assert.deepStrictEqual(safe, { ran: true, validated: true });
});

test("pal_push refusal groups 20+ duplicates with at least 50% reduction and no lost locations", () => {
    const findings = Array.from({ length: 25 }, (_, index) => ({
        severity: "error", rule: "debugTagShipped", file: "pages/demo.html", line: index + 1,
        message: "Remove c:debug before shipping; debug output is shared."
    }));
    const lint = { findings, errors: findings.length, warnings: 0, filesChecked: 1 };
    const legacy = findings.map(f => "ERROR " + f.rule + " " + f.file + ":" + f.line + " — " + f.message +
        " Fix this error before pushing; force cannot bypass validation.").join("\n\n");
    const output = formatPushValidationRefusal(lint);
    assert.ok(Buffer.byteLength(output) <= Buffer.byteLength(legacy) / 2);
    assert.match(output, /debugTagShipped/);
    for (const finding of findings) assert.ok(output.includes(finding.file + ":" + finding.line));
});

test("SEO audit groups 20+ duplicates with at least 50% reduction and preserves rule and remediation", () => {
    const message = "Add one canonical link to the page head. Fix: emit a stable absolute canonical URL.";
    const findings = Array.from({ length: 25 }, () => ({ severity: "error", rule: "canonicalMissing", message }));
    const result = { findings, passed: [], errors: findings.length, warnings: 0, url: "https://example.test/" };
    const legacy = findings.map(f => "ERROR " + f.rule + " — " + f.message).join("\n\n");
    const output = formatSeoAudit(result);
    assert.ok(Buffer.byteLength(output) <= Buffer.byteLength(legacy) / 2);
    assert.match(output, /canonicalMissing/);
    assert.ok(output.includes(message));
    assert.match(output, /24 duplicate finding\(s\) grouped/);
});
