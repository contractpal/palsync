"use strict";
// On-demand file fetch for the REPOSITORY pal being worked on (the pal in this workspace).
//
// A repository pal keeps each file's content in its own server row and can be huge (images, Word
// attachments). palsync therefore never downloads one wholesale: the pull brings down structure
// only, and files arrive one at a time through CheckOut.do when something needs them. This module
// is that path, with the developer in control of when and how fast:
//   - one file per call needs no ceremony;
//   - more than one needs askedUser:true — an attestation that the developer asked for exactly
//     that batch (same pattern as pal_tunnel_test) — and stays under maxFilesPerCall;
//   - a per-call byte budget and an optional pause between downloads pace it, because the size of
//     a repository file is NOT on the wire before the download (it is only on the server), so the
//     budget can only be enforced as bytes arrive.
// Limits live in the workspace record (.palsync.json -> repoFetch), set by the developer.
//
// No "fetched" state is tracked — whether a file was ever downloaded means nothing; only whether it
// was EDITED does. That is already answered by the per-file baseline (record.fileHashes), which pull
// leaves holding the empty stub's hash. A fetch therefore updates that one baseline entry to the
// real content's hash, so a freshly fetched file reads as unedited rather than as a change, and
// the push sends only what the developer (or agent) actually changed.
//
// Wire (verified live against secure.cloudpiston.com, 2026-10-21): GetPal with Repository-Hint:
// false lists names without content and carries repositoryPal; CheckOut.do with checkout:"false"
// returns base64 content, and answers a name the pal does not hold with success + EMPTY content,
// so names are validated against the server's listing first.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { CloudPistonAPIManager } = require("../../lib/apiManager");
const { Pal } = require("../../lib/pal");
const { READABLE_TYPES } = require("./resources");
const { timestampText } = require("./resolve");
const { hashWorkspace } = require("./workspaceHash");
const baseline = require("./baseline");

// singular fileType -> [pulled-pal getter, on-disk folder]. Everything CheckOut reads from a
// repository row, plus workflows (a repository pal may hold a workflow row). Fonts are excluded:
// the server never reads font rows back.
const REPO_TYPES = Object.assign({}, READABLE_TYPES, { workflow: ["allWorkflows", "workflows"] });

const DEFAULT_LIMITS = Object.freeze({
    maxFilesPerCall: 10,
    maxBytesPerCall: 25 * 1024 * 1024,
    pauseMs: 0
});

function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

function limitsFor(record) {
    const cfg = (record && record.repoFetch) || {};
    const num = (v, d, min) => (Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : d);
    return {
        maxFilesPerCall: Math.floor(num(cfg.maxFilesPerCall, DEFAULT_LIMITS.maxFilesPerCall, 1)),
        maxBytesPerCall: num(cfg.maxBytesPerCall, DEFAULT_LIMITS.maxBytesPerCall, 1),
        pauseMs: num(cfg.pauseMs, DEFAULT_LIMITS.pauseMs, 0)
    };
}

// "fragments"/"Fragment" -> "fragment"; null when the type can't be read on demand.
function normalizeType(type) {
    const key = String(type || "").trim().toLowerCase();
    if (REPO_TYPES[key]) return key;
    return Object.keys(REPO_TYPES).find(k => REPO_TYPES[k][1] === key) || null;
}

// Levenshtein distance, for "did you mean" on mistyped names.
function editDistance(a, b) {
    const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let diag = prev[0];
        prev[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const keep = prev[j];
            prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
            diag = keep;
        }
    }
    return prev[b.length];
}

function similarNames(names, wanted, limit = 5) {
    const needle = wanted.toLowerCase();
    const slack = Math.max(2, Math.floor(needle.length / 4));
    return names
        .map(n => ({ n, d: editDistance(n.toLowerCase(), needle), sub: n.toLowerCase().includes(needle) || needle.includes(n.toLowerCase()) }))
        .filter(x => x.sub || x.d <= slack)
        .sort((x, y) => x.d - y.d)
        .slice(0, limit)
        .map(x => x.n);
}

function mb(bytes) { return (bytes / (1024 * 1024)).toFixed(1) + " MB"; }

const defaultSleep = ms => new Promise(r => setTimeout(r, ms));

// files: [{ type, file }]. Returns { ok, refused?, reason?, results: [...], fetched, bytes, notFetched }.
// Mutates record (fileHashes, localHash) — the caller persists it.
async function fetchRepoFiles(session, resolved, workspaceDir, record, { files, askedUser = false, sleep = defaultSleep } = {}) {
    const limits = limitsFor(record);
    const results = [];

    // 1) normalize + dedupe the request
    const wanted = [];
    const seen = new Set();
    for (const f of Array.isArray(files) ? files : []) {
        const type = normalizeType(f && f.type);
        const file = f && typeof f.file === "string" ? f.file.trim() : "";
        if (!type || !file) {
            results.push({ type: f && f.type, file: f && f.file, status: "invalid",
                reason: !type ? "type \"" + (f && f.type) + "\" is not readable on demand (use one of: " + Object.keys(REPO_TYPES).join(", ") + ")" : "file name is required" });
            continue;
        }
        const key = type + "\0" + file;
        if (seen.has(key)) continue;
        seen.add(key);
        wanted.push({ type, file });
    }
    if (!wanted.length) {
        return { ok: false, refused: "nothing-to-fetch", reason: results.length ? "No valid files in the request." : "No files requested.", results, fetched: 0, bytes: 0, notFetched: 0 };
    }

    // 2) the developer gate — checked before any network traffic
    if (wanted.length > 1 && !askedUser) {
        return {
            ok: false, refused: "interview-needed", results, fetched: 0, bytes: 0, notFetched: wanted.length,
            reason: "NOT FETCHED — " + wanted.length + " files were requested at once. A repository's files can be large (images, Word attachments), " +
                "so the developer decides when and how many come down. Ask them (do not answer for them): which files, and how many now? " +
                "Then call again with exactly those files plus askedUser:true. To fetch one file, just request that one."
        };
    }
    if (wanted.length > limits.maxFilesPerCall) {
        return {
            ok: false, refused: "over-cap", results, fetched: 0, bytes: 0, notFetched: wanted.length,
            reason: "NOT FETCHED — " + wanted.length + " files exceeds this workspace's limit of " + limits.maxFilesPerCall + " per call. " +
                "Fetch them in smaller batches, or ask the developer to raise repoFetch.maxFilesPerCall in .palsync.json."
        };
    }

    // 3) the server's own listing (names, no content) — authoritative, and proves this is a repository pal
    let resp;
    try { resp = await CloudPistonAPIManager.getPal(session, resolved.id); }
    catch (e) { return { ok: false, refused: "request-failed", reason: "GetPal.do failed: " + (e && e.message ? e.message : e), results, fetched: 0, bytes: 0, notFetched: wanted.length }; }
    if (!resp || !resp.success || !resp.pal) {
        return { ok: false, refused: "request-failed", reason: "GetPal.do did not succeed for this pal.", results, fetched: 0, bytes: 0, notFetched: wanted.length };
    }
    if (resp.repositoryPal !== true) {
        return { ok: false, refused: "not-repository", results, fetched: 0, bytes: 0, notFetched: wanted.length,
            reason: "This is not a repository pal — its files were pulled with their content, so there is nothing to fetch. Use pal_pull to refresh them." };
    }
    const listing = new Pal(Object.assign(JSON.parse(JSON.stringify(resp.pal)), { id: resolved.id, path: workspaceDir }));

    let fetched = 0;
    let bytes = 0;
    let stopped = false;

    for (const { type, file } of wanted) {
        const [getter, folder] = REPO_TYPES[type];
        const rel = folder + "/" + file.replace(/\\/g, "/");
        const base = { type, file, path: rel };

        const names = (listing[getter] || []).map(e => e.string);
        if (!names.includes(file)) {
            const near = similarNames(names, file);
            results.push(Object.assign(base, { status: "unknown-name",
                reason: "the pal has no " + type + " named \"" + file + "\"" + (near.length ? ". Similar: " + near.join(", ") : ". See pal.json for the file list.") }));
            continue;
        }

        const dest = path.resolve(workspaceDir, folder, ...file.split(/[\\/]/));
        if (!dest.startsWith(path.resolve(workspaceDir, folder) + path.sep)) {
            results.push(Object.assign(base, { status: "invalid", reason: "name resolves outside " + folder + "/" }));
            continue;
        }

        // never clobber work: a non-empty local file is either unedited (matches the baseline) or edited
        let local = null;
        try { local = fs.readFileSync(dest); } catch (e) { if (e.code !== "ENOENT") throw e; }
        if (local && local.length > 0) {
            const h = sha256(local);
            const unedited = !!(record.fileHashes && record.fileHashes[rel] === h);
            results.push(Object.assign(base, unedited
                ? { status: "already-present", bytes: local.length }
                : { status: "local-content", bytes: local.length,
                    reason: "a local copy with content already exists and differs from the baseline (edited) — not overwritten" }));
            continue;
        }

        if (stopped || bytes >= limits.maxBytesPerCall) {
            stopped = true;
            results.push(Object.assign(base, { status: "budget", reason: "per-call byte budget (" + mb(limits.maxBytesPerCall) + ") reached — not fetched" }));
            continue;
        }

        if (fetched > 0 && limits.pauseMs > 0) await sleep(limits.pauseMs);

        let read;
        try { read = await CloudPistonAPIManager.checkOutFile(session, resolved.id, type, file); }
        catch (e) { results.push(Object.assign(base, { status: "error", reason: "CheckOut.do failed: " + (e && e.message ? e.message : e) })); continue; }
        if (!read || !read.success || !read.palFile) {
            const msg = read && read.messages && read.messages["com.contractpal.Message"] && read.messages["com.contractpal.Message"].message;
            results.push(Object.assign(base, { status: "refused", reason: "CheckOut.do refused" + (msg ? ": " + msg : "") }));
            continue;
        }

        const buf = Buffer.from(timestampText(read.palFile.content) || "", "base64");
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        const hash = sha256(buf);
        if (record.fileHashes && typeof record.fileHashes === "object") record.fileHashes[rel] = hash;
        baseline.snapshotFile(workspaceDir, rel);
        fetched++;
        bytes += buf.length;
        results.push(Object.assign(base, { status: "fetched", bytes: buf.length }));
    }

    if (fetched > 0) record.localHash = hashWorkspace(workspaceDir);
    const notFetched = results.filter(r => ["budget", "unknown-name", "invalid", "refused", "error"].includes(r.status)).length;
    return { ok: true, results, fetched, bytes, notFetched, limits };
}

module.exports = { fetchRepoFiles, limitsFor, normalizeType, REPO_TYPES, DEFAULT_LIMITS };
