"use strict";
// robots.txt/sitemap.xml/llms.txt audit checks — added after the palbuilder-seo skill rewrite
// (Gifthub Web + V2-OE-Website scan) surfaced that pal_seo_audit had no coverage for these
// files at all, even though both reference pals hit the "homepage HTML served as robots.txt"
// bug live (test/stage instances route every path through the workflow).
const { test } = require("node:test");
const assert = require("node:assert");
const { auditRobotsTxt, auditSitemapXml, auditCrawlerFile, auditHtml } = require("../src/core/seoAudit");

function severities(findings) { return findings.map(f => f.severity + ":" + f.rule); }

test("auditRobotsTxt: clean file passes", () => {
    const body = "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n";
    assert.deepEqual(auditRobotsTxt(body, "text/plain"), []);
});

test("auditRobotsTxt: homepage-HTML fallthrough is the one error reported", () => {
    const body = "<!doctype html><html><head><title>Home</title></head><body>Hi</body></html>";
    const findings = auditRobotsTxt(body, "text/html");
    assert.deepEqual(severities(findings), ["error:robotsFallthrough"]);
});

test("auditRobotsTxt: missing User-agent and Sitemap lines flagged", () => {
    const findings = auditRobotsTxt("Allow: /\n", "text/plain");
    assert.ok(findings.some(f => f.rule === "robotsMissingUserAgent" && f.severity === "error"));
    assert.ok(findings.some(f => f.rule === "robotsNoSitemapLine" && f.severity === "warn"));
});

test("auditRobotsTxt: relative Sitemap: line is an error", () => {
    const body = "User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n";
    const findings = auditRobotsTxt(body, "text/plain");
    assert.ok(findings.some(f => f.rule === "robotsSitemapRelative" && f.severity === "error"));
});

test("auditRobotsTxt: wrong content-type is a warning, not an error", () => {
    const body = "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n";
    const findings = auditRobotsTxt(body, "text/html");
    assert.deepEqual(severities(findings), ["warn:robotsContentType"]);
});

test("auditSitemapXml: clean file passes", () => {
    const body = "<?xml version=\"1.0\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">" +
        "<url><loc>https://example.com/</loc></url></urlset>";
    assert.deepEqual(auditSitemapXml(body, "application/xml"), []);
});

test("auditSitemapXml: homepage-HTML fallthrough is the one error reported", () => {
    const body = "<!doctype html><html><body>Hi</body></html>";
    const findings = auditSitemapXml(body, "text/html");
    assert.deepEqual(severities(findings), ["error:sitemapFallthrough"]);
});

test("auditSitemapXml: missing urlset and empty list both flagged", () => {
    const findings = auditSitemapXml("<?xml version=\"1.0\"?><foo></foo>", "application/xml");
    assert.ok(findings.some(f => f.rule === "sitemapMissingUrlset"));
    assert.ok(findings.some(f => f.rule === "sitemapEmpty"));
});

test("auditSitemapXml: text/xml content-type is accepted (not just application/xml)", () => {
    const body = "<?xml version=\"1.0\"?><urlset><url><loc>https://example.com/</loc></url></urlset>";
    assert.deepEqual(auditSitemapXml(body, "text/xml"), []);
});

test("auditCrawlerFile: 404 on a required file is an error", () => {
    const findings = auditCrawlerFile("robots", "robots.txt", { status: 404, html: "" }, true);
    assert.deepEqual(severities(findings), ["error:robotsMissing"]);
});

test("auditCrawlerFile: 404 on llms.txt (optional) is only a warning", () => {
    const findings = auditCrawlerFile("llms", "llms.txt", { status: 404, html: "" }, false);
    assert.deepEqual(severities(findings), ["warn:llmsMissing"]);
});

test("auditCrawlerFile: llms.txt present (200) has no checks beyond presence", () => {
    const findings = auditCrawlerFile("llms", "llms.txt", { status: 200, html: "# Anything" }, false);
    assert.deepEqual(findings, []);
});

// ---- auditHtml: newer on-page checks (all warnings) ----

function htmlWarnings(result, rule) {
    return result.findings.filter(f => f.rule === rule && f.severity === "warn");
}
function passedRule(result, rule) {
    return result.passed.some(p => p.rule === rule);
}

test("auditHtml htmlLang: missing lang warns, declared lang passes", () => {
    const missing = auditHtml("<html><body><p>x</p></body></html>");
    assert.equal(htmlWarnings(missing, "htmlLang").length, 1);
    const declared = auditHtml("<html lang=\"en\"><body><p>x</p></body></html>");
    assert.equal(htmlWarnings(declared, "htmlLang").length, 0);
    assert.ok(passedRule(declared, "htmlLang"));
});

test("auditHtml robotsNoindex: noindex warns, index passes", () => {
    const blocked = auditHtml("<html lang=\"en\"><head><meta name=\"robots\" content=\"noindex, follow\"/></head><body></body></html>");
    assert.equal(htmlWarnings(blocked, "robotsNoindex").length, 1);
    const indexable = auditHtml("<html lang=\"en\"><head><meta name=\"robots\" content=\"index, follow\"/></head><body></body></html>");
    assert.equal(htmlWarnings(indexable, "robotsNoindex").length, 0);
    assert.ok(passedRule(indexable, "robotsNoindex"));
});

test("auditHtml canonicalMultiple: two canonicals warn, one passes", () => {
    const two = auditHtml("<html lang=\"en\"><head>" +
        "<link rel=\"canonical\" href=\"https://example.com/a\"/>" +
        "<link rel=\"canonical\" href=\"https://example.com/b\"/>" +
        "</head><body></body></html>");
    assert.equal(htmlWarnings(two, "canonicalMultiple").length, 1);
    const one = auditHtml("<html lang=\"en\"><head><link rel=\"canonical\" href=\"https://example.com/a\"/></head><body></body></html>");
    assert.equal(htmlWarnings(one, "canonicalMultiple").length, 0);
    assert.ok(passedRule(one, "canonicalMultiple"));
});

test("auditHtml headingSkip: h1 to h3 warns, sequential headings pass", () => {
    const skip = auditHtml("<html lang=\"en\"><body><h1>Top</h1><h3>Skipped</h3></body></html>");
    assert.equal(htmlWarnings(skip, "headingSkip").length, 1);
    const clean = auditHtml("<html lang=\"en\"><body><h1>Top</h1><h2>Next</h2><h3>Then</h3></body></html>");
    assert.equal(htmlWarnings(clean, "headingSkip").length, 0);
    assert.ok(passedRule(clean, "headingSkip"));
});

test("auditHtml jsonLdInvalid: broken JSON and missing @type warn, valid block passes", () => {
    const broken = auditHtml("<html lang=\"en\"><head>" +
        "<script type=\"application/ld+json\">{ not json }</script>" +
        "<script type=\"application/ld+json\">{\"@context\":\"https://schema.org\"}</script>" +
        "</head><body></body></html>");
    const brokenFindings = htmlWarnings(broken, "jsonLdInvalid");
    assert.equal(brokenFindings.length, 1);
    assert.match(brokenFindings[0].message, /block 1 is not valid JSON[\s\S]*block 2 has no @type/);
    const valid = auditHtml("<html lang=\"en\"><head><script type=\"application/ld+json\">" +
        "{\"@context\":\"https://schema.org\",\"@type\":\"WebSite\"}</script></head><body></body></html>");
    assert.equal(htmlWarnings(valid, "jsonLdInvalid").length, 0);
    assert.ok(passedRule(valid, "jsonLdInvalid"));
});

test("auditHtml imgDimensions: missing width/height warns, both present pass", () => {
    const missing = auditHtml("<html lang=\"en\"><body><img src=\"../Images/a.jpg\" alt=\"A\"/></body></html>");
    assert.equal(htmlWarnings(missing, "imgDimensions").length, 1);
    const sized = auditHtml("<html lang=\"en\"><body><img src=\"../Images/a.jpg\" alt=\"A\" width=\"800\" height=\"600\"/></body></html>");
    assert.equal(htmlWarnings(sized, "imgDimensions").length, 0);
    assert.ok(passedRule(sized, "imgDimensions"));
});

test("auditHtml thinContent: under 150 words warns, 150+ words pass", () => {
    const thin = auditHtml("<html lang=\"en\"><body><p>Short page.</p></body></html>");
    assert.equal(htmlWarnings(thin, "thinContent").length, 1);
    const full = auditHtml("<html lang=\"en\"><body><p>" + Array(160).fill("word").join(" ") + "</p></body></html>");
    assert.equal(htmlWarnings(full, "thinContent").length, 0);
    assert.ok(passedRule(full, "thinContent"));
});
