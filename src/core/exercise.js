"use strict";
// pal_exercise core: functionally EXERCISE a pal's workflow actions and assert the rendered
// result — the missing layer above "it compiles" (pal_test) and "it renders" (pal_screenshot):
// "the write actually did the right thing". Each step triggers an action and asserts strings
// that MUST appear (`expect`) and MUST NOT appear (`absent`) in the rendered output afterwards
// — `absent` is what catches the classic edit-becomes-duplicate-insert bug (after an edit: new
// value in expect, old value in absent).
//
// Two modes, chosen automatically:
//   fetch   — WEB pal, no fill/click steps: the test-token URL is publicly fetchable and
//             `?action=X&param=Y` invokes the action with query params (the documented plain-link
//             mechanism). No browser needed.
//   browser — CONSOLE/transaction pals, or any step with fill/click: Playwright drives the REAL
//             screen through the same authenticated replay pal_screenshot uses — fill named
//             inputs, click the action link/button, read the rendered result. This exercises the
//             production path (encrypted c:a AJAX included), not a simulation.
//
// SECURITY: console URLs are credential-bearing — results only ever carry sanitizeUrl()'d URLs.
const { runTest } = require("./test");
const { checkExpect } = require("./preview");
const { detectRenderError, sanitizeUrl, loadChromium, getBrowser, releaseBrowser, VIEWPORTS } = require("./screenshot");

const MAX_STEPS = 10;

// ---- pure helpers (unit-testable without a server or browser) -------------------------------

function makeRunId() {
    return "run" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function substituteRunIdValue(v, runId) {
    if (typeof v === "string") return v.split("{{runId}}").join(runId);
    if (typeof v === "number") return v;
    if (Array.isArray(v)) return v.map(x => substituteRunIdValue(x, runId));
    if (v && typeof v === "object") {
        const out = {};
        for (const k of Object.keys(v)) out[k] = substituteRunIdValue(v[k], runId);
        return out;
    }
    return v;
}

function applyRunId(steps, runId) {
    return substituteRunIdValue(steps, runId);
}

// Validate the steps array shape. Returns [] when valid, else human-readable problem strings.
function validateSteps(steps) {
    const errs = [];
    if (!Array.isArray(steps) || steps.length === 0) return ["steps must be a non-empty array"];
    if (steps.length > MAX_STEPS) errs.push("too many steps (" + steps.length + " > " + MAX_STEPS + ") — split into multiple pal_exercise calls");
    steps.forEach((s, i) => {
        const at = "step " + (i + 1);
        if (!s || typeof s !== "object") { errs.push(at + " is not an object"); return; }
        if (!s.action && !s.page && !s.fill && !s.click && !(s.expect && s.expect.length) && !(s.absent && s.absent.length)) {
            errs.push(at + " does nothing — give it an action, page, fill, click, expect, or absent");
        }
        if (s.params && !s.action) errs.push(at + " has params but no action to send them with");
        for (const k of ["expect", "absent"]) {
            if (s[k] !== undefined && (!Array.isArray(s[k]) || s[k].some(x => typeof x !== "string" || !x))) {
                errs.push(at + " " + k + " must be an array of non-empty strings");
            }
        }
        for (const k of ["fill", "params"]) {
            if (s[k] !== undefined && (typeof s[k] !== "object" || Array.isArray(s[k]) ||
                Object.values(s[k]).some(v => typeof v !== "string" && typeof v !== "number"))) {
                errs.push(at + " " + k + " must be an object of name → string/number value");
            }
        }
        if (s.click !== undefined && (typeof s.click !== "string" || !s.click.trim())) {
            errs.push(at + " click must be the visible text (or a simple #id/.class selector) of the element to click; if text appears more than once, scope it with within");
        }
        if (s.within !== undefined && (typeof s.within !== "string" || !s.within.trim())) {
            errs.push(at + " within must be a non-empty CSS/Playwright selector");
        }
        if (s.within !== undefined && !s.click) errs.push(at + " has within but no click to scope");
    });
    return errs;
}

// Assert one step's expect/absent against a rendered-output haystack. Fetch mode passes served
// HTML; browser mode uses checkBrowserStep so only visible text proves behavior.
function checkStep(haystack, step) {
    const exp = checkExpect(haystack, step.expect || []);
    const abs = (step.absent || []).map((s) => {
        const text = String(haystack || "");
        let occurrences = 0;
        let from = 0;
        while (s && (from = text.indexOf(s, from)) !== -1) { occurrences++; from += s.length; }
        return { string: s, absent: occurrences === 0, occurrences };
    });
    return { pass: exp.pass && abs.every(a => a.absent), expect: exp.results, absent: abs };
}

// Browser checks deliberately use visible text. HTML is diagnostic-only: a submitted value can
// remain in an input's value= attribute when an action fails and leaves the form open.
function checkBrowserStep(visibleText, html, step) {
    const chk = checkStep(visibleText, step);
    for (const r of chk.expect) {
        if (!r.found && String(html || "").indexOf(r.string) !== -1) r.markupOnly = true;
    }
    return chk;
}

// One-line label for a step in output ("action=saveEquipment name=Camera" / "click \"Save\"").
function stepLabel(step) {
    const bits = [];
    if (step.page) bits.push("page=" + step.page);
    if (step.action) bits.push("action=" + step.action + (step.params ? "?" + new URLSearchParams(step.params).toString() : ""));
    if (step.fill) bits.push("fill{" + Object.keys(step.fill).join(",") + "}");
    if (step.click) bits.push("click " + JSON.stringify(step.click));
    if (step.within) bits.push("within " + JSON.stringify(step.within));
    if (!bits.length) bits.push("assert-only");
    return bits.join(" ");
}

// Resolve a click deterministically. The old behavior silently clicked `.first()` whenever a
// list contained several identical row actions (Edit / Check out / Delete), which could prove the
// wrong record and produce a false PASS. Duplicate visible text is now an explicit test failure;
// callers scope it with `within`, normally a row selector containing a unique {{runId}} value.
async function resolveClickTarget(pg, step) {
    const c = step.click.trim();
    let scope = pg;
    if (step.within) {
        const scopes = pg.locator(step.within);
        const scopeCount = await scopes.count();
        if (scopeCount === 0) {
            return { error: "within selector \"" + step.within + "\" matched no element" };
        }
        if (scopeCount > 1) {
            return { error: "within selector \"" + step.within + "\" is ambiguous (matched " + scopeCount + " elements); :has-text() can match containing ancestors. Scope through the identifying cell, for example tr:has([data-label=\"Name\"]:has-text(\"Record {{runId}}\"))" };
        }
        scope = scopes.first();
    }

    const loc = /^[#.]/.test(c) ? scope.locator(c) : scope.getByText(c, { exact: true });
    const count = await loc.count();
    if (count === 0) {
        return { error: "nothing to click matching \"" + c + "\"" + (step.within ? " within \"" + step.within + "\"" : "") };
    }
    if (count > 1) {
        return { error: "click \"" + c + "\" is ambiguous (matched " + count + " elements); add within with a precise row selector such as tr:has([data-label=\"Name\"]:has-text(\"Record {{runId}}\")), use the equivalent unique card selector, or click a unique #id/.class selector" };
    }
    return { locator: loc.first() };
}

function needsBrowser(steps) {
    return steps.some(s => s.fill || s.click);
}

async function screenFingerprint(pg) {
    try {
        return await pg.evaluate(() => {
            const body = document.body;
            const html = document.documentElement ? document.documentElement.outerHTML : "";
            return {
                text: body ? body.innerText : "",
                htmlLength: html.length,
                htmlTail: html.slice(Math.max(0, html.length - 2000))
            };
        });
    } catch (e) {
        return { text: "", htmlLength: 0, htmlTail: "" };
    }
}

async function waitForScreenSettle(pg, before) {
    try { await pg.waitForLoadState("networkidle", { timeout: 3000 }); } catch (e) { /* AJAX may not drive load state */ }
    try {
        await pg.waitForFunction((prev) => {
            const body = document.body;
            const html = document.documentElement ? document.documentElement.outerHTML : "";
            const text = body ? body.innerText : "";
            return text !== prev.text ||
                html.length !== prev.htmlLength ||
                html.slice(Math.max(0, html.length - 2000)) !== prev.htmlTail;
        }, before, { timeout: 3000 });
    } catch (e) { /* unchanged screens are valid for some actions */ }
    try { await pg.waitForTimeout(250); } catch (e) { /* best effort */ }
}

async function screenHints(pg) {
    try {
        return await pg.evaluate(() => {
            const compact = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 80);
            const uniq = (xs) => Array.from(new Set(xs.filter(Boolean)));
            const clickNodes = Array.from(document.querySelectorAll("a,button,input[type='button'],input[type='submit'],[role='button'],[onclick]"));
            const clicks = uniq(clickNodes.map(el =>
                compact(el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || el.getAttribute("title")))).slice(0, 20);
            const ids = uniq(Array.from(document.querySelectorAll("[id]")).map(el => "#" + compact(el.id))).slice(0, 20);
            const fields = uniq(Array.from(document.querySelectorAll("input[name],textarea[name],select[name]")).map(el => compact(el.getAttribute("name")))).slice(0, 20);
            const headings = uniq(Array.from(document.querySelectorAll("h1,h2,[role='heading']")).map(el => compact(el.innerText || el.textContent))).slice(0, 10);
            return { clicks, ids, fields, headings };
        });
    } catch (e) {
        return { clicks: [], ids: [], fields: [], headings: [] };
    }
}

function formatScreenHints(h) {
    const parts = [];
    if (h && h.headings && h.headings.length) parts.push("headings: " + h.headings.map(s => JSON.stringify(s)).join(", "));
    if (h && h.clicks && h.clicks.length) parts.push("clickable text: " + h.clicks.map(s => JSON.stringify(s)).join(", "));
    if (h && h.ids && h.ids.length) parts.push("ids: " + h.ids.join(", "));
    if (h && h.fields && h.fields.length) parts.push("fields: " + h.fields.join(", "));
    return parts.length ? " Current screen has " + parts.join("; ") + "." : "";
}

// ---- the runner ------------------------------------------------------------------------------

// Exercise the pal. Returns a structured result; never throws on a normal failure.
//   steps: [{ page?, action?, params?, fill?, click?, within?, expect?, absent? }]
//   workflow: "console" | "web" | "transaction" (optional — auto-detected)
//   viewport: "desktop" | "mobile" (browser mode only)
// Stops at the first failing step (later steps usually depend on earlier writes).
async function runExercise(session, guid, { steps, workflow, viewport } = {}) {
    const runId = makeRunId();
    steps = applyRunId(steps, runId);
    const problems = validateSteps(steps);
    if (problems.length) return { ran: false, invalid: true, problems, runId };

    const t = await runTest(session, guid, { kind: workflow });
    if (!t.ran) {
        return { ran: false, blocked: t.blocked, holder: t.holder, runId,
                 reason: t.blocked === "no-testable-workflow"
                     ? "This pal has no runnable workflow to exercise."
                     : "Could not start a test instance (" + (t.blocked || "unknown") + ")." };
    }
    if (!t.validated) {
        return { ran: false, kind: t.kind, validation: t.validation, runId,
                 reason: "The pal did not validate on the server, so it can't be exercised. Fix the validation notes, push, and exercise again." };
    }

    const isWeb = t.kind === "web";
    if (!isWeb && !needsBrowser(steps) && steps.some(s => s.action || s.page)) {
        return { ran: false, kind: t.kind, invalid: true, runId,
                 problems: ["a " + t.kind + " pal's actions run through the console screen — write steps as fill (inputs by name) + click (the action link/button text), not action/page"] };
    }

    const res = isWeb && !needsBrowser(steps) ? await exerciseByFetch(t, steps) : await exerciseByBrowser(t, steps, viewport);
    res.runId = runId;
    return res;
}

// WEB fast path: plain fetches against the activated test session, no browser.
async function exerciseByFetch(t, steps) {
    const { openInstanceSessionFromTest } = require("./preview");
    const inst = await openInstanceSessionFromTest(t);
    if (!inst.opened) return { ran: false, kind: "web", reason: inst.reason };
    const results = [];
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        let path = step.page || "";
        if (step.action) {
            const qs = new URLSearchParams(Object.assign({ action: step.action }, step.params || {}));
            path += (path.indexOf("?") === -1 ? "?" : "&") + qs.toString();
        }
        let r;
        try { r = await inst.fetchPath(path); }
        catch (e) {
            results.push({ step: i + 1, label: stepLabel(step), pass: false, error: "fetch failed: " + (e && e.message ? e.message : String(e)) });
            return { ran: true, kind: "web", mode: "fetch", pass: false, failedStep: i + 1, steps: results };
        }
        const renderError = detectRenderError(r.html);
        const chk = checkStep(r.html, step);
        const pass = chk.pass && !renderError && r.status < 400;
        results.push({ step: i + 1, label: stepLabel(step), status: r.status, pass,
                       expect: chk.expect, absent: chk.absent, renderError });
        if (!pass) return { ran: true, kind: "web", mode: "fetch", pass: false, failedStep: i + 1, steps: results };
    }
    return { ran: true, kind: "web", mode: "fetch", pass: true, steps: results };
}

// Browser path: drive the real screen (console/transaction always; web when steps fill/click).
async function exerciseByBrowser(t, steps, viewport) {
    const chromium = loadChromium();
    if (!chromium) {
        return { ran: false, available: false,
                 reason: "Playwright/Chromium is not installed in this runtime, and these steps need a real browser (console screen or fill/click). Enable with: npm i playwright && npx playwright install chromium — or verify this behavior at the human eyeball gate." };
    }
    const isWeb = t.kind === "web";
    const target = isWeb ? t.rawToken : t._previewUrl;
    if (!target) {
        return { ran: false, kind: t.kind,
                 reason: "No runnable URL for this " + t.kind + " pal — can't drive the screen." };
    }
    const vp = VIEWPORTS[viewport] ? VIEWPORTS[viewport] : VIEWPORTS.desktop;
    let browser;
    try { browser = await getBrowser(); }
    catch (e) {
        return { ran: false, available: false,
                 reason: "Playwright is installed but its Chromium browser is not — install it with: npx playwright install chromium (" + (e && e.message ? e.message.split("\n")[0] : String(e)) + ")" };
    }
    const results = [];
    let bctx;
    try {
        bctx = await browser.newContext({ viewport: vp });
        const pg = await bctx.newPage();
        const acceptedDialogs = [];
        pg.on("dialog", async (dialog) => {
            acceptedDialogs.push(dialog.type() + (dialog.message() ? ": " + dialog.message() : ""));
            try { await dialog.accept(); } catch (e) { /* dialog may already be gone */ }
        });
        await pg.goto(target, { waitUntil: "networkidle" });
        // Web base for page/action navigation — same derivation screenshot.js uses.
        let base = null;
        if (isWeb) {
            const u = new URL(pg.url());
            const seg = u.pathname.split("/").filter(Boolean)[0] || "";
            base = u.origin + "/" + (seg ? seg + "/" : "");
        }
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const fail = (why) => {
                results.push({ step: i + 1, label: stepLabel(step), pass: false, error: why, url: sanitizeUrl(pg.url()) });
                return { ran: true, kind: t.kind, mode: "browser", pass: false, failedStep: i + 1, steps: results };
            };
            try {
                if (isWeb && (step.page || step.action)) {
                    let path = step.page || "";
                    if (step.action) {
                        const qs = new URLSearchParams(Object.assign({ action: step.action }, step.params || {}));
                        path += (path.indexOf("?") === -1 ? "?" : "&") + qs.toString();
                    }
                    await pg.goto(base + String(path).replace(/^\/+/, ""), { waitUntil: "networkidle" });
                }
                if (step.fill) {
                    for (const [name, value] of Object.entries(step.fill)) {
                        const sel = "[name=" + JSON.stringify(String(name)) + "]";
                        if (await pg.locator(sel).count() === 0) {
                            const hints = await screenHints(pg);
                            const hasCreateNav = (hints.clicks || []).some(label => /^(?:add|create|new)\b/i.test(label));
                            return fail("no input named \"" + name + "\" on the current screen — " +
                                (hasCreateNav ? "the console opened on its list view; add a first step that clicks the visible Add/Create action before filling the form." : "check the fragment's name= attributes.") +
                                formatScreenHints(hints));
                        }
                        try { await pg.fill(sel, String(value)); }
                        catch (e) { await pg.selectOption(sel, String(value)); } // <select> fallback
                    }
                }
                if (step.click) {
                    const target = await resolveClickTarget(pg, step);
                    if (target.error) return fail(target.error + "." + formatScreenHints(await screenHints(pg)));
                    const before = await screenFingerprint(pg);
                    await target.locator.click();
                    await waitForScreenSettle(pg, before);
                }
            } catch (e) {
                const msg = (e && e.message ? e.message.split("\n")[0] : String(e)).replace(/https?:\/\/\S+/g, "<url>");
                return fail(msg);
            }
            let text = "";
            try { text = await pg.innerText("body"); } catch (e) { /* keep "" */ }
            const html = await pg.content();
            const renderError = detectRenderError(text) || detectRenderError(html);
            // Browser assertions prove what the user can see, not incidental source markup.
            // Searching HTML made a failed Save look successful whenever the submitted value
            // survived in an input's value= attribute on the still-open form.
            const chk = checkBrowserStep(text, html, step);
            const pass = chk.pass && !renderError;
            const dialogs = acceptedDialogs.splice(0);
            const hints = pass ? null : await screenHints(pg);
            results.push({ step: i + 1, label: stepLabel(step), pass,
                           expect: chk.expect, absent: chk.absent, renderError, dialogs, hints, url: sanitizeUrl(pg.url()) });
            if (!pass) return { ran: true, kind: t.kind, mode: "browser", pass: false, failedStep: i + 1, steps: results };
        }
        return { ran: true, kind: t.kind, mode: "browser", pass: true, steps: results };
    } catch (e) {
        const msg = (e && e.message ? e.message.split("\n")[0] : String(e)).replace(/https?:\/\/\S+/g, "<url>");
        return { ran: false, kind: t.kind,
                 reason: (isWeb ? "Could not drive the web page" : "Could not drive the authenticated " + t.kind + " screen") + " (" + msg + ")",
                 steps: results };
    } finally {
        try { if (bctx) await bctx.close(); }
        finally { releaseBrowser(); }
    }
}

// Human/agent-readable report. Never includes raw HTML or credential URLs.
function formatExercise(res) {
    if (res.invalid) return "pal_exercise: invalid steps —\n  - " + res.problems.join("\n  - ");
    if (!res.ran) return "pal_exercise did not run: " + (res.reason || res.blocked || "unknown");
    const lines = ["pal_exercise (" + res.kind + ", " + res.mode + " mode) — " + (res.pass ? "PASS" : "FAIL at step " + res.failedStep)];
    if (res.runId) lines.push("  runId: " + res.runId + " ({{runId}} placeholders in steps were replaced with this value)");
    for (const s of res.steps || []) {
        lines.push((s.pass ? "  ✓ " : "  ✗ ") + "step " + s.step + " [" + s.label + "]");
        if (s.error) lines.push("      error: " + s.error);
        for (const r of s.expect || []) {
            lines.push("      expect " + JSON.stringify(r.string) + ": " + (r.found ? "found in visible text" :
                "MISSING from visible text" + (r.markupOnly ? " (string exists only in markup (e.g. input value attribute) — expect visible rendered text instead)" : "")));
        }
        for (const r of s.absent || []) {
            lines.push("      absent " + JSON.stringify(r.string) + ": " + (r.absent ? "clean" : "STILL PRESENT — the old value survived (duplicate insert / edit didn't apply?)"));
            if (!r.absent && r.occurrences >= 1) lines.push("      hint: " + JSON.stringify(r.string) + " appears " + r.occurrences + " times on this page — on list pages scope with `within:` or assert against a unique {{runId}} value.");
        }
        if (s.dialogs && s.dialogs.length) lines.push("      dialog(s) accepted: " + s.dialogs.map(d => JSON.stringify(d)).join(", "));
        if (s.renderError) lines.push("      renderError: " + s.renderError.message + (s.renderError.workflow ? " (" + s.renderError.workflow + (s.renderError.line ? ":" + s.renderError.line : "") + ")" : ""));
        if (!s.pass && s.hints) lines.push("      " + formatScreenHints(s.hints));
    }
    if (!res.pass && res.ran) lines.push("  Later steps were not run — inspect the current screen/test targeting first. Push again only after editing a pal file.");
    return lines.join("\n");
}

module.exports = { runExercise, validateSteps, checkStep, checkBrowserStep, stepLabel, needsBrowser, formatExercise, applyRunId, resolveClickTarget, MAX_STEPS };
