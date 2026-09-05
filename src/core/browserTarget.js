"use strict";
// Shared browser foundation for pal_screenshot and pal_exercise: ONE definition of a workflow
// target, ONE authenticated bootstrap, ONE state oracle. Before this module each tool built its
// own console URL and each decided for itself whether a landed page counted as evidence — which
// let a screenshot of the wrong screen return captured:true and let an exercise report an action
// it never dispatched.
//
// CONSOLE ACTION CONTRACT (evidence, not guesswork)
//   The platform's own mechanism for "open the test console AT an action" is the cp-ws-doaction
//   query parameter that PalBuilder's IDE appends to the Test token URL
//   (com/nxlight/palbuilder/webstart/ui/actions/TestConsoleAction.java:108 for console,
//   TestTransactionAction.java:94 for transaction). The IDE takes the action from a free-text
//   "Action:" field (ui/dialogs/ValidationDialog.java:111) and appends it verbatim, so the value
//   is an action STRING, not an action name plus a separate parameter map.
//   The pal-side spelling of that same string is the c:a form documented in
//   bundled-context/skills/palbuilder-frontend/references/c-tags.md:44 —
//   `<c:a action="getCampaign?id=${campaign.id}">` — action name with an optional query suffix.
//   So the canonical internal representation is that one string ("dispatch"), and a caller-supplied
//   `params` map is normalized INTO it rather than being scattered as separate top-level query
//   keys. Encoded once through URLSearchParams, so a value containing & or = survives.
//
//   LIVE-VERIFIED 2026-09-05 against secure.cloudpiston.com (console pal Audithelm V1):
//     cp-ws-doaction=openClientSetup             -> setup wizard, "STEP 1 OF 8" visible
//     cp-ws-doaction=openClientSetup?id=999999   -> client list, wizard absent (id parsed, no match)
//     cp-ws-doaction=openClientSetup?id=NOT-A-NUMBER -> server threw For input string: "NOT-A-NUMBER"
//                                                    in findClientInWorkspace
//   The exception proves the value reached request.getData().get("id") verbatim, and the first two
//   prove it changes the rendered outcome. The landed URL was byte-identical in all three cases,
//   which is why rendered text — not the URL — is the state oracle.
//
//   This is the INITIAL target only. Every action AFTER the first screen is dispatched by clicking
//   the real rendered `c:a` (pal_exercise's existing click path) — that is the production path,
//   javascript: href and AJAX fragment included. PalSync never simulates the dispatcher with its
//   own HTTP request.
//
// STATE ORACLE
//   `c:a` navigation does not reliably update window.location
//   (bundled-context/skills/palbuilder-frontend/references/platform-facts.md:80), so URL matching
//   is NOT the console state oracle. Rendered text is: the caller declares expected visible
//   strings and verifyState checks them against what the browser actually painted.
const { RESERVED_QUERY_KEYS } = require("./test");

// Bounded observation of what the browser is actually showing. Only enough to answer
// "which screen is this?" — never a DOM dump.
const OBSERVE_HEADINGS = 8;
const OBSERVE_TEXT_CAP = 80;

function isScalar(v) {
    return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

// Normalize a requested workflow target into the single canonical form.
// Accepts either the platform-native combined string ("openClientSetup?id=9") or an action name
// plus a params map, or both — but never silently resolves a disagreement between them.
// Returns { target } | { target: null } (no target requested) | { blocked, reason, ... }.
function normalizeTarget({ action, params } = {}) {
    const hasParams = params != null && typeof params === "object" && !Array.isArray(params) && Object.keys(params).length > 0;
    if (params != null && (typeof params !== "object" || Array.isArray(params))) {
        return { blocked: "invalid-params", reason: "params must be a map of scalar query parameters." };
    }
    const rawAction = action == null ? "" : String(action).trim();
    if (!rawAction) {
        if (hasParams) return { blocked: "params-require-action", reason: "params require an action — pass the action they belong to." };
        return { target: null };
    }

    const qIndex = rawAction.indexOf("?");
    const name = (qIndex === -1 ? rawAction : rawAction.slice(0, qIndex)).trim();
    // No character restrictions beyond emptiness: the dispatch string is encoded once through
    // URLSearchParams, so any character an action name legitimately carries survives intact.
    if (!name) return { blocked: "invalid-action", reason: "action must start with the action name (e.g. \"openClientSetup\" or \"openClientSetup?id=9\")." };

    const merged = new Map();
    if (qIndex !== -1) {
        for (const [k, v] of new URLSearchParams(rawAction.slice(qIndex + 1))) {
            if (RESERVED_QUERY_KEYS.has(k)) return { blocked: "reserved-param", reservedKey: k, reason: "Param key \"" + k + "\" is reserved and cannot be overwritten." };
            merged.set(k, v);
        }
    }
    if (hasParams) {
        for (const [k, v] of Object.entries(params)) {
            if (RESERVED_QUERY_KEYS.has(k)) return { blocked: "reserved-param", reservedKey: k, reason: "Param key \"" + k + "\" is reserved and cannot be overwritten." };
            if (!isScalar(v)) return { blocked: "invalid-params", reason: "Param \"" + k + "\" must be a scalar string/number/boolean." };
            const asString = String(v);
            if (merged.has(k) && merged.get(k) !== asString) {
                // Never pick a winner: the caller asked for two different values for one parameter.
                return { blocked: "conflicting-params", conflictingKey: k,
                         reason: "Param \"" + k + "\" is given both inside the action string and in params with different values — pass it once." };
            }
            merged.set(k, asString);
        }
    }

    const paramMap = {};
    for (const [k, v] of merged) paramMap[k] = v;
    const query = new URLSearchParams(merged).toString();
    return {
        target: {
            action: name,
            params: paramMap,
            paramKeys: Object.keys(paramMap),
            dispatch: query ? name + "?" + query : name
        }
    };
}

// Append the canonical dispatch string as ONE encoded cp-ws-doaction value. Existing token/auth/
// workflow fields on the preview URL survive untouched.
function buildTargetUrl(previewUrl, dispatch) {
    const u = new URL(previewUrl);
    u.searchParams.append("cp-ws-doaction", String(dispatch));
    return u.toString();
}

// Time-bind one page call. A page that never answers must not hang the caller: state observation
// resolves to the fallback and the run continues with an honest "nothing identifiable rendered".
function withBound(promise, ms, fallback) {
    let timer = null;
    return new Promise((resolve) => {
        const done = (value) => { if (timer) clearTimeout(timer); resolve(value); };
        timer = setTimeout(() => done(fallback), ms);
        Promise.resolve(promise).then(done, () => done(fallback));
    });
}

const STATE_TIMEOUT_MS = 5000;

// What is the browser actually showing? Bounded, credential-free, and cheap.
async function observeScreen(pg, boundMs = STATE_TIMEOUT_MS) {
    try {
        const seen = await withBound(pg.evaluate(() => {
            const compact = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 80);
            const uniq = (xs) => Array.from(new Set(xs.filter(Boolean)));
            const headings = uniq(Array.from(document.querySelectorAll("h1,h2,[role='heading']"))
                .map(el => compact(el.innerText || el.textContent)));
            return { title: compact(document.title), headings: headings.slice(0, 8) };
        }), boundMs, null);
        return { title: (seen && seen.title) || null, headings: (seen && seen.headings) || [] };
    } catch (e) {
        return { title: null, headings: [] };
    }
}

// The state oracle. `expect` is a small list of strings that MUST be visible on the screen the
// caller asked for. Returns verified:null when the caller declared no expectation — that is an
// honest "not proven", never a pass.
async function verifyState(pg, expect, boundMs = STATE_TIMEOUT_MS) {
    const wanted = Array.isArray(expect) ? expect.filter(s => typeof s === "string" && s) : [];
    const observed = await observeScreen(pg, boundMs);
    if (!wanted.length) return { verified: null, expect: [], observed };
    const text = await withBound(Promise.resolve().then(() => pg.innerText("body")), boundMs, "");
    const results = wanted.map(s => ({ string: s, found: String(text).indexOf(s) !== -1 }));
    return { verified: results.every(r => r.found), expect: results, observed };
}

// Compact "you asked for X, the browser showed Y" line for failure reporting. Param VALUES never
// appear — only their keys, matching PalSync's evidence rules.
function describeTargetMismatch(requested, state) {
    const req = ["workflow: " + (requested.kind || "unknown")];
    if (requested.action) req.push("action: " + requested.action);
    if (requested.paramKeys && requested.paramKeys.length) req.push("paramKeys: " + requested.paramKeys.join(", "));
    const missing = (state.expect || []).filter(r => !r.found).map(r => JSON.stringify(r.string));
    const obs = [];
    if (state.observed && state.observed.headings && state.observed.headings.length) {
        obs.push("headings: " + state.observed.headings.slice(0, OBSERVE_HEADINGS).map(h => JSON.stringify(h.slice(0, OBSERVE_TEXT_CAP))).join(", "));
    }
    if (state.observed && state.observed.title) obs.push("title: " + JSON.stringify(state.observed.title.slice(0, OBSERVE_TEXT_CAP)));
    return "requested — " + req.join("; ") +
        "\n  missing from the rendered screen: " + (missing.length ? missing.join(", ") : "(none)") +
        "\n  observed — " + (obs.length ? obs.join("; ") : "(nothing identifiable rendered)");
}

// Web test instances serve every route under origin + the first path segment. preview.js,
// screenshot.js and exercise.js all derived this independently; this is the one definition.
function deriveWebBase(landedUrl) {
    const u = new URL(landedUrl);
    const seg = u.pathname.split("/").filter(Boolean)[0] || "";
    return u.origin + "/" + (seg ? seg + "/" : "");
}

// Which URL establishes the requested initial state? WEB lands on its public token URL (route
// selection happens after landing, under the derived base). CONSOLE/transaction lands on the
// cp-auth'd preview URL, carrying the initial action as cp-ws-doaction when one was requested.
function resolveTargetUrl(t, target) {
    const isWeb = t.kind === "web";
    const base = isWeb ? t.rawToken : t._previewUrl;
    if (!base) return { blocked: "no-preview-url" };
    if (!target || isWeb) return { url: base, dispatched: false };
    return { url: buildTargetUrl(base, target.dispatch), dispatched: true };
}

// The browser lifecycle (Chromium launch/reuse, navigation settle, login detection) lives in
// browser.js — this module depends straight down on it, and screenshot.js/exercise.js depend on
// both. No cycles, no lazy resolution.
function browserPrimitives(deps = {}) {
    const s = require("./browser");
    return {
        loadChromium: deps.loadChromium || s.loadChromium,
        getBrowser: deps.getBrowser || s.getBrowser,
        waitForRenderablePage: deps.waitForRenderablePage || s.waitForRenderablePage,
        isLoginRedirect: deps.isLoginRedirect || s.isLoginRedirect,
        VIEWPORTS: s.VIEWPORTS
    };
}

// THE INVARIANT: no browser evidence is valid and no exercise step runs until this has positively
// established that the browser is authenticated and standing on the requested initial state.
// Returns { ok:true, browser, bctx, pg, state, potentialMutationStarted } on success, or
// { ok:false, status:"blocked"|"failed", category, retryable, reason, ... } — always with bctx/pg
// when they exist, so the caller can collect failure evidence before closing them in its finally.
//
// RETRY SAFETY: `retryable` is true only for failures that provably happened BEFORE the requested
// action could execute — a missing/failed browser, or a login redirect (an unauthenticated console
// request is bounced to login, so the action was never dispatched). Any failure after an
// action-bearing navigation was issued sets potentialMutationStarted and is never retryable.
async function openAuthenticatedScreen(t, { viewport, target, expect, navOpts, onPage, afterLanding, contextTimeouts, stateTimeout } = {}, deps = {}) {
    const prim = browserPrimitives(deps);
    const isWeb = t.kind === "web";
    if (!prim.loadChromium()) {
        return { ok: false, available: false, status: "blocked", category: "environment", retryable: false,
                 potentialMutationStarted: false,
                 reason: "Playwright/Chromium is not installed in this runtime. Enable with: npm i playwright && npx playwright install chromium" };
    }
    const resolved = resolveTargetUrl(t, target);
    if (resolved.blocked) {
        return { ok: false, status: "blocked", category: "navigation", retryable: false, potentialMutationStarted: false,
                 reason: isWeb ? "No web preview URL was returned — can't render."
                               : "No authenticated preview URL for this " + t.kind + " pal — can't drive the console screen." };
    }
    let browser;
    try { browser = await prim.getBrowser(); }
    catch (e) {
        return { ok: false, available: false, status: "blocked", category: "environment", retryable: false,
                 potentialMutationStarted: false,
                 reason: "Playwright is installed but its Chromium browser is not — install it with: npx playwright install chromium (" +
                     (e && e.message ? e.message.split("\n")[0] : String(e)) + ")" };
    }

    const vp = prim.VIEWPORTS[viewport] ? prim.VIEWPORTS[viewport] : prim.VIEWPORTS.desktop;
    let bctx = null, pg = null;
    let potentialMutationStarted = false;
    try {
        bctx = await browser.newContext({ viewport: vp });
        // Opt-in context-level bounds. pal_exercise drives many sequential operations and caps each
        // one; pal_screenshot deliberately keeps Playwright's own defaults so a slow console render
        // still produces evidence. These are context METHODS, not newContext options.
        if (contextTimeouts) {
            try { if (bctx.setDefaultTimeout) bctx.setDefaultTimeout(contextTimeouts.action); } catch (e) { /* older/fake context */ }
            try { if (bctx.setDefaultNavigationTimeout) bctx.setDefaultNavigationTimeout(contextTimeouts.navigation); } catch (e) { /* older/fake context */ }
        }
        pg = await bctx.newPage();
        if (onPage) onPage(pg, bctx);
        // The action rides the first navigation, so from here a failure cannot prove the action
        // did not run — except a login redirect, handled explicitly below.
        potentialMutationStarted = resolved.dispatched;
        await prim.waitForRenderablePage(pg, resolved.url, navOpts || {});
    } catch (e) {
        const landedLogin = (() => { try { return !isWeb && prim.isLoginRedirect(pg.url()); } catch { return false; } })();
        const msg = (e && e.message ? e.message.split("\n")[0] : String(e)).replace(/https?:\/\/\S+/g, "<url>");
        return { ok: false, browser, bctx, pg, viewport: vp,
                 status: "blocked", category: landedLogin ? "auth" : "navigation",
                 retryable: landedLogin || !resolved.dispatched,
                 potentialMutationStarted: landedLogin ? false : potentialMutationStarted,
                 reason: landedLogin ? "console session expired / not authenticated"
                                     : (isWeb ? "Could not open the web page" : "Could not open the authenticated " + t.kind + " screen") + " (" + msg + ")" };
    }

    if (!isWeb && prim.isLoginRedirect(pg.url())) {
        // Unauthenticated console requests are bounced to login before the workflow runs, so the
        // requested action provably did not execute — this is the one failure a retry may replay.
        return { ok: false, browser, bctx, pg, viewport: vp, authExpired: true,
                 status: "blocked", category: "auth", retryable: true, potentialMutationStarted: false,
                 reason: "The console preview redirected to the CloudPiston login page, so the authenticated test session expired. No UI evidence was captured." };
    }

    // WEB selects its route after landing (the token URL activates the session first), so the
    // state oracle runs once the caller has finished establishing the requested screen.
    if (afterLanding) {
        try { await afterLanding(pg); }
        catch (e) {
            const msg = (e && e.message ? e.message.split("\n")[0] : String(e)).replace(/https?:\/\/\S+/g, "<url>");
            return { ok: false, browser, bctx, pg, viewport: vp, status: "blocked", category: "navigation",
                     retryable: !resolved.dispatched, potentialMutationStarted,
                     reason: "Could not reach the requested screen (" + msg + ")" };
        }
    }

    const state = await verifyState(pg, expect, stateTimeout || STATE_TIMEOUT_MS);
    if (state.verified === false) {
        return { ok: false, browser, bctx, pg, viewport: vp, state,
                 status: "failed", category: "targeting", code: "initial-state-not-reached",
                 retryable: false, potentialMutationStarted,
                 reason: "The browser did not reach the requested state." };
    }
    return { ok: true, browser, bctx, pg, viewport: vp, state, potentialMutationStarted };
}

// One retry loop shared by every browser-oriented tool: mint a FRESH test instance and try again
// exactly once, and only when the previous attempt reported a provably pre-action failure. The
// token URL activates a single test session, so a retry must re-run the Test endpoint rather than
// replay the spent URL.
async function attemptWithFreshTest(session, guid, testOpts, attempt, deps = {}) {
    const testFn = deps.runTest || require("./test").runTest;
    const wait = deps.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    let retryAttempted = false;
    for (let i = 0; i < 2; i++) {
        const t = await testFn(session, guid, testOpts);
        const res = await attempt(t, { retryAttempted });
        if (i === 0 && res && res.retryable === true && res.potentialMutationStarted !== true) {
            retryAttempted = true;
            await wait(100);
            continue;
        }
        if (res && typeof res === "object") res.retryAttempted = retryAttempted;
        return res;
    }
}

module.exports = {
    normalizeTarget, buildTargetUrl, observeScreen, verifyState, describeTargetMismatch, isScalar,
    deriveWebBase, resolveTargetUrl, openAuthenticatedScreen, attemptWithFreshTest, STATE_TIMEOUT_MS
};
