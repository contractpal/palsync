"use strict";
// Workspace-path handling for the launcher: turn whatever the user typed (absolute, relative,
// ~-prefixed, quoted, containing spaces) into ONE exact absolute directory, and — before a
// REMEMBERED directory is reused — check that it still is what the history says it is.
//
// The remembered directory is a preference, not proof of identity. `.palsync.json` plus the
// authenticated server stay authoritative (src/launcher/workspace.js enforces the same palGuid
// rule for every caller); this module only answers the question early enough to offer recovery
// instead of failing after a login.
const fs = require("fs");
const path = require("path");
const os = require("os");
const palsyncfile = require("../core/palsyncfile");

const FILENAME = palsyncfile.FILENAME;

// One exact directory. Accepts absolute paths, relative paths, a leading ~, paths with spaces,
// and pasted values wrapped in quotes. Returns null when there is nothing usable. `path` and
// `homedir` are injectable so Windows rules are testable from any platform.
function normalizeWorkspaceDir(input, { path: p = path, homedir = os.homedir(), cwd = process.cwd() } = {}) {
    if (typeof input !== "string") return null;
    let value = input.trim();
    // Pasting from a file manager or chat often brings quotes along — strip one matching pair.
    if (value.length >= 2) {
        const first = value[0], last = value[value.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1).trim();
    }
    if (!value) return null;
    if (value === "~") value = homedir;
    else if (/^~[\\/]/.test(value)) value = p.resolve(homedir, value.slice(2));
    return p.resolve(cwd, value);
}

// Do two cloud base URLs point at the same deployment? Tolerates a trailing slash, missing
// scheme case differences, and a path suffix — a recorded "https://x.example/" must not look
// like a different cloud from "https://x.example".
function sameCloud(a, b) {
    if (!a || !b) return true; // nothing to compare — never a refusal on missing data
    const norm = (url) => {
        const s = String(url).trim().replace(/\/+$/, "").toLowerCase();
        try {
            const u = new URL(/^https?:\/\//.test(s) ? s : "https://" + s);
            return u.host + (u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, ""));
        } catch (e) {
            return s;
        }
    };
    return norm(a) === norm(b);
}

// `~/projects/Audithelm-V1` for display in the menu.
function shortenHome(dir, homedir = os.homedir()) {
    if (!dir || !homedir) return dir || "";
    if (dir === homedir) return "~";
    const prefix = homedir.endsWith(path.sep) ? homedir : homedir + path.sep;
    return dir.startsWith(prefix) ? "~" + dir.slice(homedir.length) : dir;
}

// What is at `dir`, and is it this pal's workspace?
//   { ok: true,  existing: true }   .palsync.json for this pal — normal setup (drift guard and all)
//   { ok: true,  existing: false }  empty (or, with allowMissing, not-yet-created) directory
//   { ok: false, reason }           missing | not-a-directory | other-pal | other-cloud |
//                                   unrecognized-nonempty | unreadable
// A directory with files but no PalSync identity is NEVER adopted silently — that is how a parent
// folder (the classic mistake: ~/projects instead of ~/projects/Audithelm-V1) would get a pal
// dumped into it. A name is not identity: the palGuid decides other-pal, the cloud decides
// other-cloud.
//   allowMissing (default false): a folder that does not exist yet is a normal first checkout for
//   a path the user just typed or passed via --dir. A REMEMBERED folder must not be recreated
//   silently at an unexpected location, so that caller keeps the default.
function inspectWorkspace(dir, identity = {}, { fs: fss = fs, path: p = path, allowMissing = false } = {}) {
    if (typeof dir !== "string" || !dir) return { ok: false, reason: "missing", dir: null };
    let stat;
    try {
        stat = fss.statSync(dir);
    } catch (e) {
        if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) {
            return allowMissing ? { ok: true, existing: false, missing: true, dir } : { ok: false, reason: "missing", dir };
        }
        return { ok: false, reason: "unreadable", dir, error: e && e.message };
    }
    if (!stat.isDirectory()) return { ok: false, reason: "not-a-directory", dir };

    let record = null;
    let identityUnreadable = false;
    try {
        record = JSON.parse(fss.readFileSync(p.join(dir, FILENAME), "utf8"));
    } catch (e) {
        if (e && e.code !== "ENOENT") identityUnreadable = true; // present but broken
    }
    if (identityUnreadable || (record && typeof record !== "object")) {
        // Present but unreadable/unparseable: it is a PalSync folder, and we cannot prove whose.
        return { ok: false, reason: "unrecognized-nonempty", dir };
    }
    if (record) {
        if (identity.palGuid && record.palGuid && record.palGuid !== identity.palGuid) {
            return { ok: false, reason: "other-pal", dir, record };
        }
        if (identity.cloudUrl && record.cloudUrl && !sameCloud(identity.cloudUrl, record.cloudUrl)) {
            return { ok: false, reason: "other-cloud", dir, record };
        }
        // A different account on the same cloud with the same pal GUID is the SAME pal (teams
        // share pals, and the server already authorized this account for the GUID) — allowed.
        return { ok: true, existing: true, sameAccount: !identity.username || record.username === identity.username, dir, record };
    }
    let entries = [];
    try {
        entries = fss.readdirSync(dir);
    } catch (e) {
        return { ok: false, reason: "unreadable", dir, error: e && e.message };
    }
    if (entries.length) return { ok: false, reason: "unrecognized-nonempty", dir, entries: entries.length };
    return { ok: true, existing: false, dir };
}

// Human explanation for an inspectWorkspace refusal (the launcher shows this before offering
// recovery actions).
function describeRefusal(result, { palName, dir }) {
    const where = shortenHome(dir || "");
    if (!dir) return "No workspace folder is remembered for \"" + palName + "\" yet.";
    switch (result.reason) {
        case "missing":
            return "The remembered workspace folder for \"" + palName + "\" is gone:\n  " + where +
                "\npalsync will not create a replacement checkout somewhere unexpected.";
        case "not-a-directory":
            return where + " is not a directory.";
        case "other-pal": {
            const record = result.record || {};
            return where + " belongs to a different pal: \"" + (record.palName || "unknown") +
                "\" (" + (record.palGuid || "unknown") + ").\npalsync will not mix two pals' state in one folder.";
        }
        case "other-cloud": {
            const record = result.record || {};
            return where + " belongs to a workspace created on " + (record.cloudUrl || "another cloud") +
                ", not on the cloud you are signing in to.\npalsync will not mix two deployments in one folder.";
        }
        case "unrecognized-nonempty":
            return where + " exists and has files, but no PalSync workspace in it" +
                (result.entries ? " (" + result.entries + " entries)" : "") +
                ".\npalsync will not adopt or overwrite a folder it doesn't recognize.";
        default:
            return "Could not use " + where + " (" + (result.reason || "unknown") + (result.error ? ": " + result.error : "") + ").";
    }
}

module.exports = { normalizeWorkspaceDir, inspectWorkspace, describeRefusal, sameCloud, shortenHome, FILENAME };
