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

// THE identity rule, shared by inspectWorkspace() (the launcher's early check) and
// workspace.setup() (the check every caller passes through) so the two can never disagree.
// A `.palsync.json` only proves ownership when it names a pal GUID and that GUID is the one we
// are opening; an incomplete record ({} , no palGuid, a hand-truncated file) proves nothing, so
// the folder is refused rather than pulled into. cloudUrl has been written by every version of
// buildRecord, but a record without one still cannot be shown to be from ANOTHER cloud, so a
// missing cloudUrl is not on its own a refusal (sameCloud). The account/username is deliberately
// NOT part of the rule: a team's shared pal opened by a second authorized account is the same
// pal, and the server already authorized that account for the GUID.
// Returns a refusal reason ("incomplete-identity" | "other-pal" | "other-cloud") or null.
function identityRefusal(record, identity = {}) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return "incomplete-identity";
    const recorded = typeof record.palGuid === "string" ? record.palGuid.trim() : "";
    const wanted = typeof identity.palGuid === "string" ? identity.palGuid.trim() : "";
    if (!recorded || !wanted) return "incomplete-identity";
    if (recorded !== wanted) return "other-pal";
    if (identity.cloudUrl && record.cloudUrl && !sameCloud(identity.cloudUrl, record.cloudUrl)) return "other-cloud";
    return null;
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
        const refusal = identityRefusal(record, identity);
        if (refusal) return { ok: false, reason: refusal, dir, record };
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
        case "incomplete-identity":
            return where + " holds a " + FILENAME + " with no usable pal identity in it" +
                " (no palGuid).\npalsync cannot prove whose workspace that folder is, so it will not " +
                "pull into it. Remove that file if the folder is really empty of PalSync state, or " +
                "choose a different folder.";
        case "unrecognized-nonempty":
            return where + " exists and has files, but no PalSync workspace in it" +
                (result.entries ? " (" + result.entries + " entries)" : "") +
                ".\npalsync will not adopt or overwrite a folder it doesn't recognize.";
        default:
            return "Could not use " + where + " (" + (result.reason || "unknown") + (result.error ? ": " + result.error : "") + ").";
    }
}

module.exports = { normalizeWorkspaceDir, inspectWorkspace, identityRefusal, describeRefusal, sameCloud, shortenHome, FILENAME };
