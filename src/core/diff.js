"use strict";
// pal_diff core: compare the workspace's server-tracked files with a REFERENCE tree — a fresh
// server pull, a pre-pull snapshot, or the last-pull baseline store. Pure file comparison, no
// network and no mutation; the caller supplies the reference directory.
//
// Statuses, from the workspace's point of view:
//   changed        in both, content differs
//   localOnly      on disk, not in the reference     (added locally, or removed from the reference)
//   referenceOnly  in the reference, not on disk     (deleted locally, or added to the reference)
// Binary and text files compare by exact bytes. pal.json compares as PARSED JSON with keys sorted:
// pull rewrites the manifest through its own persistence rules, so byte order says nothing.
const fs = require("fs");
const path = require("path");
const { listScopedFiles, MANIFEST_FILE } = require("./workspaceHash");
const baseline = require("./baseline");
const { SNAPSHOT_DIR } = require("./snapshot");

function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
    return v;
}

// Bytes (or canonical manifest text) used to decide "same". Unparseable pal.json falls back to bytes.
function comparable(rel, abs) {
    const buf = fs.readFileSync(abs);
    if (rel !== MANIFEST_FILE) return buf;
    try { return Buffer.from(JSON.stringify(sortKeys(JSON.parse(buf.toString("utf8"))), null, 2)); }
    catch (e) { return buf; }
}

function isBinaryBuffer(buf) { return buf.includes(0); }

// Line-level diff of two texts via LCS, as hunks of { line (1-based, in `ref`), ref:[…], local:[…] }.
// Capped: past MAX_LINES per side the O(n·m) table is not worth it and we say so instead.
const MAX_LINES = 3000;
function lineHunks(refText, localText) {
    const a = refText.split("\n"), b = localText.split("\n");
    if (a.length > MAX_LINES || b.length > MAX_LINES) return { tooLarge: true, hunks: [] };
    const n = a.length, m = b.length;
    const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
        t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
    const hunks = [];
    let i = 0, j = 0, cur = null;
    const flush = () => { if (cur) { hunks.push(cur); cur = null; } };
    while (i < n || j < m) {
        if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; continue; }
        if (!cur) cur = { line: i + 1, ref: [], local: [] };
        if (j < m && (i >= n || t[i][j + 1] >= t[i + 1][j])) cur.local.push(b[j++]);
        else cur.ref.push(a[i++]);
    }
    flush();
    return { tooLarge: false, hunks };
}

function toMap(dir) {
    const map = new Map();
    for (const f of listScopedFiles(dir)) map.set(f.rel, f.abs);
    return map;
}

// Compare workspaceDir against refDir.
//   textOnly: restrict BOTH sides to files the baseline store keeps (text + pal.json) — the
//             baseline holds nothing else, so binaries would all read as "only on disk".
//   file:     optional rel path; adds line hunks for that one file.
function compareTrees(workspaceDir, refDir, { textOnly = false, file = null } = {}) {
    let local = toMap(workspaceDir), ref = toMap(refDir);
    let skippedBinary = 0;
    if (textOnly) {
        const keep = rel => rel === MANIFEST_FILE || baseline.isTextTracked(rel);
        skippedBinary = [...local.keys()].filter(r => !keep(r)).length;
        local = new Map([...local].filter(([r]) => keep(r)));
        ref = new Map([...ref].filter(([r]) => keep(r)));
    }
    const changed = [], localOnly = [], referenceOnly = [];
    let identical = 0;
    for (const rel of [...new Set([...local.keys(), ...ref.keys()])].sort()) {
        if (!ref.has(rel)) { localOnly.push(rel); continue; }
        if (!local.has(rel)) { referenceOnly.push(rel); continue; }
        if (comparable(rel, local.get(rel)).equals(comparable(rel, ref.get(rel)))) identical++;
        else changed.push(rel);
    }
    const out = { identical, changed, localOnly, referenceOnly, skippedBinary };
    if (file) {
        const l = local.get(file), r = ref.get(file);
        if (!l && !r) out.fileDiff = { rel: file, note: "not in either tree" };
        else {
            const lb = l ? comparable(file, l) : null, rb = r ? comparable(file, r) : null;
            if ((lb && isBinaryBuffer(lb)) || (rb && isBinaryBuffer(rb))) out.fileDiff = { rel: file, binary: true };
            else out.fileDiff = Object.assign({ rel: file }, lineHunks(rb ? rb.toString("utf8") : "", lb ? lb.toString("utf8") : ""));
        }
    }
    return out;
}

// Snapshot directories under .palsync/snapshots/, newest first (names embed an ISO timestamp).
function listSnapshots(workspaceDir) {
    try {
        return fs.readdirSync(path.join(workspaceDir, SNAPSHOT_DIR), { withFileTypes: true })
            .filter(e => e.isDirectory()).map(e => e.name).sort().reverse();
    } catch (e) { return []; }
}

module.exports = { compareTrees, lineHunks, listSnapshots, comparable };
