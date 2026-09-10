"use strict";
// Backs the ribbon's "Web Services…" panel — runs a Console or Transaction Web Services
// workflow for the CURRENT pal, always against the cloud that pal actually came from (never a
// hardcoded domain — see src/core/webServices.js). Uses a genuinely separate Web Services
// login (webServicesCreds.js), not the pal-cloud session Chip already has.
const palsyncfile = require("palsync/src/core/palsyncfile");
const webServices = require("palsync/src/core/webServices");
const creds = require("./webServicesCreds");

async function palContext(workspaceDir) {
    const record = await palsyncfile.read(workspaceDir);
    return { environmentUrl: record.cloudUrl, palId: record.palGuid };
}

// { needsLogin: true, environmentUrl } | { needsLogin: false, environmentUrl, username }
async function checkLogin(workspaceDir) {
    const { environmentUrl } = await palContext(workspaceDir);
    const usernames = creds.listUsernames(environmentUrl);
    if (!usernames.length) return { needsLogin: true, environmentUrl };
    return { needsLogin: false, environmentUrl, username: usernames[0] };
}

function login(environmentUrl, username, password) {
    creds.setCredential(environmentUrl, username, password);
    return { ok: true };
}

function logout(environmentUrl, username) {
    creds.deleteCredential(environmentUrl, username);
    return { ok: true };
}

// What the panel shows before running anything — the exact URL(s) the call below will actually
// hit, built from the same helpers runConsoleWorkflow/runTransactionWorkflow use (never a
// separately-maintained guess). Transaction is two calls; its second URL isn't fully known until
// the first response hands back a transaction id, so that line is shown as a template.
async function describeEndpoint(workspaceDir, engine) {
    const { environmentUrl, palId } = await palContext(workspaceDir);
    if (engine === "console") {
        return { lines: [webServices.consoleWorkflowUrl(environmentUrl, palId)] };
    }
    if (engine === "transaction") {
        // The real transactionId isn't known until the create call responds, so this second
        // line uses a literal placeholder — build it by hand rather than through
        // transactionWorkflowUrl, which would URL-encode the {braces} into %7B/%7D.
        return {
            lines: [
                webServices.transactionCreateUrl(environmentUrl) + "  (creates a transaction)",
                webServices.transactionCreateUrl(environmentUrl) + "/{transactionId}/runWorkflow  (then runs it)"
            ]
        };
    }
    return { lines: [] };
}

// postData: a plain { key: value } object of post-data pairs (documents/images/styles/payload
// are out of scope for this pass — see BACKLOG.md).
async function runWorkflow(workspaceDir, engine, postData) {
    const { environmentUrl, palId } = await palContext(workspaceDir);
    const usernames = creds.listUsernames(environmentUrl);
    if (!usernames.length) return { ran: false, reason: "Not logged in to Web Services for this cloud." };
    const username = usernames[0];
    const password = creds.getPassword(environmentUrl, username);
    if (!password) return { ran: false, reason: "Stored Web Services credential is unreadable — log in again." };
    const session = { environmentUrl, username, password };

    if (engine === "console") return webServices.runConsoleWorkflow(session, palId, postData);
    if (engine === "transaction") return webServices.runTransactionWorkflow(session, palId, postData);
    return { ran: false, reason: "Unknown engine '" + engine + "'." };
}

module.exports = { checkLogin, login, logout, runWorkflow, describeEndpoint };
