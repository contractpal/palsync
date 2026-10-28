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
// guid each mint (ids rotate per enumeration — see core/resolve) UNLESS the caller already has
// a current one (resolvedId — e.g. from a cached resolve/refreshResolvedPal, one cheap call
// instead of the full account walk here) to skip resolving it again.
async function mintTunnelCredentials(session, palGuid, resolvedId) {
    let id = resolvedId;
    if (!id) {
        const resolved = await resolveServerPalByGuid(session, palGuid);
        if (!resolved) return { minted: false, reason: "pal not found on the server by guid " + palGuid };
        id = resolved.id;
    }
    const res = await CloudPistonAPIManager.createTunnel(session, id);
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

// The project's scratch folder for tunnel work, shared by the agent and the developer: payload
// files go in, saved responses come out. Created on first save, never by a read.
const TUNNEL_DIR = ".tunnel";

// Resolve a payloadFile. Absolute paths are used as given. A relative one is looked up in
// .tunnel first (the common case: "just the file name"); if it isn't there but exists relative
// to the workspace, that wins so older workspace-relative calls keep working. When neither
// exists the .tunnel path is returned, so the "could not read" error names the expected spot.
function resolvePayloadPath(workspaceDir, payloadFile) {
    if (path.isAbsolute(payloadFile)) return payloadFile;
    const inTunnel = path.join(workspaceDir, TUNNEL_DIR, payloadFile);
    if (fs.existsSync(inTunnel)) return inTunnel;
    const inWorkspace = path.join(workspaceDir, payloadFile);
    return fs.existsSync(inWorkspace) ? inWorkspace : inTunnel;
}

// outFile is a bare file name inside .tunnel — never a path, so a response can't be written
// outside the folder. Returns { ok, name } or { ok:false, reason }.
function validateOutFileName(outFile) {
    const name = String(outFile || "").trim();
    if (!name) return { ok: false, reason: "outFile is empty" };
    if (/[\\/]/.test(name) || name === "." || name === ".." || /^[a-zA-Z]:/.test(name)) {
        return { ok: false, reason: "outFile must be a file name only (it is saved in the " + TUNNEL_DIR + " folder), not a path" };
    }
    if (/[<>:"|?*\x00-\x1f]/.test(name)) {
        return { ok: false, reason: "outFile contains characters that are not allowed in a file name" };
    }
    return { ok: true, name };
}

const MAX_KEYS_SHOWN = 40;

// What the console shows instead of the body: the shape of the JSON, one level deep.
function describeJsonShape(parsed) {
    if (Array.isArray(parsed)) return { kind: "array", length: parsed.length, topLevelKeys: [] };
    if (parsed !== null && typeof parsed === "object") return { kind: "object", topLevelKeys: Object.keys(parsed) };
    return { kind: parsed === null ? "null" : typeof parsed, topLevelKeys: [] };
}

// Save a successful tunnel response to <workspace>/.tunnel/<outFile>. The body is written exactly
// as received. Callers must only pass a successful, parsed-JSON response — failures are never saved.
//   -> { saved:true, name, relPath, path, bytes, shape } | { saved:false, reason }
function saveTunnelResponse(workspaceDir, outFile, raw, parsed) {
    const v = validateOutFileName(outFile);
    if (!v.ok) return { saved: false, reason: v.reason };
    const dir = path.join(workspaceDir, TUNNEL_DIR);
    const target = path.join(dir, v.name);
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(target, raw, "utf8");
    } catch (e) {
        return { saved: false, reason: "could not write " + target + ": " + e.message };
    }
    return {
        saved: true, name: v.name, relPath: TUNNEL_DIR + "/" + v.name, path: target,
        bytes: Buffer.byteLength(raw, "utf8"), shape: describeJsonShape(parsed)
    };
}

// The console line for a saved response: name, size, and the top-level JSON keys.
function formatSavedSummary(s) {
    let shape;
    if (s.shape.kind === "object") {
        const keys = s.shape.topLevelKeys;
        shape = keys.length
            ? "top-level keys (" + keys.length + "): " + keys.slice(0, MAX_KEYS_SHOWN).join(", ") +
              (keys.length > MAX_KEYS_SHOWN ? ", … +" + (keys.length - MAX_KEYS_SHOWN) + " more" : "")
            : "empty JSON object";
    } else if (s.shape.kind === "array") {
        shape = "top-level JSON array of " + s.shape.length + " item" + (s.shape.length === 1 ? "" : "s") + " (no keys)";
    } else {
        shape = "top-level JSON " + s.shape.kind + " (no keys)";
    }
    return "Saved response → " + s.relPath + "\n  size: " + s.bytes + " bytes\n  " + shape +
        "\nReport exactly these three facts (file, size, top-level keys). Do NOT print, quote, or re-read the file contents unless the user asks to see them.";
}

// One raw call to the tunnel endpoint. Returns { status, text }; throws only on network failure.
// This hits cptservice/run.do directly (NOT /cpbuilder/), so it bypasses apiManager.js's
// fetchAPI entirely — chipSessionId is threaded through separately here for the same
// Chip-Session-ID header fetchAPI adds, so a Tunnel run for this agent+pal window is
// identifiable the same way any other request for it is.
async function callTunnelOnce(creds, { action, workflow, payload, chipSessionId }, fetchImpl) {
    const headers = {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from(creds.username + ":" + creds.password).toString("base64")
    };
    // action is OPTIONAL — omit the header entirely and the workflow's getAction() returns null.
    if (action) headers.tunnelAction = action;
    if (workflow) headers.tunnelWorkflow = workflow;
    if (chipSessionId) headers["Chip-Session-ID"] = chipSessionId;
    const body = payload == null ? "{}" : (typeof payload === "string" ? payload : JSON.stringify(payload));
    const resp = await fetchImpl(creds.url, { method: "POST", headers, body });
    return { status: resp.status, text: await resp.text() };
}

// Run a tunnel action with credential lifecycle: use `creds` if given, else mint; on a 401
// (token expired — they live ~5 min) mint fresh and retry ONCE. Returns the creds actually used
// so the caller can cache them for the next call.
//   -> { ran, refused?, reason?, status, action, workflow, response (parsed JSON|null),
//        raw (body text), emptyBody, refreshedCredentials, creds }
// resolvedId: a previously-resolved transient pal id (see core/resolve.js) to skip
// mintTunnelCredentials' own resolve walk — optional, callers that run this repeatedly against
// the same pal (e.g. Chip's Tunnel panel) should cache and pass this back in.
async function runTunnelAction(session, palGuid, { action, workflow, payload, creds, fetchImpl = fetch, resolvedId } = {}) {
    let refreshed = false;
    if (!creds) {
        const mint = await mintTunnelCredentials(session, palGuid, resolvedId);
        if (!mint.minted) return { ran: false, refused: "mint-failed", reason: mint.reason };
        creds = mint;
        refreshed = true;
    }

    const chipSessionId = session && session.chipSessionId;
    let res = await callTunnelOnce(creds, { action, workflow, payload, chipSessionId }, fetchImpl);
    if (res.status === 401 && !refreshed) {
        // Cached token expired — mint once and retry.
        const mint = await mintTunnelCredentials(session, palGuid, resolvedId);
        if (!mint.minted) return { ran: false, refused: "mint-failed", reason: mint.reason };
        creds = mint;
        refreshed = true;
        res = await callTunnelOnce(creds, { action, workflow, payload, chipSessionId }, fetchImpl);
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

module.exports = {
    runTunnelAction, mintTunnelCredentials, callTunnelOnce, listTunnelWorkflows, matchTunnelWorkflow,
    TUNNEL_DIR, resolvePayloadPath, validateOutFileName, saveTunnelResponse, formatSavedSummary
};