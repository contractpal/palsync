"use strict";
// Deterministic hashes of the SERVER-TRACKED files in a pal workspace. Used as the baseline
// at pull/push time so palsync can detect un-pushed local changes (the reverse drift guard).
//
// SCOPE — the 14 manifest folders + pal.json. Exactly the files pull manages; user-only files
// at the workspace root (spec.md, references/, notes/) do NOT enter any hash, so editing or
// adding them never triggers the drift guard.
//
// Two granularities:
//   - hashWorkspace(dir)      → one combined sha256 (legacy .palsync.json `localHash`).
//   - hashWorkspaceFiles(dir) → { combined, files: { "<posix-rel>": sha256 } } — the per-file
//     map (`fileHashes`) that lets drift be reported BY FILE and lets pull distinguish a new
//     local file (preserve) from a server-side delete (remove).
// All rel paths are POSIX-style ("/") so keys match core/pull's manifestPaths on every OS.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { walkTree } = require("./fsWalk");

const IN_SCOPE = [
    "data", "datalists", "datasets", "dataviews",
    "attachments", "documents", "emails", "fragments",
    "images", "pages", "scripts", "styles", "workflows", "wizards"
];
const MANIFEST_FILE = "pal.json";

function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

// One walk used by both granularities. Returns [{ rel (posix), abs }] sorted by rel.
function listScopedFiles(dir) {
    const files = [];
    for (const folder of IN_SCOPE) walkTree(path.join(dir, folder), folder, files);
    const manifestAbs = path.join(dir, MANIFEST_FILE);
    if (fs.existsSync(manifestAbs)) files.push({ rel: MANIFEST_FILE, abs: manifestAbs });
    files.sort((a, b) => a.rel.localeCompare(b.rel));
    return files;
}

function hashWorkspace(dir) {
    const h = crypto.createHash("sha256");
    for (const f of listScopedFiles(dir)) {
        h.update(f.rel); h.update("\0");
        h.update(fs.readFileSync(f.abs)); h.update("\0");
    }
    return h.digest("hex");
}

// Per-file map + the combined hash from the same walk (combined === hashWorkspace(dir)).
function hashWorkspaceFiles(dir) {
    const files = {};
    const h = crypto.createHash("sha256");
    for (const f of listScopedFiles(dir)) {
        const content = fs.readFileSync(f.abs);
        files[f.rel] = sha256(content);
        h.update(f.rel); h.update("\0");
        h.update(content); h.update("\0");
    }
    return { combined: h.digest("hex"), files };
}

// Hash a specific set of files (POSIX rel paths) — used to build the SERVER-TRACKED baseline
// right after a pull/push, when the caller knows exactly which files the server owns
// (pull/push's serverPaths + pal.json). Missing files are skipped.
function hashPaths(dir, relPaths) {
    const out = {};
    const all = new Set(relPaths);
    all.add(MANIFEST_FILE);
    for (const rel of [...all].sort()) {
        const abs = path.join(dir, ...rel.split("/"));
        try { out[rel] = sha256(fs.readFileSync(abs)); }
        catch (e) { if (e.code !== "ENOENT") throw e; /* not on disk — skip */ }
    }
    return out;
}

module.exports = { hashWorkspace, hashWorkspaceFiles, hashPaths, IN_SCOPE, MANIFEST_FILE };
