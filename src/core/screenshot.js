"use strict";
// pal_screenshot core: render a pal screen in a headless browser and return a PNG, so pal-review's
// visual arm (with a vision-capable model) can judge UI/UX automatically instead of parking every
// visual check at the human eyeball gate.
//
// Phase 1 — WEB pals only. A WEB pal's rawToken (from runTest) is a directly-fetchable URL on
// webpals.cloudpiston.com that activates a test session through its redirect chain — a real
// browser absorbs the session cookies on the way in exactly as a human does opening the preview
// link, so Playwright just navigates to it. No auth, no credentials in the URL.
//
// TODO Phase 2 — CONSOLE pals: reuse preview.js openInstanceSession + test.js buildPreviewUrl to
// get the cp-auth'd URL + activated session cookies, load them into the Playwright context, then
// navigate (replay the auth/redirect chain). The fiddly part is the auth replay — test against a
// real console pal. See docs/pal_screenshot-implementation.md.
//
// SECURITY: only WEB (no-auth) URLs are driven here. Never return or log a cp-auth URL or
// credentials — the result carries the image + the resolved (sanitized) landing URL only.
const { runTest } = require("./test");

const VIEWPORTS = {
    desktop: { width: 1280, height: 800 },
    mobile: { width: 390, height: 844 }
};

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

    const t = await runTest(session, guid, { kind: "web" });
    if (!t.ran) {
        return { captured: false, available: true, blocked: t.blocked,
                 reason: t.blocked === "no-testable-workflow"
                     ? "This pal has no web workflow to screenshot (phase 1 supports WEB pals only)."
                     : "Could not start a test instance (" + (t.blocked || "unknown") + ")." };
    }
    if (t.kind !== "web") {
        // Phase 2 (console auth replay) is deferred — see docs/pal_screenshot-implementation.md.
        return { captured: false, available: true, kind: t.kind,
                 reason: "Screenshot phase 1 supports WEB pals only; this is a " + t.kind + " pal — its render stays at the human eyeball gate (phase 2 deferred)." };
    }
    if (!t.validated) {
        return { captured: false, available: true, kind: "web", validation: t.validation,
                 reason: "The pal did not validate on the server, so it can't be rendered. Fix the validation notes, push, and screenshot again." };
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
        // rawToken activates the session and lands on the site index. The browser absorbs cookies
        // through the redirect chain, same as a human opening the preview link.
        await pg.goto(t.rawToken, { waitUntil: "networkidle" });
        if (page) {
            // Navigate to a specific page under the activated session's site root (same base
            // derivation preview.js openInstanceSession uses: origin + first path segment).
            const root = new URL(pg.url());
            const seg = root.pathname.split("/").filter(Boolean)[0] || "";
            const base = root.origin + "/" + (seg ? seg + "/" : "");
            await pg.goto(base + String(page).replace(/^\/+/, ""), { waitUntil: "networkidle" });
        }
        const buf = await pg.screenshot({ fullPage: !!fullPage });
        return {
            captured: true, available: true, kind: "web",
            viewport: vp, viewportName,
            url: pg.url(),            // resolved landing — webpals host, no credentials
            pngBase64: buf.toString("base64")
        };
    } finally {
        await browser.close();
    }
}

module.exports = { runScreenshot, VIEWPORTS };
