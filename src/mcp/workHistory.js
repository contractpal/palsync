"use strict";

const fs = require("fs");
const path = require("path");
const usage = require("../core/usage");

const HISTORY_DIR = ".agent-work-history";
const IGNORE_ENTRY = HISTORY_DIR + "/";

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
    const gitignore = path.join(workspaceDir, ".gitignore");
    let text = "";
    try { text = fs.readFileSync(gitignore, "utf8"); }
    catch (e) {
        if (!e || e.code !== "ENOENT") return;
    }
    const already = new RegExp("(^|\\n)" + HISTORY_DIR.replace(".", "\\.") + "\\/?(\\n|$)").test(text);
    if (already) return;
    const prefix = text && !text.endsWith("\n") ? "\n" : "";
    const header = text ? "" : "# local agent work history\n";
    try { fs.writeFileSync(gitignore, text + prefix + header + IGNORE_ENTRY + "\n", "utf8"); }
    catch (e) { /* best-effort */ }
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

function writeRunMetadata(run, metadata) {
    if (!run || !run.dir) return null;
    const payload = Object.assign({
        createdAt: run.createdAt,
        tool: run.tool,
        feature: run.feature
    }, metadata || {});
    return writeArtifactFile(run, "metadata.json", JSON.stringify(payload, null, 2) + "\n", "utf8");
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
    writeRunMetadata,
    writeRunNotes,
    recordSessionCost
};
