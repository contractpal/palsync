"use strict";
// Recent-Pal history — the local data behind the "type palsync, pick your pal" startup menu.
// Lives in ~/.palsync/config.json (src/platform/config.js) under `recentPals`: no database, no
// service, no new file, no new dependency.
//
// IDENTITY is (cloudUrl, account username, stable pal GUID). Pal NAMES are not identity — two
// clouds or two accounts can hold identically named pals, and a pal can be renamed — so the menu
// key is the GUID and the display name is refreshed from the server on every launch.
//
// NOTHING SECRET IS STORED: no password, no session object, no auth token. Credentials keep
// living in the OS keychain (src/platform/keychain.js); the password prompt is skipped on a
// recent launch because auth/credentials.js finds the CACHED credential, not because anything
// secret was copied here.
//
// The remembered workspaceDir is a PREFERENCE, never proof of identity: .palsync.json in the
// folder plus the authenticated server stay authoritative (see src/launcher/workspacePath.js and
// src/launcher/workspace.js).
const config = require("./config");

const KEY = "recentPals";
const MAX_ENTRIES = 20;  // storage bound — history can never grow without limit
const MAX_VISIBLE = 5;   // how many the startup menu shows

// Stored fields. Everything else in a hand-edited file is dropped on read.
const FIELDS = ["userId", "palName", "palId", "profileId", "groupId", "profileName", "groupName",
    "branch", "workspaceDir", "agent", "lastLaunchedAt"];

function entryKey(e) {
    return e.cloudUrl + "\u0000" + e.username + "\u0000" + e.palGuid;
}

function str(v) {
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function launchedAt(e) {
    const t = Date.parse((e && e.lastLaunchedAt) || "");
    return Number.isFinite(t) ? t : 0;
}

function count(e) {
    return Number.isFinite(e && e.launchCount) && e.launchCount > 0 ? Math.floor(e.launchCount) : 1;
}

// Only the known, non-secret fields survive; entries missing an identity field are dropped.
function sanitizeEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const cloudUrl = str(raw.cloudUrl);
    const username = str(raw.username);
    const palGuid = str(raw.palGuid);
    if (!cloudUrl || !username || !palGuid) return null;
    const entry = { cloudUrl, username, palGuid };
    for (const field of FIELDS) {
        const v = str(raw[field]);
        if (v !== undefined) entry[field] = v;
    }
    entry.launchCount = count(raw);
    return entry;
}

function debug(message) {
    if (!process.env.PALSYNC_DEBUG) return;
    try { process.stderr.write("[palsync] recent pals: " + message + "\n"); } catch (e) { /* stderr gone */ }
}

// Read the history, newest-launched first. Never throws: a missing, malformed, or unreadable
// config yields [] (dir/size problems are reported through PALSYNC_DEBUG), and individually
// broken entries are skipped without discarding the good ones.
function list() {
    let raw;
    try {
        raw = config.get(KEY, []);
    } catch (e) {
        debug("could not read ~/.palsync/config.json: " + e.message);
        return [];
    }
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
        debug("ignoring `" + KEY + "` — expected a list, found " + typeof raw);
        return [];
    }
    const byKey = new Map();
    for (const item of raw) {
        const entry = sanitizeEntry(item);
        if (!entry) { debug("skipping a malformed entry"); continue; }
        const key = entryKey(entry);
        const prev = byKey.get(key);
        if (!prev) { byKey.set(key, entry); continue; }
        // Same pal twice (e.g. a workspace change that wrote a second row): keep one entry,
        // the newest, carrying the summed usage count.
        const newer = launchedAt(entry) >= launchedAt(prev) ? entry : prev;
        newer.launchCount = count(prev) + count(entry);
        byKey.set(key, newer);
    }
    return [...byKey.values()].sort(newerFirst);
}

function newerFirst(a, b) {
    return launchedAt(b) - launchedAt(a) ||
        count(b) - count(a) ||
        String(a.palName || "").localeCompare(String(b.palName || ""));
}

// What the startup menu shows: the pal you most recently opened first (the "one pal at a time"
// workflow), then the rest by usage count, ties broken by recency. Deterministic and cheap —
// no scoring model.
function ranked(entries, limit = MAX_VISIBLE) {
    const all = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!all.length) return [];
    const byRecency = [...all].sort((a, b) =>
        launchedAt(b) - launchedAt(a) ||
        count(b) - count(a) ||
        String(a.palName || "").localeCompare(String(b.palName || "")));
    const [first, ...rest] = byRecency;
    rest.sort((a, b) =>
        count(b) - count(a) ||
        launchedAt(b) - launchedAt(a) ||
        String(a.palName || "").localeCompare(String(b.palName || "")));
    return [first, ...rest].slice(0, limit);
}

// Write the history back. Returns true on success, false when the file could not be written
// (read-only home, disk full). History is a convenience — callers must never let a failure here
// break an otherwise successful launch.
function write(entries) {
    try {
        const ok = config.set(KEY, entries);
        return ok !== false;
    } catch (e) {
        debug("write failed: " + e.message);
        return false;
    }
}

// Record a successful launch: upsert by identity, bump the count, stamp the time, keep the list
// bounded. `entry` carries cloudUrl/username/palGuid plus whatever else the caller knows.
// Returns { ok, entry?, error? } — never throws.
function record(entry, { now = new Date().toISOString() } = {}) {
    const clean = sanitizeEntry(entry);
    if (!clean) return { ok: false, error: "incomplete recent-pal entry (need cloudUrl, username, palGuid)" };
    try {
        const existing = list();
        const prev = existing.find(e => entryKey(e) === entryKey(clean));
        const merged = { ...(prev || {}), ...clean, lastLaunchedAt: now, launchCount: (prev ? count(prev) : 0) + 1 };
        const next = [merged, ...existing.filter(e => entryKey(e) !== entryKey(merged))]
            .sort(newerFirst)
            .slice(0, MAX_ENTRIES);
        if (!write(next)) return { ok: false, error: "could not write " + KEY + " to ~/.palsync/config.json" };
        return { ok: true, entry: merged, entries: next };
    } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
    }
}

// Change the remembered workspace directory for one entry (the "Change workspace directory…"
// action). Keeps the usage count and the last-launch time — this is a preference edit, not a
// launch. Returns { ok, error? }.
function setWorkspaceDir(entry, workspaceDir, { now } = {}) {
    const clean = sanitizeEntry(entry);
    if (!clean) return { ok: false, error: "incomplete recent-pal entry" };
    if (!str(workspaceDir)) return { ok: false, error: "missing workspace directory" };
    try {
        const existing = list();
        const i = existing.findIndex(e => entryKey(e) === entryKey(clean));
        if (i === -1) return { ok: false, error: "pal is not in the recent list" };
        const next = [...existing];
        next[i] = { ...next[i], workspaceDir: str(workspaceDir), lastLaunchedAt: now || next[i].lastLaunchedAt };
        if (!write(next)) return { ok: false, error: "could not write " + KEY + " to ~/.palsync/config.json" };
        return { ok: true, entries: next };
    } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
    }
}

// Drop one entry — used when the server confirms the pal is gone for this account, so a dead
// row doesn't sit in the menu forever.
function forget(entry) {
    const clean = sanitizeEntry(entry);
    if (!clean) return { ok: false, error: "incomplete recent-pal entry" };
    try {
        const existing = list();
        const next = existing.filter(e => entryKey(e) !== entryKey(clean));
        if (next.length === existing.length) return { ok: true, removed: false };
        if (!write(next)) return { ok: false, error: "could not write " + KEY + " to ~/.palsync/config.json" };
        return { ok: true, removed: true, entries: next };
    } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
    }
}

module.exports = { list, ranked, record, setWorkspaceDir, forget, entryKey, sanitizeEntry, MAX_ENTRIES, MAX_VISIBLE, KEY };
