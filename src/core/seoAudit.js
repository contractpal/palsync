"use strict";
// pal_seo_audit core: fetch the LAST-PUSHED render of a WEB pal (reuses pal_preview's plumbing)
// and run deterministic on-page SEO checks against the actual HTML the server serves.
//
// Why these checks: the first real palsync build (OBE homepage, June 2026) shipped two SEO
// defects a render-audit would have caught — a RELATIVE og:image (social scrapers can't resolve
// it) and raw non-ASCII in meta content attributes (server validation note). This tool makes
// that class of mistake impossible to miss. Checks run on the RENDERED output, so they verify
// what crawlers actually see — not what the source intends.
//
// auditHtml(html, {url}) is pure (offline-testable). Severity:
//   "error" = will materially hurt search/social handling of the page
//   "warn"  = best-practice gap; review it
// Every finding is a full sentence with the fix — built for the least capable agent.
const { runPreview, openInstanceSession } = require("./preview");
const { capRepeats } = require("./findingCap");
const fs = require("fs");
const path = require("path");

function collectMetas(html) {
    const metas = [];
    const re = /<meta\b[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
        const tag = m[0];
        const name = (tag.match(/\bname=["']([^"']*)["']/i) || [])[1];
        const property = (tag.match(/\bproperty=["']([^"']*)["']/i) || [])[1];
        const content = (tag.match(/\bcontent=["']([^"']*)["']/i) || [])[1];
        metas.push({ key: (property || name || "").toLowerCase(), content: content !== undefined ? content : null });
    }
    return metas;
}

function metaContent(metas, key) {
    const hit = metas.find(x => x.key === key.toLowerCase() && x.content != null);
    return hit ? hit.content : null;
}

const ABSOLUTE = /^https?:\/\//i;

// Pure audit of rendered HTML. Returns { findings, passed, errors, warnings }.
function auditHtml(html, { url = "" } = {}) {
    const findings = [];
    const passed = [];
    const add = (severity, rule, message) => findings.push({ severity, rule, message });
    const ok = (rule, message) => passed.push({ rule, message });

    const metas = collectMetas(html);

    // ---- title ----
    const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
    const titleText = title ? title.replace(/&#?\w+;/g, "x").trim() : null; // entities count as 1 char-ish
    if (!title || !title.trim()) {
        add("error", "title", "The page has NO <title>. Search results show the title; without one the page is effectively unlisted. Fix: add <title>Primary Keyword — Brand</title> in <head>.");
    } else {
        const len = title.trim().length;
        if (len > 60) add("warn", "titleLength", "The <title> is " + len + " characters — Google truncates around 60. Fix: shorten it; lead with the primary keyword (\"" + title.trim().slice(0, 50) + "…\").");
        else if (len < 15) add("warn", "titleLength", "The <title> is only " + len + " characters — too thin to describe the page. Fix: write 15–60 characters, primary keyword first.");
        else ok("title", "<title> present, " + len + " chars");
    }

    // ---- meta description ----
    const desc = metaContent(metas, "description");
    if (!desc) {
        add("error", "metaDescription", "There is NO meta description. Google writes its own snippet without one, usually worse. Fix: add <meta name=\"description\" content=\"…\" /> in <head>, 50–160 characters, stating the offer plainly.");
    } else {
        const len = desc.length;
        if (len > 160) add("warn", "descriptionLength", "The meta description is " + len + " characters — truncated around 160 in results. Fix: tighten it to 50–160.");
        else if (len < 50) add("warn", "descriptionLength", "The meta description is only " + len + " characters — too thin. Fix: 50–160 characters stating what the page offers and for whom.");
        else ok("metaDescription", "meta description present, " + len + " chars");
    }

    // ---- canonical ----
    const canonical = (html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i) || [])[0];
    const canonicalHref = canonical ? (canonical.match(/href=["']([^"']*)["']/i) || [])[1] : null;
    if (!canonicalHref) {
        add("warn", "canonical", "No canonical link. Without it, URL variants (tracking params, http/https) can split ranking signals. Fix: add <link rel=\"canonical\" href=\"https://…absolute page URL…\" /> in <head>.");
    } else if (!ABSOLUTE.test(canonicalHref)) {
        add("error", "canonicalRelative", "The canonical URL is RELATIVE (\"" + canonicalHref + "\"). Canonicals must be absolute. Fix: use the full https:// URL of this page.");
    } else ok("canonical", "canonical present and absolute");

    // ---- Open Graph + twitter ----
    const OG_REQUIRED = ["og:title", "og:description", "og:image", "og:url", "og:type"];
    const missingOg = OG_REQUIRED.filter(k => !metaContent(metas, k));
    if (missingOg.length) {
        add("warn", "ogMissing", "Missing Open Graph tag(s): " + missingOg.join(", ") + ". Links shared on social/chat render without a proper card. Fix: add each as <meta property=\"og:…\" content=\"…\" /> in <head>.");
    } else ok("openGraph", "all 5 core og: tags present");
    for (const k of ["og:image", "og:url"]) {
        const v = metaContent(metas, k);
        if (v && !ABSOLUTE.test(v)) {
            add("error", "ogRelative", k + " is RELATIVE (\"" + v + "\"). Social scrapers fetch these from THEIR servers — a relative URL cannot resolve and the card shows no image/link. Fix: use the full absolute URL (e.g. https://webpals.cloudpiston.com/nx-ref/Images/…).");
        }
    }
    if (!metaContent(metas, "twitter:card")) {
        add("warn", "twitterCard", "No twitter:card meta. X/Twitter shares render as bare links. Fix: add <meta name=\"twitter:card\" content=\"summary_large_image\" />.");
    } else ok("twitterCard", "twitter:card present");

    // ---- non-ASCII in meta content attributes (the live server-note trap) ----
    const nonAscii = metas.filter(x => x.content && /[^\x00-\x7F]/.test(x.content));
    if (nonAscii.length) {
        add("warn", "nonAsciiMeta", "Non-ASCII character(s) (e.g. an em-dash —) inside meta content attribute(s): " +
            nonAscii.map(x => x.key).filter(Boolean).slice(0, 5).join(", ") +
            ". The PalBuilder server flags this (\"non ASCII attribute\") on every save. Fix: entity-encode in attribute values — write &#8212; instead of a literal em-dash. (Body TEXT is fine; only attribute values need this.)");
    }

    // ---- H1 ----
    const h1s = html.match(/<h1[\s>]/gi) || [];
    if (h1s.length === 0) add("error", "h1", "The page has NO <h1>. The H1 is the page's one headline for crawlers and readers. Fix: exactly one <h1> stating the page's primary topic.");
    else if (h1s.length > 1) add("warn", "h1", "The page has " + h1s.length + " <h1> elements — there should be exactly ONE. Fix: keep the main headline as <h1>; demote the others to <h2>.");
    else ok("h1", "exactly one <h1>");

    // ---- viewport ----
    if (!metas.some(x => x.key === "viewport")) {
        add("error", "viewport", "No viewport meta — the page is not mobile-friendly in Google's eyes (mobile-first indexing). Fix: add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /> in <head>.");
    } else ok("viewport", "viewport meta present");

    // ---- structured data ----
    if (!/<script[^>]*type=["']application\/ld\+json["']/i.test(html)) {
        add("warn", "structuredData", "No JSON-LD structured data. Schema markup earns rich results and helps AI/answer engines cite you. Fix: add a <script type=\"application/ld+json\"> block in the PAGE <head> (allowed there — only fragments reject <script>) with Organization or WebSite schema. The seo-core skill has a copy-paste recipe.");
    } else ok("structuredData", "JSON-LD present");

    // ---- img alt ----
    const imgs = html.match(/<img\b[^>]*>/gi) || [];
    const noAlt = imgs.filter(t => !/\balt=/i.test(t));
    if (noAlt.length) {
        const srcs = noAlt.map(t => (t.match(/src=["']([^"']*)["']/i) || [])[1] || "(no src)").slice(0, 5);
        add("warn", "imgAlt", noAlt.length + " <img> tag(s) have no alt attribute (" + srcs.join(", ") + (noAlt.length > 5 ? ", …" : "") + "). Images without alt are invisible to image search and screen readers. Fix: add alt=\"describe the image\" (or alt=\"\" if purely decorative).");
    } else if (imgs.length) ok("imgAlt", "all " + imgs.length + " <img> tags have alt");

    const errors = findings.filter(f => f.severity === "error").length;
    const warnings = findings.filter(f => f.severity === "warn").length;
    return { findings, passed, errors, warnings, url };
}

// ---- robots.txt / sitemap.xml / llms.txt — every WEB pal needs all three (seo-core skill) ----
// Both reference builds hit the same live bug: on test/stage instances every path falls through
// to the workflow, so without an explicit intercept these files render the homepage HTML instead
// (one pal shipped this as 305 Lighthouse parse errors). That's the #1 thing this check catches.
const CRAWLER_FILES = [
    { name: "robots.txt", kind: "robots", label: "robots.txt", required: true },
    { name: "sitemap.xml", kind: "sitemap", label: "sitemap.xml", required: true },
    { name: "llms.txt", kind: "llms", label: "llms.txt", required: false },
];

function looksLikeFallthroughPage(body) {
    return /<html[\s>]|<!doctype html/i.test(body || "");
}

function auditRobotsTxt(body, contentType) {
    const findings = [];
    if (looksLikeFallthroughPage(body)) {
        findings.push({ severity: "error", rule: "robotsFallthrough", message: "robots.txt returned the homepage HTML, not plain text. On PalBuilder test/stage instances every path falls through to the workflow unless robots.txt is explicitly intercepted. Fix: handle robots.txt before the route switch in run() (see seo-core skill, Pattern A or B)." });
        return findings;
    }
    if (contentType && !/text\/plain/i.test(contentType)) {
        findings.push({ severity: "warn", rule: "robotsContentType", message: "robots.txt content-type is \"" + contentType + "\" — should be text/plain. Fix: call setContentType(\"text/plain\") on the response." });
    }
    if (!/^User-agent:/im.test(body)) {
        findings.push({ severity: "error", rule: "robotsMissingUserAgent", message: "robots.txt has no \"User-agent:\" line — crawlers may ignore the whole file. Fix: include at minimum \"User-agent: *\" with an Allow:/Disallow: policy." });
    }
    const sm = body.match(/^Sitemap:\s*(\S+)/im);
    if (!sm) {
        findings.push({ severity: "warn", rule: "robotsNoSitemapLine", message: "robots.txt has no \"Sitemap:\" line pointing at sitemap.xml. Fix: add \"Sitemap: https://YOUR-DOMAIN/sitemap.xml\" (absolute URL)." });
    } else if (!ABSOLUTE.test(sm[1])) {
        findings.push({ severity: "error", rule: "robotsSitemapRelative", message: "robots.txt's Sitemap: line is not an absolute URL (\"" + sm[1] + "\"). Fix: use the full https:// URL." });
    }
    return findings;
}

function auditSitemapXml(body, contentType) {
    const findings = [];
    if (looksLikeFallthroughPage(body)) {
        findings.push({ severity: "error", rule: "sitemapFallthrough", message: "sitemap.xml returned the homepage HTML, not XML. Fix: handle sitemap.xml explicitly before the route switch in run() (see seo-core skill, Pattern A or B)." });
        return findings;
    }
    if (contentType && !/xml/i.test(contentType)) {
        findings.push({ severity: "error", rule: "sitemapContentType", message: "sitemap.xml content-type is \"" + contentType + "\" — without application/xml (or text/xml) browsers/crawlers can render the <url>/<loc> tags as plain text instead of a sitemap. Fix: call setContentType(\"application/xml\")." });
    }
    if (!/<urlset[\s>]/i.test(body)) {
        findings.push({ severity: "error", rule: "sitemapMissingUrlset", message: "sitemap.xml has no <urlset> root element — it isn't a valid sitemap. Fix: follow the sitemaps.org schema (see the seo-core skill)." });
    }
    if (!/<loc>/i.test(body)) {
        findings.push({ severity: "error", rule: "sitemapEmpty", message: "sitemap.xml has no <url><loc> entries — it's empty. Fix: list every public page's absolute URL." });
    }
    return findings;
}

function auditCrawlerFile(kind, label, r, required) {
    if (r.status !== 200) {
        return [{ severity: required ? "error" : "warn", rule: kind + "Missing",
            message: "/" + label + " returned HTTP " + r.status + (required
                ? " — every WEB pal needs this file. Fix: see the seo-core skill's robots.txt/sitemap.xml section."
                : " — optional, but recommended for AI-crawler/LLM discovery. See the seo-core skill.") }];
    }
    if (kind === "robots") return auditRobotsTxt(r.html, r.contentType);
    if (kind === "sitemap") return auditSitemapXml(r.html, r.contentType);
    return []; // llms.txt: presence is the only check
}

// Fetch and audit robots.txt/sitemap.xml/llms.txt against an already-opened instance session.
async function auditCrawlerFiles(inst) {
    const out = {};
    for (const f of CRAWLER_FILES) {
        const r = await inst.fetchPath(f.name);
        const findings = auditCrawlerFile(f.kind, f.label, r, f.required);
        out[f.kind] = { label: f.label, status: r.status, findings,
            errors: findings.filter(x => x.severity === "error").length,
            warnings: findings.filter(x => x.severity === "warn").length };
    }
    return out;
}

function crawlerTotals(crawlerFiles) {
    let errors = 0, warnings = 0;
    for (const k of Object.keys(crawlerFiles || {})) { errors += crawlerFiles[k].errors; warnings += crawlerFiles[k].warnings; }
    return { errors, warnings };
}

// Format for an agent: verdict first, then every finding spelled out, then what passed
// (positive confirmation so a literal-minded agent knows those areas are done).
function crawlerFileLines(crawlerFiles) {
    if (!crawlerFiles) return [];
    const lines = ["Crawler files:"];
    for (const k of Object.keys(crawlerFiles)) {
        const c = crawlerFiles[k];
        if (!c.findings.length) { lines.push("   " + c.label + ": OK"); continue; }
        for (const f of c.findings) lines.push("   " + c.label + ": " + (f.severity === "error" ? "ERROR" : "WARNING") + " — " + f.message);
    }
    return lines;
}

function formatSeoAudit(result) {
    // Sitewide shape: result.pages = per-page audits
    if (result.pages && Array.isArray(result.pages)) {
        const head = (result.errors > 0 ? "SEO AUDIT FAILED" : result.warnings > 0 ? "SEO AUDIT PASSED WITH WARNINGS" : "SEO AUDIT PASSED")
            + " — " + result.errors + " error(s), " + result.warnings + " warning(s) across " + result.pageCount + " page(s).";
        const lines = [head];
        if (result.errors > 0) lines.push("ERROR = materially hurts how search engines/social scrapers handle the page; fix every error.");
        lines.push(...crawlerFileLines(result.crawlerFiles));
        for (const p of result.pages) {
            if (p.fetchFailed) { lines.push(p.page + ": ERROR — page did not render (HTTP " + p.status + "). Check the route in the workflow and the pal.json entry."); continue; }
            if (!p.findings.length) continue;
            lines.push(p.page + (p.noindex ? " (noindex — warnings suppressed)" : "") + ":");
            const { shown, more } = capRepeats(p.findings, f => f.rule);
            for (const f of shown) lines.push("   " + (f.severity === "error" ? "ERROR" : "WARNING") + " — " + f.message);
            for (const m of more) lines.push("   …and " + m.count + " more of the same (" + m.key + ").");
        }
        const clean = result.pages.filter(p => !p.fetchFailed && !p.findings.length).length;
        lines.push(clean + "/" + result.pageCount + " pages fully clean.");
        return lines.join("\n");
    }
    const { findings, passed, errors, warnings, url } = result;
    const head = (errors > 0 ? "SEO AUDIT FAILED" : warnings > 0 ? "SEO AUDIT PASSED WITH WARNINGS" : "SEO AUDIT PASSED")
        + " — " + errors + " error(s), " + warnings + " warning(s)" + (url ? " for " + url : "") + ".";
    const lines = [head];
    if (errors > 0) lines.push("ERROR = materially hurts how search engines/social scrapers handle this page; fix every error.");
    lines.push(...crawlerFileLines(result.crawlerFiles));
    const { shown, more } = capRepeats(findings, f => f.rule);
    for (const f of shown) lines.push("   " + (f.severity === "error" ? "ERROR" : "WARNING") + " — " + f.message);
    for (const m of more) lines.push("   …and " + m.count + " more of the same (" + m.key + ").");
    if (passed.length) lines.push("Passed: " + passed.map(p => p.message).join(" · "));
    return lines.join("\n");
}

// Fetch the rendered page via the preview plumbing and audit it. Web pals only.
async function runSeoAudit(session, guid, record, workspaceDir) {
    // Page list from the workspace manifest — audit EVERY page, not just the landing page
    // (the OBE smoke test had to rebuild this by hand: 9 of 23 pages had findings index.html didn't).
    let pageNames = [];
    try {
        const pj = JSON.parse(fs.readFileSync(path.join(workspaceDir, "pal.json"), "utf8"));
        pageNames = (((pj.pages || {}).entry) || []).map(e => e.string).filter(Boolean);
    } catch (e) { /* fall through to landing-page-only */ }

    if (!pageNames.length) {
        const p = await runPreview(session, guid, record, workspaceDir, { workflow: "web" });
        if (!p.previewed) return { audited: false, reason: p.reason, validation: p.validation };
        if (!p.agentVisible) {
            return { audited: false, reason: "SEO audit works on WEB pals (their render is publicly fetchable). This is a " + p.kind + " pal — console pages aren't crawled by search engines, so an SEO audit doesn't apply." };
        }
        const result = auditHtml(p.html, { url: p.url });
        const inst = await openInstanceSession(session, guid);
        const crawlerFiles = inst.opened ? await auditCrawlerFiles(inst) : null;
        const ct = crawlerTotals(crawlerFiles);
        return Object.assign({ audited: true, dirty: p.dirty, dirtyFiles: p.dirtyFiles, pages: null, crawlerFiles }, result,
            { errors: result.errors + ct.errors, warnings: result.warnings + ct.warnings });
    }

    const inst = await openInstanceSession(session, guid);
    if (!inst.opened) return { audited: false, reason: inst.reason, validation: inst.validation };
    const crawlerFiles = await auditCrawlerFiles(inst);
    const pages = [];
    let errors = 0, warnings = 0;
    for (const name of pageNames) {
        const r = await inst.fetchPath(name);
        if (r.status !== 200) {
            pages.push({ page: name, fetchFailed: true, status: r.status, findings: [], errors: 1, warnings: 0 });
            errors += 1;
            continue;
        }
        const noindex = /<meta[^>]*name=["']robots["'][^>]*noindex/i.test(r.html);
        const a = auditHtml(r.html, { url: r.url });
        if (noindex) {
            // noindex pages aren't crawled — og/canonical/JSON-LD gaps don't matter; keep only errors
            a.findings = a.findings.filter(f => f.severity === "error");
            a.warnings = 0;
            a.errors = a.findings.length;
        }
        pages.push(Object.assign({ page: name, noindex }, a));
        errors += a.errors; warnings += a.warnings;
    }
    const ct = crawlerTotals(crawlerFiles);
    return { audited: true, pages, errors: errors + ct.errors, warnings: warnings + ct.warnings, pageCount: pageNames.length, crawlerFiles };
}
module.exports = { auditHtml, formatSeoAudit, runSeoAudit, collectMetas, auditRobotsTxt, auditSitemapXml, auditCrawlerFile, auditCrawlerFiles };
