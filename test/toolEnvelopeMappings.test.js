"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { seoEnvelopeResults, pushVisibilityFindings, testEnvelopeFindings, datasetSaveFindings } = require("../src/mcp/tools");

test("sitewide SEO envelope keeps page, fetch, crawler, and passing details", () => {
    const result = seoEnvelopeResults({
        pages: [
            { page: "index.html", findings: [{ severity: "warn", rule: "title", message: "Short title" }], passed: [{ rule: "h1", message: "H1 present" }] },
            { page: "missing.html", fetchFailed: true, status: 404, findings: [] }
        ],
        crawlerFiles: {
            robots: { label: "robots.txt", findings: [{ severity: "error", rule: "robots", message: "Missing sitemap" }] }
        }
    });
    assert.deepStrictEqual(result.findings.map(item => [item.rule, item.file]), [
        ["title", "index.html"], ["pageFetch", "missing.html"], ["robots", "robots.txt"]
    ]);
    assert.deepStrictEqual(result.passing, [{ rule: "h1", message: "H1 present", file: "index.html" }]);
});

test("dataset save refusals keep drift and lock remediation in findings", () => {
    const drift = datasetSaveFindings({ saveResult: { refused: "drift" } });
    assert.equal(drift[0].rule, "datasetSaveDrift");
    assert.match(drift[0].message, /pal_pull first/);
    assert.match(drift[0].message, /force:true/);

    const locked = datasetSaveFindings({ saveResult: { refused: "gui-lock-other" } });
    assert.equal(locked[0].rule, "datasetSaveLock");
    assert.match(locked[0].message, /Resolve or release the lock/);
});

test("pal_test envelope keeps server failure, verdict, and preview status", () => {
    const findings = testEnvelopeFindings({
        validated: false,
        validation: [],
        messages: [{ type: "error", message: "Pal is not a Web Pal" }]
    }, "Live preview available but NOT opened", "web workflow did NOT validate");
    assert.deepStrictEqual(findings.map(item => [item.severity, item.rule]), [
        ["error", "serverMessage"], ["info", "testVerdict"], ["info", "previewStatus"]
    ]);
    assert.match(findings[0].message, /Pal is not a Web Pal/);
    assert.match(findings[2].message, /NOT opened/);
});

test("push envelope warns for every unpushed stray and skipped file", () => {
    const findings = pushVisibilityFindings({
        strayCreatable: ["pages/unregistered.html"],
        skipped: [{ type: "documents", file: "brief.pdf", reason: "new entry — not creatable via push (use PalBuilder)" }]
    });
    assert.deepStrictEqual(findings.map(item => [item.severity, item.rule, item.file]), [
        ["warn", "strayCreatable", "pages/unregistered.html"],
        ["warn", "pushSkipped", "documents/brief.pdf"]
    ]);
    assert.match(findings[1].message, /not creatable via push/);
});
