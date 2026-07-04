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
const { pull } = require("../core/pull");
const { push } = require("../core/push");
const lock = require("../core/lock");
const contextInject = require("./contextInject");
const palsyncfile = require("../core/palsyncfile");
const { register } = require("../mcp/register");
const { registerCodex } = require("../mcp/registerCodex");
const { registerOpencode } = require("../mcp/registerOpencode");
const { hashWorkspace, hashPaths } = require("../core/workspaceHash");
const { diffWorkspace, describeDiff } = require("../core/localDrift");
const { mergeWorkspace } = require("../core/merge");

function slug(name) {
    return String(name).trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "pal";
}

function defaultWorkspaceDir(palName) {
    return path.join(os.homedir(), "PalBuilder", slug(palName));
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

// Run the full setup. Returns a summary. Throws if the pal is locked by another user.
//   agent ("claude" default | "codex") picks the injection destinations and MCP registration path.
//   onDrift (injectable; launcher/index.js provides the interactive UI) decides what to do with
//   un-pushed local changes. Headless callers that omit it get a refusal throw, never a wipe.
async function setup({ session, cloudUrl, sel, workspaceDir, agent = "claude", onDrift, log = () => {} }) {

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
    if (mode === "pull") {
        log("pulling " + sel.pal.name + " → " + workspaceDir);
        const res = await pull(session, sel.pal.guid, workspaceDir, { baseline: (existing && existing.fileHashes) || null });
        written = res.written; removed = res.removed; preserved = res.preserved;
        if (removed.length) log("  sync removed " + removed.length + " file(s) deleted on server");
        for (const p of preserved) log("  preserved local work: " + p.rel + (p.merged ? "" : " — " + p.note));

        // .palsync.json (drift marker = pulled lastModifiedDate; localHash + per-file baseline)
        record = palsyncfile.buildRecord({
            cloudUrl, userId: session.userId, username: session.username,
            pal: { guid: sel.pal.guid, name: sel.pal.name, lastModifiedDate: res.resolved.lastModifiedDate },
            workspaceDir
        });
        record.localHash = hashWorkspace(workspaceDir);
        record.fileHashes = hashPaths(workspaceDir, res.serverPaths);
        record.pulledAt = new Date().toISOString();
    } else {
        // skip: the user chose to keep local state. Keep the existing record untouched (its
        // marker still guards the next push; its baseline still names the local changes).
        log("skipping pull — keeping local workspace state as-is");
        record = existing;
    }

    // auto-lock (own Webstart-lock reclaim is automatic; setup never force-overrides a PalBuilder lock)
    log("locking pal");
    const lk = await lock.acquireByGuid(session, sel.pal.guid, { force: false });
    if (!lk.acquired) {
        if (lk.blocked === "gui-lock-self") {
            throw new Error("This pal is locked — you have \"" + sel.pal.name + "\" checked out in PalBuilder (since " + lk.since + "). Unlock and close it in PalBuilder, then re-run palsync.");
        }
        if (lk.blocked === "gui-lock-other") {
            throw new Error("This pal is locked by " + lk.holder + " (since " + lk.since + ") — cannot start a session. Unlock and close it in PalBuilder.");
        }
        throw new Error("Could not lock \"" + sel.pal.name + "\" (" + (lk.blocked || "unknown") + "). Unlock and close it in PalBuilder, then re-run palsync.");
    }

    // CLAUDE.md is not wiped by pull (sync only touches files inside the 13 manifest folders
    // + pal.json) — inject() reads the user's existing CLAUDE.md and merges its managed block
    // in place.
    log("injecting CLAUDE.md + skills" +
        (agent === "codex" ? " + AGENTS.md/.agents (Codex)" : agent === "pi" ? " + AGENTS.md/.agents (Pi)" :
         agent === "opencode" ? " + AGENTS.md/.agents (OpenCode)" : ""));
    const injected = await contextInject.inject(workspaceDir, { palName: sel.pal.name, agent });

    await palsyncfile.write(workspaceDir, record);

    // register the MCP server for the chosen agent.
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
        // Pi has no MCP — it drives palsync through the headless CLI (palsync push|pull|status|…),
        // which AGENTS.md tells it to use. Nothing to register.
        log("Pi uses the palsync CLI (no MCP server) — AGENTS.md carries the sync instructions");
    } else if (agent === "opencode") {
        log("registering palsync MCP server with OpenCode (opencode.json)");
        reg = await registerOpencode(workspaceDir);
    } else {
        log("registering palsync MCP server (.mcp.json)");
        reg = await register(workspaceDir);
    }

    return {
        workspaceDir,
        pulled: mode === "pull",
        pulledFiles: written.base64.length,
        dataFiles: written.json.length,
        removed,
        preserved,
        locked: lk.acquired,
        lockHolder: lk.holder,
        injected,
        agent,
        mcpConfig: reg.filePath || null,   // .mcp.json path (Claude) or null (Codex uses its own config)
        mcpRegistration: reg,
        record
    };
}

module.exports = { setup, defaultWorkspaceDir, slug, resolveLocalDrift };
