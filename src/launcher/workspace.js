"use strict";
// Workspace setup: pull the pal to disk, auto-lock it, inject context (preserving a pre-existing
// user CLAUDE.md across the pull), write .palsync.json, and register the MCP server. After this
// the directory is a ready Claude Code workspace. The lock is left HELD — the MCP server (booted
// by Claude Code) owns its lifecycle/release; the launcher does not release on exit.
//
// DATA-LOSS GUARD (the launcher-side reverse drift guard): if the workspace holds un-pushed
// local edits to server-tracked files (e.g. the MCP server died before a push), the setup pull
// must NOT silently overwrite them. Before pulling we diff the workspace against the baseline
// recorded at the last pull/push (.palsync.json fileHashes / localHash) and, on drift, route
// the decision through the injectable onDrift prompt: push first / overwrite / skip / abort.
// NEW local files never trigger the guard — pull-as-sync preserves them (see core/pull).
const path = require("path");
const os = require("os");
const fsSync = require("fs");
const fsp = require("fs/promises");
const { pull } = require("../core/pull");
const { push } = require("../core/push");
const lock = require("../core/lock");
const { fetchAndExtract } = require("../core/resources");
const contextInject = require("./contextInject");
const palsyncfile = require("../core/palsyncfile");
const { register } = require("../mcp/register");
const { registerCodex } = require("../mcp/registerCodex");
const { registerOpencode } = require("../mcp/registerOpencode");
const registerPi = require("../mcp/registerPi");
const { registerGemini } = require("../mcp/registerGemini");
const { registerCursor } = require("../mcp/registerCursor");
const { registerCopilot } = require("../mcp/registerCopilot");
const { hashWorkspace, hashPaths } = require("../core/workspaceHash");
const { diffWorkspace, describeDiff } = require("../core/localDrift");
const { mergeWorkspace } = require("../core/merge");

function slug(name) {
    return String(name).trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "pal";
}

// branch is read-only display metadata from the pal list (never written back anywhere) — it
// only affects the local folder name so two branches of the same pal don't collide on disk.
// baseDir overrides the default `~/PalBuilder` parent (e.g. the GUI's own configurable default
// pal folder location) — optional, so the CLI (which never passes it) is unaffected.
function defaultWorkspaceDir(palName, branch, baseDir) {
    const dirName = branch ? slug(palName) + " (" + slug(branch) + ")" : slug(palName);
    return path.join(baseDir || path.join(os.homedir(), "PalBuilder"), dirName);
}

// Resolve un-pushed local changes before the setup pull. Loops the injectable onDrift prompt
// until an action lands. Returns "pull" (proceed) or "skip" (keep local state, no pull).
// Throws on abort or when no prompt is available (headless safety: never silently overwrite).
async function resolveLocalDrift({ session, existing, workspaceDir, palName, diff, onDrift, log }) {
    if (!onDrift) {
        throw new Error(
            "Workspace " + workspaceDir + " has un-pushed local changes:\n" + describeDiff(diff) +
            "\nRefusing to overwrite them in a non-interactive setup. Push or discard the changes, then re-run."
        );
    }
    let info = { phase: "initial", diff, palName, workspaceDir };
    while (true) {
        const action = await onDrift(info);
        if (!action || action === "abort") {
            throw new Error("Cancelled — un-pushed local changes left untouched in " + workspaceDir + ".");
        }
        if (action === "skip") return "skip";
        if (action === "overwrite") return "pull";
        if (action === "merge") {
            // 3-way merge incorporates the server's changes into the workspace, keeping local
            // edits where they don't collide. After it, the workspace already holds the server
            // state — so setup must NOT pull again (that would re-overwrite the merge); return
            // "skip" with the record's marker/baseline already advanced by mergeWorkspace.
            log("merging local changes with the server (3-way)…");
            const mr = await mergeWorkspace(session, existing.palGuid, existing, workspaceDir);
            if (!mr.merged) {
                log("merge could not run (" + mr.reason + ") — choose another option");
                info = { phase: "initial", diff, palName, workspaceDir };
                continue;
            }
            existing.localHash = hashWorkspace(workspaceDir);
            if (mr.serverPaths) existing.fileHashes = hashPaths(workspaceDir, mr.serverPaths);
            await palsyncfile.write(workspaceDir, existing);
            if (mr.conflicts.length) {
                log("merged with " + mr.conflicts.length + " conflict(s) to resolve: " +
                    mr.conflicts.map(c => c.rel).join(", ") + " (compare each against its .server file, then push)");
            } else {
                log("merged cleanly — local + server changes combined");
            }
            return "skip"; // workspace already reconciled; do not pull over it
        }
        if (action === "push" || action === "force-push") {
            log(action === "force-push" ? "force-pushing local changes (past server drift)…" : "pushing local changes first…");
            const pr = await push(session, existing, workspaceDir, { force: action === "force-push" });
            if (pr.pushed) {
                // Server now matches disk — refresh the baseline so the pull that follows sees a
                // clean workspace (and preserves any remaining new-but-uncreatable local files).
                existing.localHash = hashWorkspace(workspaceDir);
                if (pr.serverPaths) existing.fileHashes = hashPaths(workspaceDir, pr.serverPaths);
                await palsyncfile.write(workspaceDir, existing);
                log("local changes pushed (" + pr.filesPushed + " files) — safe to pull");
                return "pull";
            }
            // Push refused (server drifted too, or a lock) — surface it and re-prompt.
            info = { phase: "push-refused", refusal: pr, diff, palName, workspaceDir };
            continue;
        }
        throw new Error("Unknown drift action: " + action);
    }
}

// The five steps a checklist-style caller (the GUI's checkout wizards) would want to show, in
// the order setup() actually performs them. Purely descriptive — setup() itself doesn't consume
// this list, it just calls onStep with one of these ids at each boundary.
const STEPS = ["pull", "lock", "resources", "inject", "register"];

// Run the full setup. Returns a summary. Throws if the pal is locked by another user.
//   agent ("claude" default | "codex") picks the injection destinations and MCP registration path.
//   onDrift (injectable; launcher/index.js provides the interactive UI) decides what to do with
//   un-pushed local changes. Headless callers that omit it get a refusal throw, never a wipe.
//   onStep (injectable; optional) — fires { step, status: "start"|"done", ...detail } at each of
//   the STEPS boundaries above, purely additive alongside the existing free-text `log` (which
//   every caller, including the CLI, already consumes as plain strings — onStep never changes
//   what log() receives or how many times it's called). Built for the GUI's checkout-progress
//   checklist; CLI/launcher callers simply never pass it, so their output is unaffected.
//   forceLock (optional, default false) — human-confirmed-only escape hatch for a stuck lock (see
//   src/core/lock.js's allowOverride). CLI/launcher never pass this; only the GUI does, and only
//   after a human has explicitly checked "Force Lock" having already seen who holds it.
async function setup({ session, cloudUrl, sel, workspaceDir, agent = "claude", onDrift, log = () => {}, onStep = () => {}, forceLock = false }) {
    // Captured before anything touches disk: if this is a brand-new checkout (this directory
    // didn't exist yet) and setup fails partway through — most commonly a lock conflict, found
    // testing the GUI's checkout flow (David, 2026-09-10): canceling out of a locked-pal error
    // left the freshly-pulled folder sitting on disk, so the next attempt collided with it and
    // suggested "folder (2)" — the failure should leave no trace at all. A folder that already
    // existed before this call (re-opening a pal that's already set up) is never touched here,
    // even on failure, no matter how it fails.
    const dirExistedBefore = fsSync.existsSync(workspaceDir);

    try {

    // Collision guard. The default workspace path is ~/PalBuilder/<slug(palName)>/ — stable per
    // pal name. If a different pal already lives in this dir (.palsync.json present with a
    // different palGuid), refuse rather than mix two pals' state into one workspace.
    let existing = null;
    try {
        existing = await palsyncfile.read(workspaceDir);
        if (existing && existing.palGuid && existing.palGuid !== sel.pal.guid) {
            throw new Error(
                "Workspace " + workspaceDir + " already belongs to a different pal: \"" +
                existing.palName + "\" (" + existing.palGuid + ") on " + existing.cloudUrl + ".\n" +
                "Choose a different workspace directory, or remove that workspace if you no longer need it."
            );
        }
    } catch (e) { if (e.code !== "ENOENT") throw e; /* no .palsync.json = fresh workspace, fine */ }

    // Reverse drift guard BEFORE the pull (same pal only — `existing` is this pal's record).
    let mode = "pull";
    if (existing) {
        const diff = diffWorkspace(existing, workspaceDir);
        if (diff.dirty) {
            log("un-pushed local changes detected in " + workspaceDir);
            mode = await resolveLocalDrift({ session, existing, workspaceDir, palName: sel.pal.name, diff, onDrift, log });
        }
    }

    let record, written = { base64: [], json: [] }, removed = [], preserved = [];
    onStep({ step: "pull", status: "start" });
    if (mode === "pull") {
        log("pulling " + sel.pal.name + " → " + workspaceDir);
        const res = await pull(session, sel.pal.guid, workspaceDir, { baseline: (existing && existing.fileHashes) || null });
        written = res.written; removed = res.removed; preserved = res.preserved;
        if (removed.length) log("  sync removed " + removed.length + " file(s) deleted on server");
        for (const p of preserved) log("  preserved local work: " + p.rel + (p.merged ? "" : " — " + p.note));

        // .palsync.json (drift marker = pulled lastModifiedDate; localHash + per-file baseline)
        record = palsyncfile.buildRecord({
            cloudUrl, userId: session.userId, username: session.username,
            pal: { guid: sel.pal.guid, name: sel.pal.name, lastModifiedDate: res.resolved.lastModifiedDate,
                   id: res.resolved.id, profileId: res.resolved.profileId },
            workspaceDir
        });
        record.localHash = hashWorkspace(workspaceDir);
        record.fileHashes = hashPaths(workspaceDir, res.serverPaths);
        record.pulledAt = new Date().toISOString();
        onStep({ step: "pull", status: "done", filesPulled: written.base64.length + written.json.length, removed: removed.length });
    } else {
        // skip: the user chose to keep local state. Keep the existing record untouched (its
        // marker still guards the next push; its baseline still names the local changes).
        log("skipping pull — keeping local workspace state as-is");
        record = existing;
        onStep({ step: "pull", status: "done", skipped: true });
    }

    // auto-lock (own Webstart-lock reclaim is automatic; forceLock is the GUI-only human-confirmed
    // escape hatch above — CLI/launcher never set it, so they never force-override a PalBuilder lock)
    log("locking pal");
    onStep({ step: "lock", status: "start" });
    const lk = await lock.acquireByGuid(session, sel.pal.guid, { force: forceLock, allowOverride: forceLock });
    if (!lk.acquired) {
        onStep({ step: "lock", status: "error" });
        let message;
        if (lk.blocked === "gui-lock-self") {
            message = "This pal is locked — you have \"" + sel.pal.name + "\" checked out in PalBuilder (since " + lk.since + "). Unlock and close it in PalBuilder, then re-run palsync.";
        } else if (lk.blocked === "gui-lock-other") {
            message = "This pal is locked by " + lk.holder + " (since " + lk.since + ") — cannot start a session. Unlock and close it in PalBuilder.";
        } else {
            message = "Could not lock \"" + sel.pal.name + "\" (" + (lk.blocked || "unknown") + "). Unlock and close it in PalBuilder, then re-run palsync.";
        }
        const err = new Error(message);
        // Structured, additive — CLI/launcher callers only ever read err.message (unchanged
        // above); the GUI reads this to offer its "Force Lock" checkbox without string-parsing.
        if (lk.blocked === "gui-lock-self" || lk.blocked === "gui-lock-other") {
            err.lockBlocked = { blocked: lk.blocked, holder: lk.holder, holderEmail: lk.holderEmail, since: lk.since };
        }
        throw err;
    }
    onStep({ step: "lock", status: "done" });

    // Fetch the pal's chain (module dependencies, resource pals, CloudPiston Resource, etc.) into
    // .resources/ so the agent has the full in-scope code available from the start of the session,
    // not just on request. Best-effort: most pals have a chain, but a pal with none, or a transient
    // failure, must never block session setup.
    log("fetching pal chain (.resources/)");
    onStep({ step: "resources", status: "start" });
    let resources;
    try {
        resources = await fetchAndExtract(session, lk.resolved, workspaceDir);
        if (resources.ok) log("  extracted " + resources.entries.length + " chain resource(s): " + resources.entries.map(e => e.slug).join(", "));
        else log("  chain fetch skipped: " + resources.reason);
    } catch (e) {
        resources = { ok: false, reason: e && e.message ? e.message : String(e) };
        log("  chain fetch failed (non-fatal): " + resources.reason);
    }
    onStep({ step: "resources", status: "done", ok: !!resources.ok, count: resources.entries ? resources.entries.length : 0 });

    // CLAUDE.md is not wiped by pull (sync only touches files inside the 14 manifest folders
    // + pal.json) — inject() reads the user's existing CLAUDE.md and merges its managed block
    // in place.
    log("injecting CLAUDE.md + skills" +
        (agent === "codex" ? " + AGENTS.md/.agents (Codex)" : agent === "pi" ? " + AGENTS.md/.agents (Pi)" :
         agent === "opencode" ? " + AGENTS.md/.agents (OpenCode)" : ""));
    // KNOWN GAP: Gemini CLI/Cursor/Copilot fall through to the Claude-only CLAUDE.md branch below
    // (contextInject.inject only special-cases codex/pi/opencode for AGENTS.md/.agents) — those
    // three agents don't read CLAUDE.md natively (Cursor/Copilot read AGENTS.md; Gemini CLI reads
    // its own GEMINI.md), so they currently get MCP tools registered but no injected context doc.
    // Tracked in gui/BACKLOG.md; MCP registration below is unaffected either way.
    onStep({ step: "inject", status: "start" });
    const injected = await contextInject.inject(workspaceDir, {
        palName: sel.pal.name, agent, policy: require("../core/policy").resolve()
    });
    if (injected.hookSettings && injected.hookSettings.skipped) {
        log("  Claude hook settings skipped: " + injected.hookSettings.error + ". " + injected.hookSettings.manualRemediation);
    }
    onStep({ step: "inject", status: "done" });

    // Persist the id this session actually just locked with — freshest available, and what
    // every later session in this pal folder will try first (see core/lock.js's self-heal).
    record.palId = lk.resolved.id;
    if (lk.resolved.profileId) record.profileId = lk.resolved.profileId;
    await palsyncfile.write(workspaceDir, record);

    // register the MCP server for the chosen agent.
    onStep({ step: "register", status: "start" });
    let reg = {};
    if (agent === "codex") {
        log("registering palsync MCP server with Codex (codex mcp add)");
        reg = await registerCodex(workspaceDir);
        if (reg.ok) {
            log("  registered with Codex" + (reg.refreshed ? " (refreshed)" : ""));
            // The Codex MCP entry is GLOBAL (~/.codex/config.toml) — one shared `palsync` server
            // whose PALSYNC_WORKSPACE is whatever was registered last. Make the current target loud.
            log("  Codex MCP 'palsync' now targets: " + workspaceDir + "  (" + sel.pal.name + ")");
        } else if (reg.reason === "codex-not-found") {
            log("  ⚠ Codex CLI not found — register the MCP server manually once Codex is installed:\n      " + reg.command);
        } else {
            log("  ⚠ `codex mcp add` failed (" + (reg.stderr || "unknown") + ") — register manually:\n      " + reg.command);
        }
    } else if (agent === "pi") {
        log("installing native PalSync Pi extension (no project file written)");
        reg = await registerPi.register({ installExtension: true });
        log(reg.written ? "  installed native Pi extension" : "  native Pi extension already current");
        if (reg.collisionGuidance) log("  ⚠ " + reg.collisionGuidance);
    } else if (agent === "opencode") {
        log("registering palsync MCP server with OpenCode (opencode.json)");
        reg = await registerOpencode(workspaceDir);
    } else if (agent === "gemini") {
        log("registering palsync MCP server with Gemini CLI (.gemini/settings.json)");
        reg = await registerGemini(workspaceDir);
    } else if (agent === "cursor") {
        log("registering palsync MCP server with Cursor (.cursor/mcp.json)");
        reg = await registerCursor(workspaceDir);
    } else if (agent === "copilot") {
        log("registering palsync MCP server with GitHub Copilot CLI (.mcp.json)");
        reg = await registerCopilot(workspaceDir);
    } else {
        log("registering palsync MCP server (.mcp.json)");
        reg = await register(workspaceDir);
    }
    onStep({ step: "register", status: "done", ok: reg.error ? false : true });

    return {
        workspaceDir,
        pulled: mode === "pull",
        pulledFiles: written.base64.length,
        dataFiles: written.json.length,
        removed,
        preserved,
        locked: lk.acquired,
        lockHolder: lk.holder,
        resources,
        injected,
        agent,
        mcpConfig: reg.filePath || null,   // .mcp.json path (Claude) or null (Codex uses its own config)
        mcpRegistration: reg,
        record
    };
    } catch (e) {
        if (!dirExistedBefore) {
            try { await fsp.rm(workspaceDir, { recursive: true, force: true }); }
            catch (cleanupErr) { /* best-effort — the original error still surfaces either way */ }
        }
        throw e;
    }
}

module.exports = { setup, defaultWorkspaceDir, slug, resolveLocalDrift, STEPS };
