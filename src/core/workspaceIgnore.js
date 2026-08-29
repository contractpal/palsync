"use strict";
// Centralized workspace ignore management for known transient PalSync artifacts.
//
// WHY this exists: local task commits (git add -A && git commit) must contain only source
// and lifecycle state. Transient caches, telemetry, and evidence would otherwise pollute
// diffs and task history. The harness enforces exclusion mechanically so the model never
// has to remember pathspecs.
//
// Ignore EXACT paths only — never the whole .palsync directory. Baseline snapshots,
// context manifests, EXECUTION.md, and REVIEW.md remain trackable.
//
// Transient evidence per file:
//   .agent-work-history/        — content-addressed run artifacts (metadata/notes) written by src/mcp/workHistory.js; ephemeral, rebuildable
//   .palsync/cache/             — lint result cache (entries/index/stats) written by src/core/lintCache.js; derived, rebuildable
//   .palsync.usage.json         — MCP tool-call tally written by src/core/usage.js recordToolCall/flush; telemetry sidecar
//   .palsync/session-cost.json  — harness-reported model spend written by src/core/usage.js recordSessionCost; telemetry sidecar
//   .palsync/session-cost.lock  — lock directory for session-cost writer in src/core/usage.js; transient lock, never source
//   .palsync/pi-usage.jsonl     — Pi extension telemetry written by src/core/piHelpers.js appendPiUsage; telemetry sidecar
//   .palsync/tool-evidence.jsonl — durable exercise/push evidence written by src/core/usage.js appendToolEvidence; queried via API, not committed as source (committed evidence is REVIEW.md/EXECUTION.md)
//
// Retained (MUST stay trackable):
//   .palsync/baseline/          — drift baseline snapshots used by pre-push gate to block only NEW errors
//   .palsync/context-manifest.json / .prev.json — injected context manifest for cost/insights
//   EXECUTION.md, REVIEW.md     — lifecycle state
//   pal.json, pages/, etc.      — source

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const TRANSIENT_IGNORE_PATTERNS = [
    "/.agent-work-history/",
    "/.palsync/cache/",
    "/.palsync.usage.json",
    "/.palsync/session-cost.json",
    "/.palsync/session-cost.lock",
    "/.palsync/pi-usage.jsonl",
    "/.palsync/tool-evidence.jsonl"
];

// Paths as passed to `git rm --cached` — leading/trailing slashes stripped, -r covers directories.
const TRANSIENT_GIT_RM_PATHS = TRANSIENT_IGNORE_PATTERNS.map(function (p) {
    return p.replace(/^\//, "").replace(/\/$/, "");
});

const MANAGED_START = "# palsync transient artifacts — managed by palsync; do not edit this block";
const MANAGED_END = "# end palsync transient artifacts";

function warn(message) {
    try {
        console.warn(message);
    } catch (e) {
        // best-effort
    }
}

function isPatternCovered(text, pattern) {
    const lines = text.split(/\r?\n/).map(function (l) {
        return l.trim();
    }).filter(function (l) {
        return l && !l.startsWith("#");
    });
    const normalizedPattern = pattern.replace(/^\//, "");
    const withoutSlash = normalizedPattern.replace(/\/$/, "");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/^\//, "");
        if (line === normalizedPattern) return true;
        if (pattern.endsWith("/") && line === withoutSlash) return true;
    }
    return false;
}

function ensureGitignoreSync(workspaceDir) {
    if (!workspaceDir || typeof workspaceDir !== "string") return { updated: false };
    const gitignorePath = path.join(workspaceDir, ".gitignore");
    let text = "";
    try {
        text = fs.readFileSync(gitignorePath, "utf8");
    } catch (e) {
        if (!e || e.code !== "ENOENT") return { updated: false };
        text = "";
    }

    const missing = TRANSIENT_IGNORE_PATTERNS.filter(function (p) {
        return !isPatternCovered(text, p);
    });
    if (missing.length === 0) return { updated: false };

    // If a managed block already exists, expand it to include missing entries.
    if (text.indexOf(MANAGED_START) !== -1 && text.indexOf(MANAGED_END) !== -1) {
        const startIdx = text.indexOf(MANAGED_START);
        const endIdx = text.indexOf(MANAGED_END);
        if (endIdx > startIdx) {
            const before = text.slice(0, startIdx);
            const blockInner = text.slice(startIdx + MANAGED_START.length, endIdx);
            const blockLines = blockInner.split(/\r?\n/).map(function (l) {
                return l.trim();
            }).filter(Boolean);
            const blockSet = new Set(blockLines.map(function (line) { return line.replace(/^\//, ""); }));
            const toAdd = missing.filter(function (p) {
                const norm = p.replace(/^\//, "").replace(/\/$/, "");
                return !blockSet.has(norm) && !blockSet.has(p) && !blockSet.has(p.replace(/\/$/, ""));
            });
            if (toAdd.length === 0) return { updated: false };
            const trimmedInner = blockInner.trimEnd();
            const newInner = trimmedInner + "\n" + toAdd.join("\n") + "\n";
            const after = text.slice(endIdx);
            const newText = before + MANAGED_START + newInner + after;
            try {
                fs.mkdirSync(path.dirname(gitignorePath), { recursive: true });
                fs.writeFileSync(gitignorePath, newText, "utf8");
                return { updated: true, added: toAdd };
            } catch (e) {
                return { updated: false };
            }
        }
    }

    // No managed block — append a new block containing the missing patterns.
    const prefix = text && !text.endsWith("\n") ? "\n" : "";
    const block = MANAGED_START + "\n" + missing.join("\n") + "\n" + MANAGED_END + "\n";
    const newText = text + prefix + block;
    try {
        fs.mkdirSync(path.dirname(gitignorePath), { recursive: true });
        fs.writeFileSync(gitignorePath, newText, "utf8");
        return { updated: true, added: missing };
    } catch (e) {
        return { updated: false };
    }
}

function migrateTrackedTransientsSync(workspaceDir) {
    if (!workspaceDir || typeof workspaceDir !== "string") return { migrated: false };
    let isInside = false;
    try {
        const check = child_process.spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
            cwd: workspaceDir,
            stdio: "pipe",
            encoding: "utf8"
        });
        if (check.error && check.error.code === "ENOENT") {
            warn("palsync: Git not available — transient ignore migration skipped (" + workspaceDir + ")");
            return { migrated: false, warning: "Git not available" };
        }
        isInside = check.status === 0;
    } catch (e) {
        if (e && e.code === "ENOENT") {
            warn("palsync: Git not available — transient ignore migration skipped (" + workspaceDir + ")");
            return { migrated: false, warning: "Git not available" };
        }
        warn("palsync: transient index cleanup failed — " + (e && e.message ? e.message : String(e)));
        return { migrated: false, warning: e && e.message ? e.message : String(e) };
    }
    if (!isInside) {
        // Not a Git workspace — still a valid PalSync workspace (e.g. fresh before git init).
        // Emit a visible warning per spec but do not block.
        warn("palsync: not a Git workspace — transient index cleanup skipped (" + workspaceDir + ")");
        return { migrated: false, warning: "not a Git workspace" };
    }
    try {
        const args = ["rm", "-r", "--cached", "--ignore-unmatch", "--"].concat(TRANSIENT_GIT_RM_PATHS);
        const res = child_process.spawnSync("git", args, {
            cwd: workspaceDir,
            stdio: "pipe",
            encoding: "utf8"
        });
        if (res.error) {
            if (res.error.code === "ENOENT") {
                warn("palsync: Git not available — transient index cleanup skipped");
                return { migrated: false, warning: "Git not available" };
            }
            throw res.error;
        }
        if (res.status !== 0) {
            const stderr = (res.stderr || "").trim();
            // --ignore-unmatch should make this succeed even when nothing is tracked; any
            // non-zero here is unexpected — warn but do not block Pal work.
            if (stderr) warn("palsync: transient index cleanup warning: " + stderr);
            return { migrated: false, warning: stderr || "git rm failed" };
        }
        return { migrated: true };
    } catch (e) {
        warn("palsync: transient index cleanup failed — " + (e && e.message ? e.message : String(e)));
        return { migrated: false, warning: e && e.message ? e.message : String(e) };
    }
}

function ensureWorkspaceIgnoreSync(workspaceDir) {
    if (!workspaceDir || typeof workspaceDir !== "string") return { updated: false, migrated: false };
    let gitignoreResult = { updated: false };
    try {
        gitignoreResult = ensureGitignoreSync(workspaceDir);
    } catch (e) {
        // best-effort
    }
    let migrateResult = { migrated: false };
    try {
        migrateResult = migrateTrackedTransientsSync(workspaceDir);
    } catch (e) {
        warn("palsync: transient ignore migration failed — " + (e && e.message ? e.message : String(e)));
        migrateResult = { migrated: false, warning: e && e.message ? e.message : String(e) };
    }
    return {
        updated: !!gitignoreResult.updated,
        migrated: !!migrateResult.migrated,
        warning: migrateResult.warning || null,
        added: gitignoreResult.added || []
    };
}

module.exports = {
    TRANSIENT_IGNORE_PATTERNS,
    ensureGitignoreSync,
    migrateTrackedTransientsSync,
    ensureWorkspaceIgnoreSync
};
