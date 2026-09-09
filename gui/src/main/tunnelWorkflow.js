"use strict";
// Backing logic for the per-pal Tunnel panel — wraps palsync's already-verified-live
// src/core/tunnel.js end to end (credential minting, 401 retry, response parsing). Unlike
// Web/Console/System/Transaction, there is no Test*.do for Tunnel — CreateTunnel.do mints
// short-lived SOAP-service-style credentials, then the workflow is called directly as a real
// HTTP POST (see tunnel.js's header comment for the wire format).
const { listTunnelWorkflows, runTunnelAction } = require("palsync/src/core/tunnel");
const { sessionForFolder } = require("./palSession");
const { resolvePal } = require("./resolveCached");

// Local, no network/auth — just reads the pal's last-pulled pal.json for its tunnel workflow
// names, so the panel can populate a dropdown before the user runs anything.
function listWorkflows(workspaceDir) {
    return listTunnelWorkflows(workspaceDir);
}

// action/workflow are optional (server defaults workflow to the pal's registered
// layout.tunnelServiceWorkflow if omitted); payload is passed through as-is (a JSON string, or
// "{}" if blank — runTunnelAction handles both).
async function runTunnel(workspaceDir, { action, workflow, payload, chipSessionId } = {}) {
    const { session, record } = await sessionForFolder(workspaceDir, chipSessionId);
    // See resolveCached.js — avoids walking the whole account on every tunnel run.
    const resolved = await resolvePal(session, workspaceDir, record.palGuid);
    return runTunnelAction(session, record.palGuid, { action, workflow, payload, resolvedId: resolved && resolved.id });
}

module.exports = { listWorkflows, runTunnel };
