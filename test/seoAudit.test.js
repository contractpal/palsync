"use strict";
// robots.txt/sitemap.xml/llms.txt audit checks — added after the seo-core skill rewrite
// (Gifthub Web + V2-OE-Website scan) surfaced that pal_seo_audit had no coverage for these
// files at all, even though both reference pals hit the "homepage HTML served as robots.txt"
// bug live (test/stage instances route every path through the workflow).
const { test } = require("node:test");
const assert = require("node:assert");
const { auditRobotsTxt, auditSitemapXml, auditCrawlerFile } = require("../src/core/seoAudit");

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
