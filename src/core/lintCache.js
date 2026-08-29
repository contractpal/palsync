"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CACHE_FORMAT_VERSION = 2;
// Legacy/default version for ad-hoc modes. Workspace modes are versioned independently, while
// push-gate composes every workspace rule version because lintContent dispatches to those same
// rule implementations based on file type.
const RULES_VERSION = 1;
const WORKSPACE_RULE_VERSIONS = Object.freeze({
    "workspace-workflow": 1,
    "workspace-markup": 1,
    "workspace-dataset": 1,
    // Bump whenever contracts.js or palJson.js gains or changes a rule.
    "workspace-contracts": 1
});

function pushGateRulesVersion(versions = WORKSPACE_RULE_VERSIONS) {
    return ["workspace-workflow", "workspace-markup", "workspace-dataset", "workspace-contracts"]
        .map(mode => versions[mode])
        .join(".");
}

const RULE_VERSIONS = Object.freeze({
    ...WORKSPACE_RULE_VERSIONS,
    "push-gate": pushGateRulesVersion(),
    "spec-lint": 1
});
const MAX_ENTRIES = 500;
const VERSION = require("../../package.json").version;

function cacheRoot(workspaceDir) { return path.join(workspaceDir, ".palsync", "cache"); }
function entriesDir(workspaceDir) { return path.join(cacheRoot(workspaceDir), "lint"); }
function statsPath(workspaceDir) { return path.join(cacheRoot(workspaceDir), "lint-stats.json"); }
function indexPath(workspaceDir) { return path.join(cacheRoot(workspaceDir), "lint-index.json"); }

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
        const parsed = JSON.parse(fs.readFileSync(statsPath(workspaceDir), "utf8"));
        return Object.assign({ version: 2, hits: 0, misses: 0, bypasses: 0 }, parsed, {
            missReasons: Object.assign({ content: 0, deps: 0, rulesVersion: 0, palsyncVersion: 0, evicted: 0, cold: 0 }, parsed.missReasons)
        });
    } catch (e) {
        return { version: 2, hits: 0, misses: 0, bypasses: 0,
            missReasons: { content: 0, deps: 0, rulesVersion: 0, palsyncVersion: 0, evicted: 0, cold: 0 } };
    }
}

function record(workspaceDir, field) {
    try {
        const stats = readStats(workspaceDir);
        stats[field] = (stats[field] || 0) + 1;
        atomicJson(statsPath(workspaceDir), stats);
    } catch (e) { /* cache observability must never affect lint correctness */ }
}

function recordMiss(workspaceDir, reason) {
    try {
        const stats = readStats(workspaceDir);
        stats.misses++;
        stats.missReasons[reason] = (stats.missReasons[reason] || 0) + 1;
        atomicJson(statsPath(workspaceDir), stats);
    } catch (e) { /* observability never affects lint */ }
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function depsSha256(deps = [], context = {}) {
    const inputs = (deps || []).map((dep, index) => {
        if (typeof dep === "string") return { path: String(index), sha256: sha256(dep) };
        const content = dep && dep.content != null ? String(dep.content) : "<absent>";
        return { path: String(dep && dep.path || index), sha256: sha256(content) };
    });
    if (context && Object.keys(context).length) inputs.push({ path: "<context>", sha256: sha256(JSON.stringify(context)) });
    inputs.sort((a, b) => a.path.localeCompare(b.path) || a.sha256.localeCompare(b.sha256));
    return sha256(JSON.stringify(inputs));
}

function componentsFor({ rel, content, mode = "workspace", context = {}, deps = [], rulesVersion, palsyncVersion = VERSION }) {
    return {
        cacheFormatVersion: CACHE_FORMAT_VERSION,
        palsyncVersion,
        rulesVersion: rulesVersion ?? RULE_VERSIONS[mode] ?? RULES_VERSION,
        rel,
        mode,
        depsSha256: depsSha256(deps, context),
        contentSha256: sha256(content)
    };
}

function keyFor(options) {
    return sha256(JSON.stringify(componentsFor(options)));
}

function readIndex(workspaceDir) {
    try { return JSON.parse(fs.readFileSync(indexPath(workspaceDir), "utf8")); } catch (e) { return {}; }
}

function missReason(previous, current) {
    if (!previous) return "cold";
    if (previous.palsyncVersion !== current.palsyncVersion) return "palsyncVersion";
    if (previous.rulesVersion !== current.rulesVersion) return "rulesVersion";
    if (previous.depsSha256 !== current.depsSha256) return "deps";
    if (previous.contentSha256 !== current.contentSha256) return "content";
    return "cold";
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
        record(workspaceDir, "evictions");
        try {
            const stats = readStats(workspaceDir);
            stats.missReasons.evicted++;
            atomicJson(statsPath(workspaceDir), stats);
        } catch (e) { /* best effort */ }
    }
}

function cachedLint(workspaceDir, options, compute) {
    try { require("./workspaceIgnore").ensureGitignoreSync(workspaceDir); } catch (e) { /* best-effort */ }
    if (process.env.PALSYNC_NO_CACHE === "1") {
        record(workspaceDir, "bypasses");
        return compute();
    }
    const components = componentsFor(options);
    const key = sha256(JSON.stringify(components));
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
    const index = readIndex(workspaceDir);
    const identity = sha256(JSON.stringify({ rel: components.rel, mode: components.mode }));
    const reason = missReason(index[identity], components);
    recordMiss(workspaceDir, reason);
    try {
        const resultJson = JSON.stringify(result);
        atomicJson(file, {
            version: CACHE_FORMAT_VERSION,
            key,
            resultSha256: crypto.createHash("sha256").update(resultJson).digest("hex"),
            result
        });
        index[identity] = components;
        atomicJson(indexPath(workspaceDir), index);
        prune(workspaceDir);
    } catch (e) { /* cache writes are best-effort; computed lint remains authoritative */ }
    return result;
}

module.exports = { cachedLint, keyFor, readStats, depsSha256, componentsFor, missReason,
    RULES_VERSION, RULE_VERSIONS, WORKSPACE_RULE_VERSIONS, pushGateRulesVersion,
    CACHE_FORMAT_VERSION, MAX_ENTRIES };
