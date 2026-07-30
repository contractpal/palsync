"use strict";
// The palsync launcher: cloud → login → profile → group → pal → agent → setup → open Claude Code.
// All interactive steps are injectable so the flow is testable headlessly; defaults use the real
// @clack/prompts UI. autoLaunch=false stops before opening the agent (used by tests).
const { loadClack } = require("../platform/uiPrompts");
const { login } = require("../auth/credentials");
const { runSelection } = require("./selection");
const { createNewPal } = require("../core/createPal");
const { selectionPrompts, driftPrompt, pickEvalSpec } = require("./prompts");
const agents = require("./agents");
const workspace = require("./workspace");
const evalSpec = require("../core/evalSpec");
const { BACK } = require("../core/back");

async function defaultChooseDir(defaultDir) {
    const clack = await loadClack();
    const v = await clack.text({ message: "Workspace directory", initialValue: defaultDir });
    if (clack.isCancel(v) || !v) return null;
    return v;
}

// Orchestrate the whole flow. Returns { workspaceDir, setupResult, agent, child } or null on cancel.
async function run({
    loginPrompts,
    selectionPrompts: selPrompts = selectionPrompts,
    pickAgent,
    chooseWorkspaceDir = defaultChooseDir,
    onDrift = driftPrompt,
    autoLaunch = true,
    agent: agentKey,
    evalSpec: evalSpecKey,
    pickEvalSpecPrompt = pickEvalSpec,
    log = () => {}
} = {}) {
    // 0. eval-harness spec pick (no session needed — pure local files). Resolves eagerly if a
    //    key string was given (--eval=01_crud_equipment_checkout); prompts interactively for
    //    bare --eval; skipped entirely when evalSpecKey is undefined (normal flow).
    let spec = null;
    if (evalSpecKey) {
        if (evalSpecKey === true) {
            const chosen = await pickEvalSpecPrompt(evalSpec.listSpecs());
            if (!chosen) { log("cancelled at eval spec pick"); return null; }
            spec = evalSpec.resolveSpec(chosen);
        } else {
            spec = evalSpec.resolveSpec(evalSpecKey);
        }
        log("eval spec: " + spec.key + " (suggested pal name: " + spec.suggestedName + ")");
    }

    // 1–2. cloud + login (cached creds skip the prompt)
    let loginResult = await login({ prompts: loginPrompts });
    if (loginResult === BACK) { log("cancelled at login"); return null; }
    let { session, cloudUrl } = loginResult;
    log("logged in: " + session.username + " @ " + cloudUrl + " (userId=" + session.userId + ")");

    // 3. profile → [open existing | create new]. Backing out of the very first selection
    //    screen (profile) re-enters login at its last step (password) — see selection.js's
    //    "profile" step and credentials.js's resumable entry — so the whole login+selection
    //    flow reads as one continuous back stack instead of two disconnected menus.
    let sel;
    while (true) {
        sel = await runSelection(session, selPrompts, spec ? { forceCreate: true, defaultName: spec.suggestedName } : undefined);
        if (sel !== BACK) break;
        loginResult = await login({ prompts: loginPrompts, cloudUrl, username: session.username });
        if (loginResult === BACK) { log("cancelled at login"); return null; }
        ({ session, cloudUrl } = loginResult);
        log("logged in: " + session.username + " @ " + cloudUrl + " (userId=" + session.userId + ")");
    }
    if (!sel) { log("cancelled at selection"); return null; }

    // Create mode: mint the pal now (server returns its guid), then fall through to the same
    // pull + lock + setup path the open path uses — the new pal is just an empty one.
    if (sel.mode === "create") {
        log("creating pal: " + sel.details.name + " in " + sel.groups.length + " group(s)");
        const created = await createNewPal(session, {
            profileId: sel.profile.profileId,
            groupIds: sel.groups.map(g => g.groupId),
            name: sel.details.name,
            description: sel.details.description,
            category: sel.details.category,
            activationKeyId: sel.activationKey
        });
        sel = { profile: sel.profile, pal: { guid: created.guid, name: created.name || sel.details.name } };
    }
    log("selected pal: " + sel.pal.name + " (" + sel.pal.guid + ")");

    // 4. agent — an explicit --agent value resolves directly (skips the picker); otherwise fall
    //    back to the interactive pick (Claude Code default). Codex/Pi are reachable via the flag.
    let agent;
    if (agentKey) {
        agent = agents.resolve(agentKey);
        if (!agent) throw new Error("Unknown agent '" + agentKey + "'. Use one of: " + agents.AGENTS.map(a => a.key).join(", ") + ".");
    } else {
        agent = await agents.pick(pickAgent);
        if (!agent) { log("cancelled at agent"); return null; }
    }
    log("agent: " + agent.label);

    // 5. workspace dir + setup (pull + lock + inject + .palsync.json + register MCP)
    const dir = await chooseWorkspaceDir(workspace.defaultWorkspaceDir(sel.pal.name, sel.pal.branch), sel.pal);
    if (!dir) { log("cancelled at workspace dir"); return null; }
    const setupResult = await workspace.setup({ session, cloudUrl, sel, workspaceDir: dir, agent: agent.key, onDrift, log });

    // 5b. eval-harness: inject the chosen spec's docs + auto-fill the placeholder header now
    //     that we know the real cloud URL and pal name — workspace is then 100% ready to run.
    if (spec) {
        const fillValue = cloudUrl + " (pal: " + sel.pal.name + ")";
        const injectResult = evalSpec.injectSpec(dir, spec, { fillValue });
        log("eval spec injected: " + injectResult.written.join(", ") +
            (injectResult.skipped.length ? " (skipped existing: " + injectResult.skipped.join(", ") + ")" : ""));
    }

    // 6. open the agent in the workspace (handoff). Lock stays held; MCP server owns release.
    let child = null;
    if (autoLaunch) {
        log("opening " + agent.label + " in " + dir);
        child = agents.launch(agent, { cwd: dir });
    }

    return { workspaceDir: dir, setupResult, agent, child, evalSpec: spec };
}

module.exports = { run };
