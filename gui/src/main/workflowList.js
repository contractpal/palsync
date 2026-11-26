"use strict";
// Lists a pal's workflow file names for a given kind, so a picker can offer a choice when a pal
// has more than one workflow of that kind (e.g. several console-system workflows) — runTest()
// otherwise silently defaults to the first one found. Read-only: resolves the pal and reads its
// server record, no lock acquired.
const { CloudPistonAPIManager } = require("palsync/lib/apiManager");
const { availableWorkflows, normalizeWorkflowName } = require("palsync/src/core/test");
const { sessionForFolder } = require("./palSession");
const { resolvePal } = require("./resolveCached");

const LAYOUT_DEFAULT_KEY = {
    console: "consoleWorkflow", transaction: "transactionWorkflow",
    "console-system": "consoleSystemWorkflow", web: "webWorkflow"
};

async function listWorkflowFiles(workspaceDir, kind, chipSessionId) {
    const { session, record } = await sessionForFolder(workspaceDir, chipSessionId);
    const resolved = await resolvePal(session, workspaceDir, record.palGuid);
    if (!resolved) return { files: [], error: "Pal not found on the server." };
    const gp = await CloudPistonAPIManager.getPal(session, resolved.id);
    const avail = availableWorkflows(gp && gp.pal);
    const entry = avail.find(a => a.kind === kind);
    // Profiles feed the Test dialog's profile select (the Java IDE's dialog has the same one).
    // Best-effort: a failed lookup just leaves the select empty and runTest falls back to the first.
    let profiles = [];
    try {
        const pr = await CloudPistonAPIManager.getProfileList(session);
        const list = (pr && pr.success && pr.profileList && pr.profileList["com.contractpal.pal.ProfileInfo"]) || [];
        profiles = list.map(p => ({ id: p.profileId, name: p.profileName }));
    } catch { /* leave empty */ }
    // layout.<kind>Workflow names the pal's default workflow; same string format as the entries'.
    const layout = (gp && gp.pal && gp.pal.layout) || {};
    const layoutKey = LAYOUT_DEFAULT_KEY[kind];
    const defaultFile = layoutKey && layout[layoutKey] ? normalizeWorkflowName(layout[layoutKey]) : null;
    return { files: (entry ? entry.files : []).map(normalizeWorkflowName), defaultFile, profiles };
}

module.exports = { listWorkflowFiles };
