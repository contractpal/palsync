"use strict";
// pal_tunnel_test core: call a pal's TUNNEL workflow (workflowType 15) as a real web-service
// client and return its JSON response — the one sync surface where the agent gets actual DATA
// back from the server, not just validation verdicts.
//
// Wire format (verified live against test-vm1, July 2026):
//   1. CreateTunnel.do (standard cpbuilder call — no lock, no body) mints
//      { tunnelUrl, tunnelUsername, tunnelPassword }. The username is "TB-" + pal guid; the
//      password is a short-lived token (~5 min). Mint on demand, cache per session, re-mint
//      once on a 401 — never persist.
//   2. POST tunnelUrl (cptservice/run.do — a DIFFERENT servlet from /cpbuilder/) with
//      Basic <tunnelUsername:tunnelPassword> and:
//        header  tunnelAction:   what the workflow reads via request.getAction()
//        header  tunnelWorkflow: which tunnel workflow (optional — the server defaults to the
//                                pal's registered layout.tunnelServiceWorkflow)
//        body    the JSON payload STRING ("{}" if none) — top-level keys land in
//                request.getPayload() (payload.get(key))
//   Response: the workflow's response payload serialized as JSON (served as text/plain).
//   An EMPTY 200 body means the workflow THREW at runtime — the server swallows the error —
//   so surface that loudly instead of reporting "no data".
const { CloudPistonAPIManager } = require("../../lib/apiManager");
const { resolveServerPalByGuid } = require("./resolve");
const fs = require("fs");
const path = require("path");

// Mint fresh tunnel credentials for the pal. The transient pal id must be re-resolved from the
// guid each mint (ids rotate per enumeration — see core/resolve).
async function mintTunnelCredentials(session, palGuid) {
    const resolved = await resolveServerPalByGuid(session, palGuid);
    if (!resolved) return { minted: false, reason: "pal not found on the server by guid " + palGuid };
    const res = await CloudPistonAPIManager.createTunnel(session, resolved.id);
    if (!res || !res.tunnelUrl || !res.tunnelUsername || !res.tunnelPassword) {
        return { minted: false, reason: "CreateTunnel.do did not return tunnel credentials" +
            (res && res.success === false ? " (the server reported failure)" : "") };
    }
    return { minted: true, url: res.tunnelUrl, username: res.tunnelUsername, password: res.tunnelPassword };
}

// Enumerate the pal's tunnel workflows from the LOCAL pal.json (best-effort — reflects the last
// pull). Returns { tunnels: [names], defaultTunnel: layout.tunnelServiceWorkflow | null }.
function listTunnelWorkflows(workspaceDir) {
    try {
        const pal = JSON.parse(fs.readFileSync(path.join(workspaceDir, "pal.json"), "utf8"));
        const entries = (pal.workflows && pal.workflows.entry) || [];
        const list = Array.isArray(entries) ? entries : [entries];
        return {
            tunnels: list.filter(e => e.Workflow && e.Workflow.workflowType === 15).map(e => e.string),
            defaultTunnel: (pal.layout && pal.layout.tunnelServiceWorkflow) || null
        };
    } catch (e) {
        return { tunnels: [], defaultTunnel: null, error: e.message };
    }
}

// Match a user-supplied tunnel name against the pal's tunnel workflows: exact, with a .js
// extension added, or case-insensitive sans-extension ("xyz" matches "xyz.js"). Null if no match.
function matchTunnelWorkflow(name, tunnels) {
    if (!name) return null;
    if (tunnels.includes(name)) return name;
    if (tunnels.includes(name + ".js")) return name + ".js";
    const bare = String(name).toLowerCase().replace(/\.js$/, "");
    return tunnels.find(t => String(t).toLowerCase().replace(/\.js$/, "") === bare) || null;
}

// One raw call to the tunnel endpoint. Returns { status, text }; throws only on network failure.
async function callTunnelOnce(creds, { action, workflow, payload }, fetchImpl) {
    const headers = {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from(creds.username + ":" + creds.password).toString("base64")
    };
    // action is OPTIONAL — omit the header entirely and the workflow's getAction() returns null.
    if (action) headers.tunnelAction = action;
    if (workflow) headers.tunnelWorkflow = workflow;
    const body = payload == null ? "{}" : (typeof payload === "string" ? payload : JSON.stringify(payload));
    const resp = await fetchImpl(creds.url, { method: "POST", headers, body });
    return { status: resp.status, text: await resp.text() };
}

// Run a tunnel action with credential lifecycle: use `creds` if given, else mint; on a 401
// (token expired — they live ~5 min) mint fresh and retry ONCE. Returns the creds actually used
// so the caller can cache them for the next call.
//   -> { ran, refused?, reason?, status, action, workflow, response (parsed JSON|null),
//        raw (body text), emptyBody, refreshedCredentials, creds }
async function runTunnelAction(session, palGuid, { action, workflow, payload, creds, fetchImpl = fetch } = {}) {
    let refreshed = false;
    if (!creds) {
        const mint = await mintTunnelCredentials(session, palGuid);
        if (!mint.minted) return { ran: false, refused: "mint-failed", reason: mint.reason };
        creds = mint;
        refreshed = true;
    }

    let res = await callTunnelOnce(creds, { action, workflow, payload }, fetchImpl);
    if (res.status === 401 && !refreshed) {
        // Cached token expired — mint once and retry.
        const mint = await mintTunnelCredentials(session, palGuid);
        if (!mint.minted) return { ran: false, refused: "mint-failed", reason: mint.reason };
        creds = mint;
        refreshed = true;
        res = await callTunnelOnce(creds, { action, workflow, payload }, fetchImpl);
    }
    if (res.status === 401) {
        return { ran: false, refused: "unauthorized", creds,
            reason: "the tunnel endpoint rejected freshly-minted credentials (401) — the tunnel may be disabled for this pal or cloud." };
    }
    if (res.status !== 200) {
        // The servlet's error pages are small HTML blobs with the reason inline — pass the text through.
        return { ran: false, refused: "http-" + res.status, creds, raw: res.text,
            reason: "tunnel call failed with HTTP " + res.status + ": " + stripHtml(res.text) };
    }

    let parsed = null, parseError = null;
    const text = res.text || "";
    if (text.trim().length) {
        try { parsed = JSON.parse(text); } catch (e) { parseError = e.message; }
    }
    return {
        ran: true, status: res.status, action: action || null, workflow: workflow || null,
        response: parsed, raw: text, parseError,
        emptyBody: !text.trim().length,
        refreshedCredentials: refreshed, creds
    };
}

// The cptservice error pages are one-line HTML — reduce to their text for a readable reason.
function stripHtml(text) {
    return String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

module.exports = { runTunnelAction, mintTunnelCredentials, callTunnelOnce, listTunnelWorkflows, matchTunnelWorkflow };