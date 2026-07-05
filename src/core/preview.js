"use strict";
// pal_preview core: render a pal and return what it produces TO THE AGENT.
//
// WEB pals (verified live, June 2026): TestWeb.do yields a token URL on the separate
// webpals.cloudpiston.com host that is PUBLICLY FETCHABLE — a plain GET (no auth, no browser)
// returns the FULLY RENDERED HTML (server-side c: tags + EL resolved). So for web pals,
// pal_preview fetches that HTML and hands it back to the agent — the agent can actually SEE its
// output. No credentials are involved, so nothing sensitive is returned.
//
// CONSOLE / TRANSACTION pals render inside the platform console shell behind login via encrypted
// AJAX — a plain fetch can't reproduce that, so the agent CANNOT see it. For those, pal_preview
// defers to the browser-open (the user sees it); the agent is told plainly it can't.
const { runTest } = require("./test");
const { diffWorkspace } = require("./localDrift");

// Minimal cookie-jar redirect follower (web preview only needs one host). No external deps.
class Jar {
    constructor() { this.cookies = new Map(); }
    absorb(resp) {
        const set = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
        for (const c of set) {
            const [pair] = c.split(";"); const i = pair.indexOf("=");
            if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        }
    }
    header() { return [...this.cookies.entries()].map(([k, v]) => k + "=" + v).join("; "); }
}

async function fetchRendered(url, { maxHops = 8 } = {}) {
    const jar = new Jar();
    let current = url;
    const hops = [];
    for (let i = 0; i < maxHops; i++) {
        const resp = await fetch(current, { redirect: "manual", headers: jar.cookies.size ? { cookie: jar.header() } : {} });
        jar.absorb(resp);
        const loc = resp.headers.get("location");
        hops.push({ status: resp.status, url: current });
        if (resp.status >= 300 && resp.status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
        const body = await resp.text();
        return { status: resp.status, contentType: resp.headers.get("content-type") || "", body, finalUrl: current, hops };
    }
    throw new Error("too many redirects following the preview URL");
}

function titleOf(html) { const m = html.match(/<title>([^<]*)<\/title>/i); return m ? m[1].trim() : null; }

// Token-efficient verification: check served HTML for expected substrings WITHOUT returning the
// HTML. Returns { pass, results: [{ string, found, matchedLine }] } — the agent sees only the
// verdict per string (and the line it matched on), never the 3-8k-token page body. This is the
// DEFAULT check for "does the page contain X" after a push.
function checkExpect(html, expect) {
    const src = String(html || "");
    const results = (expect || []).map((s) => {
        const idx = src.indexOf(s);
        if (idx === -1) return { string: s, found: false, matchedLine: null };
        const lineStart = src.lastIndexOf("\n", idx) + 1;
        let lineEnd = src.indexOf("\n", idx); if (lineEnd === -1) lineEnd = src.length;
        return { string: s, found: true, matchedLine: src.slice(lineStart, lineEnd).trim().slice(0, 200) };
    });
    return { pass: results.every((r) => r.found), results };
}

// Dependency-free extraction of ONE region's markup by a SIMPLE selector — enough to hand the
// agent just the <head>, a <nav>, or an element by id/class when it genuinely needs markup (NOT a
// full CSS engine). Supports: "tag", ".class", "#id", "tag.class", "tag#id". Returns the first
// matched element's outerHTML, or null when nothing matches.
function extractSelector(html, selector) {
    const src = String(html || "");
    const m = String(selector || "").trim().match(/^([a-zA-Z][\w-]*)?(?:([.#])([\w-]+))?$/);
    if (!m || (!m[1] && !m[2])) return null;
    const tagPat = m[1] || "[a-zA-Z][\\w-]*"; // any tag when only .class / #id is given
    const attr = m[2] === "#" ? "id" : m[2] === "." ? "class" : null;
    const val = m[3];
    const openRe = new RegExp("<(" + tagPat + ")(\\s[^>]*)?>", "gi");
    let om;
    while ((om = openRe.exec(src))) {
        const attrs = om[2] || "";
        if (attr) {
            const av = attrs.match(new RegExp(attr + "\\s*=\\s*[\"']([^\"']*)[\"']", "i"));
            if (!av) continue;
            if (attr === "class") { if (av[1].split(/\s+/).indexOf(val) === -1) continue; }
            else if (av[1] !== val) continue;
        }
        const tagLc = om[1].toLowerCase();
        const walkRe = new RegExp("<(/?)(" + tagLc + ")(\\s[^>]*)?>", "gi");
        walkRe.lastIndex = om.index;
        let depth = 0, wm;
        while ((wm = walkRe.exec(src))) {
            if (wm[1] !== "/" && /\/\s*$/.test(wm[3] || "")) continue; // self-closing <tag ... />
            if (wm[1] === "/") { if (--depth === 0) return src.slice(om.index, walkRe.lastIndex); }
            else depth++;
        }
        return src.slice(om.index); // unbalanced markup — return from the open tag to the end
    }
    return null;
}

// Render preview. Returns a structured result; never throws on a normal failure.
//   record/workspaceDir are used only to WARN when the workspace has un-pushed changes (the
//   preview always reflects the last SAVED state — TestWeb runs server-side).
async function runPreview(session, guid, record, workspaceDir, { workflow } = {}) {
    // Warn if the on-disk code differs from what's saved (the preview won't show un-pushed edits).
    let dirty = false, dirtyFiles = [];
    if (record && (record.fileHashes || record.localHash) && workspaceDir) {
        const d = diffWorkspace(record, workspaceDir);
        dirty = d.dirty || (d.changed && d.changed.length > 0);
        dirtyFiles = [...(d.changed || []), ...(d.added || [])];
    }

    const t = await runTest(session, guid, { kind: workflow });
    if (!t.ran) {
        return { previewed: false, blocked: t.blocked, holder: t.holder, dirty, dirtyFiles,
                 reason: t.blocked === "no-testable-workflow"
                     ? "This pal has no runnable workflow to preview (need a web/console/transaction workflow)."
                     : "Could not run the preview (" + (t.blocked || "unknown") + ")." };
    }
    if (!t.validated) {
        return { previewed: false, kind: t.kind, validated: false, validation: t.validation, dirty, dirtyFiles,
                 reason: "The pal did not validate on the server, so it can't be previewed. Fix the validation notes, push, and preview again." };
    }

    if (t.kind === "web") {
        // The high-value path: fetch the rendered HTML and hand it to the agent.
        let page;
        try { page = await fetchRendered(t.rawToken); }
        catch (e) { return { previewed: false, kind: "web", dirty, dirtyFiles, reason: "Failed to fetch the web preview: " + (e && e.message ? e.message : String(e)) }; }
        const isHtml = /html/i.test(page.contentType) || /<html|<!doctype/i.test(page.body);
        // url MUST be the rawToken — that's the link that activates a session when opened in a
        // browser. page.finalUrl is the post-redirect landing (e.g. webpals.cloudpiston.com/index.html)
        // which needs the cookies that were absorbed during the fetch's redirect chain; opening it
        // fresh hits "Web Pal Expired". Keep finalUrl as a debug field, not the user-facing URL.
        return {
            previewed: true, kind: "web", agentVisible: true,
            url: t.rawToken, finalUrl: page.finalUrl, status: page.status, contentType: page.contentType,
            title: titleOf(page.body), bytes: page.body.length, isHtml,
            html: page.body, dirty, dirtyFiles
        };
    }

    // console / transaction: needs a browser; the agent cannot see it.
    return {
        previewed: true, kind: t.kind, agentVisible: false,
        _previewUrl: t._previewUrl, dirty, dirtyFiles,
        reason: "This is a " + t.kind + " pal: its preview renders inside the CloudPiston console (behind login), so it can't be returned to you as HTML. It will open in the user's browser instead — ask the user what they see."
    };
}

// Open a web pal's test instance once and return a session you can fetch many paths from.
// The verification primitive (OBE smoke test): "push said OK" is not "the page renders".
async function openInstanceSession(session, guid) {
    const t = await runTest(session, guid, { kind: "web" });
    if (!t.ran) {
        return { opened: false, reason: "Could not start a test instance (" + (t.blocked || "unknown") + ")." };
    }
    return openInstanceSessionFromTest(t);
}

// Same, from an ALREADY-RUN runTest result — callers that already tested (pal_exercise) reuse it
// instead of paying a second Test round trip.
async function openInstanceSessionFromTest(t) {
    if (!t.validated) {
        return { opened: false, validation: t.validation,
                 reason: "The pal did not validate on the server — fix the validation notes and push first." };
    }
    if (t.kind !== "web") {
        return { opened: false, reason: "Page fetching works on WEB pals; this is a " + t.kind + " pal." };
    }
    const jar = new Jar();
    let current = t.rawToken;
    let finalUrl = null;
    for (let i = 0; i < 8; i++) {
        const resp = await fetch(current, { redirect: "manual", headers: jar.cookies.size ? { cookie: jar.header() } : {} });
        jar.absorb(resp);
        const loc = resp.headers.get("location");
        if (resp.status >= 300 && resp.status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
        await resp.text();
        finalUrl = current;
        break;
    }
    if (!finalUrl) return { opened: false, reason: "Too many redirects activating the test session." };
    const u = new URL(finalUrl);
    const seg = u.pathname.split("/").filter(Boolean)[0] || "";
    const base = u.origin + "/" + (seg ? seg + "/" : "");
    return {
        opened: true, base,
        async fetchPath(path) {
            const target = base + String(path || "").replace(/^\/+/, "");
            const resp = await fetch(target, { headers: jar.cookies.size ? { cookie: jar.header() } : {} });
            const body = await resp.text();
            return { url: target, status: resp.status, contentType: resp.headers.get("content-type") || "",
                     title: titleOf(body), bytes: body.length, html: body };
        }
    };
}

// Single-path convenience wrapper (pal_fetch tool).
async function fetchPagePath(session, guid, path) {
    const inst = await openInstanceSession(session, guid);
    if (!inst.opened) return { fetched: false, reason: inst.reason, validation: inst.validation };
    const r = await inst.fetchPath(path);
    if (r.html.length > 250000) r.html = r.html.slice(0, 250000) + "\n<!-- truncated by pal_fetch at 250KB -->";
    return Object.assign({ fetched: true }, r);
}

module.exports = { runPreview, fetchRendered, fetchPagePath, openInstanceSession, openInstanceSessionFromTest, titleOf, checkExpect, extractSelector };