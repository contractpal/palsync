"use strict";
// Low-level browser lifecycle: Chromium acquisition/reuse, viewports, navigation settle, and the
// URL sanitizers every browser-derived result depends on. Deliberately knows nothing about pals,
// targets, or evidence — so the target/auth/state layer (browserTarget.js) and the two tools that
// sit on top of it (screenshot.js, exercise.js) all depend downward on this module and nothing
// depends back up.

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

// cp-workflow (and any credential the auth redirect left in the URL). Returns origin + pathname.
function sanitizeUrl(u) {
    try { const x = new URL(u); return x.origin + x.pathname; }
    catch (e) { return ""; }
}

function isLoginRedirect(u) {
    try { return /(?:^|\/)login(?:\/|\b)|\bgetlogin\b/i.test(new URL(u).pathname); }
    catch (e) { return false; }
}

function sanitizeResourceUrl(u) {
    try {
        const x = new URL(u);
        if (x.protocol === "data:" || x.protocol === "blob:") return x.protocol;
        return x.origin + x.pathname;
    } catch (e) {
        return String(u || "").replace(/[?#].*$/, "").slice(0, 300);
    }
}



async function waitForStyles(pg, timeout = 5000) {
    try {
        await pg.waitForFunction(() => {
            const links = Array.from(document.querySelectorAll("link"))
                .filter(l => /\bstylesheet\b/i.test(l.rel || l.getAttribute("rel") || ""));
            if (!links.length) return true;
            return links.every((link) => {
                if (link.disabled) return true;
                const media = String(link.media || "").trim();
                if (media && media.toLowerCase() !== "all" && window.matchMedia && !window.matchMedia(media).matches) return true;
                if (link.sheet) return true;
                const href = link.href;
                return !!href && Array.from(document.styleSheets).some(sheet => sheet.href === href);
            });
        }, null, { timeout });
    } catch (e) { /* capture diagnostics below instead of failing the screenshot */ }
    try {
        await pg.evaluate(() => document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true);
    } catch (e) { /* ignore */ }
    try { await pg.waitForTimeout(100); } catch (e) { /* ignore */ }
}

// Navigate and wait until a page is renderable. pal_screenshot wants the FULL settle (stylesheets
// and fonts included) because the image is the evidence, so the defaults below preserve its
// behavior exactly (goto keeps Playwright's own default timeout). pal_exercise drives many
// sequential navigations and asserts visible text, so it passes bounded timeouts and skips the
// screenshot-only style/font settle — a single stuck navigation must never consume minutes.
// opts: { gotoTimeout, loadTimeout, idleTimeout, skipStyleSettle }
async function waitForRenderablePage(pg, url, opts = {}) {
    const gotoOpts = opts.gotoTimeout != null
        ? { waitUntil: "domcontentloaded", timeout: opts.gotoTimeout }
        : { waitUntil: "domcontentloaded" };
    await pg.goto(url, gotoOpts);
    try { await pg.waitForLoadState("load", { timeout: opts.loadTimeout != null ? opts.loadTimeout : 15000 }); } catch (e) { /* keep going; style diagnostics explain gaps */ }
    try { await pg.waitForLoadState("networkidle", { timeout: opts.idleTimeout != null ? opts.idleTimeout : 5000 }); } catch (e) { /* common with analytics/long polling */ }
    if (!opts.skipStyleSettle) await waitForStyles(pg);
}


// so a missing module degrades to a clean "unavailable" signal (pal-review falls back to the
// human eyeball gate), never a crash.
function loadChromium() {
    try { return require("playwright").chromium; }
    catch (e) { return null; }
}

const BROWSER_IDLE_MS = 60_000;
let sharedBrowserPromise = null;
let browserIdleTimer = null;
let activeBrowserCalls = 0;

function clearBrowserIdleTimer() {
    if (browserIdleTimer) clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
}

async function closeSharedBrowser() {
    const pending = sharedBrowserPromise;
    sharedBrowserPromise = null;
    if (!pending) return;
    try { await (await pending).close(); } catch (e) { /* best-effort idle/exit cleanup */ }
}

function scheduleBrowserIdleClose() {
    clearBrowserIdleTimer();
    browserIdleTimer = setTimeout(() => {
        browserIdleTimer = null;
        if (activeBrowserCalls > 0) {
            scheduleBrowserIdleClose();
            return;
        }
        closeSharedBrowser().catch(() => {});
    }, BROWSER_IDLE_MS);
    browserIdleTimer.unref();
}

async function getBrowser() {
    clearBrowserIdleTimer();
    const launch = () => {
        const chromium = loadChromium();
        if (!chromium) return Promise.reject(new Error("Playwright/Chromium is not installed"));
        const pending = chromium.launch();
        pending.catch(() => { if (sharedBrowserPromise === pending) sharedBrowserPromise = null; });
        return pending;
    };
    if (!sharedBrowserPromise) sharedBrowserPromise = launch();
    let browser = await sharedBrowserPromise;
    if (typeof browser.isConnected === "function" && !browser.isConnected()) {
        sharedBrowserPromise = launch();
        browser = await sharedBrowserPromise;
    }
    activeBrowserCalls += 1;
    return browser;
}

function releaseBrowser() {
    activeBrowserCalls = Math.max(0, activeBrowserCalls - 1);
    scheduleBrowserIdleClose();
}

process.once("exit", () => {
    clearBrowserIdleTimer();
    if (sharedBrowserPromise) sharedBrowserPromise.then(browser => browser.close()).catch(() => {});
});

// Re-encode the full-res PNG down to a small JPEG, entirely in the browser page's own JS context
// (canvas from a data: URL we constructed — never a cross-origin resource, so it never taints).
// Anthropic's image-token cost scales with pixel area, not just bytes, so this cuts the inline
// copy that rides in the agent's context on every subsequent turn (the on-disk PNG stays full-res
// for anyone who needs to zoom in). Zero new dependencies — no sharp, no canvas package.

module.exports = {
    VIEWPORTS, sanitizeUrl, isLoginRedirect, sanitizeResourceUrl,
    waitForStyles, waitForRenderablePage,
    loadChromium, getBrowser, releaseBrowser
};
