"use strict";
// pal_test core: run the builder's "Test pal" against a workflow and report FRESH validation
// (the workflow-compile feedback the save API never gives), plus build a runnable preview URL.
//
// Confirmed live (scripts/test-workflow-probe*.js against ISR): Test<Console|Web|System|Pal>.do
// returns { success, validated, token, validationResults, profileList }. The `token` is a
// CreateTest<Type>.do URL; for console/console-system/transaction the runnable form appends
// &cp-auth=base64(user:pass) &nxProfileId=<profile> &cp-workflow=<name-no-ext>. A CONSOLE pal's
// token URL is meant to be opened with a plain GET in a real browser (it navigates into the
// platform console chrome) — it is not an AJAX/XHR endpoint; a WEB pal renders directly.
//
// SECURITY: the runnable URL embeds the password (base64). It is NEVER returned to the caller or
// logged — buildPreviewUrl() is consumed only by an in-process browser-open. The agent gets the
// validation results and a "preview opened in your browser" signal, never the credential URL.
const { CloudPistonAPIManager } = require("../../lib/apiManager");
const { normalizeValidation } = require("./push");
const lock = require("./lock");

// workflowType number → the engine name the Test endpoint + EL use. From the extension's
// types/fileProperties.js (workflowTypes). Four real endpoints: TestConsole.do (7),
// TestWeb.do (9), TestSystem.do (11, console-system/job workflows — NOT the same endpoint as
// console!), TestPal.do (2/3/5 — "Pal" is the legacy name for the Transaction engine).
// Library/user aren't runnable test targets at all. Tunnel (15) has no Test*.do compile
// endpoint either — it's exercised via a completely different path (core/tunnel.js's
// CreateTunnel.do mints real short-lived credentials and calls the workflow for real over
// HTTP), so it's intentionally absent from this table too.
const TYPE_NUM = {
    2: { kind: "transaction", endpoint: "Pal" },
    3: { kind: "transaction", endpoint: "Pal" },
    5: { kind: "transaction", endpoint: "Pal" },
    7: { kind: "console", endpoint: "Console" },
    9: { kind: "web", endpoint: "Web" },
    11: { kind: "console-system", endpoint: "System" },
    12: { kind: "console", endpoint: "Console" }
};
// caller-facing kind → Test endpoint name.
const KIND_ENDPOINT = { console: "Console", web: "Web", transaction: "Pal", "console-system": "System" };

// Server-level messages (resp.messages) are SEPARATE from per-rule validationResults: they carry
// whole-test failures like "Pal is not a Web Pal". The CLI used to ignore them and print "No
// validation notes", hiding the real cause — so always surface them. Returns [{ message, type }].
function normalizeMessages(resp) {
    const m = resp && resp.messages;
    if (!m || m === "") return [];
    const list = m["com.contractpal.Message"];
    if (!list) return [];
    return (Array.isArray(list) ? list : [list]).map(x => ({ message: x && x.message, type: x && x.type }));
}

// Which workflow engines does this pal actually have? Returns [{ kind, endpoint, files: [...] }].
function availableWorkflows(serverPal) {
    const entries = (serverPal && serverPal.workflows && serverPal.workflows.entry) || [];
    const byKind = {};
    for (const e of entries) {
        const t = e.Workflow && e.Workflow.workflowType;
        const map = TYPE_NUM[t];
        if (!map) continue;
        (byKind[map.kind] = byKind[map.kind] || { kind: map.kind, endpoint: map.endpoint, files: [] })
            .files.push(e.string);
    }
    return Object.values(byKind);
}

// Vendored query-key evidence:
//   cp-auth: PalbuilderTaskConnector.addAuth (com/nxlight/palbuilder/webstart/services/PalbuilderTaskConnector.java:152) and AppConstants.CPAUTH (com/nxlight/framework/AppConstants.java:137)
//   nxProfileId: TestConsoleAction.java:86 / TestTransactionAction.java:103
//   cp-workflow: AppConstants.cpWorkflow (AppConstants.java:28), TestConsoleAction.java:102, TestTransactionAction.java:109, TestWebAction.java:84
//   cp-ws-doaction: TestConsoleAction.java:108, TestTransactionAction.java:94
const RESERVED_QUERY_KEYS = new Set(["cp-auth", "nxProfileId", "cp-workflow", "cp-ws-doaction"]);

// Normalize workflow names consistently, stripping a file extension if present.
// Matches runTest's prior behaviour String(file).replace(/\.[^.]+$/, "").
function normalizeWorkflowName(name) {
    const s = String(name == null ? "" : name).trim();
    // strip last ".ext" only when an extension exists; bare names pass through unchanged
    return s.replace(/\.[^.]+$/, "");
}

// Append a single query parameter using URL + URLSearchParams (no manual concatenation).
function appendQueryParam(urlString, key, value) {
    // Token URLs from Test*.do are absolute (verified live against ISR / webpals hosts).
    // New URL() is the required URL-parsing path — no manual "?" / "&" concatenation.
    const u = new URL(urlString);
    u.searchParams.append(key, String(value));
    return u.toString();
}

// Build the runnable preview URL. CREDENTIAL-BEARING — never return/log this; hand straight to
// the browser opener. profileId/workflowName only matter for console/transaction.
// Uses URL and URLSearchParams for all selection fields (no manual string concatenation).
function buildPreviewUrl(session, token, kind, profileId, workflowName) {
    if (kind === "web") return token;
    let url = token;
    if (session.sessionAuthToken) {
        const auth = session.sessionAuthToken;
        const tokenPart = auth.indexOf(":") >= 0 ? auth.substring(auth.indexOf(":") + 1) : auth;
        url = appendQueryParam(url, "cp-auth", tokenPart);
    }
    if (profileId) url = appendQueryParam(url, "nxProfileId", profileId);
    if (workflowName) url = appendQueryParam(url, "cp-workflow", normalizeWorkflowName(workflowName));
    return url;
}

// Resolve + lock + Test. Returns a structured result; NEVER includes the credential URL.
//   kind: "console" | "web" | "transaction" (optional — auto-detected from the pal's workflows)
//   workflowName: which workflow to run for console/transaction (optional; defaults to the
//                 first of that kind, sans extension)
// Returns { ran, kind, success, validated, validation, profiles, _previewUrl, blocked }.
// _previewUrl is underscored to signal "internal, do not surface" — the tool layer opens it and
// drops it from the response.
async function runTest(session, guid, { kind, workflowName } = {}) {
    const lk = await lock.acquireByGuid(session, guid, { force: false });
    if (!lk.acquired) {
        return { ran: false, blocked: lk.blocked || "no-lock", holder: lk.holder, since: lk.since };
    }
    const palId = lk.resolved.id;

    const gp = await CloudPistonAPIManager.getPal(session, palId);
    const serverPal = gp && gp.pal;
    const avail = availableWorkflows(serverPal);
    if (!avail.length) {
        return { ran: false, blocked: "no-testable-workflow", available: [] };
    }
    // Explicit selection takes precedence over auto-detection. Validate BEFORE starting a Test
    // endpoint that the type exists and the workflow name belongs to it — list valid choices and
    // make no Test call on failure.
    let chosen = null;
    const hasWorkflowName = workflowName != null && String(workflowName).trim() !== "";
    const normalizedRequested = hasWorkflowName ? normalizeWorkflowName(workflowName) : null;
    if (kind) {
        if (!KIND_ENDPOINT[kind]) {
            return { ran: false, blocked: "unknown-workflow-type", kind, availableKinds: avail.map(a => a.kind) };
        }
        chosen = avail.find(a => a.kind === kind);
        if (!chosen) {
            return { ran: false, blocked: "unknown-workflow-type", kind, availableKinds: avail.map(a => a.kind) };
        }
        if (hasWorkflowName) {
            const availableNames = chosen.files.map(f => normalizeWorkflowName(f));
            if (!availableNames.includes(normalizedRequested)) {
                return { ran: false, blocked: "unknown-workflow-name", kind: chosen.kind, workflowName: normalizedRequested, availableWorkflowNames: availableNames, availableKinds: avail.map(a => a.kind) };
            }
        }
    } else if (hasWorkflowName) {
        const owner = avail.find(a => a.files.map(f => normalizeWorkflowName(f)).includes(normalizedRequested));
        if (!owner) {
            const allNames = avail.flatMap(a => a.files.map(f => normalizeWorkflowName(f)));
            return { ran: false, blocked: "unknown-workflow-name", workflowName: normalizedRequested, availableWorkflowNames: allNames, availableKinds: avail.map(a => a.kind) };
        }
        chosen = owner;
    } else {
        chosen = avail.find(a => a.kind === "web") || avail[0];
    }
    if (!chosen || !chosen.endpoint) return { ran: false, blocked: "unknown-workflow-type", kind, availableKinds: avail.map(a => a.kind) };

    const resp = await CloudPistonAPIManager.testWorkflow(session, palId, chosen.endpoint);
    const validation = normalizeValidation(resp);
    const messages = normalizeMessages(resp);
    const success = !!(resp && resp.success);
    const validated = !!(resp && resp.validated);
    const profiles = (resp && resp.profileList && resp.profileList["com.contractpal.pal.ProfileInfo"]) || [];

    let previewUrl = null;
    if (validated && resp.token) {
        const wfName = chosen.kind === "web" ? null
            : (hasWorkflowName ? normalizedRequested : (chosen.files[0] ? normalizeWorkflowName(chosen.files[0]) : "main"));
        const profileId = chosen.kind === "web" ? null : (profiles[0] && profiles[0].profileId);
        previewUrl = buildPreviewUrl(session, resp.token, chosen.kind, profileId, wfName);
    }

    return {
        ran: true, kind: chosen.kind, endpoint: chosen.endpoint, success, validated,
        validation, messages, profiles: profiles.map(p => ({ name: p.profileName, id: p.profileId })),
        availableKinds: avail.map(a => a.kind),
        // rawToken = the unmodified resp.token. For WEB it's a directly-fetchable URL on
        // webpals.cloudpiston.com (no auth needed — verified live). _previewUrl carries cp-auth
        // for the console browser-open path and must never be returned to the agent.
        rawToken: validated ? resp.token : null,
        _previewUrl: previewUrl
    };
}

module.exports = { runTest, availableWorkflows, buildPreviewUrl, normalizeWorkflowName, appendQueryParam, RESERVED_QUERY_KEYS, normalizeValidation, normalizeMessages, TYPE_NUM, KIND_ENDPOINT };
