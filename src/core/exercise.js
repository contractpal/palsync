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
const { checkExpect } = require("./preview");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { stableStringify } = require("./stableStringify");
const { detectRenderError } = require("./screenshot");
const { sanitizeUrl, sanitizeResourceUrl, releaseBrowser, waitForRenderablePage } = require("./browser");
// Target normalization, the authenticated bootstrap, the state oracle and the retry boundary are
// shared with pal_screenshot — neither tool may interpret a console action differently.
const { normalizeTarget, openAuthenticatedScreen, attemptWithFreshTest, deriveWebBase, describeTargetMismatch } = require("./browserTarget");

const MAX_STEPS = 10;

// Per-step bounded wait: a step may wait for its existing expect/absent assertions to become
// true without replaying the mutation. Waiting forces browser observation so current visible
// state (not stale fetch HTML) is checked. Timeout and interval are optional and bounded.
const WAIT_DEFAULT_TIMEOUT_MS = 15000;
const WAIT_MAX_TIMEOUT_MS = 60000;
const WAIT_DEFAULT_INTERVAL_MS = 500;
const WAIT_MIN_INTERVAL_MS = 100;

// Failure-evidence bounds. A failed/blocked browser run captures bounded evidence (browser events,
// a scoped accessibility snapshot, one failure JPEG) that the pal_exercise handler persists as
// failure-only artifacts under .agent-work-history/ so a coding agent can act on evidence instead
// of probing selectors by trial and error. Everything stays bounded: events are capped and deduped
// with strongly sanitized URLs/messages, the snapshot is truncated with an explicit marker, and
// the screenshot is a single bounded JPEG. Passing runs collect nothing extra and write nothing.
const BROWSER_EVENTS_CAP = 50;    // max captured browser events per run
const EVENT_MESSAGE_CAP = 300;    // max chars per event message (first line)
const ARIA_CAP = 4096;            // accessibility snapshot cap (~4k) with explicit truncation
const ARIA_TRUNCATE_MARK = "\n… (snapshot truncated)";
const FINAL_TEXT_CAP = 4000;      // final-state snapshot cap (~4k) with explicit truncation marker
const FINAL_TEXT_TRUNCATE_MARK = "\n… (final text truncated)";
const FAILURE_JPEG_QUALITY = 50;  // bounded failure screenshot (JPEG, quality 0-100)
const EVIDENCE_TIMEOUT_MS = 5000; // per-call bound for evaluate/aria/screenshot evidence calls

// Bounded per-operation browser timeouts (ms). A long valid flow may run many steps, but a single
// stuck operation must never consume minutes — each navigation/action/settle is capped well below
// Playwright's 30s per-action default. Deliberately NO whole-exercise deadline: a slow but live
// multi-step flow keeps running to completion.
const NAV_TIMEOUT_MS = 10000;   // one page navigation (goto)
const LOAD_TIMEOUT_MS = 5000;   // load state within a navigation
const IDLE_TIMEOUT_MS = 3000;   // networkidle within a navigation / screen settle
const ACTION_TIMEOUT_MS = 5000; // one fill/select/click
// Style/font settling is screenshot-only evidence — behavior checks assert visible text, which
// does not depend on it — so exercise navigations skip it.
const EXERCISE_NAV_OPTS = { gotoTimeout: NAV_TIMEOUT_MS, loadTimeout: LOAD_TIMEOUT_MS, idleTimeout: IDLE_TIMEOUT_MS, skipStyleSettle: true };

// Credential-ish step keys whose values must not be persisted. Record names and other values stay
// so the artifacts remain actionable for repro.
const SECRET_KEY_RE = /password|passwd|passcode|pwd|secret|token|auth|api[_-]?key|apikey|session|jwt|credential|otp|pin|private[_-]?key/i;

// The same key family for textual scrubbing — the single source of truth used both by evidence
// capture and by artifact persistence. Covers query-like (?k=v), header-like (k: v), and JSON-like
// ("k": "v") secret assignments plus bearer/basic authorization tokens. Failure evidence uses
// the strict scrub (blanket URL substitution + header-like on any secret-bearing label); the
// success snapshot path uses assignment/bearer/basic redaction only, with a tightened
// header-like rule that does not fire on a bare human-readable label like "Session:".
const SECRET_FORM_KEYS = "cp-auth|cp_auth|authorization|auth|token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|password|passwd|passcode|pwd|secret|client[_-]?secret|credential|jwt|session|cookie|otp|pin|bearer|private[_-]?key";

// Central textual secret scrubbing: strips auth-ish values from query-like, header-like, and
// JSON-like forms plus bearer/basic authorization tokens, so no credential value in these forms
// can reach a report or a persisted artifact.
function redactSecretForms(text) {
    let s = String(text == null ? "" : text);
    s = s.replace(new RegExp("([?&](?:" + SECRET_FORM_KEYS + ")=)[^&\\s\"'<>]+", "gi"), "$1<redacted>");
    // Unquoted key=value forms in body text (e.g. token=SECRET or cp-auth=SECRET) — not after ?/& and not quoted.
    s = s.replace(new RegExp("\\b((?:" + SECRET_FORM_KEYS + ")\\b)[\\t ]*=[\\t ]*[^\\s\"'<>`&;,]+", "gi"), "$1=<redacted>");
    s = s.replace(new RegExp("(^|\\r?\\n)([ \\t]*(?:[\\w-]*[ ._-])?(?:" + SECRET_FORM_KEYS + ")[\\w-]*[ \\t]*:[ \\t]*)([^\\r\\n]*)", "gim"), "$1$2<redacted>");
    s = s.replace(new RegExp("([\"']?(?:" + SECRET_FORM_KEYS + ")[\"']?[ \\t]*[:=][ \\t]*[\"'])([^\"']*)([\"'])", "gi"), "$1<redacted>$3");
    s = s.replace(/\bBearer[ \t]+[A-Za-z0-9._~+/=_-]+/gi, "Bearer <redacted>");
    s = s.replace(/\bBasic[ \t]+[A-Za-z0-9+/=_-]{4,}/gi, "Basic <redacted>");
    return s;
}

// Success-path redaction: same assignment/bearer/basic forms as redactSecretForms but WITHOUT
// blanket URL substitution and with a tightened header-like rule that does not fire on a bare
// human-readable label such as "Session: Welding 101". Failure evidence keeps the strict
// scrubCredentials path (which blanks every URL and redacts any header-like secret label).
function redactSecretFormsForSuccess(text) {
    let s = String(text == null ? "" : text);
    s = s.replace(new RegExp("([?&](?:" + SECRET_FORM_KEYS + ")=)[^&\\s\"'<>]+", "gi"), "$1<redacted>");
    s = s.replace(new RegExp("\\b((?:" + SECRET_FORM_KEYS + ")\\b)[\\t ]*=[\\t ]*[^\\s\"'<>`&;,]+", "gi"), "$1=<redacted>");
    s = s.replace(new RegExp("(^|\\r?\\n)([ \\t]*(?:[\\w-]*[ ._-])?(?:" + SECRET_FORM_KEYS + ")[\\w-]*[ \\t]*:[ \\t]*)([^\\r\\n]*)", "gim"), (match, p1, p2) => {
        const normalized = p2.trim().replace(/:.*/, "").trim();
        if (/^session$/i.test(normalized)) return match;
        return p1 + p2 + "<redacted>";
    });
    s = s.replace(new RegExp("([\"']?(?:" + SECRET_FORM_KEYS + ")[\"']?[ \\t]*[:=][ \\t]*[\"'])([^\"']*)([\"'])", "gi"), "$1<redacted>$3");
    s = s.replace(/\bBearer[ \t]+[A-Za-z0-9._~+/=_-]+/gi, "Bearer <redacted>");
    s = s.replace(/\bBasic[ \t]+[A-Za-z0-9+/=_-]{4,}/gi, "Basic <redacted>");
    return s;
}

// Build a bounded, scrubbed final-state snapshot. Only returned on overall success; failures
// carry no final text. Browser results use visible body text, fetch results carry honest
// server-markup provenance so callers never overclaim browser evidence. Text is scrubbed with
// the success-path filter (assignment/bearer/basic only, no blanket URL, tightened header)
// and capped with an explicit marker; failure-evidence scrubbing stays strictly via scrubCredentials.
function makeFinalSnapshot(raw, source) {
    const scrubbed = redactSecretFormsForSuccess(String(raw == null ? "" : raw));
    const truncated = scrubbed.length > FINAL_TEXT_CAP;
    const text = truncated ? scrubbed.slice(0, FINAL_TEXT_CAP - FINAL_TEXT_TRUNCATE_MARK.length) + FINAL_TEXT_TRUNCATE_MARK : scrubbed;
    return { source, text, truncated };
}

// Strip URL-shaped tokens and auth-ish values from evidence text. Inline summaries and persisted
// artifacts must never carry credential-bearing preview URLs, query/fragment values, or auth values.
function scrubCredentials(text) {
    let s = String(text == null ? "" : text);
    s = s.replace(/https?:\/\/[^\s()"'<>]+/g, "<url>");
    return redactSecretForms(s);
}

// One-line, scrubbed message for event evidence.
function scrubMessage(msg) {
    return scrubCredentials(msg).split("\n")[0].slice(0, EVENT_MESSAGE_CAP);
}

// Time-bind a single evaluate/aria/screenshot evidence call. A timed-out action must never be
// followed by an indefinite evidence hang: every evidence call is raced against this per-call
// bound and resolves to `fallback` (default null) when the page does not answer in time. The
// underlying Playwright call keeps its own lifecycle; evidence capture and the context close
// still proceed. Deliberately per-call only — there is NO whole-exercise cutoff.
function withBound(promise, ms, fallback = null) {
    let timer = null;
    return new Promise((resolve) => {
        const done = (value) => { if (timer) clearTimeout(timer); resolve(value); };
        timer = setTimeout(() => done(fallback), ms);
        Promise.resolve(promise).then(done, () => done(fallback));
    });
}

// Redact auth-like fill/params values from steps before they are persisted as an artifact.
function redactStepValues(steps) {
    return (steps || []).map((s) => {
        const out = Object.assign({}, s);
        for (const k of ["fill", "params"]) {
            if (out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
                const next = {};
                for (const name of Object.keys(out[k])) {
                    next[name] = SECRET_KEY_RE.test(name) ? "<redacted>" : out[k][name];
                }
                out[k] = next;
            }
        }
        return out;
    });
}

// Attach bounded, deduped browser-event listeners BEFORE navigation. Only the signals that explain
// a failure or block count: console errors/warnings, page errors, failed requests, and HTTP >= 400
// responses. Every URL is sanitized (origin+path only; query/fragment stripped) and every message
// is scrubbed + first-line + capped. Older/fake Page implementations may not support every event;
// each listener is attached best-effort and each handler is individually guarded.
function attachBrowserEvidence(pg) {
    const events = [];
    const boundedUrl = (url) => {
        const safe = sanitizeResourceUrl(url);
        return safe.length > EVENT_MESSAGE_CAP ? safe.slice(0, EVENT_MESSAGE_CAP - 14) + "… (truncated)" : safe;
    };
    const push = (ev) => {
        if (events.length >= BROWSER_EVENTS_CAP) return;
        if (events.some(e => e.type === ev.type && e.status === ev.status && e.url === ev.url && e.message === ev.message)) return;
        events.push(ev);
    };
    try {
        pg.on("console", (msg) => {
            try {
                const type = String(msg && msg.type ? msg.type() : "").toLowerCase();
                if (type !== "error" && type !== "warning") return;
                push({ type: "console:" + type, message: scrubMessage(msg.text ? msg.text() : msg.message) });
            } catch (e) { /* ignore */ }
        });
    } catch (e) { /* ignore */ }
    try {
        pg.on("pageerror", (err) => {
            try { push({ type: "pageerror", message: scrubMessage(err && err.message ? err.message : err) }); }
            catch (e) { /* ignore */ }
        });
    } catch (e) { /* ignore */ }
    try {
        pg.on("requestfailed", (req) => {
            try {
                const failure = req && req.failure ? req.failure() : null;
                push({ type: "requestfailed",
                       url: boundedUrl(req && req.url ? req.url() : ""),
                       message: scrubMessage(failure && failure.errorText) });
            } catch (e) { /* ignore */ }
        });
    } catch (e) { /* ignore */ }
    try {
        pg.on("response", (resp) => {
            try {
                const status = resp && resp.status ? resp.status() : null;
                if (status == null || status < 400) return;
                push({ type: "http", status, url: boundedUrl(resp.url ? resp.url() : "") });
            } catch (e) { /* ignore */ }
        });
    } catch (e) { /* ignore */ }
    return events;
}

// Scoped accessibility snapshot for failure evidence, truncated at ~4k with an explicit marker and
// credential-scrubbed. A scoped capture that fails or times out falls back to the body snapshot
// before the caller gives up on hints. Returns null only when every scope fails.
async function captureAria(pg, within, evidenceTimeout) {
    const scopes = [];
    if (within && within !== "body") scopes.push(within);
    scopes.push("body");
    for (const scope of scopes) {
        try {
            const raw = await withBound(pg.locator(scope).ariaSnapshot({ timeout: evidenceTimeout }), evidenceTimeout, null);
            if (raw == null || !String(raw).trim()) continue; // rejected, timed out, or empty — try the next scope
            const text = scrubCredentials(raw);
            const truncated = text.length > ARIA_CAP;
            return {
                aria: truncated ? text.slice(0, ARIA_CAP - ARIA_TRUNCATE_MARK.length) + ARIA_TRUNCATE_MARK : text,
                scope,
                truncated
            };
        } catch (e) { /* try the next scope */ }
    }
    return null;
}

// Best-effort DOM masking before the failure JPEG: password/auth/OTP-like input/select/textarea
// values are replaced in the DOM so the screenshot cannot carry them. Bounded like every other
// evidence call. This is a control, not a guarantee — screenshots may still show typed secrets in
// other elements, so artifacts are never advertised as fully credential-proof.
async function maskSensitiveFields(pg, evidenceTimeout) {
    try {
        return await withBound(pg.evaluate(() => {
            const KEY = /pass(word|code|wd)?|secret|token|otp|auth|pin|api[-_]?key/i;
            const masked = [];
            const pick = (el) => [el.name, el.id, el.getAttribute("aria-label"), el.placeholder, el.getAttribute("autocomplete")]
                .filter(Boolean).join(" ");
            for (const el of document.querySelectorAll("input,textarea,select")) {
                if (el.type === "password" || KEY.test(pick(el))) {
                    if (el.tagName === "SELECT") { for (const opt of el.options) opt.textContent = "••••••"; }
                    else if (el.value) { el.value = "••••••"; }
                    masked.push(el.name || el.id || el.tagName.toLowerCase());
                }
            }
            return masked;
        }), evidenceTimeout, []);
    } catch (e) {
        return [];
    }
}

// One bounded JPEG failure screenshot, best-effort (null when the page is gone or the capture
// fails). Sensitive DOM values are masked first; the capture itself is time-bound.
async function captureFailureJpeg(pg, evidenceTimeout) {
    try {
        await maskSensitiveFields(pg, evidenceTimeout);
        const buf = await withBound(pg.screenshot({ type: "jpeg", quality: FAILURE_JPEG_QUALITY, timeout: evidenceTimeout }), evidenceTimeout, null);
        return buf ? buf.toString("base64") : null;
    } catch (e) {
        return null;
    }
}

// Attach run-level failure evidence (browser events, accessibility snapshot or screen-hints
// fallback, and a bounded failure JPEG) to a failed/blocked result. The JPEG rides as base64 only
// as far as the caller that persists it — the pal_exercise handler writes it to disk and strips it
// before the result is returned, so base64 never reaches the calling agent.
async function attachEvidence(result, pg, step, events, evidenceTimeout) {
    if (!pg) return result; // no page, no browser evidence — caller gets the plain failed/blocked result
    const aria = await captureAria(pg, step && step.within, evidenceTimeout);
    result.evidence = {
        events: events || [],
        aria: aria ? aria.aria : null,
        ariaScope: aria ? aria.scope : (step && step.within) || "body",
        ariaTruncated: aria ? aria.truncated : false,
        hints: aria ? null : await screenHints(pg, evidenceTimeout),
        jpegBase64: await captureFailureJpeg(pg, evidenceTimeout),
        jpegBytes: null
    };
    return result;
}

// ---- pure helpers (unit-testable without a server or browser) -------------------------------

// Deterministic-but-unique runId: identical steps + identical ordinal state → identical bytes;
// the ordinal advances once per exercise run so sequential runs stay unique (runId is the
// uniqueness token for records the exercise creates/finds/deletes). Ordinal 0 keeps the
// helper pure for callers without a workspace (unit tests, offline paths).
function makeRunId(steps, ordinal) {
    const ord = Number.isFinite(ordinal) && ordinal >= 0 ? Math.floor(ordinal) : 0;
    const digest = crypto.createHash("sha256").update(stableStringify(steps || [])).digest("hex");
    return "run" + ord.toString(36) + "-" + digest.slice(0, 6);
}

// Ordinal source: <workspace>/.agent-work-history/pal_exercise/ordinal, a plain counter of
// prior pal_exercise runs. Inspected alternatives and why neither works: .palsync/tool-evidence.jsonl
// only records PASSING exercise runs (tools.js appends solely on ran && pass) and work-history
// pal_exercise run dirs only record failure/blocked browser runs (persistExerciseFailure) — neither
// is written for EVERY run (invalid/blocked/fetch-failure runs persist nothing), so neither can
// back a uniqueness ordinal. This dedicated counter is advanced by every run that mints a runId
// instead; a missing/unparseable file reads as 0 (best-effort, never throws).
function exerciseOrdinalFile(workspaceDir) {
    return path.join(workspaceDir, ".agent-work-history", "pal_exercise", "ordinal");
}

function readExerciseOrdinal(workspaceDir) {
    if (!workspaceDir) return 0;
    try {
        const n = parseInt(String(fs.readFileSync(exerciseOrdinalFile(workspaceDir), "utf8")).trim(), 10);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    } catch (e) { return 0; }
}

function takeExerciseOrdinal(workspaceDir) {
    const current = readExerciseOrdinal(workspaceDir);
    if (!workspaceDir) return current;
    try {
        fs.mkdirSync(path.dirname(exerciseOrdinalFile(workspaceDir)), { recursive: true });
        fs.writeFileSync(exerciseOrdinalFile(workspaceDir), String(current + 1) + "\n", "utf8");
    } catch (e) { /* best-effort — uniqueness degrades, determinism holds */ }
    return current;
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
        if (s.waitFor !== undefined) {
            if (!s.waitFor || typeof s.waitFor !== "object" || Array.isArray(s.waitFor)) {
                errs.push(at + " waitFor must be an object with timeoutMs and/or intervalMs");
            } else {
                if (s.waitFor.timeoutMs !== undefined) {
                    const v = s.waitFor.timeoutMs;
                    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v <= 0 || v > WAIT_MAX_TIMEOUT_MS) {
                        errs.push(at + " waitFor.timeoutMs must be an integer 1.." + WAIT_MAX_TIMEOUT_MS + " (ms)");
                    }
                }
                if (s.waitFor.intervalMs !== undefined) {
                    const v = s.waitFor.intervalMs;
                    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < WAIT_MIN_INTERVAL_MS || v > WAIT_MAX_TIMEOUT_MS) {
                        errs.push(at + " waitFor.intervalMs must be an integer " + WAIT_MIN_INTERVAL_MS + ".." + WAIT_MAX_TIMEOUT_MS + " (ms)");
                    }
                }
                const known = new Set(["timeoutMs", "intervalMs"]);
                for (const k of Object.keys(s.waitFor)) {
                    if (!known.has(k)) errs.push(at + " waitFor has unknown key " + JSON.stringify(k));
                }
                const hasAssertion = (Array.isArray(s.expect) && s.expect.length) || (Array.isArray(s.absent) && s.absent.length);
                if (!hasAssertion) errs.push(at + " waitFor requires at least one expect or absent assertion");
            }
        }
    });
    return errs;
}

// Common words that appear as row-level status/action buttons across many lists.
// Absent checks against these without a row scope are brittle on multi-row lists.
const STATUS_WORDS = ["Save", "Delete", "Edit", "Check out", "Check in", "Remove", "Update", "Submit", "Cancel", "Add", "New", "Create"];

// Labels that typically appear once per record in a list, so clicking them without a row scope is almost always ambiguous.
const DUPLICATE_ACTION_LABELS = ["Edit", "Delete", "Check out", "Check in", "Remove", "Update", "View", "Details"];

// Preflight misuse linter. Returns { warnings: [...], errors: [...] } without mutating the steps.
// Warnings allow the exercise to run; errors are treated as invalid steps.
function lintSteps(steps) {
    const warnings = [];
    const errors = [];
    let runIdDeleted = false;
    const earlierFillValues = [];
    const hasRunIdFill = steps.some(s => s.fill && Object.values(s.fill).some(v => String(v).indexOf("{{runId}}") !== -1));
    const canonicalWithin = "within: 'tr:has([data-label=\"Name\"]:has-text(\"{{runId}}\"))'";

    function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    function findStatusWord(a) {
        for (const w of STATUS_WORDS) {
            // Whole-word match; multi-word entries keep word boundaries around each word.
            const pattern = "\\b" + w.split(/\s+/).map(escapeRegExp).join("\\b\\s+\\b") + "\\b";
            if (new RegExp(pattern, "i").test(a)) return w;
        }
        return null;
    }
    function containsNth(sel) {
        return /\bnth=|:nth-child|:nth-of-type|:nth-last-child/i.test(sel);
    }
    function nthBeneathUniqueScope(sel) {
        // A positional selector is safe when it appears after a unique row scope marker.
        const re = /\bnth=|:nth-child|:nth-of-type|:nth-last-child/gi;
        for (const m of sel.matchAll(re)) {
            if (sel.slice(0, m.index).indexOf("{{runId}}") === -1) return false;
        }
        return true;
    }
    function meaningful(v) { return String(v).trim(); }

    steps.forEach((s, i) => {
        const at = "step " + (i + 1);
        const currentFillValues = s.fill ? Object.values(s.fill).map(String) : [];

        // Shared text exists in containing rows and cards, so :has-text() needs the unique run value.
        // This remains advisory: fixed text may intentionally target a pre-existing record.
        if (s.within && /:has-text\s*\(/i.test(s.within) && s.within.indexOf("{{runId}}") === -1) {
            warnings.push(at + " `within` uses :has-text() without {{runId}} and may match a shared-name row/card; use " + canonicalWithin +
                (hasRunIdFill ? ". This exercise fills a {{runId}} value, so scope the action to that record" : ""));
        }

        // An absent string that is contained by expected or filled text can never disappear.
        for (const a of s.absent || []) {
            const evidence = (s.expect || []).map(String).concat(earlierFillValues, currentFillValues);
            if (a && evidence.some(e => e !== a && e.indexOf(a) !== -1)) {
                errors.push(at + " absent value " + JSON.stringify(a) + " is a substring of an expected or filled value, so the assertion cannot pass; use full unique old/new values (`'Old {{runId}}'` absent, `'New {{runId}}'` expect), neither a substring of the other");
            }
        }

        // Shared datasets make page-global empty-state copy unreliable evidence.
        if (!s.within) {
            const emptyState = (s.expect || []).concat(s.absent || []).find(v => /^no\s+\w+/i.test(v));
            if (emptyState) {
                warnings.push(at + " global empty-state assertion " + JSON.stringify(emptyState) + " is unsafe in a shared dataset; assert absence of the unique {{runId}} value instead");
            }
        }

        // 1. Global absent checks on common status words against multi-row lists.
        if (s.absent && !s.within) {
            for (const a of s.absent) {
                const word = findStatusWord(a);
                if (word) {
                    warnings.push(at + " absent check on status word \"" + word + "\" without a row `within` is brittle on multi-row lists; scope to the specific row or assert against a unique {{runId}} value");
                    break;
                }
            }
        }

        // 2. Clicks on duplicate visible labels without `within`.
        if (s.click && !s.within) {
            const label = s.click.trim();
            if (DUPLICATE_ACTION_LABELS.includes(label)) {
                errors.push(at + " click \"" + label + "\" appears in every row; scope it with a unique row selector such as " + canonicalWithin);
            }
        }

        // 3. Expecting a just-deleted unique value to be present.
        // Track whether a previous step deleted a row scoped by the unique runId value.
        // Re-adding the value (fill it or click Add/Create/Save) clears the stickiness.
        if (s.click && /^(?:delete|remove)$/i.test(s.click.trim())) {
            if (s.within && s.within.indexOf("{{runId}}") !== -1) runIdDeleted = true;
        }
        if (runIdDeleted) {
            const readded = (s.fill && Object.values(s.fill).some(v => String(v).indexOf("{{runId}}") !== -1)) ||
                (s.click && /^(?:add|create|new|save|submit)$/i.test(s.click.trim()));
            if (readded) runIdDeleted = false;
        }
        if (runIdDeleted && s.expect) {
            for (const e of s.expect) {
                if (e.indexOf("{{runId}}") !== -1) {
                    warnings.push(at + " expects a value containing {{runId}} after a delete step scoped by {{runId}}; the deleted unique value is unlikely to be present");
                    break;
                }
            }
        }

        // 4. nth= used for record actions instead of unique row scope.
        // Positional selectors are permitted beneath a unique row scope (e.g. a cell inside a row identified by {{runId}}).
        if (s.click && containsNth(s.click)) {
            errors.push(at + " uses an nth/positional selector for a record action; scope the action through a unique row selector instead");
        }
        if (s.within && containsNth(s.within) && !nthBeneathUniqueScope(s.within)) {
            errors.push(at + " uses an nth/positional selector for a record action; scope the action through a unique row selector instead");
        }

        // 5. Expecting typed input values as visible text.
        // If the step also clicks an action, the assertion runs after the click and the value may
        // be rendered; only warn for fill+expect with no click, where the value is still in markup.
        if (s.fill && s.expect && !s.click) {
            const filled = Object.values(s.fill).map(String).map(meaningful);
            for (const raw of s.expect) {
                const e = meaningful(raw);
                if (e && filled.some(v => v === e)) {
                    warnings.push(at + " expects a value that was just typed into an input; inputs only show it in markup until a save action renders it as visible text. Assert the value in visible rendered text after the click, using full unique old/new values (`'Old {{runId}}'` absent, `'New {{runId}}'` expect), neither a substring of the other.");
                    break;
                }
            }
        }
        earlierFillValues.push(...currentFillValues);
    });
    return { warnings, errors };
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
    if (step.page) bits.push("page=" + scrubCredentials(step.page));
    if (step.action) {
        let params = "";
        if (step.params) {
            const safe = redactStepValues([{ params: step.params }])[0].params;
            for (const key of Object.keys(safe)) safe[key] = scrubCredentials(safe[key]);
            params = "?" + new URLSearchParams(safe).toString();
        }
        bits.push("action=" + scrubCredentials(step.action) + params);
    }
    if (step.fill) bits.push("fill{" + Object.keys(step.fill).join(",") + "}");
    if (step.click) bits.push("click " + JSON.stringify(scrubCredentials(step.click)));
    if (step.within) bits.push("within " + JSON.stringify(scrubCredentials(step.within)));
    if (!bits.length) bits.push("assert-only");
    return bits.join(" ");
}

// Resolve a click deterministically. The old behavior silently clicked `.first()` whenever a
// list contained several identical row actions (Edit / Check out / Delete), which could prove the
// wrong record and produce a false PASS. Duplicate visible text is now an explicit test failure;
// callers scope it with `within`, normally a row selector containing a unique {{runId}} value.

// Best-effort helper: when the click text is ambiguous, find up to 2 unique text strings in the
// same row/card as each duplicate and suggest them as within selectors.
async function findWithinCandidates(scope, clickText) {
    try {
        // Playwright calling conventions differ: Page.evaluate(fn, arg) invokes fn(arg), while
        // Locator.evaluate(fn, arg) invokes fn(element, arg). Accept both by taking the payload as
        // the last argument and resolving the search root from the first only when it's an element.
        return await scope.evaluate((...args) => {
            const text = args[args.length - 1];
            const root = (args[0] && typeof args[0] === "object" && typeof args[0].querySelectorAll === "function")
                ? args[0]
                : document.body;
            const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
            const all = Array.from(root.querySelectorAll("*"));
            const matches = all.filter(el => el.children.length === 0 && norm(el.textContent) === text);
            if (matches.length < 2) return [];
            const rows = matches.map(el => {
                let row = el.closest("tr, li, [data-pb-row], .row, .card");
                return row || el.parentElement;
            });
            const rowTexts = rows.map(r => norm(r.textContent));
            const candidates = [];
            for (let i = 0; i < rows.length; i++) {
                const walker = document.createTreeWalker(rows[i], NodeFilter.SHOW_TEXT);
                const nodeTexts = [];
                let n;
                while ((n = walker.nextNode())) {
                    const t = norm(n.textContent);
                    if (t && t !== text && t.length >= 2 && t.length <= 80) nodeTexts.push(t);
                }
                for (const t of nodeTexts) {
                    const inOneRow = rowTexts.filter(rt => rt.indexOf(t) !== -1).length === 1;
                    if (inOneRow && !candidates.includes(t)) {
                        candidates.push(t);
                        if (candidates.length >= 2) return candidates;
                    }
                }
            }
            return candidates;
        }, clickText);
    } catch (e) {
        return [];
    }
}

async function resolveClickTarget(pg, step) {
    const c = step.click.trim();
    let scope = pg;
    const resolved = (step.within ? "locator(" + JSON.stringify(step.within) + ")." : "") +
        (/^[#.]/.test(c) ? "locator(" + JSON.stringify(c) + ")" : "getByText(" + JSON.stringify(c) + ", { exact: true })");
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
        return { error: "nothing to click matching \"" + c + "\"" + (step.within ? " within \"" + step.within + "\"" : "") + "; resolved Playwright locator: " + resolved };
    }
    if (count > 1) {
        const candidates = await findWithinCandidates(scope, c);
        const candidateHint = candidates.length
            ? " Nearby unique text suggests: " + candidates.map(t => "tr:has-text(" + JSON.stringify(t) + ")").join(", ") + "."
            : "";
        return { error: "click \"" + c + "\" is ambiguous (matched " + count + " elements); resolved Playwright locator: " + resolved + ". Add within with a precise row selector such as tr:has([data-label=\"Name\"]:has-text(\"Record {{runId}}\")), use the equivalent unique card selector, or click a unique #id/.class selector." + candidateHint };
    }
    return { locator: loc.first() };
}

function needsBrowser(steps) {
    return steps.some(s => s.fill || s.click);
}

function hasWaitFor(steps) {
    return steps.some(s => s.waitFor);
}

function isLoginRedirect(url) {
    try { return /(?:^|\/)login(?:\/|\b)|\bgetlogin\b/i.test(new URL(url).pathname); }
    catch (e) { return false; }
}

function pageIsLoginRedirect(page) {
    try { return !!page && isLoginRedirect(page.url()); }
    catch (e) { return false; }
}

function browserFailureMessage(error, page, isWeb, kind) {
    let landed = "";
    try { landed = page && page.url ? page.url() : ""; } catch (e) { /* unavailable */ }
    if (!isWeb && isLoginRedirect(landed)) {
        return "console session expired / not authenticated — re-auth and retry";
    }
    const msg = (error && error.message ? error.message.split("\n")[0] : String(error)).replace(/https?:\/\/\S+/g, "<url>");
    return (isWeb ? "Could not drive the web page" : "Could not drive the authenticated " + kind + " screen") + " (" + msg + ")";
}

async function screenFingerprint(pg, boundMs) {
    try {
        return await withBound(pg.evaluate(() => {
            const body = document.body;
            const html = document.documentElement ? document.documentElement.outerHTML : "";
            return {
                text: body ? body.innerText : "",
                htmlLength: html.length,
                htmlTail: html.slice(Math.max(0, html.length - 2000))
            };
        }), boundMs, { text: "", htmlLength: 0, htmlTail: "" });
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

async function screenHints(pg, boundMs) {
    try {
        const hints = await withBound(pg.evaluate(() => {
            const compact = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 80);
            const uniq = (xs) => Array.from(new Set(xs.filter(Boolean)));
            const clickNodes = Array.from(document.querySelectorAll("a,button,input[type='button'],input[type='submit'],[role='button'],[onclick]"));
            const clicks = uniq(clickNodes.map(el =>
                compact(el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || el.getAttribute("title")))).slice(0, 20);
            const ids = uniq(Array.from(document.querySelectorAll("[id]")).map(el => "#" + compact(el.id))).slice(0, 20);
            const fields = uniq(Array.from(document.querySelectorAll("input[name],textarea[name],select[name]")).map(el => compact(el.getAttribute("name")))).slice(0, 20);
            const headings = uniq(Array.from(document.querySelectorAll("h1,h2,[role='heading']")).map(el => compact(el.innerText || el.textContent))).slice(0, 10);
            return { clicks, ids, fields, headings };
        }), boundMs, null);
        return hints || { clicks: [], ids: [], fields: [], headings: [] };
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

// Compact run-level failure evidence for the report: bounded event counts, the accessibility
// snapshot scope/size, the failure-screenshot size, and the persisted artifact directory. Event
// URLs/messages and snapshot contents stay in the artifacts — the report line stays compact and
// credential-free.
function failureEvidenceLines(res) {
    const ev = res.evidence;
    if (!ev) return [];
    const lines = [];
    const bits = [];
    const byType = {};
    for (const e of ev.events || []) byType[e.type] = (byType[e.type] || 0) + 1;
    const typeBits = Object.keys(byType).sort().map(t => t + " ×" + byType[t]);
    if (typeBits.length) bits.push("browser events: " + typeBits.join(", "));
    if (ev.aria != null) {
        bits.push("accessibility snapshot" + (ev.ariaScope ? " (" + ev.ariaScope + ")" : "") + " " +
            ev.aria.length + " chars" + (ev.ariaTruncated ? ", truncated" : ""));
    } else if (ev.hints) {
        bits.push("accessibility snapshot unavailable — screen hints captured");
    }
    const jpegBytes = ev.jpegBytes != null ? ev.jpegBytes : (ev.jpegBase64 ? Math.round((ev.jpegBase64.length * 3) / 4) : 0);
    if (jpegBytes > 0) bits.push("failure screenshot " + Math.max(1, Math.round(jpegBytes / 1024)) + "KB");
    else if (ev.jpegUnavailable) bits.push("failure screenshot: captured but not persisted");
    if (bits.length) lines.push("  evidence: " + bits.join("; "));
    if (res.artifacts) {
        if (res.artifacts.dir) {
            const FILE_NAMES = { steps: "steps.json", events: "browser-events.json", aria: "aria-snapshot.txt",
                hints: "screen-hints.json", jpeg: "failure.jpg", metadata: "metadata.json", notes: "notes.md" };
            const names = Object.keys(FILE_NAMES).filter(k => res.artifacts[k]).map(k => FILE_NAMES[k]);
            lines.push("  artifacts: " + res.artifacts.dir + (names.length ? " (" + names.join(", ") + ")" : " (none persisted)"));
            if (names.length) lines.push("  inspect the artifacts instead of probing selectors by trial and error — blocked/failed is not PASS");
        }
        if (res.artifacts.incomplete && res.artifacts.incomplete.length) {
            lines.push("  warning: " + res.artifacts.incomplete.length + " artifact write(s) failed: " + res.artifacts.incomplete.join(", "));
        }
    }
    return lines;
}

// ---- the runner ------------------------------------------------------------------------------

// Exercise the pal. Returns a structured result; never throws on a normal failure.
//   steps: [{ page?, action?, params?, fill?, click?, within?, expect?, absent? }]
//   workflow: "console" | "web" | "transaction" (optional — auto-detected)
//   viewport: "desktop" | "mobile" (browser mode only)
// Stops at the first failing step (later steps usually depend on earlier writes).
async function runExercise(session, guid, { steps, workflow, viewport, workspaceDir, initial, browser } = {}, deps = {}) {
    const runId = makeRunId(steps, takeExerciseOrdinal(workspaceDir));
    const problems = validateSteps(steps).concat(validateInitial(initial));
    const lint = lintSteps(steps);
    const allProblems = problems.concat(lint.errors);
    if (allProblems.length) return { ran: false, invalid: true, status: "invalid", category: "steps", problems: allProblems, runId, warnings: lint.warnings };

    steps = applyRunId(steps, runId);
    // The initial target is normalized ONCE, here, into the same canonical form pal_screenshot
    // uses — so the two tools can never interpret the same console action differently.
    let start = null;
    if (initial) {
        const withRunId = applyRunId([initial], runId)[0];
        const norm = normalizeTarget({ action: withRunId.action, params: withRunId.params });
        if (norm.blocked) {
            return { ran: false, invalid: true, status: "invalid", category: "steps", runId,
                     problems: ["initial: " + norm.reason], warnings: lint.warnings };
        }
        start = { target: norm.target, page: withRunId.page || null, expect: withRunId.expect || [] };
    }

    const browserFn = deps.exerciseByBrowser || exerciseByBrowser;
    const res = await attemptWithFreshTest(session, guid, { kind: workflow }, async (t) => {
        if (!t.ran) {
            return { ran: false, blocked: t.blocked, holder: t.holder,
                     status: "blocked", category: "environment", retryable: false,
                     potentialMutationStarted: false,
                     reason: t.blocked === "no-testable-workflow"
                         ? "This pal has no runnable workflow to exercise."
                         : "Could not start a test instance (" + (t.blocked || "unknown") + ").",
                     remediation: "Resolve the test environment, then run a new exercise." };
        }
        if (!t.validated) {
            return { ran: false, kind: t.kind, validation: t.validation,
                     status: "blocked", category: "environment", retryable: false,
                     potentialMutationStarted: false,
                     reason: "The pal did not validate on the server, so it can't be exercised. Fix the validation notes, push, and exercise again." };
        }

        const isWeb = t.kind === "web";
        // A console/transaction action is dispatched by clicking its rendered c:a link, or — for
        // the FIRST screen only — through the initial target. A step-level action/page has no
        // supported mechanism here, so it is rejected. It must never be accepted and ignored.
        const offending = steps.findIndex(s => s.action || s.page);
        if (!isWeb && offending !== -1) {
            return { ran: false, kind: t.kind, invalid: true, status: "invalid", category: "steps",
                     problems: ["step " + (offending + 1) + " carries action/page, but a " + t.kind +
                         " pal dispatches actions by clicking the rendered c:a link. Put the FIRST screen's action in `initial` ({ action, params, expect }); reach later screens with click (the action link/button text)."] };
        }
        if (!isWeb && start && start.page) {
            return { ran: false, kind: t.kind, invalid: true, status: "invalid", category: "steps",
                     problems: ["initial.page is a WEB route selector; a " + t.kind + " pal selects its first screen with initial.action."] };
        }

        const useFetch = isWeb && !browser && !needsBrowser(steps) && !hasWaitFor(steps);
        const res = useFetch ? await exerciseByFetch(t, steps, start) : await browserFn(t, steps, viewport, deps, start);
        // The retry rule lives here, once: only a blocked auth/navigation failure that provably
        // preceded any mutation may be replayed against a fresh test instance.
        if (res && res.retryable === undefined) {
            res.retryable = res.status === "blocked" && res.potentialMutationStarted !== true &&
                (res.category === "auth" || res.category === "navigation");
        }
        return res;
    }, deps);

    if (res && typeof res === "object") {
        delete res.retryable;
        res.runId = runId;
        res.warnings = lint.warnings;
    }
    return res;
}

// Validate the optional initial-target request. Shape only — target normalization happens once in
// runExercise via the shared normalizeTarget.
function validateInitial(initial) {
    if (initial === undefined || initial === null) return [];
    if (typeof initial !== "object" || Array.isArray(initial)) return ["initial must be an object with action/params/page/expect"];
    const errs = [];
    const known = new Set(["action", "params", "page", "expect"]);
    for (const k of Object.keys(initial)) if (!known.has(k)) errs.push("initial has unknown key " + JSON.stringify(k));
    if (initial.action !== undefined && (typeof initial.action !== "string" || !initial.action.trim())) errs.push("initial.action must be a non-empty action string");
    if (initial.page !== undefined && (typeof initial.page !== "string" || !initial.page.trim())) errs.push("initial.page must be a non-empty WEB route");
    if (initial.params !== undefined && (typeof initial.params !== "object" || Array.isArray(initial.params) ||
        Object.values(initial.params).some(v => typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean"))) {
        errs.push("initial.params must be an object of name → string/number/boolean value");
    }
    if (initial.expect !== undefined && (!Array.isArray(initial.expect) || initial.expect.some(x => typeof x !== "string" || !x))) {
        errs.push("initial.expect must be an array of non-empty strings visible on the intended first screen");
    }
    // A targeted initial (action/page) must declare what proves it landed: without an expect the
    // exercise would dispatch the targeting navigation and run steps against an UNVERIFIED screen.
    // An expect-only initial stays valid — it verifies the pal's default screen, which needs no
    // targeting navigation to reach. Caught here, in request validation, before any Test/browser
    // work starts.
    if ((initial.action || initial.page) && !(Array.isArray(initial.expect) && initial.expect.some(x => typeof x === "string" && x.trim()))) {
        errs.push("initial.action/page targets a specific screen, so initial.expect must list at least one non-empty visible string proving that screen — a targeted exercise must verify its initial state before any step runs");
    }
    if (!initial.action && !initial.page && !(initial.expect && initial.expect.length)) {
        errs.push("initial does nothing — give it an action, a page, or an expect");
    }
    return errs;
}

// The WEB query form for an initial target: the documented plain-link mechanism (?action=X&param=Y).
function webInitialPath(start) {
    if (!start) return null;
    let path = start.page || "";
    if (start.target) {
        const qs = new URLSearchParams(Object.assign({ action: start.target.action }, start.target.params));
        path += (path.indexOf("?") === -1 ? "?" : "&") + qs.toString();
    }
    return path;
}

// A structured "you asked for X, the browser showed Y" result. Never PASS, never accepted evidence.
// potentialMutationStarted tells the caller whether a mutation-capable dispatch (a console
// cp-ws-doaction navigation or a WEB ?action= navigation) was already issued before the wrong
// screen rendered — the retry/remediation wording depends on it.
function initialStateFailure(t, start, state, potentialMutationStarted) {
    return {
        ran: true, kind: t.kind, mode: "browser", pass: false,
        status: "failed", category: "targeting", code: "initial-state-not-reached",
        retryable: false, potentialMutationStarted: potentialMutationStarted === true,
        requestedState: {
            workflow: t.kind,
            action: start.target ? start.target.action : null,
            paramKeys: start.target ? start.target.paramKeys : [],
            page: start.page || null,
            expect: start.expect || []
        },
        stateVerified: false,
        observedState: {
            headings: ((state.observed && state.observed.headings) || []).slice(0, 8),
            title: (state.observed && state.observed.title) || null,
            expect: (state.expect || []).map(r => ({ string: r.string, found: r.found }))
        },
        steps: [],
        reason: "The initial state was never reached, so no step was run.\n  " +
            describeTargetMismatch({ kind: t.kind, action: start.target ? start.target.action : null,
                                     paramKeys: start.target ? start.target.paramKeys : [] }, state),
        remediation: "Fix the initial action/params (or the pal), then exercise again." +
            (potentialMutationStarted === true
                ? " The initial action may already have executed — inspect current state before retrying."
                : " No step ran and no mutation-capable action was dispatched.")
    };
}

// WEB fast path: plain fetches against the activated test session, no browser.
async function exerciseByFetch(t, steps, start = null) {
    const { openInstanceSessionFromTest } = require("./preview");
    const inst = await openInstanceSessionFromTest(t);
    if (!inst.opened) return { ran: false, kind: "web", status: "blocked", category: "environment", retryable: true, potentialMutationStarted: false, reason: inst.reason };
    // Establish and verify the requested initial state BEFORE any step runs.
    if (start) {
        let landing;
        try { landing = await inst.fetchPath(webInitialPath(start)); }
        catch (e) {
            return { ran: false, kind: "web", status: "blocked", category: "navigation", retryable: !start.target, potentialMutationStarted: !!start.target,
                     reason: "Could not reach the initial state (" + (e && e.message ? e.message : String(e)) + ")." };
        }
        const chk = checkExpect(landing.html, start.expect || []);
        if ((start.expect || []).length && !chk.pass) {
            // The initial fetch landed, so if it carried an action (?action=...) that action may
            // already have executed — never claim pre-action safety here.
            return initialStateFailure(t, start, {
                expect: chk.results.map(r => ({ string: r.string, found: r.found })),
                observed: { headings: [], title: landing.title || null }
            }, start.target);
        }
    }
    const results = [];
    let lastHtml = "";
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
            return { ran: true, kind: "web", mode: "fetch", pass: false, status: "failed", category: "behavior", failedStep: i + 1, steps: results };
        }
        lastHtml = r.html || "";
        const renderError = detectRenderError(r.html);
        const chk = checkStep(r.html, step);
        const pass = chk.pass && !renderError && r.status < 400;
        results.push({ step: i + 1, label: stepLabel(step), status: r.status, pass,
                       expect: chk.expect, absent: chk.absent, renderError });
        if (!pass) return { ran: true, kind: "web", mode: "fetch", pass: false, status: "failed", category: "behavior", failedStep: i + 1, steps: results };
    }
    return { ran: true, kind: "web", mode: "fetch", pass: true, status: "passed", category: "behavior", steps: results, finalSnapshot: makeFinalSnapshot(lastHtml, "server-markup") };
}

// Browser path: drive the real screen (console/transaction always; web when steps fill/click).
// The authenticated bootstrap, the initial target dispatch and its state verification are shared
// with pal_screenshot; only the step loop below is exercise-specific. No step runs until the
// browser has positively reached the requested initial state.
async function exerciseByBrowser(t, steps, viewport, deps = {}, start = null) {
    const isWeb = t.kind === "web";
    const results = [];
    const evidenceTimeout = deps.evidenceTimeout || EVIDENCE_TIMEOUT_MS;
    let events = [];
    const acceptedDialogs = [];
    let finalVisibleText = "";
    let potentialMutationStarted = false;

    const open = await openAuthenticatedScreen(t, {
        viewport,
        target: isWeb ? null : (start && start.target),
        expect: start ? start.expect : [],
        navOpts: EXERCISE_NAV_OPTS,
        contextTimeouts: { action: ACTION_TIMEOUT_MS, navigation: NAV_TIMEOUT_MS },
        stateTimeout: evidenceTimeout,
        onPage: (pg) => {
            // Listeners attach BEFORE any navigation so console/page errors, failed requests and
            // HTTP >= 400 responses during the auth redirect are captured too.
            events = attachBrowserEvidence(pg);
            pg.on("dialog", async (dialog) => {
                acceptedDialogs.push(dialog.type() + (dialog.message() ? ": " + dialog.message() : ""));
                try { await dialog.accept(); } catch (e) { /* dialog may already be gone */ }
            });
        },
        // WEB reaches its initial screen by route, after the token URL activates the session.
        afterLanding: (isWeb && start && (start.page || start.target))
            ? async (pg) => {
                await (deps.waitForRenderablePage || waitForRenderablePage)(
                    pg, deriveWebBase(pg.url()) + String(webInitialPath(start)).replace(/^\/+/, ""), EXERCISE_NAV_OPTS);
            }
            : null,
        // The WEB initial action rides the afterLanding navigation (?action=...), so its failure must
        // never be replayed; a page-only initial navigation is pre-mutation and stays retryable.
        afterLandingMutates: !!(isWeb && start && start.target)
    }, deps);

    const pg = open.pg;
    potentialMutationStarted = open.potentialMutationStarted === true;
    try {
        if (!open.ok) {
            if (open.category === "targeting") {
                // open.potentialMutationStarted already reflects whether the initial action navigation
                // (console cp-ws-doaction or WEB afterLanding ?action=) was issued before the wrong
                // screen rendered.
                return attachEvidence(initialStateFailure(t, start, open.state, open.potentialMutationStarted), pg, null, events, evidenceTimeout);
            }
            const failed = {
                ran: false, kind: t.kind, status: "blocked", category: open.category,
                retryable: open.retryable === true, potentialMutationStarted, steps: results,
                reason: open.reason,
                remediation: open.category === "auth"
                    ? "Refresh authentication before trying again."
                    : "Refresh navigation/authentication before trying again."
            };
            if (open.available === false) failed.available = false;
            return pg ? attachEvidence(failed, pg, null, events, evidenceTimeout) : failed;
        }
        // Web base for step-level page/action navigation.
        const base = isWeb ? deriveWebBase(pg.url()) : null;
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const fail = async (why) => {
                results.push({ step: i + 1, label: stepLabel(step), pass: false, error: why, url: sanitizeUrl(pg.url()) });
                return attachEvidence({
                    ran: true, kind: t.kind, mode: "browser", pass: false, status: "failed",
                    category: "behavior", potentialMutationStarted, failedStep: i + 1, steps: results
                }, pg, step, events, evidenceTimeout);
            };
            try {
                if (isWeb && (step.page || step.action)) {
                    let path = step.page || "";
                    if (step.action) {
                        potentialMutationStarted = true;
                        const qs = new URLSearchParams(Object.assign({ action: step.action }, step.params || {}));
                        path += (path.indexOf("?") === -1 ? "?" : "&") + qs.toString();
                    }
                    await (deps.waitForRenderablePage || waitForRenderablePage)(pg, base + String(path).replace(/^\/+/, ""), EXERCISE_NAV_OPTS);
                }
                if (step.fill) {
                    for (const [name, value] of Object.entries(step.fill)) {
                        const sel = "[name=" + JSON.stringify(String(name)) + "]";
                        if (await pg.locator(sel).count() === 0) {
                            const hints = await screenHints(pg, evidenceTimeout);
                            const hasCreateNav = (hints.clicks || []).some(label => /^(?:add|create|new)\b/i.test(label));
                            return fail("no input named \"" + name + "\" on the current screen — " +
                                (hasCreateNav ? "the console opened on its list view; add a first step that clicks the visible Add/Create action before filling the form." : "check the fragment's name= attributes.") +
                                formatScreenHints(hints));
                        }
                        try { await pg.fill(sel, String(value), { timeout: ACTION_TIMEOUT_MS }); }
                        catch (e) { await pg.selectOption(sel, String(value), { timeout: ACTION_TIMEOUT_MS }); } // <select> fallback
                    }
                }
                if (step.click) {
                    const target = await resolveClickTarget(pg, step);
                    if (target.error) return fail(target.error + "." + formatScreenHints(await screenHints(pg, evidenceTimeout)));
                    const before = await screenFingerprint(pg, evidenceTimeout);
                    potentialMutationStarted = true;
                    await target.locator.click({ timeout: ACTION_TIMEOUT_MS });
                    await waitForScreenSettle(pg, before);
                }
            } catch (e) {
                if (step.page || step.action || step.click) {
                    const category = !isWeb && pageIsLoginRedirect(pg) ? "auth" : "navigation";
                    return attachEvidence({
                        ran: potentialMutationStarted, kind: t.kind, mode: "browser", pass: false,
                        status: "blocked", category, potentialMutationStarted,
                        retryable: !potentialMutationStarted,
                        reason: browserFailureMessage(e, pg, isWeb, t.kind), steps: results,
                        remediation: potentialMutationStarted
                            ? "Data may already have changed. Inspect current state before deciding whether to run anything again."
                            : "Refresh navigation/authentication before trying again."
                    }, pg, step, events, evidenceTimeout);
                }
                return fail(browserFailureMessage(e, pg, isWeb, t.kind));
            }
            // Optional bounded wait: observe current visible state repeatedly without replaying
            // the mutation. Each poll only re-reads body text and markup; never navigates, clicks,
            // or invokes a workflow again.
            const waitCfg = step.waitFor;
            if (waitCfg) {
                const timeoutMs = waitCfg.timeoutMs != null ? waitCfg.timeoutMs : WAIT_DEFAULT_TIMEOUT_MS;
                const intervalMs = waitCfg.intervalMs != null ? waitCfg.intervalMs : WAIT_DEFAULT_INTERVAL_MS;
                const wait = deps.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
                const now = deps.now || Date.now;
                const deadline = now() + timeoutMs;
                let lastText = "", lastHtml = "", lastChk = null, lastRenderError = null;
                while (true) {
                    try { lastText = await pg.innerText("body"); } catch (e) { lastText = ""; }
                    try { lastHtml = await pg.content(); } catch (e) { lastHtml = ""; }
                    lastRenderError = detectRenderError(lastText) || detectRenderError(lastHtml);
                    if (lastRenderError) {
                        lastChk = checkBrowserStep(lastText, lastHtml, step);
                        const dialogs = acceptedDialogs.splice(0);
                        const hints = await screenHints(pg, evidenceTimeout);
                        results.push({ step: i + 1, label: stepLabel(step), pass: false,
                            expect: lastChk.expect, absent: lastChk.absent, renderError: lastRenderError, dialogs, hints, url: sanitizeUrl(pg.url()) });
                        return attachEvidence({
                            ran: true, kind: t.kind, mode: "browser", pass: false, status: "failed",
                            category: "behavior", potentialMutationStarted, failedStep: i + 1, steps: results
                        }, pg, step, events, evidenceTimeout);
                    }
                    lastChk = checkBrowserStep(lastText, lastHtml, step);
                    if (lastChk.pass) {
                        finalVisibleText = lastText;
                        const dialogs = acceptedDialogs.splice(0);
                        results.push({ step: i + 1, label: stepLabel(step), pass: true,
                            expect: lastChk.expect, absent: lastChk.absent, renderError: null, dialogs, hints: null, url: sanitizeUrl(pg.url()) });
                        break;
                    }
                    if (now() >= deadline) {
                        const dialogs = acceptedDialogs.splice(0);
                        const hints = await screenHints(pg, evidenceTimeout);
                        results.push({ step: i + 1, label: stepLabel(step), pass: false,
                            expect: lastChk.expect, absent: lastChk.absent, renderError: null, dialogs, hints, url: sanitizeUrl(pg.url()) });
                        return attachEvidence({
                            ran: true, kind: t.kind, mode: "browser", pass: false, status: "failed",
                            category: "behavior", potentialMutationStarted, failedStep: i + 1, steps: results
                        }, pg, step, events, evidenceTimeout);
                    }
                    await wait(Math.min(intervalMs, Math.max(0, deadline - now())));
                }
                continue;
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
            const hints = pass ? null : await screenHints(pg, evidenceTimeout);
            if (pass) finalVisibleText = text;
            results.push({ step: i + 1, label: stepLabel(step), pass,
                           expect: chk.expect, absent: chk.absent, renderError, dialogs, hints, url: sanitizeUrl(pg.url()) });
            if (!pass) return attachEvidence({
                ran: true, kind: t.kind, mode: "browser", pass: false, status: "failed",
                category: "behavior", potentialMutationStarted, failedStep: i + 1, steps: results
            }, pg, step, events, evidenceTimeout);
        }
        return { ran: true, kind: t.kind, mode: "browser", pass: true, status: "passed", category: "behavior", potentialMutationStarted, steps: results, finalSnapshot: makeFinalSnapshot(finalVisibleText, "visible") };
    } catch (e) {
        const category = !isWeb && pageIsLoginRedirect(pg) ? "auth" : "navigation";
        return attachEvidence({
            ran: false, kind: t.kind, status: "blocked", category, potentialMutationStarted,
            retryable: !potentialMutationStarted,
            reason: browserFailureMessage(e, pg, isWeb, t.kind),
            remediation: "Refresh navigation/authentication before trying again.", steps: results
        }, pg, null, events, evidenceTimeout);
    } finally {
        try { if (open.bctx) await open.bctx.close(); }
        finally { if (open.browser) (deps.releaseBrowser || releaseBrowser)(); }
    }
}

// Human/agent-readable report. Never includes raw HTML or credential URLs.
function formatExercise(res) {
    if (res.status === "invalid" || res.invalid) return "pal_exercise — INVALID STEPS — fix the request:\n  - " + res.problems.join("\n  - ") +
        (res.warnings && res.warnings.length ? "\n  warnings:\n  - " + res.warnings.join("\n  - ") : "");
    if (res.status === "blocked" || (!res.ran && !res.invalid)) {
        const lines = ["pal_exercise — BLOCKED — Pal result unknown; do not mark done",
            "  category: " + (res.category || "environment"),
            "  retry attempted: " + (res.retryAttempted ? "yes" : "no"),
            "  potential mutation started: " + (res.potentialMutationStarted ? "yes" : "no"),
            "  reason: " + (res.reason || res.blocked || "unknown")];
        if (res.remediation) lines.push("  next: " + res.remediation);
        // A block mid-flow must not lose what already completed: steps that passed before the
        // stuck navigation ride on the blocked result as evidence.
        if (res.steps && res.steps.length) {
            lines.push("  completed steps before the block (" + res.steps.length + "):");
            for (const s of res.steps) {
                lines.push("    " + (s.pass ? "✓" : "✗") + " step " + s.step + " [" + s.label + "]");
            }
        }
        lines.push(...failureEvidenceLines(res));
        return lines.join("\n");
    }
    if (res.category === "targeting") {
        // Not a behavior result: no step ran, so nothing about the pal's behavior was proven. The
        // mutation line must never claim "nothing was mutated" when the initial action navigation
        // was already issued — the agent has to inspect current state before retrying.
        const mutationLine = res.potentialMutationStarted
            ? "NO exercise step ran. The initial action may already have executed; inspect current state before retrying."
            : "NO exercise step ran; no mutation-capable action was dispatched.";
        const lines = ["pal_exercise — TARGETING FAIL — the initial state was never reached; " + mutationLine,
            "  code: " + (res.code || "initial-state-not-reached"),
            "  " + res.reason];
        if (res.remediation) lines.push("  next: " + res.remediation);
        lines.push(...failureEvidenceLines(res));
        return lines.join("\n");
    }
    const lines = ["pal_exercise (" + res.kind + ", " + res.mode + " mode) — " + (res.pass ? "PASS" : "BEHAVIOR FAIL — fix the Pal or targeting as directed (step " + res.failedStep + ")")];
    if (res.runId) lines.push("  runId: " + res.runId + " ({{runId}} placeholders in steps were replaced with this value)");
    if (res.warnings && res.warnings.length) lines.push("  warnings:\n  - " + res.warnings.join("\n  - "));
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
    if (!res.pass && res.ran) lines.push("  Later steps were not run. Do not probe labels/selectors by trial and error: read the local page/fragment markup and derive the exact name=, click text, and unique within selector. If only the exercise targeting was wrong, revise the steps and call again without pushing; edit and push first only when the pal behavior was wrong.");
    if (res.finalSnapshot) {
        const snap = res.finalSnapshot;
        const label = snap.source === "server-markup" ? "server markup" : "visible text";
        const firstLine = String(snap.text).split("\n")[0].slice(0, 120);
        lines.push("  final snapshot (" + snap.source + " — " + label + ", " + snap.text.length + " chars" + (snap.truncated ? ", truncated" : "") + "): " + JSON.stringify(firstLine) + (snap.text.indexOf("\n") !== -1 ? " …" : ""));
        lines.push("  final text (bounded, " + snap.text.length + " chars):\n" + snap.text);
    }
    lines.push(...failureEvidenceLines(res));
    return lines.join("\n");
}

module.exports = { runExercise, exerciseByFetch, exerciseByBrowser, validateSteps, validateInitial, webInitialPath, lintSteps, checkStep, checkBrowserStep, stepLabel, needsBrowser, hasWaitFor, formatExercise, applyRunId, makeRunId, readExerciseOrdinal, takeExerciseOrdinal, resolveClickTarget, browserFailureMessage, redactStepValues, redactSecretForms, redactSecretFormsForSuccess, makeFinalSnapshot, BROWSER_EVENTS_CAP, EVIDENCE_TIMEOUT_MS, MAX_STEPS, WAIT_DEFAULT_TIMEOUT_MS, WAIT_MAX_TIMEOUT_MS, WAIT_DEFAULT_INTERVAL_MS, WAIT_MIN_INTERVAL_MS, FINAL_TEXT_CAP, FINAL_TEXT_TRUNCATE_MARK };
