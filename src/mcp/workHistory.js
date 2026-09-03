"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const usage = require("../core/usage");
const { stableStringify } = require("../core/stableStringify");

const HISTORY_DIR = ".agent-work-history";
const workspaceIgnore = require("../core/workspaceIgnore");

function safeSlug(value, fallback = "run") {
    const raw = String(value || "").trim();
    const slug = raw
        .replace(/[\/\\]+/g, "-")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 90);
    return slug || fallback;
}

function stamp(d = new Date()) {
    return d.toISOString().replace(/[:.]/g, "-");
}

function ensureGitignored(workspaceDir) {
    try {
        workspaceIgnore.ensureGitignoreSync(workspaceDir);
    } catch (e) {
        // best-effort — never block Pal work
    }
}

function createWorkHistoryRun(workspaceDir, { tool = "palsync", feature = "run", now = new Date() } = {}) {
    if (!workspaceDir) return null;
    const root = path.join(workspaceDir, HISTORY_DIR);
    ensureGitignored(workspaceDir);
    try { fs.mkdirSync(root, { recursive: true }); }
    catch (e) { return null; }

    const toolSlug = safeSlug(tool, "palsync");
    const featureSlug = safeSlug(feature, "run");
    const base = stamp(now) + "--" + toolSlug + "--" + featureSlug;
    let dir = path.join(root, base);
    for (let i = 2; fs.existsSync(dir); i++) dir = path.join(root, base + "-" + i);
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch (e) { return null; }

    return {
        root,
        dir,
        relDir: path.relative(workspaceDir, dir),
        createdAt: now.toISOString(),
        tool,
        feature,
        toolSlug,
        featureSlug
    };
}

function writeArtifactFile(run, fileName, data, encoding) {
    if (!run || !run.dir) return null;
    const safeName = safeSlug(fileName, "artifact");
    const filePath = path.join(run.dir, safeName);
    try {
        if (encoding) fs.writeFileSync(filePath, data, encoding);
        else fs.writeFileSync(filePath, data);
        return filePath;
    } catch (e) {
        return null;
    }
}

function writeContentAddressedArtifact(workspaceDir, tool, value, encoding) {
    if (!workspaceDir) return null;
    // Binary-safe: a Buffer value is hashed/written byte-accurately (the only binary
    // caller is the screenshot PNG path, hence the .png extension); every other value
    // hashes its canonical text. Encoding passes through to fs.writeFileSync.
    const isBinary = Buffer.isBuffer(value);
    const data = isBinary ? value : typeof value === "string" ? value : stableStringify(value, 2) + "\n";
    const digest = crypto.createHash("sha256").update(isBinary ? data : Buffer.from(data, "utf8")).digest("hex");
    const dir = path.join(workspaceDir, HISTORY_DIR, safeSlug(tool, "palsync"));
    const filePath = path.join(dir, digest.slice(0, 16) + (isBinary ? ".png" : ".json"));
    ensureGitignored(workspaceDir);
    try {
        fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(filePath)) {
            const tmp = filePath + ".tmp-" + process.pid + "-" + Math.random().toString(16).slice(2);
            try {
                if (encoding) fs.writeFileSync(tmp, data, encoding);
                else if (isBinary) fs.writeFileSync(tmp, data);
                else fs.writeFileSync(tmp, data, "utf8");
                fs.renameSync(tmp, filePath);
            } catch (e) {
                try { fs.rmSync(tmp, { force: true }); } catch (ignored) { /* best-effort */ }
                throw e;
            }
        }
        return path.relative(workspaceDir, filePath).split(path.sep).join("/");
    } catch (e) {
        return null;
    }
}

function writeRunMetadata(run, metadata) {
    if (!run || !run.dir) return null;
    const payload = Object.assign({
        createdAt: run.createdAt,
        tool: run.tool,
        feature: run.feature
    }, metadata || {});
    return writeArtifactFile(run, "metadata.json", stableStringify(payload, 2) + "\n", "utf8");
}

function writeRunNotes(run, lines) {
    if (!run || !run.dir) return null;
    const body = (lines || []).filter(Boolean).join("\n") + "\n";
    return writeArtifactFile(run, "notes.md", body, "utf8");
}

// Harness accounting hook for model-token spend. Writes a per-workspace sidecar that
// `palsync cost` consumes (when present); palsync never estimates when it is absent.
// Required entry fields: model, provider, tokensIn, tokensCached, tokensOut.
// Optional: cost (numeric), currency (default "USD"), phase ("build" | "review").
function recordSessionCost(workspaceDir, entry) {
    if (!workspaceDir || !entry || typeof entry.model !== "string" || typeof entry.provider !== "string") return null;
    ensureGitignored(workspaceDir);
    try {
        const filePath = path.join(workspaceDir, usage.SESSION_COST_FILE);
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        const now = new Date().toISOString();
        let sc;
        try { sc = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (e) { /* start fresh */ }
        // readSessionCost also accepts a bare array sidecar; normalize it so the append survives
        // JSON.stringify (an expando `.entries` on an array would be dropped on serialize).
        if (Array.isArray(sc)) sc = { entries: sc };
        if (!sc || typeof sc !== "object") sc = {};
        if (!Array.isArray(sc.entries)) sc.entries = [];
        sc.entries.push(Object.assign({}, entry, { recordedAt: now }));
        sc.updatedAt = now;
        fs.writeFileSync(filePath, JSON.stringify(sc, null, 2) + "\n", "utf8");
        return filePath;
    } catch (e) {
        return null;
    }
}

module.exports = {
    HISTORY_DIR,
    safeSlug,
    createWorkHistoryRun,
    writeArtifactFile,
    writeContentAddressedArtifact,
    writeRunMetadata,
    writeRunNotes,
    recordSessionCost
};
