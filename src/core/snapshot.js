"use strict";
// Point-in-time copy of the server-tracked files in a workspace (same scope the drift hashes
// use: the manifest folders + pal.json). Taken before a pull that can't prove it won't overwrite
// un-pushed work — a record with no per-file baseline can't say what differs, so the copy is the
// only way anything can be diffed afterwards. Lives in <workspace>/.palsync/snapshots/, outside
// every hash and outside pull's stale-delete.
const fs = require("fs");
const path = require("path");
const { listScopedFiles } = require("./workspaceHash");

const SNAPSHOT_DIR = path.join(".palsync", "snapshots");

// Copy every in-scope file to .palsync/snapshots/<label>-<timestamp>/ (same relative layout).
// Returns { dir (workspace-relative), abs, files }.
function snapshotWorkspace(workspaceDir, label = "snapshot") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rel = path.join(SNAPSHOT_DIR, label + "-" + stamp);
    const abs = path.join(workspaceDir, rel);
    const files = listScopedFiles(workspaceDir);
    for (const f of files) {
        const dest = path.join(abs, ...f.rel.split("/"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(f.abs, dest);
    }
    return { dir: rel.split(path.sep).join("/"), abs, files: files.length };
}

module.exports = { snapshotWorkspace, SNAPSHOT_DIR };
