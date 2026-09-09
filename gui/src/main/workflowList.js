"use strict";
// Lists a pal's workflow file names for a given kind, so a picker can offer a choice when a pal
// has more than one workflow of that kind (e.g. several console-system workflows) — runTest()
// otherwise silently defaults to the first one found. Read-only: resolves the pal and reads its
// server record, no lock acquired.
const { CloudPistonAPIManager } = require("palsync/lib/apiManager");
const { availableWorkflows, normalizeWorkflowName } = require("palsync/src/core/test");
const { sessionForFolder } = require("./palSession");
const { resolvePal } = require("./resolveCached");

async function listWorkflowFiles(workspaceDir, kind, chipSessionId) {
    const { session, record } = await sessionForFolder(workspaceDir, chipSessionId);
    const resolved = await resolvePal(session, workspaceDir, record.palGuid);
    if (!resolved) return { files: [], error: "Pal not found on the server." };
    const gp = await CloudPistonAPIManager.getPal(session, resolved.id);
    const avail = availableWorkflows(gp && gp.pal);
    const entry = avail.find(a => a.kind === kind);
    return { files: (entry ? entry.files : []).map(normalizeWorkflowName) };
}

module.exports = { listWorkflowFiles };
