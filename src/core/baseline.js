"use strict";
// Baseline CONTENT store: a snapshot of the lintable server-tracked files as they were at the
// last pull/push (i.e. the last time local == server). Lives in <workspace>/.palsync/baseline/.
//
// Used by the pre-push gate to block ONLY on errors a change INTRODUCED — by linting the baseline
// version of a touched file and the current version and comparing. A pal carrying pre-existing
// errors in a file (e.g. a legacy workflow full of object literals) no longer forces the agent to
// rewrite that legacy code just to land an unrelated edit; only NEW errors block. (This snapshot
// is also the foundation a future 3-way merge needs.)
//
// TEXT server-tracked files plus pal.json are stored. The pre-push gate diffs its lintable subset,
// including pal.json; the 3-way merge filters ancestors through isTextTracked, so the manifest
// remains on merge's separate manifest path. Binary folders (images, attachments, documents) are
// skipped — a 3-way TEXT merge can't reconcile bytes, and they bloat the store. The snapshot lives
// under .palsync/, which pull's stale-delete and the workspace hash never touch.
const fs = require("fs");
const path = require("path");
const { walkTree } = require("./fsWalk");

const BASELINE_DIR = path.join(".palsync", "baseline");

// The files the GATE can lint (must match validate/index.js lintContent dispatch). A subset of
// what's snapshotted.
function isLintable(rel) {
    if (rel === "pal.json") return true;
    if (rel.startsWith("workflows/") && rel.endsWith(".js")) return true;
    if ((rel.startsWith("pages/") || rel.startsWith("fragments/")) && /\.(html?|xhtml)$/i.test(rel)) return true;
    if (rel.startsWith("datasets/") && rel.endsWith(".json")) return true;
    return false;
}

// Folders whose files are text and worth a merge ancestor. Images/attachments/documents are
// excluded (binary; merge can't reconcile them). Wizards are XHTML text like pages/fragments.
const TEXT_FOLDERS = ["workflows", "pages", "fragments", "scripts", "styles", "emails",
    "datasets", "dataviews", "data", "datalists", "wizards"];

// Is this a text server-tracked file worth snapshotting (for the gate and/or merge)?
function isTextTracked(rel) {
    const slash = rel.indexOf("/");
    if (slash === -1) return false;
    return TEXT_FOLDERS.indexOf(rel.slice(0, slash)) !== -1;
}

function isSnapshottable(rel) {
    return rel === "pal.json" || isTextTracked(rel);
}

// Snapshot the current (server-equal) text files into the baseline store. Call right after a
// pull or a successful push, when the workspace's server-tracked files match the server.
function snapshot(workspaceDir, serverPaths) {
    const baseAbs = path.join(workspaceDir, BASELINE_DIR);
    fs.rmSync(baseAbs, { recursive: true, force: true });
    // Production serverPaths contains manifest entries, not the manifest file itself.
    const paths = new Set([...(serverPaths || []), "pal.json"]);
    for (const rel of paths) {
        if (!isSnapshottable(rel)) continue;
        const src = path.join(workspaceDir, ...rel.split("/"));
        let content;
        try { content = fs.readFileSync(src); }
        catch (e) { if (e.code === "ENOENT") continue; throw e; }
        const dest = path.join(baseAbs, ...rel.split("/"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content);
    }
}

// Every rel path currently in the baseline store (POSIX). Used by merge to know the ancestor set.
function list(workspaceDir) {
    return walkTree(path.join(workspaceDir, BASELINE_DIR), "").map(f => f.rel);
}

// Baseline content for one file (POSIX rel), or null if not snapshotted.
function read(workspaceDir, rel) {
    try { return fs.readFileSync(path.join(workspaceDir, BASELINE_DIR, ...rel.split("/")), "utf8"); }
    catch (e) { return null; }
}

// Is there a baseline store at all? (false for legacy workspaces created before this feature.)
function exists(workspaceDir) {
    try { return fs.readdirSync(path.join(workspaceDir, BASELINE_DIR)).length > 0; }
    catch (e) { return false; }
}

module.exports = { snapshot, read, exists, list, isLintable, isTextTracked, TEXT_FOLDERS, BASELINE_DIR };
