"use strict";
// pal_merge — 3-way file-level merge for the both-sides-changed case.
//
// When you have un-pushed LOCAL edits AND the server has advanced (a teammate, or your other
// session, saved since your last pull), the blunt choices are lossy: force-push buries their
// save, overwrite-pull buries yours. A 3-way merge keeps both wherever they don't collide:
//
//   O = ANCESTOR  (the baseline content store — state at your last pull/push)
//   A = MINE      (your working files on disk)
//   B = THEIRS    (the current server state)
//
//   server-only change (A==O, B!=O)  → take theirs (you weren't touching that file)
//   local-only change  (A!=O, B==O)  → keep yours  (they weren't touching it)
//   same change        (A==B)        → already agree
//   CONFLICT           (A!=O, B!=O, A!=B) → keep YOURS untouched, write <file>.server with
//                                            theirs, and report it for a human to reconcile
//
// Non-destructive by construction: a conflict never overwrites your file, and their version is
// always preserved alongside as `.server`. Adds/deletes are handled the same way (see classify).
//
// classifyFile(a,o,b) is pure and unit-tested; mergeWorkspace orchestrates (pulls THEIRS into a
// temp dir, applies the plan to the workspace, refreshes the baseline + drift marker).
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { pull, listTrackedFiles, mergePreservedEntries, CREATABLE_FOLDERS } = require("./pull");
const baseline = require("./baseline");
const { resolveServerPalByGuid } = require("./resolve");
const { buildPersistedObject, serializeManifest } = require("./manifestPersist");
const { writeIfChanged } = require("./atomicWrite");

// Pure 3-way classification for ONE file, given its content (string) or null (absent) in each of
// the three versions. Returns { action, reason } where action is one of:
//   "noop"        already consistent — nothing to do
//   "takeServer"  write THEIRS to disk (server-only change, or server-added)
//   "deleteLocal" remove the local file (server deleted a file you didn't touch)
//   "keepLocal"   leave YOURS as-is (local-only change / local-add / you deleted it and they didn't)
//   "conflict"    both changed/added differently, or modify-vs-delete — keep yours, surface theirs
function classifyFile(a, o, b) {
    const hasA = a != null, hasO = o != null, hasB = b != null;

    // present in the ancestor → it's a modify/delete situation
    if (hasO) {
        const aSame = hasA && a === o;   // I didn't change it (and didn't delete it)
        const bSame = hasB && b === o;   // they didn't change it (and didn't delete it)

        if (!hasA && !hasB) return { action: "noop", reason: "both deleted it" };
        if (!hasA) {
            // I deleted it locally
            if (bSame) return { action: "deleteLocal", reason: "you deleted it; the server did not change it — honoring your delete" };
            return { action: "conflict", reason: "you DELETED this file but the server CHANGED it — kept it deleted locally; theirs is in <file>.server (restore it if their change matters)" };
        }
        if (!hasB) {
            // they deleted it on the server
            if (aSame) return { action: "deleteLocal", reason: "the server deleted it and you didn't change it — removing it locally too" };
            return { action: "conflict", reason: "the server DELETED this file but you CHANGED it — kept YOUR version; push it to re-create the file, or delete it to accept the removal" };
        }
        if (aSame && bSame) return { action: "noop", reason: "unchanged on both sides" };
        if (aSame) return { action: "takeServer", reason: "server-only change — taking theirs" };
        if (bSame) return { action: "keepLocal", reason: "local-only change — keeping yours" };
        if (a === b) return { action: "noop", reason: "you and the server made the same change" };
        return { action: "conflict", reason: "both you and the server changed this file differently — kept YOURS; theirs is in <file>.server" };
    }

    // NOT in the ancestor → an add situation
    if (hasA && hasB) {
        if (a === b) return { action: "noop", reason: "both added the same content" };
        return { action: "conflict", reason: "you and the server both ADDED this file with different content — kept YOURS; theirs is in <file>.server" };
    }
    if (hasA) return { action: "keepLocal", reason: "you added this file — keeping it (push will ship it)" };
    if (hasB) return { action: "takeServer", reason: "the server added this file — taking it" };
    return { action: "noop", reason: "absent everywhere" };
}

function readFileOrNull(abs) {
    try { return fs.readFileSync(abs, "utf8"); } catch (e) { return null; }
}

// Orchestrate the merge. Returns a structured result; never throws on a normal outcome.
//   record.fileHashes/localHash and the baseline content store must exist (a prior pull/push).
async function mergeWorkspace(session, guid, record, workspaceDir) {
    if (!baseline.exists(workspaceDir)) {
        return { merged: false, reason: "No merge ancestor is stored for this workspace yet (it predates the baseline store, or was never pulled here). Run pal_pull once to establish the ancestor; after that, a future both-sides-changed case can be 3-way merged." };
    }

    // THEIRS: pull the current server state into a scratch dir so we never disturb the workspace
    // until the plan is computed.
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "palsync-merge-"));
    let serverPaths, resolved, oldLocalPalJson;
    try {
        oldLocalPalJson = JSON.parse(readFileOrNull(path.join(workspaceDir, "pal.json")) || "null");
        const res = await pull(session, guid, tmp, { baseline: null });
        serverPaths = res.serverPaths;
        resolved = res.resolved;

        // The universe of text files to reconcile = union of (theirs ∩ text) ∪ (ancestor) ∪
        // (mine ∩ text). pal.json is handled separately (manifest, not a text merge).
        const isText = (rel) => baseline.isTextTracked(rel);
        const localTracked = (await listTrackedFiles(workspaceDir)).filter(isText);
        const serverText = (serverPaths || []).filter(isText);
        const ancestor = baseline.list(workspaceDir).filter(isText);
        const all = new Set([].concat(localTracked, serverText, ancestor));

        const plan = { takeServer: [], deleteLocal: [], keepLocal: [], conflicts: [], noop: [] };
        for (const rel of [...all].sort()) {
            const a = readFileOrNull(path.join(workspaceDir, ...rel.split("/")));
            const o = baseline.read(workspaceDir, rel);
            const b = readFileOrNull(path.join(tmp, ...rel.split("/")));
            const c = classifyFile(a, o, b);
            if (c.action === "takeServer") plan.takeServer.push({ rel, reason: c.reason, content: b });
            else if (c.action === "deleteLocal") plan.deleteLocal.push({ rel, reason: c.reason });
            else if (c.action === "keepLocal") plan.keepLocal.push({ rel, reason: c.reason });
            else if (c.action === "conflict") plan.conflicts.push({ rel, reason: c.reason, serverContent: b });
            else plan.noop.push(rel);
        }

        // APPLY (workspace mutations happen here, after the full plan is known).
        for (const f of plan.takeServer) {
            const dest = path.join(workspaceDir, ...f.rel.split("/"));
            await fsp.mkdir(path.dirname(dest), { recursive: true });
            await fsp.writeFile(dest, f.content, "utf8");
        }
        for (const f of plan.deleteLocal) {
            try { await fsp.unlink(path.join(workspaceDir, ...f.rel.split("/"))); } catch (e) { /* already gone */ }
        }
        for (const f of plan.conflicts) {
            // keep YOURS untouched; drop theirs alongside as <file>.server (only when it exists).
            if (f.serverContent != null) {
                const dest = path.join(workspaceDir, ...f.rel.split("/")) + ".server";
                await fsp.mkdir(path.dirname(dest), { recursive: true });
                await fsp.writeFile(dest, f.serverContent, "utf8");
            }
        }

        // pal.json: take THEIRS (the server manifest) through the same persistence contract as
        // pull — omit runtime keys, preserve empty shape/key order, trailing newline, write-if-changed.
        const serverPalJson = JSON.parse(readFileOrNull(path.join(tmp, "pal.json")) || "null");
        if (serverPalJson) {
            const serverSet = new Set(serverPaths);
            const keepRels = [].concat(plan.keepLocal.map(f => f.rel), plan.conflicts.map(f => f.rel))
                .filter(rel => !serverSet.has(rel));
            mergePreservedEntries(serverPalJson, oldLocalPalJson, keepRels);
            const plain = buildPersistedObject(serverPalJson, oldLocalPalJson);
            const content = serializeManifest(plain, oldLocalPalJson);
            await writeIfChanged(path.join(workspaceDir, "pal.json"), content);
        }

        // The workspace has now incorporated THEIRS. The new ancestor is the server state, and the
        // drift marker advances to the server's marker (so a follow-up push isn't drift-blocked).
        record.lastModifiedDate = resolved.lastModifiedDate;
        baseline.snapshot(workspaceDir, serverPaths);

        return {
            merged: true,
            marker: resolved.lastModifiedDate,
            tookServer: plan.takeServer.map(f => f.rel),
            keptLocal: plan.keepLocal.map(f => f.rel),
            deletedLocal: plan.deleteLocal.map(f => f.rel),
            conflicts: plan.conflicts.map(f => ({ rel: f.rel, reason: f.reason, serverFile: f.serverContent != null ? f.rel + ".server" : null })),
            serverPaths
        };
    } finally {
        await fsp.rm(tmp, { recursive: true, force: true });
    }
}

// Dumb-model-grade report.
function formatMerge(res) {
    if (!res.merged) return "Merge did not run: " + res.reason;
    const lines = [];
    const auto = res.tookServer.length + res.keptLocal.length + res.deletedLocal.length;
    if (res.conflicts.length === 0) {
        lines.push("MERGE COMPLETE — " + auto + " file(s) reconciled automatically, 0 conflicts. Your local changes and the server's changes were combined cleanly.");
    } else {
        lines.push("MERGE DONE WITH CONFLICTS — " + auto + " file(s) merged automatically, but " + res.conflicts.length + " file(s) changed on BOTH sides and need you to decide.");
    }
    if (res.tookServer.length) lines.push("Took the server's version (you weren't editing these): " + res.tookServer.join(", "));
    if (res.keptLocal.length) lines.push("Kept your version (the server wasn't editing these): " + res.keptLocal.join(", "));
    if (res.deletedLocal.length) lines.push("Removed locally (deleted on the server): " + res.deletedLocal.join(", "));
    for (const c of res.conflicts) {
        lines.push("CONFLICT: " + c.rel + " — " + c.reason +
            (c.serverFile ? ". Compare your " + c.rel + " against " + c.serverFile + ", combine them by hand, delete the .server file, then pal_push." : "."));
    }
    if (res.conflicts.length === 0) lines.push("Next: review, then pal_push to send your combined changes (the server's changes are already incorporated, so the push won't be drift-blocked).");
    else lines.push("Next: resolve each CONFLICT above (edit your file, delete the matching .server file), then pal_push.");
    return lines.join("\n");
}

module.exports = { classifyFile, mergeWorkspace, formatMerge };
