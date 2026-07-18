"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { buildEnvelope } = require("../src/mcp/envelope");
const {
    seoEnvelopeResults, pushVisibilityFindings, testEnvelopeFindings, datasetSaveFindings,
    testEnvelopeProjection, seoEnvelopeProjection, pushEnvelopeProjection, testActionFields,
    failureLineSummary, addExpectContext, expectBodyBlock, debugHasDiagnosticLines, debugFailed, cappedFailureDebug,
    screenshotEnvelopeProjection
} = require("../src/mcp/tools");

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
    assert.deepStrictEqual(testActionFields({ ran: true, validated: true, kind: "web" }), {
        ran: true, validated: true, kind: "web", compileOnly: true
    });
});

test("tool projections keep diagnostics once and preserve actionable fields", () => {
    const finding = {
        severity: "error", rule: "brokenRoute", file: "workflows/web.js", line: 17,
        message: "Missing route. Fix: add the action branch."
    };
    const common = { ok: false, filesChecked: 2, findings: [finding], debug: "gate detail" };
    for (const projection of [
        testEnvelopeProjection(common),
        seoEnvelopeProjection(Object.assign({ passing: [] }, common)),
        pushEnvelopeProjection(Object.assign({ cacheHits: 1, cacheMisses: 0 }, common))
    ]) {
        const response = { ran: true, envelope: buildEnvelope(projection) };
        assert.equal(response.findings, undefined, "raw findings are not duplicated at top level");
        assert.equal(response.validation, undefined, "raw validation is not duplicated at top level");
        assert.equal(response.envelope.diagnostics.length, 1);
        assert.deepStrictEqual(response.envelope.diagnostics[0].locations, [{ file: finding.file, line: finding.line }]);
        assert.equal(response.envelope.diagnostics[0].fix, "add the action branch.");
    }
});

test("screenshot projection drops browser internals but keeps visual failures", () => {
    const projected = screenshotEnvelopeProjection({
        captured: true,
        available: true,
        kind: "console",
        url: "https://example.test/console",
        viewportName: "desktop",
        viewport: { width: 1280, height: 800 },
        renderError: null,
        styleStatus: {
            inspected: true, linked: 2, loaded: 1, likelyLoaded: false,
            missingStylesheets: ["styles/missing.css"], failedRequests: [], noisyInternal: "drop"
        },
        designAudit: {
            inspected: true, pass: false, errors: 1, warnings: 0,
            metrics: { horizontalOverflow: 20 },
            findings: [{ severity: "error", rule: "overflow", message: "Page overflows" }],
            notes: "full audit only"
        },
        pngBase64: "large-png",
        jpegSmallBase64: "small-jpeg",
        browserInternals: { headings: ["Equipment"] }
    }, { pngFile: "shot.png", message: "failed audit" });
    assert.equal(projected.pngBase64, undefined);
    assert.equal(projected.jpegSmallBase64, undefined);
    assert.equal(projected.browserInternals, undefined);
    assert.equal(projected.styleStatus.noisyInternal, undefined);
    assert.equal(projected.designAudit.notes, undefined);
    assert.deepStrictEqual(projected.designAudit.findings, [
        { severity: "error", rule: "overflow", message: "Page overflows" }
    ]);
    assert.deepStrictEqual(projected.styleStatus.missingStylesheets, ["styles/missing.css"]);
});

test("summary and debug collapse preserve every failure line and context", () => {
    const summary = failureLineSummary(["header", "before", "ERROR exploded", "after", "tail"].join("\n"));
    assert.match(summary, /before/);
    assert.match(summary, /ERROR exploded/);
    assert.match(summary, /after/);
    const expect = addExpectContext("one\ntwo\ntarget\nfour\nfive\nsix", [
        { string: "target", found: true, matchedLine: "target" },
        { string: "missing", found: false, matchedLine: null }
    ]);
    assert.deepStrictEqual(expect[0].context.map(item => item.text), ["one", "two", "target", "four", "five"]);
    assert.deepStrictEqual(expect[1].context, []);
    assert.match(expectBodyBlock("target\ntail", "summary"), /Failure lines/);
    assert.match(expectBodyBlock("target\ntail", "full"), /rendered HTML[\s\S]*target/);
    assert.equal(debugHasDiagnosticLines("early WARN clue\nclean tail"), true);
    assert.equal(debugFailed({ captured: true, pass: true, designAudit: { errors: 0 },
        message: "Design audit: 0 error(s), 0 warning(s)" }), false,
    "zero-error success text does not trigger full failure debug");
    assert.equal(debugFailed({ captured: true, pass: true, designAudit: { errors: 1 } }), true);

    const longFailure = failureLineSummary("x".repeat(2000) + " ERROR root " + "y".repeat(2000));
    assert.match(longFailure, /ERROR root/);
    assert.ok(longFailure.length < 700, "minified failure lines stay bounded");
    const longExpect = addExpectContext("x".repeat(2000) + "target" + "y".repeat(2000), [
        { string: "target", found: true, matchedLine: "target" }
    ]);
    assert.match(longExpect[0].context[0].text, /target/);
    assert.ok(longExpect[0].context[0].text.length <= 302, "minified expect context stays bounded");

    const debug = cappedFailureDebug("ordinary\n".repeat(9000) + "WARN clue\nERROR root\nFAIL final");
    assert.match(debug.text, /WARN clue/);
    assert.match(debug.text, /ERROR root/);
    assert.match(debug.text, /FAIL final/);
    assert.match(debug.text, /none matching error\/warn\/fail/);
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
