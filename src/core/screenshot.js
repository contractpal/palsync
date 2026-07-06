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
// (_previewUrl) — the same URL pal_test can open when preview is explicitly requested.
// Playwright navigates to it
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

// A pal that compiles + validates can still THROW at runtime — a workflow exception (bad SQL, null
// deref, missing column) renders CloudPiston's error block into the page instead of the UI. pal_test
// only proves the workflow COMPILES; nothing proved it RENDERS until now. detectRenderError scans the
// rendered page text for that error block so a captured screenshot with a runtime fault is reported as
// a FAIL, not a silent pass. Pure + text-only so it unit-tests without a browser.
//
// CloudPiston's block is a set of labeled lines:
//   Workflow: console.js / Message: <Exception>: <msg> / Function: list /
//   Method Called: DataSet.getRecords / Approx. Line no: 66
// "Method Called" and "Approx. Line no" are near-unique to the error block; an exception class name
// (…Exception) is the fallback marker. A normal rendered UI carries none of these.
function detectRenderError(text) {
    if (!text || typeof text !== "string") return null;
    const has = (re) => re.test(text);
    const exception = /\b([A-Za-z_][A-Za-z0-9_.]*Exception)\b/;
    const labeled = /Method Called\s*:/i.test(text) || /Approx\.?\s*Line\s*no\s*:/i.test(text);
    if (!labeled && !has(exception)) return null; // ordinary page — no error block

    const grab = (label) => {
        const m = text.match(new RegExp(label + "\\s*:\\s*(.+?)\\s*(?:\\n|$)", "i"));
        return m ? m[1].trim().replace(/\.$/, "") : null;
    };
    const exMatch = text.match(exception);
    const message = grab("Message") || (exMatch ? exMatch[1] : null);
    // The single most useful line for a human/agent: the exception message if we have it.
    const msgLine = grab("Message") || (exMatch ? exMatch[0] : "a runtime error");
    return {
        message: msgLine,
        exception: exMatch ? exMatch[1] : null,
        workflow: grab("Workflow"),
        function: grab("Function"),
        methodCalled: grab("Method Called"),
        line: grab("Approx\\.?\\s*Line\\s*no"),
        raw: (message || msgLine || "").slice(0, 300)
    };
}

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

// Re-encode the full-res PNG down to a small JPEG, entirely in the browser page's own JS context
// (canvas from a data: URL we constructed — never a cross-origin resource, so it never taints).
// Anthropic's image-token cost scales with pixel area, not just bytes, so this cuts the inline
// copy that rides in the agent's context on every subsequent turn (the on-disk PNG stays full-res
// for anyone who needs to zoom in). Zero new dependencies — no sharp, no canvas package.
async function downscaleToJpeg(pg, pngBase64, scale = 0.625, quality = 0.6) {
    try {
        return await pg.evaluate(({ pngBase64, scale, quality }) => new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const w = Math.max(1, Math.round(img.naturalWidth * scale));
                const h = Math.max(1, Math.round(img.naturalHeight * scale));
                const canvas = document.createElement("canvas");
                canvas.width = w; canvas.height = h;
                canvas.getContext("2d").drawImage(img, 0, 0, w, h);
                resolve({ dataUrl: canvas.toDataURL("image/jpeg", quality), width: w, height: h });
            };
            img.onerror = () => reject(new Error("downscale image load failed"));
            img.src = "data:image/png;base64," + pngBase64;
        }), { pngBase64, scale, quality });
    } catch (e) {
        return null; // best-effort — caller falls back to the full-res PNG
    }
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
        const pngBase64 = buf.toString("base64");
        // Read the rendered text and check for a CloudPiston runtime-error block — a pal that
        // validated can still throw at render time. Best-effort: a failure to read text must not
        // sink the (successful) capture.
        let renderError = null;
        try { renderError = detectRenderError(await pg.innerText("body")); } catch (e) { /* ignore */ }
        const small = await downscaleToJpeg(pg, pngBase64);
        return {
            captured: true, available: true, kind: t.kind,
            viewport: vp, viewportName,
            // WEB landing is the webpals host (no creds). CONSOLE landing may retain cp-auth in the
            // URL — sanitize to origin+path so no credential is ever returned.
            url: isWeb ? pg.url() : sanitizeUrl(pg.url()),
            renderError,
            pngBase64,
            jpegSmallBase64: small ? small.dataUrl.replace(/^data:image\/jpeg;base64,/, "") : null,
            smallDims: small ? { width: small.width, height: small.height } : null
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

module.exports = { runScreenshot, detectRenderError, sanitizeUrl, loadChromium, downscaleToJpeg, VIEWPORTS };
