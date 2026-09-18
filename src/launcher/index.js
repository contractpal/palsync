"use strict";
// The palsync launcher. Two entry paths:
//   * RECENT (the default once you have history): a local-only menu of the pals you actually
//     work on, then straight to authenticate → cheap re-resolve → remembered workspace + agent
//     → the SAME workspace.setup() the wizard uses (pull, drift guards, lock, inject, register).
//   * WIZARD (empty history, "Open another Pal…", or a recovery that needs a fresh choice):
//     cloud → login → profile → group → pal → agent → directory → setup → open the agent.
// Both end in workspace.setup(); the sync safety machinery has exactly one implementation.
// All interactive steps are injectable so the flow is testable headlessly; defaults use the real
// @clack/prompts UI. autoLaunch=false stops before opening the agent (used by tests).
const fs = require("fs");
const path = require("path");
const { loadClack } = require("../platform/uiPrompts");
const { login } = require("../auth/credentials");
const { runSelection } = require("./selection");
const { createNewPal } = require("../core/createPal");
const { selectionPrompts, driftPrompt, pickEvalSpec } = require("./prompts");
const agents = require("./agents");
const workspace = require("./workspace");
const evalSpec = require("../core/evalSpec");
const { seedImpactBaseline } = require("../core/impactEval");
const lock = require("../core/lock");
const { BACK } = require("../core/back");
const { commandOnPath } = require("../platform/commandOnPath");
const keychain = require("../platform/keychain");
const recentStore = require("../platform/recentPals");
const recentMenu = require("./recent");
const workspacePath = require("./workspacePath");
const resolveApi = require("../core/resolve");

async function defaultChooseDir(defaultDir) {
    const clack = await loadClack();
    const v = await clack.text({
        message: "Workspace directory — this EXACT folder will hold the pal (enter to accept)",
        initialValue: defaultDir
    });
    if (clack.isCancel(v) || !v) return null;
    return v;
}

// Orchestrate the whole flow. Returns { workspaceDir, setupResult, agent, child } or null on cancel.
async function run(options = {}) {
    const {
        loginPrompts,
        selectionPrompts: selPrompts = selectionPrompts,
        pickAgent,
        chooseWorkspaceDir = defaultChooseDir,
        onDrift = driftPrompt,
        autoLaunch = true,
        agent: agentKey,
        workspaceDir: explicitWorkspaceDir,
        evalSpec: evalSpecKey,
        pickEvalSpecPrompt = pickEvalSpec,
        pickRecentPrompt,
        pickRecentPalPrompt,
        pickRecoveryPrompt,
        agentOnPath = commandOnPath,
        preflight = null,
        recent = recentStore,
        resolve: resolveModule = resolveApi,
        // Whether this caller has a human in front of it. The CLI passes true (it already refused
        // to run without a TTY); a programmatic caller defaults to TTY detection and can state it
        // outright. Every prompt is then allowed only when the caller is interactive OR supplied
        // the matching prompt seam — so a headless caller gets a clear error naming the flag to
        // use, never a prompt nobody can see and never a hang.
        interactive: declaredInteractive,
        log = () => {}
    } = options;

    const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const interactive = declaredInteractive === undefined ? tty : Boolean(declaredInteractive);
    const ctx = {
        loginPrompts, selPrompts, pickAgent, chooseWorkspaceDir, onDrift, autoLaunch,
        agentKey, explicitWorkspaceDir, pickRecentPrompt, pickRecentPalPrompt, pickRecoveryPrompt,
        agentOnPath, preflight, recent, resolveModule, log, interactive,
        canPromptDir: chooseWorkspaceDir !== defaultChooseDir || interactive,
        canPromptAgent: Boolean(pickAgent) || interactive
    };

    // 0. eval-harness spec pick (no session needed — pure local files). Resolves eagerly if a
    //    key string was given (--eval=01_crud_equipment_checkout); prompts interactively for
    //    bare --eval; skipped entirely when evalSpecKey is undefined (normal flow). Benchmark
    //    runs never touch the recent-Pal menu or the history (they would clutter it with
    //    disposable pals).
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
        return await runWizard(ctx, spec);
    }

    // 0b. recent-Pal menu — LOCAL ONLY. No login, no server call, no config beyond
    //     ~/.palsync/config.json: the menu must appear instantly. Empty history falls through to
    //     the full wizard, so a new user's first run is unchanged.
    const history = listHistory(ctx, log);
    const visible = ctx.interactive || pickRecentPrompt ? recent.ranked(history) : [];
    if (visible.length) {
        const choice = await recentMenu.pickRecent(visible, { prompt: pickRecentPrompt });
        if (!choice) { log("cancelled at recent pal pick"); return null; }
        if (choice.kind === "pal") {
            const outcome = await runRecent(choice.entry, ctx);
            if (outcome && outcome.result) return outcome.result;
            if (outcome && outcome.fallback) return await runWizard(ctx, null, outcome.fallback);
            return null;
        }
        if (choice.kind === "change-dir") {
            const entry = await recentMenu.pickRecentPal(visible, { prompt: pickRecentPalPrompt });
            if (!entry) { log("cancelled at workspace change"); return null; }
            const typed = await promptForDir(ctx, entry.workspaceDir || workspace.defaultWorkspaceDir(entry.palName, entry.branch),
                { palName: entry.palName, branch: entry.branch });
            if (!typed) { log("cancelled at workspace dir"); return null; }
            // typedDir: the folder the user just chose wins over a stale --dir, and a folder that
            // does not exist yet is accepted (a first checkout at a new location). Nothing is
            // REMEMBERED here — the preference is written by recordLaunch() only after setup()
            // actually succeeded (see recordLaunch).
            const outcome = await runRecent(entry, ctx, { typedDir: typed });
            if (outcome && outcome.result) return outcome.result;
            if (outcome && outcome.fallback) return await runWizard(ctx, null, outcome.fallback);
            return null;
        }
        log("opening the full pal list");
    }
    return await runWizard(ctx, null);
}

// The history is a convenience: an unreadable config must never stop someone from launching.
function listHistory(ctx, log) {
    try {
        return ctx.recent.list();
    } catch (e) {
        log("recent-Pal history unavailable (" + (e && e.message ? e.message : e) + ") — showing the full list");
        return [];
    }
}

// The remembered workspace dir is a preference, so it may only be reused after proving it still
// belongs to THIS pal on THIS cloud (.palsync.json + the freshly resolved server record).
//   explicitDir — the --dir flag: taken as an exact path, but still identity-checked
//   typedDir    — a folder the user just typed in the menu's "Change workspace directory…"
async function chooseRecentWorkspace(entry, resolved, ctx, { cloudUrl, username, explicitDir, typedDir }) {
    const identity = { palGuid: resolved.guid, cloudUrl, username };
    const safeDefault = () => workspace.defaultWorkspaceDir(resolved.name, resolved.branch);
    const pal = { palName: resolved.name, branch: resolved.branch };
    if (explicitDir) {
        const dir = workspacePath.normalizeWorkspaceDir(explicitDir);
        if (!dir) throw new Error("--dir requires a directory path");
        ctx.log("workspace: " + dir + " (from --dir)");
        // --dir is an EXACT path (never a parent with the pal name appended) and it does not have
        // to exist yet — but a folder that belongs to a different pal/cloud, or a non-empty folder
        // with no PalSync workspace in it, is still refused rather than written into.
        return await guardTypedDir(ctx, { dir, identity, ...pal, defaultDir: safeDefault(), allowRetry: false });
    }
    if (typedDir) {
        // The user just chose this folder — including one that does not exist yet, which is a
        // normal first checkout at a new location.
        return await guardTypedDir(ctx, { dir: typedDir, identity, ...pal, defaultDir: safeDefault(), allowRetry: false });
    }

    let dir = entry.workspaceDir;
    // allowMissing stays false for the REMEMBERED path: a folder that vanished must not be
    // recreated silently at an unexpected location.
    const check = workspacePath.inspectWorkspace(dir, identity);
    if (check.ok) {
        ctx.log("workspace: " + dir + " (remembered)");
        return { dir };
    }
    const reason = workspacePath.describeRefusal(check, { palName: resolved.name, dir });
    if (!ctx.interactive && !ctx.pickRecoveryPrompt) {
        // Nothing can be asked and nothing may be assumed: refuse, and say exactly why. This is
        // also what keeps a scripted (non-interactive) caller from looping.
        throw new Error(reason + "\nThe remembered workspace for this Pal cannot be used, and no " +
            "interactive choice is available. Re-run palsync in a terminal, or pass --dir <path>.");
    }
    const recovery = await recentMenu.pickRecovery(reason, {
        defaultDir: safeDefault(),
        prompt: ctx.pickRecoveryPrompt
    });
    if (!recovery) { ctx.log("cancelled at workspace recovery"); return { cancel: true }; }
    if (recovery.kind !== "choose-dir") return { fallback: true };
    // Enter takes the safe default, never the folder that was just refused.
    const picked = await promptForDir(ctx, safeDefault(), pal);
    if (!picked) { ctx.log("cancelled at workspace dir"); return { cancel: true }; }
    return await guardTypedDir(ctx, { dir: picked, identity, ...pal, defaultDir: safeDefault(), allowRetry: false });
}

async function promptForDir(ctx, defaultDir, pal) {
    if (!ctx.canPromptDir) {
        throw new Error("A workspace directory is needed, and no interactive prompt is available.\n" +
            "Re-run palsync in a terminal, or pass --dir <path>.");
    }
    const typed = await ctx.chooseWorkspaceDir(defaultDir, { name: pal.palName, branch: pal.branch });
    return workspacePath.normalizeWorkspaceDir(typed);
}

// Guard a directory the user typed (the wizard's prompt, "Change workspace directory…", or --dir):
// a folder that is not provably this pal's workspace is never adopted silently — the classic mistake
// is answering with a parent folder such as ~/projects instead of ~/projects/My-Pal, and PalSync has
// no way to prove that folder is safe to write into. A path that does not exist yet is a normal
// first checkout. The refused path is reported and the question comes back with the SAFE default;
// answering with a path that was ALREADY refused ends the question with the error instead of
// looping (retyping it is not a way past the guard).
//   allowRetry (default true) — false for --dir and "Change workspace directory…", where there is
//   no second question to ask: the caller reports the refusal and stops.
async function guardTypedDir(ctx, { dir, identity, palName, branch, defaultDir, allowRetry = true }) {
    let current = dir;
    const refusedPaths = new Set();
    while (true) {
        const check = workspacePath.inspectWorkspace(current, identity, { allowMissing: true });
        if (check.ok) return { dir: current };
        const reason = workspacePath.describeRefusal(check, { palName, dir: current });
        if (!allowRetry || refusedPaths.has(current)) return { refused: true, reason };
        refusedPaths.add(current);
        ctx.log(reason);
        const picked = await promptForDir(ctx, defaultDir, { palName, branch });
        if (!picked) { ctx.log("cancelled at workspace dir"); return { cancel: true }; }
        current = picked;
    }
}

// The wizard's directory question: ask, then guard what came back.
async function chooseGuardedDir(ctx, { defaultDir, identity, palName, branch }) {
    const dir = await promptForDir(ctx, defaultDir, { palName, branch });
    if (!dir) { ctx.log("cancelled at workspace dir"); return null; }
    const guarded = await guardTypedDir(ctx, { dir, identity, palName, branch, defaultDir });
    if (guarded.refused) throw new Error(guarded.reason);
    return guarded.dir || null;
}

// Resolve a remembered pal against the server, cheapest request first: ONE profile/group-scoped
// getPalList. Only when that misses (the pal moved groups, or the history has no group) does it
// fall back to the full account walk. A transport/auth failure THROWS (nothing was changed), a
// pal that really is gone for this account returns null — the caller must tell those apart.
async function resolveRecentPal(session, entry, ctx) {
    const resolve = ctx.resolveModule;
    if (entry.profileId != null && entry.groupId != null) {
        let scoped;
        try {
            scoped = await resolve.refreshResolvedPal(session, {
                guid: entry.palGuid, profileId: entry.profileId, groupId: entry.groupId,
                profileName: entry.profileName, groupName: entry.groupName
            }, { rethrow: true });
        } catch (e) {
            throw new Error(cannotReach(session, e));
        }
        if (scoped) return scoped;
    }
    let walked;
    try {
        // strict: an HTTP/auth failure or an unreadable answer THROWS. `null` from here therefore
        // means a COMPLETE walk that did not contain the guid — the only outcome that may be
        // reported as a deleted pal and remove a history row.
        walked = await resolve.resolveServerPalByGuid(session, entry.palGuid, { strict: true });
    } catch (e) {
        throw new Error(cannotReach(session, e));
    }
    return walked || null;
}

function cannotReach(session, e) {
    const url = (session && session.environment && session.environment.url) || "the cloud";
    const t = session && session.lastTransport;
    const status = t && t.ok === false ? " (HTTP " + t.status + ")" : "";
    return "Could not reach " + url + status + " to check this Pal: " + (e && e.message ? e.message : e) +
        "\nNothing was changed in your workspace.";
}

// Is there a cached credential for this account? A missing/unavailable keychain answers false
// (the caller then reports it) — never a throw from this check itself.
function hasCachedCredential(entry) {
    try {
        return Boolean(keychain.getPassword(entry.cloudUrl, entry.username));
    } catch (err) {
        return false; // keychain unavailable (headless box) — the caller reports it
    }
}

// The agent question. A caller that cannot be asked gets an error naming the flag instead of a
// prompt nobody can answer.
async function pickAgentForSession(ctx) {
    if (!ctx.canPromptAgent) {
        throw new Error("No coding agent is saved for this Pal, and no interactive prompt is available.\n" +
            "Re-run palsync in a terminal, or pass --agent <claude|codex|pi|opencode>.");
    }
    return await agents.pick(ctx.pickAgent);
}

// The fast path for one remembered pal. Returns { result } | { fallback: { cloudUrl, username } } | null.
async function runRecent(entry, ctx, { explicitDir = ctx.explicitWorkspaceDir, typedDir = null } = {}) {
    const log = ctx.log;
    const label = entry.palName || entry.palGuid;

    // 1. Agent — explicit --agent wins, else the remembered one. The prerequisite check runs for
    //    the agent this session will ACTUALLY open, which is why it comes after the "is it still
    //    installed?" replacement below and before the login: the old CLI checked Claude Code before
    //    it knew which agent the user wanted.
    let agent = null;
    if (ctx.agentKey) {
        agent = agents.resolve(ctx.agentKey);
        if (!agent) throw new Error("Unknown agent '" + ctx.agentKey + "'. Use one of: " + agents.AGENTS.map(a => a.key).join(", ") + ".");
    } else if (entry.agent) {
        agent = agents.resolve(entry.agent);
        if (!agent) log("saved agent '" + entry.agent + "' is not a known agent — pick one for this session");
    }
    if (!agent) {
        agent = await pickAgentForSession(ctx);
        if (!agent) { log("cancelled at agent"); return null; }
    }
    if (!ctx.agentKey && entry.agent && !ctx.agentOnPath(agent.command)) {
        // The remembered agent is gone: say so and let the user choose another. Never a silent swap.
        log("⚠ " + agent.label + " ('" + agent.command + "') is not on PATH — that is the agent saved for this Pal.");
        const replacement = await pickAgentForSession(ctx);
        if (!replacement) { log("cancelled at agent"); return null; }
        agent = replacement;
    }
    if (ctx.preflight) await ctx.preflight(agent.key);
    log("agent: " + agent.label);

    // 2. Authenticate with the remembered account (cached keychain credential → no prompts).
    //    A caller that cannot be asked must not reach a password prompt it can never answer: the
    //    cached credential has to be there, or the error names the terminal/headless paths.
    if (!ctx.interactive && !ctx.loginPrompts && !hasCachedCredential(entry)) {
        throw new Error("No cached credential for " + entry.username + " @ " + entry.cloudUrl +
            ", and no interactive prompt is available.\nRe-run palsync in a terminal, or use " +
            "`palsync setup --pal \"<name>\"` with CP_PASS set.");
    }
    const loginResult = await login({ cloudUrl: entry.cloudUrl, username: entry.username, prompts: ctx.loginPrompts });
    if (loginResult === BACK) { log("cancelled at login"); return null; }
    const { session, cloudUrl, username } = loginResult;
    log("logged in: " + session.username + " @ " + cloudUrl + " (userId=" + session.userId + ")");
    if (cloudUrl !== entry.cloudUrl || username !== entry.username) {
        // Never silently substitute another account or cloud for the one this pal was set up
        // with — hand the user to the full list with the session they just established.
        log("signed in as " + username + " @ " + cloudUrl + ", not the account \"" + label +
            "\" was set up with — showing the full pal list instead");
        return { fallback: { cloudUrl, username } };
    }

    // 3. The server still decides whether this pal exists for this account.
    const resolved = await resolveRecentPal(session, entry, ctx);
    if (!resolved) {
        log("\"" + label + "\" is not on " + cloudUrl + " for " + username +
            " anymore — it may have been deleted, or you may no longer have access to it.");
        const forgotten = safe(() => ctx.recent.forget(entry));
        if (forgotten && forgotten.ok && forgotten.removed) log("removed it from the recent-Pal list");
        const recovery = await recentMenu.pickRecovery(
            "That pal could not be opened. Nothing was changed on disk.",
            { allowDir: false, prompt: ctx.pickRecoveryPrompt }
        );
        if (!recovery) { log("cancelled after a missing pal"); return null; }
        return { fallback: { cloudUrl, username } };
    }
    if (entry.palName && resolved.name && entry.palName !== resolved.name) {
        log("this pal is now named \"" + resolved.name + "\" on the server (the local folder keeps its name)");
    }

    // 4. Workspace — the remembered directory, the user's explicit --dir, or the folder they just
    //    chose in the menu.
    const wd = await chooseRecentWorkspace(entry, resolved, ctx, { cloudUrl, username, explicitDir, typedDir });
    if (wd.cancel) return null;
    if (wd.refused) throw new Error(wd.reason);
    if (wd.fallback) return { fallback: { cloudUrl, username } };
    const dir = wd.dir;

    // 5. The one and only setup path: pull + drift guards + lock + resources + inject + register.
    const sel = {
        profile: { profileId: resolved.profileId },
        group: { groupId: resolved.groupId },
        pal: {
            guid: resolved.guid, name: resolved.name, description: resolved.description,
            branch: resolved.branch, lastModifiedDate: resolved.lastModifiedDate
        },
        resolved
    };
    const setupResult = await workspace.setup({ session, cloudUrl, sel, workspaceDir: dir, agent: agent.key, onDrift: ctx.onDrift, log });
    // --dir is a one-session override (README/`palsync --help`): it must not replace the folder
    // this pal is remembered in. A folder the user picked in "Change workspace directory…"
    // (typedDir) IS the new preference and is remembered normally.
    recordLaunch(ctx, { session, cloudUrl, sel, dir, agent: agent.key, setupResult, temporaryDir: Boolean(explicitDir) });

    // 6. Hand the terminal to the agent; the lock stays held (the MCP server owns release).
    let child = null;
    if (ctx.autoLaunch) {
        log("opening " + agent.label + " in " + dir);
        child = agents.launch(agent, { cwd: dir });
    }
    return { result: { workspaceDir: dir, setupResult, agent, child, evalSpec: null } };
}

// History is only written after setup() returned — so a cancelled login, a lock refusal, or an
// aborted drift resolution never counts as a launch. A write failure is reported and ignored:
// losing history must never fail a launch that already succeeded.
//   temporaryDir — the workspace came from --dir, an override for THIS session only: the launch
//   is still recorded (count, time, agent, name), but the remembered folder stays whatever it
//   already was. A pal with no history yet has no preference to protect, so its first launch —
//   --dir or not — establishes one.
function recordLaunch(ctx, { session, cloudUrl, sel, dir, agent, setupResult, temporaryDir = false }) {
    const rec = (setupResult && setupResult.record) || {};
    const resolved = sel.resolved || {};
    let workspaceDir = dir;
    if (temporaryDir) {
        const known = safe(() => ctx.recent.list());
        const prev = Array.isArray(known) && known.find(e =>
            e.palGuid === sel.pal.guid && e.username === session.username && e.cloudUrl === cloudUrl);
        if (prev && prev.workspaceDir) workspaceDir = prev.workspaceDir;
    }
    const result = ctx.recent.record({
        cloudUrl,
        username: session.username,
        userId: session.userId || rec.userId,
        palGuid: sel.pal.guid,
        palName: rec.palName || sel.pal.name,
        palId: rec.palId,
        profileId: rec.profileId || resolved.profileId,
        groupId: resolved.groupId || (sel.group && sel.group.groupId),
        profileName: resolved.profileName,
        groupName: resolved.groupName,
        branch: sel.pal.branch || resolved.branch,
        workspaceDir,
        agent
    });
    if (result && result.ok === false) {
        ctx.log("warning: could not save recent-Pal history (" + result.error + ") — the launch itself is fine");
    }
}

function safe(fn) {
    try { return fn(); } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
}

// The original full wizard, unchanged apart from where it is entered from: history is recorded
// on a successful launch, no explicit --dir skips the directory prompt, and the agent
// prerequisite check runs for the agent that was actually chosen.
//   spec   — eval-harness spec (forced create; never recorded in history)
//   resume — { cloudUrl, username } to fast-forward login when a recent launch handed over
async function runWizard(ctx, spec, resume) {
    const { log, selPrompts, loginPrompts, agentKey, onDrift, autoLaunch } = ctx;

    // 1–2. cloud + login (cached creds skip the prompt)
    let loginResult = await login({ prompts: loginPrompts, ...(resume || {}) });
    if (loginResult === BACK) { log("cancelled at login"); return null; }
    let { session, cloudUrl } = loginResult;
    log("logged in: " + session.username + " @ " + cloudUrl + " (userId=" + session.userId + ")");

    // 3. profile → [open existing | create new]. Backing out of the very first selection
    //    screen (profile) re-enters login at its last step (password) — see selection.js's
    //    "profile" step and credentials.js's resumable entry — so the whole login+selection
    //    flow reads as one continuous back stack instead of two disconnected menus.
    let sel;
    let createdPalGuid = null;
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
        createdPalGuid = created.guid;
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
        agent = await pickAgentForSession(ctx);
        if (!agent) { log("cancelled at agent"); return null; }
    }
    log("agent: " + agent.label);
    // Prerequisites for the agent that was actually chosen: Pi/Codex/OpenCode never trigger a
    // Claude Code install (src/preflight.js), and the hook is optional so callers that do their
    // own preflight (and every headless test) are unaffected.
    if (ctx.preflight) await ctx.preflight(agent.key);

    // 5. workspace dir + setup (pull + lock + inject + .palsync.json + register MCP)
    let dir;
    if (ctx.explicitWorkspaceDir) {
        // --dir is an EXACT workspace path (same meaning as `palsync setup --dir`), not a parent.
        // It does not have to exist yet, but a folder belonging to another pal/cloud, or a
        // non-empty folder with no PalSync workspace in it, is refused rather than written into.
        const normalized = workspacePath.normalizeWorkspaceDir(ctx.explicitWorkspaceDir);
        if (!normalized) throw new Error("--dir requires a directory path");
        log("workspace: " + normalized + " (from --dir)");
        const guarded = await guardTypedDir(ctx, {
            dir: normalized,
            identity: { palGuid: sel.pal.guid, cloudUrl, username: session.username },
            palName: sel.pal.name, branch: sel.pal.branch,
            defaultDir: workspace.defaultWorkspaceDir(sel.pal.name, sel.pal.branch),
            allowRetry: false
        });
        if (guarded.cancel) return null;
        if (guarded.refused) throw new Error(guarded.reason);
        dir = guarded.dir;
    } else {
        dir = await chooseGuardedDir(ctx, {
            defaultDir: workspace.defaultWorkspaceDir(sel.pal.name, sel.pal.branch),
            identity: { palGuid: sel.pal.guid, cloudUrl, username: session.username },
            palName: sel.pal.name, branch: sel.pal.branch
        });
        if (!dir) return null;
    }
    const setupResult = await workspace.setup({ session, cloudUrl, sel, workspaceDir: dir, agent: agent.key, onDrift, log });
    if (!spec) recordLaunch(ctx, { session, cloudUrl, sel, dir, agent: agent.key, setupResult, temporaryDir: Boolean(ctx.explicitWorkspaceDir) });

    // 5b. eval-harness: impact evals first prove and push their fixed baseline under setup's lock,
    //     then atomically inject the exact task arm. Standard eval injection remains unchanged.
    if (spec && spec.kind === "impact") {
        try {
            const taskDocs = ["SPEC.md", "EXECUTION.md"].filter(name => {
                try { fs.lstatSync(path.join(dir, name)); return true; }
                catch (e) { if (e.code === "ENOENT") return false; throw e; }
            });
            if (taskDocs.length) {
                throw new Error("workspace root already contains " + taskDocs.join(" or "));
            }
            await seedImpactBaseline({
                session,
                workspaceDir: dir,
                createdPalGuid,
                setupResult,
                record: setupResult.record,
                spec
            });
            const fillValue = cloudUrl + " (pal: " + sel.pal.name + ")";
            const injectResult = evalSpec.injectImpactSpec(dir, spec, { fillValue });
            log("impact eval seeded and injected: " + injectResult.written.join(", "));
        } catch (e) {
            if (setupResult.locked === true && setupResult.record && setupResult.record.palGuid) {
                try { await lock.releaseByGuid(session, setupResult.record.palGuid); }
                catch (releaseError) { log("impact eval lock release failed: " + releaseError.message); }
            }
            throw new Error("Impact eval setup failed after fresh Pal creation. The partial eval Pal must be discarded manually; no server Pal was deleted. " + e.message);
        }
    } else if (spec) {
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
