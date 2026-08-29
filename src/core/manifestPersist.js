"use strict";
// Stable manifest persistence — the single contract pull and merge share.
//
// Defects fixed:
//   - runtime-only `id`, `path`, `environment` leaked into pal.json, tying bytes/mtime to the
//     local workspace and session.
//   - empty sections flipped between "" and {entry:[]}/{Folder:[]} on every pull.
//   - top-level key order churned with server enumeration.
//
// Contract:
//   - omit id/path/environment from disk; Pal.fromPath / push reconstruct them.
//   - preserve unknown server fields verbatim.
//   - preserve array order (never sort arrays or recursively reorder).
//   - when a known empty section is still empty on both sides, keep the prior literal "" vs wrapper.
//   - preserve prior top-level key order for existing keys; append genuinely new keys alphabetically.
//   - two-space indent, one trailing newline, skip unchanged writes (mtime stable).
const fs = require("fs/promises");
const path = require("path");
const { writeIfChanged } = require("./atomicWrite");

const RUNTIME_KEYS = new Set(["id", "path", "environment"]);

// Known entry-array sections that Pal normalizes from "" -> {entry:[]} (see lib/pal.js)
const ENTRY_SECTIONS = [
    "documents", "emails", "images", "pages", "fragments", "styles",
    "workflows", "scripts", "datasets", "dataviews", "data", "datalists",
    "attachments", "wizards"
];

function isEntryEmpty(value) {
    if (value === "") return true;
    if (value == null) return false;
    if (typeof value === "object" && !Array.isArray(value)) {
        return Array.isArray(value.entry) && value.entry.length === 0;
    }
    return false;
}

function isFoldersEmpty(value) {
    if (value === "") return true;
    if (value == null) return false;
    if (typeof value === "object" && !Array.isArray(value)) {
        return Array.isArray(value.Folder) && value.Folder.length === 0;
    }
    return false;
}

function isSemanticallyEmpty(key, value) {
    if (ENTRY_SECTIONS.includes(key)) return isEntryEmpty(value);
    if (key === "folders") return isFoldersEmpty(value);
    return false;
}

// Build the plain object that will be serialized — strip runtime keys, apply empty preservation.
function buildPersistedObject(pal, priorRaw) {
    const out = {};
    for (const k of Object.keys(pal)) {
        if (RUNTIME_KEYS.has(k)) continue;
        out[k] = pal[k];
    }
    if (priorRaw && typeof priorRaw === "object") {
        for (const key of [...ENTRY_SECTIONS, "folders"]) {
            if (key in priorRaw && key in out) {
                const priorVal = priorRaw[key];
                const newVal = out[key];
                if (isSemanticallyEmpty(key, priorVal) && isSemanticallyEmpty(key, newVal)) {
                    out[key] = priorVal;
                }
            }
        }
    }
    return out;
}

// Preserve prior top-level key order for keys that still exist; append new keys alphabetically.
// New keys are those present in `obj` but absent from `priorRaw`.
function orderKeys(obj, priorRaw) {
    if (!priorRaw || typeof priorRaw !== "object" || Array.isArray(priorRaw)) {
        const keys = Object.keys(obj).sort();
        const ordered = {};
        for (const k of keys) ordered[k] = obj[k];
        return ordered;
    }
    const newKeys = Object.keys(obj).filter(k => !(k in priorRaw)).sort();
    const ordered = {};
    for (const k of Object.keys(priorRaw)) {
        if (k in obj) ordered[k] = obj[k];
    }
    for (const k of newKeys) ordered[k] = obj[k];
    return ordered;
}

function serializeManifest(obj, priorRaw) {
    const ordered = orderKeys(obj, priorRaw);
    return JSON.stringify(ordered, null, 2) + "\n";
}

// Persist `pal` to workspaceDir/pal.json using the stable contract. priorRaw is the prior
// parsed pal.json or null. Returns true if bytes changed (file written), false if skipped.
async function persistManifest(workspaceDir, pal, priorRaw) {
    const plain = buildPersistedObject(pal, priorRaw);
    const content = serializeManifest(plain, priorRaw);
    return writeIfChanged(path.join(workspaceDir, "pal.json"), content);
}

module.exports = {
    buildPersistedObject,
    serializeManifest,
    persistManifest
};
