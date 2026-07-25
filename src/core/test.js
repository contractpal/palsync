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

// Build the runnable preview URL. CREDENTIAL-BEARING — never return/log this; hand straight to
// the browser opener. profileId/workflowName only matter for console/transaction.
function buildPreviewUrl(session, token, kind, profileId, workflowName) {
    //let url = token + "&cp-auth=" + Buffer.from(session.username + ":" + session.password).toString("base64");
    let url = token;
    if (kind !== "web") {
        if (session.sessionAuthToken)
        {
            const auth=session.sessionAuthToken;
            url+="&cp-auth="+auth.substring(auth.indexOf(":")+1);
        }
        if (profileId) url += "&nxProfileId=" + profileId;
        if (workflowName) url += "&cp-workflow=" + workflowName;
    }
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
    // Pick the engine: explicit kind, else the first available (web preferred — it renders
    // directly; otherwise console).
    let chosen;
    if (kind) {
        chosen = avail.find(a => a.kind === kind) || { kind, endpoint: KIND_ENDPOINT[kind], files: [] };
    } else {
        chosen = avail.find(a => a.kind === "web") || avail[0];
    }
    if (!chosen.endpoint) return { ran: false, blocked: "unknown-kind", kind };

    const resp = await CloudPistonAPIManager.testWorkflow(session, palId, chosen.endpoint);
    const validation = normalizeValidation(resp);
    const messages = normalizeMessages(resp);
    const success = !!(resp && resp.success);
    const validated = !!(resp && resp.validated);
    const profiles = (resp && resp.profileList && resp.profileList["com.contractpal.pal.ProfileInfo"]) || [];

    let previewUrl = null;
    if (validated && resp.token) {
        const wfName = chosen.kind === "web" ? null
            : (workflowName || (chosen.files[0] ? String(chosen.files[0]).replace(/\.[^.]+$/, "") : "main"));
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

module.exports = { runTest, availableWorkflows, buildPreviewUrl, normalizeValidation, normalizeMessages, TYPE_NUM, KIND_ENDPOINT };
