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

function watchStylesheetNetwork(pg) {
    const events = { responses: [], failed: [] };
    const isStylesheet = (req) => {
        if (!req) return false;
        try { if (req.resourceType && req.resourceType() === "stylesheet") return true; } catch (e) { /* ignore */ }
        try { return /\.css(?:[?#]|$)/i.test(req.url && req.url()); } catch (e) { return false; }
    };
    try {
        pg.on("response", (resp) => {
            try {
                const req = resp.request && resp.request();
                if (!isStylesheet(req)) return;
                const url = (resp.url && resp.url()) || (req.url && req.url());
                const status = resp.status ? resp.status() : null;
                events.responses.push({ url: sanitizeResourceUrl(url), status, ok: resp.ok ? resp.ok() : !(status >= 400) });
            } catch (e) { /* ignore */ }
        });
        pg.on("requestfailed", (req) => {
            try {
                if (!isStylesheet(req)) return;
                const failure = req.failure && req.failure();
                events.failed.push({
                    url: sanitizeResourceUrl(req.url && req.url()),
                    error: failure && failure.errorText ? failure.errorText : "request failed"
                });
            } catch (e) { /* ignore */ }
        });
    } catch (e) { /* older/fake Page implementations may not support events */ }
    return events;
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

async function inspectStyleStatus(pg, events = { responses: [], failed: [] }) {
    let page = null;
    try {
        page = await pg.evaluate(() => {
            const stylesheetLinks = Array.from(document.querySelectorAll("link"))
                .filter(l => /\bstylesheet\b/i.test(l.rel || l.getAttribute("rel") || ""))
                .map((link) => {
                    const media = String(link.media || "").trim();
                    const mediaMatches = !media || media.toLowerCase() === "all" ||
                        !(window.matchMedia) || window.matchMedia(media).matches;
                    const href = link.href || link.getAttribute("href") || "";
                    const sheet = link.sheet || Array.from(document.styleSheets).find(s => s.href === href) || null;
                    let rules = null, access = sheet ? "unknown" : "none", error = null;
                    if (sheet) {
                        try {
                            rules = sheet.cssRules ? sheet.cssRules.length : null;
                            access = "ok";
                        } catch (e) {
                            access = "blocked";
                            error = e && e.name ? e.name : String(e);
                        }
                    }
                    return {
                        href,
                        media,
                        mediaMatches,
                        disabled: !!link.disabled,
                        sheetPresent: !!sheet,
                        rules,
                        access,
                        error
                    };
                });
            const body = document.body ? window.getComputedStyle(document.body) : null;
            return {
                links: stylesheetLinks,
                inlineStyleTags: document.querySelectorAll("style").length,
                totalStyleSheets: document.styleSheets.length,
                bodyComputed: body ? {
                    fontFamily: body.fontFamily,
                    margin: body.margin,
                    backgroundColor: body.backgroundColor,
                    color: body.color
                } : null
            };
        });
    } catch (e) {
        page = { links: [], inlineStyleTags: 0, totalStyleSheets: 0, bodyComputed: null,
                 error: e && e.message ? e.message.split("\n")[0] : String(e) };
    }

    const links = (page.links || []).map(l => Object.assign({}, l, { href: sanitizeResourceUrl(l.href) }));
    const active = links.filter(l => !l.disabled && l.mediaMatches !== false);
    const missing = active.filter(l => !l.sheetPresent);
    const failedResponses = (events.responses || []).filter(r => r.ok === false);
    const failedRequests = (events.failed || []).concat(failedResponses);
    return {
        inspected: true,
        linked: active.length,
        loaded: active.length - missing.length,
        inlineStyleTags: page.inlineStyleTags || 0,
        totalStyleSheets: page.totalStyleSheets || 0,
        accessibleRules: active.reduce((n, l) => n + (typeof l.rules === "number" ? l.rules : 0), 0),
        missingStylesheets: missing.map(l => ({ href: l.href, media: l.media || "" })),
        failedRequests,
        responses: (events.responses || []).slice(-20),
        likelyLoaded: active.length === 0 ? true : (missing.length === 0 && failedRequests.length === 0),
        bodyComputed: page.bodyComputed || null,
        error: page.error || null
    };
}

// Deterministic rendered-UI checks that complement (not replace) visual judgment. These inspect
// geometry and accessibility facts the browser actually computed, so weak/text-only models receive
// evidence instead of being asked to self-critique from source. Keep the rules low-noise: hard
// errors are objective WCAG/runtime failures; taste signals stay warnings for the screenshot critic.
async function inspectDesignQuality(pg, { kind = "web", viewportName = "desktop" } = {}) {
    try {
        const audit = await pg.evaluate(({ kind }) => {
            // Console pages are embedded in CloudPiston chrome. Audit only the pal-owned root so
            // platform layout tables/timer bars cannot create false table/overflow failures.
            const root = kind === "console" && document.querySelector("#cp-root")
                ? document.querySelector("#cp-root")
                : (document.body || document.documentElement);
            const select = (selector) => {
                const nodes = Array.from(root.querySelectorAll(selector));
                if (root.matches && root.matches(selector)) nodes.unshift(root);
                return nodes;
            };
            const visible = (el) => {
                const cs = window.getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) !== 0 && r.width > 0 && r.height > 0;
            };
            const nameOf = (el) => {
                if (el.id) return el.tagName.toLowerCase() + "#" + el.id;
                const cls = Array.from(el.classList || []).slice(0, 2).join(".");
                const text = String(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 36);
                const base = el.tagName.toLowerCase() + (cls ? "." + cls : "") + (text ? " (" + text + ")" : "");
                if (kind !== "console") return base;
                let node = el;
                let insideRoot = false;
                while (node) {
                    if (node.id === "cp-root") { insideRoot = true; break; }
                    node = node.parentElement;
                }
                return base + (insideRoot ? " [inside #cp-root]" : " [OUTSIDE #cp-root]");
            };
            const hasAccessibleLabel = (el) => {
                if (el.labels && el.labels.length) return true;
                if (el.closest && el.closest("label")) return true;
                if (String(el.getAttribute("aria-label") || "").trim()) return true;
                const ids = String(el.getAttribute("aria-labelledby") || "").trim().split(/\s+/).filter(Boolean);
                if (ids.some(id => { const n = document.getElementById(id); return n && String(n.textContent || "").trim(); })) return true;
                return !!String(el.getAttribute("title") || "").trim();
            };
            const findings = [];
            const add = (severity, rule, message, nodes) => findings.push({
                severity, rule, message,
                count: nodes ? nodes.length : 1,
                samples: nodes ? nodes.slice(0, 5).map(nameOf) : []
            });

            const doc = document.documentElement;
            const body = document.body;
            const rootRect = root.getBoundingClientRect();
            const rootClientWidth = Math.min(window.innerWidth, root.clientWidth || rootRect.width || window.innerWidth);
            const overflow = Math.max(0, Math.ceil((root.scrollWidth || rootRect.width) - rootClientWidth));
            if (overflow > 1) {
                const offenders = select("*").filter(el => {
                    if (!visible(el)) return false;
                    const r = el.getBoundingClientRect();
                    return r.right > Math.min(window.innerWidth, rootRect.right) + 1 || r.left < Math.max(0, rootRect.left) - 1;
                });
                add("error", "horizontalOverflow", "Page is " + overflow + "px wider than the viewport; reflow is broken.", offenders);
            }

            const headings = select("h1,h2,h3,h4,h5,h6").filter(visible);
            const h1s = headings.filter(el => el.tagName === "H1");
            if (h1s.length !== 1) add("error", "pageHeading", "Expected exactly one visible H1; found " + h1s.length + ".", h1s);
            if (h1s.length) {
                const fontPx = parseFloat(window.getComputedStyle(h1s[0]).fontSize) || 0;
                const limit = kind === "web" ? 80 : 48;
                if (fontPx > limit) add("warning", "oversizedHeading", "H1 is " + Math.round(fontPx) + "px on a " + kind + " screen; it exceeds the " + limit + "px archetype guardrail.", h1s);
            }

            const mainCount = select("main,[role='main']").filter(visible).length;
            if (mainCount !== 1) add("warning", "mainLandmark", "Expected one visible main landmark; found " + mainCount + ".");

            const labelable = select("input,select,textarea").filter(el => {
                const t = String(el.getAttribute("type") || "").toLowerCase();
                return visible(el) && !["hidden", "button", "submit", "reset", "image"].includes(t);
            });
            const unlabeled = labelable.filter(el => !hasAccessibleLabel(el));
            if (unlabeled.length) add("error", "controlLabel", "Visible form controls need an associated visible label or accessible name.", unlabeled);

            const horizontalLabels = [];
            for (const label of select("label").filter(visible)) {
                const control = label.control || label.querySelector("input,select,textarea");
                if (!control || !visible(control)) continue;
                const lr = label.getBoundingClientRect(), cr = control.getBoundingClientRect();
                const sameRow = Math.abs(lr.top - cr.top) < Math.min(12, cr.height * 0.35) && cr.left > lr.left + 8;
                if (sameRow) horizontalLabels.push(label);
            }
            if (horizontalLabels.length) add("warning", "horizontalFormLabels", "Operational forms should use concise labels above controls for proximity and scanning.", horizontalLabels);

            const wideControls = labelable.filter(el => el.getBoundingClientRect().width > 720);
            if (wideControls.length) add("warning", "overwideControl", "Controls wider than 720px should be bounded or sized to the expected answer.", wideControls);

            const targets = select("button,a[href],[role='button'],input[type='checkbox'],input[type='radio'],select").filter(visible);
            const undersized = targets.filter(el => {
                const cs = window.getComputedStyle(el), r = el.getBoundingClientRect();
                const inlineTextLink = el.tagName === "A" && cs.display === "inline" && !!el.closest("p,li,dd,figcaption");
                return !inlineTextLink && (r.width < 24 || r.height < 24);
            });
            if (undersized.length) add("warning", "targetSize", "Non-inline action targets should contain at least a 24x24 CSS-pixel area.", undersized);

            const actionWords = /^(add|create|save|cancel|edit|delete|remove|check out|check in|submit|send|email|book|get started|try again)\b/i;
            const bareActions = select("a[href]").filter(el => {
                if (!visible(el) || !actionWords.test(String(el.textContent || "").trim())) return false;
                const cs = window.getComputedStyle(el), r = el.getBoundingClientRect();
                const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
                const border = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
                const transparent = cs.backgroundColor === "rgba(0, 0, 0, 0)" || cs.backgroundColor === "transparent";
                return cs.display === "inline" && pad < 12 && border === 0 && transparent && r.height < 32;
            });
            if (bareActions.length) add("warning", "bareActionLink", "Action links render like body links; apply the documented button/action hierarchy.", bareActions);

            // Evidence: the 2026-07-30 aggregate session insights — shipped pals carried default-UA
            // underlined links past a PASS review. That is aggregate session evidence, not a live
            // server rejection, so this ships advisory ("warning") per the designClassRequired
            // precedent. Inline prose links keep the underline on purpose, so they are exempt the
            // same way targetSize exempts inlineTextLink above.
            const unstyledLinks = select("a[href]").filter(el => {
                if (!visible(el)) return false;
                const cs = window.getComputedStyle(el);
                if (!String(cs.textDecorationLine || "").includes("underline")) return false;
                if (Array.from(el.classList || []).some(c => c.startsWith("pb-"))) return false;
                const inlineProseLink = cs.display === "inline" && !!el.closest("p,li,dd,figcaption");
                return !inlineProseLink;
            });
            if (unstyledLinks.length) add("warning", "unstyledLink", "Links show the default browser underline with no pb-* class; apply the documented link/action styling.", unstyledLinks);

            // Same 2026-07-30 aggregate session evidence, same advisory reasoning: form controls do
            // not inherit font-family, so a control left unstyled renders in the UA font while the
            // rest of the pal uses the design font. Body font is read here (this evaluate); the
            // style-status pass's bodyComputed belongs to a different evaluate and is out of scope.
            const normalizeFont = (value) => String(value || "").toLowerCase().replace(/["']/g, "").replace(/\s+/g, "");
            const bodyFont = body ? normalizeFont(window.getComputedStyle(body).fontFamily) : "";
            const mismatchedControlFonts = bodyFont
                ? select("button,input,select,textarea").filter(el => visible(el)
                    && normalizeFont(window.getComputedStyle(el).fontFamily) !== bodyFont)
                : [];
            if (mismatchedControlFonts.length) add("warning", "unstyledControlTypography", "Interactive controls render in a different font than the page body; set font-family (or font: inherit) on controls.", mismatchedControlFonts);

            const actionCells = select("td[data-label='Actions']").filter(visible);
            const ungroupedRowActions = actionCells.filter(cell => {
                const actions = Array.from(cell.querySelectorAll("a[href],button,[role='button']")).filter(visible);
                return actions.length >= 2 && !cell.querySelector(".pb-row-actions");
            });
            if (ungroupedRowActions.length) add("error", "rowActionGroup", "Rows with multiple actions must use .pb-row-actions so controls have intentional spacing, wrapping, destructive separation, and mobile reflow.", ungroupedRowActions);

            const conflictingRowActions = actionCells.filter(cell => {
                const labels = Array.from(cell.querySelectorAll("a[href],button,[role='button']"))
                    .filter(visible).map(el => String(el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase());
                return labels.includes("check out") && labels.includes("check in");
            });
            if (conflictingRowActions.length) add("error", "conflictingRowActions", "Mutually exclusive state transitions are visible together; render only the action valid for the row's current status.", conflictingRowActions);

            const visibleSkipLinks = select("a[href^='#']").filter(el => {
                if (!/skip.+content/i.test(String(el.textContent || "")) || !visible(el) || document.activeElement === el) return false;
                const r = el.getBoundingClientRect();
                return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
            });
            if (visibleSkipLinks.length) add("warning", "skipLinkVisible", "Skip link is visible without keyboard focus; keep it off-canvas until focused.", visibleSkipLinks);

            const badTables = select("table").filter(el => visible(el) && !el.querySelector("th"));
            if (badTables.length) add("error", "tableHeaders", "Data tables need semantic header cells.", badTables);

            const regions = select("main,#body,.pb-section,section").filter(visible);
            let largestVerticalGap = 0;
            for (const region of regions) {
                const children = Array.from(region.children).filter(visible).map(el => el.getBoundingClientRect()).sort((a, b) => a.top - b.top);
                for (let i = 1; i < children.length; i++) largestVerticalGap = Math.max(largestVerticalGap, Math.round(children[i].top - children[i - 1].bottom));
            }

            const errors = findings.filter(f => f.severity === "error").length;
            const warnings = findings.filter(f => f.severity === "warning").length;
            return {
                inspected: true,
                version: 2,
                scope: root === document.body ? "body" : (root.id ? "#" + root.id : root.tagName.toLowerCase()),
                notes: root.id === "cp-root" ? ["audit scoped to #cp-root — platform-chrome exception cannot apply to these findings"] : [],
                metrics: {
                    viewport: { width: window.innerWidth, height: window.innerHeight },
                    scrollWidth: root.scrollWidth,
                    scrollHeight: root.scrollHeight,
                    horizontalOverflow: overflow,
                    visibleH1s: h1s.length,
                    visibleControls: labelable.length,
                    visibleTargets: targets.length,
                    largestVerticalGap
                },
                errors,
                warnings,
                pass: errors === 0,
                findings
            };
        }, { audit: "palsync-design-v1", kind });
        return Object.assign({ viewportName }, audit);
    } catch (e) {
        return {
            inspected: false,
            viewportName,
            errors: 0,
            warnings: 0,
            pass: null,
            findings: [],
            error: e && e.message ? e.message.split("\n")[0] : String(e)
        };
    }
}

// Playwright is an OPTIONAL dependency — some runtimes won't have it. require() inside try/catch
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
async function downscaleToJpeg(pg, pngBase64, scale = null, quality = 0.42) {
    try {
        return await pg.evaluate(({ pngBase64, scale, quality }) => new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                // Keep the inline evidence legible while bounding both portrait and landscape
                // captures. The full-resolution PNG remains on disk for pixel-level inspection.
                const factor = scale == null
                    ? Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight))
                    : scale;
                const w = Math.max(1, Math.round(img.naturalWidth * factor));
                const h = Math.max(1, Math.round(img.naturalHeight * factor));
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
async function runScreenshot(session, guid, { page, viewport, fullPage, imageless } = {}) {
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
        browser = await getBrowser();
    } catch (e) {
        return { captured: false, available: false,
                 reason: "Playwright is installed but its Chromium browser is not — visual review falls back to the human eyeball gate. Install it with: npx playwright install chromium  (" +
                     (e && e.message ? e.message.split("\n")[0] : String(e)) + ")" };
    }
    let bctx;
    try {
        bctx = await browser.newContext({ viewport: vp });
        const pg = await bctx.newPage();
        const styleEvents = watchStylesheetNetwork(pg);
        // The target URL activates the session and lands the render. For WEB it's the no-auth
        // rawToken; for CONSOLE/transaction it's the cp-auth'd URL — the browser absorbs the auth
        // redirect chain, same as a human opening the preview link. A failed/timed-out auth replay
        // throws here → caught below as a clean captured:false (eyeball-gate fallback).
        await waitForRenderablePage(pg, target);
        if (page && isWeb) {
            // Sub-page navigation under the site root (web only; console renders one workflow).
            // Same base derivation preview.js openInstanceSession uses: origin + first path segment.
            const root = new URL(pg.url());
            const seg = root.pathname.split("/").filter(Boolean)[0] || "";
            const base = root.origin + "/" + (seg ? seg + "/" : "");
            await waitForRenderablePage(pg, base + String(page).replace(/^\/+/, ""));
        }
        const landed = pg.url();
        if (isLoginRedirect(landed)) {
            return {
                captured: false, available: true, kind: t.kind, authExpired: true,
                url: sanitizeUrl(landed),
                reason: "The preview redirected to the CloudPiston login page, so the authenticated test session expired. Re-run pal_screenshot to establish a fresh session; no UI evidence was captured."
            };
        }
        const styleStatus = await inspectStyleStatus(pg, styleEvents);
        const designAudit = await inspectDesignQuality(pg, { kind: t.kind, viewportName });
        const buf = imageless ? null : await pg.screenshot({ fullPage: !!fullPage });
        const pngBase64 = buf ? buf.toString("base64") : null;
        // Read the rendered text and check for a CloudPiston runtime-error block — a pal that
        // validated can still throw at render time. Best-effort: a failure to read text must not
        // sink the (successful) capture.
        let renderError = null;
        try { renderError = detectRenderError(await pg.innerText("body")); } catch (e) { /* ignore */ }
        const small = pngBase64 ? await downscaleToJpeg(pg, pngBase64) : null;
        return {
            captured: true, available: true, kind: t.kind,
            viewport: vp, viewportName,
            // WEB landing is the webpals host (no creds). CONSOLE landing may retain cp-auth in the
            // URL — sanitize to origin+path so no credential is ever returned.
            url: isWeb ? pg.url() : sanitizeUrl(pg.url()),
            renderError,
            styleStatus,
            designAudit,
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
        try { if (bctx) await bctx.close(); }
        finally { releaseBrowser(); }
    }
}

module.exports = {
    runScreenshot, detectRenderError, sanitizeUrl, sanitizeResourceUrl, isLoginRedirect, loadChromium,
    getBrowser, releaseBrowser, downscaleToJpeg, waitForStyles, waitForRenderablePage, inspectStyleStatus,
    inspectDesignQuality, VIEWPORTS
};
