"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CACHE_FORMAT_VERSION = 1;
// Bump whenever validator rule behavior changes. The PalSync package version is also in every key.
const RULES_VERSION = 1;
const MAX_ENTRIES = 500;
const VERSION = require("../../package.json").version;

function cacheRoot(workspaceDir) { return path.join(workspaceDir, ".palsync", "cache"); }
function entriesDir(workspaceDir) { return path.join(cacheRoot(workspaceDir), "lint"); }
function statsPath(workspaceDir) { return path.join(cacheRoot(workspaceDir), "lint-stats.json"); }

function atomicJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp-" + process.pid + "-" + Math.random().toString(16).slice(2);
    try {
        fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
        fs.renameSync(tmp, file);
    } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch (ignored) { /* best effort */ }
        throw e;
    }
}

function readStats(workspaceDir) {
    try {
        return Object.assign({ version: 1, hits: 0, misses: 0, bypasses: 0 },
            JSON.parse(fs.readFileSync(statsPath(workspaceDir), "utf8")));
    } catch (e) { return { version: 1, hits: 0, misses: 0, bypasses: 0 }; }
}

function record(workspaceDir, field) {
    try {
        const stats = readStats(workspaceDir);
        stats[field] = (stats[field] || 0) + 1;
        atomicJson(statsPath(workspaceDir), stats);
    } catch (e) { /* cache observability must never affect lint correctness */ }
}

function keyFor({ rel, content, mode = "workspace", context = {}, rulesVersion = RULES_VERSION }) {
    const key = JSON.stringify({
        cacheFormatVersion: CACHE_FORMAT_VERSION,
        palsyncVersion: VERSION,
        rulesVersion,
        rel,
        mode,
        context,
        contentSha256: crypto.createHash("sha256").update(content).digest("hex")
    });
    return crypto.createHash("sha256").update(key).digest("hex");
}

function prune(workspaceDir) {
    const dir = entriesDir(workspaceDir);
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
            .filter(entry => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))
            .map(entry => ({ name: entry.name, mtimeMs: fs.statSync(path.join(dir, entry.name)).mtimeMs }));
    } catch (e) { return; }
    if (entries.length <= MAX_ENTRIES) return;
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries.slice(0, entries.length - MAX_ENTRIES)) {
        try { fs.rmSync(path.join(dir, entry.name), { force: true }); } catch (e) { /* best effort */ }
    }
}

function cachedLint(workspaceDir, options, compute) {
    if (process.env.PALSYNC_NO_CACHE === "1") {
        record(workspaceDir, "bypasses");
        return compute();
    }
    const key = keyFor(options);
    const file = path.join(entriesDir(workspaceDir), key + ".json");
    try {
        const hit = JSON.parse(fs.readFileSync(file, "utf8"));
        const resultJson = JSON.stringify(hit.result);
        if (hit.version !== CACHE_FORMAT_VERSION || hit.key !== key ||
            hit.resultSha256 !== crypto.createHash("sha256").update(resultJson).digest("hex")) {
            throw new Error("invalid cache entry");
        }
        try { fs.utimesSync(file, new Date(), new Date()); } catch (e) { /* LRU touch is best effort */ }
        record(workspaceDir, "hits");
        return hit.result;
    } catch (e) { /* miss or corrupt entry: recompute */ }
    const result = compute();
    try {
        const resultJson = JSON.stringify(result);
        atomicJson(file, {
            version: CACHE_FORMAT_VERSION,
            key,
            resultSha256: crypto.createHash("sha256").update(resultJson).digest("hex"),
            result
        });
        prune(workspaceDir);
    } catch (e) { /* cache writes are best-effort; computed lint remains authoritative */ }
    record(workspaceDir, "misses");
    return result;
}

module.exports = { cachedLint, keyFor, readStats, RULES_VERSION, CACHE_FORMAT_VERSION, MAX_ENTRIES };
