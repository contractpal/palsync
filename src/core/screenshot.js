"use strict";
// pal_screenshot core: render a pal screen in a headless browser and return a PNG, so pal-review's
// visual arm (with a vision-capable model) can judge UI/UX automatically instead of parking every
// visual check at the human eyeball gate.
//
// WEB pals: a WEB pal's rawToken (from runTest) is a directly-fetchable URL on
// webpals.cloudpiston.com that activates a test session through its redirect chain — a real
// browser absorbs the session cookies on the way in exactly as a human does opening the preview
// link, so Playwright just navigates to it. No auth, no credentials in the URL.
//
// CONSOLE / transaction pals (Phase 2): runTest already builds the cp-auth'd preview URL
// (_previewUrl) — the same URL pal_test opens in the user's browser. Playwright navigates to it
// and absorbs the auth redirect chain exactly as that browser does (no separate cookie loading
// needed — the cp-auth param drives session establishment server-side). If the auth replay fails
// (timeout, no token, blank), we return { captured:false } so pal-review falls back to the human
// eyeball gate — never a blank or fake image.
//
// SECURITY: the console URL is credential-bearing. Never return or log _previewUrl — the result
// carries the image + a SANITIZED landing URL (origin + path only, query/credentials stripped).
const { runTest } = require("./test");

const VIEWPORTS = {
    desktop: { width: 1280, height: 800 },
    mobile: { width: 390, height: 844 }
};

// Strip query + hash from a landed URL before returning it — drops cp-auth / nxProfileId /
// cp-workflow (and any credential the auth redirect left in the URL). Returns origin + pathname.
function sanitizeUrl(u) {
    try { const x = new URL(u); return x.origin + x.pathname; }
    catch (e) { return ""; }
}

// Playwright is an OPTIONAL dependency — some runtimes won't have it. require() inside try/catch
// so a missing module degrades to a clean "unavailable" signal (pal-review falls back to the
// human eyeball gate), never a crash.
function loadChromium() {
    try { return require("playwright").chromium; }
    catch (e) { return null; }
}

// Render a WEB pal screen and return its PNG (base64) + the resolved landing URL + viewport used.
// Returns { captured, available, ... }. Never throws on a normal failure; `available:false` means
// the capability itself is missing (Playwright/Chromium), distinct from a per-pal failure.
async function runScreenshot(session, guid, { page, viewport, fullPage } = {}) {
    const chromium = loadChromium();
    if (!chromium) {
        return { captured: false, available: false,
                 reason: "Playwright/Chromium is not installed in this runtime — visual review falls back to the human eyeball gate. Enable with: npm i playwright && npx playwright install chromium" };
    }

    // Auto-detect the engine (web preferred — directly fetchable; else console/transaction).
    const t = await runTest(session, guid, {});
    if (!t.ran) {
        return { captured: false, available: true, blocked: t.blocked,
                 reason: t.blocked === "no-testable-workflow"
                     ? "This pal has no testable workflow to screenshot."
                     : "Could not start a test instance (" + (t.blocked || "unknown") + ")." };
    }
    if (!t.validated) {
        return { captured: false, available: true, kind: t.kind, validation: t.validation,
                 reason: "The pal did not validate on the server, so it can't be rendered. Fix the validation notes, push, and screenshot again." };
    }

    // WEB → directly-fetchable rawToken (no auth). CONSOLE/transaction → the cp-auth'd preview URL
    // (credential-bearing; never returned/logged). Playwright absorbs the auth redirect chain.
    const isWeb = t.kind === "web";
    const target = isWeb ? t.rawToken : t._previewUrl;
    if (!target) {
        return { captured: false, available: true, kind: t.kind,
                 reason: isWeb
                     ? "No web preview URL was returned — can't render; falls back to the human eyeball gate."
                     : "No authenticated preview URL for this " + t.kind + " pal — can't drive the console screen; falls back to the human eyeball gate." };
    }

    const viewportName = VIEWPORTS[viewport] ? viewport : "desktop";
    const vp = VIEWPORTS[viewportName];
    // The module can be installed without its browser binary (npm i playwright without
    // `npx playwright install`). launch() throws then — treat that as unavailable (eyeball-gate
    // fallback), NOT a hard tool error, same as a missing module.
    let browser;
    try {
        browser = await chromium.launch();
    } catch (e) {
        return { captured: false, available: false,
                 reason: "Playwright is installed but its Chromium browser is not — visual review falls back to the human eyeball gate. Install it with: npx playwright install chromium  (" +
                     (e && e.message ? e.message.split("\n")[0] : String(e)) + ")" };
    }
    try {
        const bctx = await browser.newContext({ viewport: vp });
        const pg = await bctx.newPage();
        // The target URL activates the session and lands the render. For WEB it's the no-auth
        // rawToken; for CONSOLE/transaction it's the cp-auth'd URL — the browser absorbs the auth
        // redirect chain, same as a human opening the preview link. A failed/timed-out auth replay
        // throws here → caught below as a clean captured:false (eyeball-gate fallback).
        await pg.goto(target, { waitUntil: "networkidle" });
        if (page && isWeb) {
            // Sub-page navigation under the site root (web only; console renders one workflow).
            // Same base derivation preview.js openInstanceSession uses: origin + first path segment.
            const root = new URL(pg.url());
            const seg = root.pathname.split("/").filter(Boolean)[0] || "";
            const base = root.origin + "/" + (seg ? seg + "/" : "");
            await pg.goto(base + String(page).replace(/^\/+/, ""), { waitUntil: "networkidle" });
        }
        const buf = await pg.screenshot({ fullPage: !!fullPage });
        return {
            captured: true, available: true, kind: t.kind,
            viewport: vp, viewportName,
            // WEB landing is the webpals host (no creds). CONSOLE landing may retain cp-auth in the
            // URL — sanitize to origin+path so no credential is ever returned.
            url: isWeb ? pg.url() : sanitizeUrl(pg.url()),
            pngBase64: buf.toString("base64")
        };
    } catch (e) {
        // Navigation/auth-replay/screenshot failure — degrade to the eyeball gate, never throw.
        // Do NOT include the error verbatim if it could echo the credential URL; keep it to the
        // first line and strip anything URL-shaped.
        const msg = (e && e.message ? e.message.split("\n")[0] : String(e)).replace(/https?:\/\/\S+/g, "<url>");
        return { captured: false, available: true, kind: t.kind,
                 reason: (isWeb ? "Could not render the web page" : "Could not drive the authenticated " + t.kind + " screen") +
                     " — visual review falls back to the human eyeball gate. (" + msg + ")" };
    } finally {
        await browser.close();
    }
}

module.exports = { runScreenshot, VIEWPORTS };
