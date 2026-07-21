"use strict";
// Build/upsert/delete pal-level Data and DataList manifest entries (pal.json's data.entry /
// datalists.entry) with server-verified serialized shapes — see
// bundled-context/skills/palbuilder-core/references/pal-json.md's "data"/"datalists" sections and
// validate/palJson.js's checkDataStructures for the shape these must match.
//
// pal.json stays the single source of truth for push (core/push.js sends whatever is there for
// these two sections, unguarded — see CREATABLE_FOLDERS in core/pull.js). The mirror files under
// data/<name>.json and datalists/<name>.json are kept in sync here purely so:
//   (a) a new, unpushed entry is recognized as "new local work" by core/pull.js's
//       preserve-across-a-forced-pull logic (mergePreservedEntries), which is file-existence
//       based, and
//   (b) the mirror stays truthful for anyone reading the folder, matching what core/pull.js
//       itself writes there on every pull.
// Every function here mutates ONLY the one named entry — every sibling entry in data.entry /
// datalists.entry, and every other top-level pal.json key, is left as the exact same value it
// already was, so it re-serializes unchanged.
const fs = require("fs");
const path = require("path");

function nonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}

// A null/undefined cell is CloudPiston's genuine "empty" wire value (serialized as <null/>, not
// an empty <string></string>) — String(null) would instead write the literal text "null".
function cellToWireValue(cell) {
    return (cell === null || cell === undefined) ? null : String(cell);
}

function readManifest(workspaceDir) {
    const filePath = path.join(workspaceDir, "pal.json");
    let raw;
    try { raw = fs.readFileSync(filePath, "utf8"); }
    catch (e) { throw new Error("could not read pal.json: " + e.message); }
    try { return JSON.parse(raw); }
    catch (e) { throw new Error("pal.json is not valid JSON: " + e.message); }
}

function writeManifest(workspaceDir, manifest) {
    fs.writeFileSync(path.join(workspaceDir, "pal.json"), JSON.stringify(manifest, null, 2), "utf8");
}

// Mirrors core/pull.js's writeJsonEntry: <folder>/<name>.json = just the inner Data/DataList body.
function writeMirrorFile(workspaceDir, folder, name, body) {
    const filePath = path.join(workspaceDir, folder, name + ".json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(body, null, 2), "utf8");
}

function deleteMirrorFile(workspaceDir, folder, name) {
    try { fs.unlinkSync(path.join(workspaceDir, folder, name + ".json")); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
}

// ---- Data — pal-level key/value map (pal.getData("name")) ----

// { string: name, Data: { name, values: { entry: [{ string: [key, value] }, ...] } } }
function buildDataEntry(name, values) {
    if (!nonEmptyString(name)) throw new Error("Data name must be a non-empty string.");
    const trimmed = name.trim();
    const src = values && typeof values === "object" ? values : {};
    const entry = Object.keys(src).map(key => ({ string: [String(key), cellToWireValue(src[key])] }));
    return { string: trimmed, Data: { name: trimmed, values: { entry } } };
}

// Create (name unseen) or update (name matches an existing entry, replaced in place — a full
// replace of that entry's key/value set, not a delta) a named Data map.
function upsertData(workspaceDir, name, values) {
    const built = buildDataEntry(name, values);
    const manifest = readManifest(workspaceDir);
    if (manifest.data == null || manifest.data === "") manifest.data = { entry: [] };
    if (!Array.isArray(manifest.data.entry)) manifest.data.entry = [];
    const idx = manifest.data.entry.findIndex(e => e && e.string === built.string);
    const created = idx === -1;
    if (created) manifest.data.entry.push(built);
    else manifest.data.entry[idx] = built;
    writeManifest(workspaceDir, manifest);
    writeMirrorFile(workspaceDir, "data", built.string, built.Data);
    return { created, name: built.string, entry: built };
}

function deleteData(workspaceDir, name) {
    if (!nonEmptyString(name)) throw new Error("Data name must be a non-empty string.");
    const trimmed = name.trim();
    const manifest = readManifest(workspaceDir);
    const section = manifest.data;
    const list = section && Array.isArray(section.entry) ? section.entry : [];
    const found = list.some(e => e && e.string === trimmed);
    if (found) {
        manifest.data.entry = list.filter(e => !(e && e.string === trimmed));
        writeManifest(workspaceDir, manifest);
    }
    deleteMirrorFile(workspaceDir, "data", trimmed);
    return { deleted: found, name: trimmed };
}

// ---- DataList — pal-level static table (pal.getDataList("name")) ----

// { string: name, DataList: { name, cols: { string: [...] }, recs: { "string-array": [{ string: [...cells] }, ...] } } }
function buildDataListEntry(name, columns, rows) {
    if (!nonEmptyString(name)) throw new Error("DataList name must be a non-empty string.");
    const trimmed = name.trim();
    if (!Array.isArray(columns) || columns.length === 0 || !columns.every(nonEmptyString)) {
        throw new Error("DataList columns must be a non-empty array of non-empty column names.");
    }
    const cols = columns.map(String);
    const list = Array.isArray(rows) ? rows : [];
    list.forEach((row, i) => {
        if (!Array.isArray(row) || row.length !== cols.length) {
            throw new Error("DataList row " + i + " must have exactly " + cols.length +
                " cell(s), one per column (got " + (Array.isArray(row) ? row.length : typeof row) + ").");
        }
    });
    const recs = list.map(row => ({ string: row.map(cellToWireValue) }));
    return { string: trimmed, DataList: { name: trimmed, cols: { string: cols }, recs: { "string-array": recs } } };
}

// Create or update (full replace of that entry's rows, not a delta) a named DataList.
function upsertDataList(workspaceDir, name, columns, rows) {
    const built = buildDataListEntry(name, columns, rows);
    const manifest = readManifest(workspaceDir);
    if (manifest.datalists == null || manifest.datalists === "") manifest.datalists = { entry: [] };
    if (!Array.isArray(manifest.datalists.entry)) manifest.datalists.entry = [];
    const idx = manifest.datalists.entry.findIndex(e => e && e.string === built.string);
    const created = idx === -1;
    if (created) manifest.datalists.entry.push(built);
    else manifest.datalists.entry[idx] = built;
    writeManifest(workspaceDir, manifest);
    writeMirrorFile(workspaceDir, "datalists", built.string, built.DataList);
    return { created, name: built.string, entry: built };
}

function deleteDataList(workspaceDir, name) {
    if (!nonEmptyString(name)) throw new Error("DataList name must be a non-empty string.");
    const trimmed = name.trim();
    const manifest = readManifest(workspaceDir);
    const section = manifest.datalists;
    const list = section && Array.isArray(section.entry) ? section.entry : [];
    const found = list.some(e => e && e.string === trimmed);
    if (found) {
        manifest.datalists.entry = list.filter(e => !(e && e.string === trimmed));
        writeManifest(workspaceDir, manifest);
    }
    deleteMirrorFile(workspaceDir, "datalists", trimmed);
    return { deleted: found, name: trimmed };
}

module.exports = {
    buildDataEntry, buildDataListEntry,
    upsertData, deleteData,
    upsertDataList, deleteDataList,
};
