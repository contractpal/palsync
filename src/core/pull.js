"use strict";
// Headless pull: resolve fresh id by GUID -> getPal(id) -> SYNC the server pal to disk.
//
// SYNC, NOT WIPE. The 14 manifest folders (pages, fragments, scripts, styles, …) are
// pull-managed: their contents are replaced with the server state, and files that no longer
// exist on the server are removed. Everything ELSE in the workspace — files at the root
// (spec.md, notes, the palsync-managed .palsync.json / CLAUDE.md / .claude/), user-created
// subdirs (references/, docs/) — is left ALONE. This is the symmetric-with-git-pull contract:
// pull touches only the files it manages.
//
// Datasets/dataviews/data/datalists are JSON passthrough — written verbatim, never created or
// altered semantically. Only the 10 base64 "content" types are decoded to files (and then
// blanked in pal.json by clearContent, exactly like the extension).
const fs = require("fs/promises");
const path = require("path");
const { CloudPistonAPIManager } = require("../../lib/apiManager");
const { Pal } = require("../../lib/pal");
const { resolveServerPalByGuid } = require("./resolve");
// Named baselineStore (not `baseline`) on purpose: pull()'s options already destructure a
// `baseline` (the fileHashes map for the sync decision), which would shadow this inside the fn.
const baselineStore = require("./baseline");

// The 14 manifest folders pull manages. Files INSIDE these are pull-owned and may be deleted
// as stale; anything outside is left alone.
const ALL_FOLDERS = [
    "data", "datalists", "datasets", "dataviews",
    "attachments", "documents", "emails", "fragments",
    "images", "pages", "scripts", "styles", "workflows", "wizards"
];

// JSON-based entry types: [getter, entry sub-key, folder]
const JSON_TYPES = [
    ["allData", "Data", "data"],
    ["allDatalists", "DataList", "datalists"],
    ["allDatasets", "Dataset", "datasets"],
    ["allDataviews", "Dataview", "dataviews"]
];

// Base64-based ("content") entry types: [getter, entry sub-key, folder]
const BASE64_TYPES = [
    ["allAttachments", "Attachment", "attachments"],
    ["allDocuments", "Document", "documents"],
    ["allEmails", "Email", "emails"],
    ["allFragments", "Fragment", "fragments"],
    ["allImages", "Image", "images"],
    ["allPages", "Page", "pages"],
    ["allScripts", "Script", "scripts"],
    ["allStyles", "Style", "styles"],
    ["allWorkflows", "Workflow", "workflows"],
    ["allWizards", "Wizard", "wizards"]
];

// Folders whose NEW local files palsync can legitimately push (and so whose pal.json entries
// are worth carrying forward through a pull). Workflows are creatable too (well-formed, with a
// workflowType). documents/fonts are server-rejected on create; datasets/dataviews/data/datalists
// are PalBuilder-provisioned. Files of those types are still PRESERVED on disk (never destroy
// local work) — they just can't ride a push.
const CREATABLE_FOLDERS = new Set(["pages", "fragments", "scripts", "styles", "images", "emails", "attachments", "workflows", "wizards"]);

// Compute the set of POSIX-style relative paths the current server manifest will write into
// the workspace (everything inside the 14 manifest folders). Exposed for tests/diagnostics.
function manifestPaths(pal) {
    const out = new Set();
    for (const [getter, , folder] of JSON_TYPES) {
        for (const entry of pal[getter]) out.add(folder + "/" + entry.string + ".json");
    }
    for (const [getter, , folder] of BASE64_TYPES) {
        for (const entry of pal[getter]) out.add(folder + "/" + entry.string);
    }
    return out;
}

// THE SYNC DECISION (pure, unit-testable): which local files under the manifest folders are
// deleted vs preserved, given the current server manifest and the per-file baseline recorded
// at the last pull/push (record.fileHashes — its KEYS are the files the server tracked then).
//
//   in server manifest                         → overwritten by expandPalFiles (not listed here)
//   not on server, IN baseline                 → the server deleted it → delete locally
//   not on server, NOT in baseline             → new un-pushed local work → PRESERVE
//   not on server, no baseline available       → legacy behavior: delete (pre-baseline records
//                                                 can't tell the two cases apart; the launcher/
//                                                 pal_pull drift guard fires before this anyway)
function planSync(localTracked, serverSet, baseline) {
    const toDelete = [], toPreserve = [];
    for (const rel of localTracked) {
        if (serverSet.has(rel)) continue;
        if (!baseline || rel in baseline) toDelete.push(rel);
        else toPreserve.push(rel);
    }
    return { toDelete, toPreserve };
}

// Carry the pal.json entries of preserved NEW files forward into the fresh (server) manifest,
// so the next push still ships them. Only creatable types merge; preserved files of other
// types keep their bytes on disk but are reported as needing PalBuilder creation. Mutates pal.
// Returns [{ rel, merged, note }].
function mergePreservedEntries(pal, oldPalJson, toPreserve) {
    const report = [];
    for (const rel of toPreserve) {
        const slash = rel.indexOf("/");
        const folder = rel.slice(0, slash);
        const entryString = rel.slice(slash + 1); // fragments keep subpaths, e.g. contacts/list.html
        if (!CREATABLE_FOLDERS.has(folder)) {
            report.push({ rel, merged: false, note: "preserved on disk; this type can't be created via push — create it in PalBuilder first" });
            continue;
        }
        const node = oldPalJson && oldPalJson[folder] && Array.isArray(oldPalJson[folder].entry)
            ? oldPalJson[folder].entry : [];
        const oldEntry = node.find(e => e && e.string === entryString);
        if (!oldEntry) {
            report.push({ rel, merged: false, note: "preserved on disk; no pal.json entry found — add one so push can ship it" });
            continue;
        }
        if (!pal[folder] || pal[folder] === "") pal[folder] = { entry: [] };
        if (!Array.isArray(pal[folder].entry)) pal[folder].entry = [];
        if (!pal[folder].entry.some(e => e && e.string === entryString)) {
            pal[folder].entry.push(oldEntry);
        }
        report.push({ rel, merged: true, note: "new local file — preserved and kept in pal.json for the next push" });
    }
    return report;
}

// List every file currently under the 14 manifest folders (recursive, files only). Returns
// POSIX-style relative paths so equality with manifestPaths() comparison is straightforward.
async function listTrackedFiles(targetDir) {
    const out = [];
    async function walk(dirAbs, relBase) {
        let entries;
        try { entries = await fs.readdir(dirAbs, { withFileTypes: true }); }
        catch (e) { if (e.code === "ENOENT") return; throw e; }
        for (const e of entries) {
            const childAbs = path.join(dirAbs, e.name);
            const childRel = relBase ? relBase + "/" + e.name : e.name;
            if (e.isDirectory()) await walk(childAbs, childRel);
            else out.push(childRel);
        }
    }
    for (const folder of ALL_FOLDERS) await walk(path.join(targetDir, folder), folder);
    return out;
}

// After deletions, prune empty directories INSIDE the 14 manifest folders (bottom-up). The
// 14 top-level folders themselves are kept (mkdir-recursive re-creates them anyway, and
// keeping them around makes the workspace shape stable). Never touches dirs outside the 14.
async function pruneEmptySubdirs(targetDir) {
    async function prune(dirAbs, depth) {
        let entries;
        try { entries = await fs.readdir(dirAbs, { withFileTypes: true }); }
        catch (e) { if (e.code === "ENOENT") return; throw e; }
        for (const e of entries) {
            if (e.isDirectory()) await prune(path.join(dirAbs, e.name), depth + 1);
        }
        if (depth === 0) return;                         // keep the 14 top-level dirs
        const after = await fs.readdir(dirAbs);
        if (after.length === 0) await fs.rmdir(dirAbs);
    }
    for (const folder of ALL_FOLDERS) await prune(path.join(targetDir, folder), 0);
}

async function writeJsonEntry(baseDir, folder, name, data) {
    const filePath = path.join(baseDir, folder, `${name}.json`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function writeBase64Entry(baseDir, folder, name, base64Content) {
    const filePath = path.join(baseDir, folder, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true }); // name may contain subdirs
    await fs.writeFile(filePath, Buffer.from(base64Content || "", "base64"));
}

// Port of expandPalFiles(): default folders + JSON entries + base64 entries to disk.
async function expandPalFiles(pal) {
    const written = { json: [], base64: [] };
    for (const folder of ALL_FOLDERS) {
        await fs.mkdir(path.join(pal.path, folder), { recursive: true });
    }
    for (const [getter, key, folder] of JSON_TYPES) {
        for (const entry of pal[getter]) {
            await writeJsonEntry(pal.path, folder, entry.string, entry[key]);
            written.json.push(path.join(folder, `${entry.string}.json`));
        }
    }
    for (const [getter, key, folder] of BASE64_TYPES) {
        for (const entry of pal[getter]) {
            const content = entry[key] ? entry[key].content : "";
            await writeBase64Entry(pal.path, folder, entry.string, content);
            written.base64.push(path.join(folder, entry.string));
        }
    }
    return written;
}

// Port of clearContent(): blank the 9 base64 content fields before saving pal.json.
function clearContent(pal) {
    for (const [getter, key] of BASE64_TYPES) {
        for (const entry of pal[getter]) {
            if (entry[key]) entry[key].content = "";
        }
    }
}

// Port of saveLocal(): write pal.json (structure only; base64 content blanked).
async function saveLocal(pal) {
    await fs.mkdir(pal.path, { recursive: true });
    await fs.writeFile(path.join(pal.path, "pal.json"), JSON.stringify(pal, null, 2), "utf8");
}

// Full pull (SYNC). Returns { resolved, serverPal, pal, written, removed, preserved, serverPaths }.
//   - Pull-managed = the 14 manifest folders + pal.json. Files there are overwritten with the
//     server state; files the server no longer tracks are removed ONLY when the baseline
//     proves the server tracked them before (a real server-side delete). New un-pushed local
//     files are PRESERVED and their pal.json entries carried forward (see planSync /
//     mergePreservedEntries). Without a baseline (legacy records), behavior is unchanged.
//   - Everything else in targetDir is untouched (root-level user files like spec.md, user-
//     created subdirs like references/, and palsync-managed files .palsync.json / CLAUDE.md /
//     .claude/ / .mcp.json all survive a pull cleanly).
// environment carries only the url — never credentials, so nothing secret reaches pal.json.
//   baseline = the record.fileHashes map from the last pull/push (or null).
async function pull(session, guid, targetDir, { baseline = null } = {}) {
    const resolved = await resolveServerPalByGuid(session, guid);
    if (!resolved) {
        throw new Error("GUID " + guid + " not found on " + session.environment.url);
    }
    const palResp = await CloudPistonAPIManager.getPal(session, resolved.id);
    if (!palResp || !palResp.success || !palResp.pal) {
        throw new Error("GetPal.do failed for id " + resolved.id);
    }
    const serverPal = palResp.pal;

    // 1) Ensure the workspace dir exists (no-op if already there — DO NOT wipe). Read the old
    //    local pal.json BEFORE anything overwrites it — preserved new files need their entries.
    await fs.mkdir(targetDir, { recursive: true });
    let oldPalJson = null;
    try { oldPalJson = JSON.parse(await fs.readFile(path.join(targetDir, "pal.json"), "utf8")); }
    catch (e) { /* fresh workspace or unreadable manifest — nothing to merge */ }

    // Deep-clone for the Pal instance: expandPalFiles writes from it and clearContent blanks
    // its base64 content in place. Cloning keeps the returned serverPal pristine (full content)
    // so callers/drift checks see the true server state, not a half-cleared object.
    const palData = JSON.parse(JSON.stringify(serverPal));
    const pal = new Pal(Object.assign(palData, {
        id: resolved.id,
        path: targetDir,
        environment: { url: session.environment.url, name: session.environment.name, platformVersion: session.environment.platformVersion || "" }
    }));

    // 2) STALE-DELETE vs PRESERVE: decide per local file via the baseline (see planSync).
    const serverSet = manifestPaths(pal);
    const localTracked = await listTrackedFiles(targetDir);
    const { toDelete, toPreserve } = planSync(localTracked, serverSet, baseline);
    const removed = [];
    for (const rel of toDelete) {
        await fs.unlink(path.join(targetDir, ...rel.split("/")));
        removed.push(rel);
    }

    // 3) Write the server state. expandPalFiles mkdir's each folder + sub-path, then writes
    //    JSON entries and base64 entries — overwriting any prior local versions in place.
    const written = await expandPalFiles(pal);

    // 4) Prune any subdirs INSIDE the 14 manifest folders that became empty after deletions.
    //    The 14 top-level folders themselves stay (kept for stable workspace shape).
    await pruneEmptySubdirs(targetDir);

    // 5) Carry preserved new files' manifest entries forward, then write pal.json (base64
    //    content blanked). pal.json = server manifest + the preserved local-only entries, so
    //    the next push still ships the user's new files.
    const preserved = mergePreservedEntries(pal, oldPalJson, toPreserve);
    clearContent(pal);
    await saveLocal(pal);

    // serverPaths = exactly the files the SERVER tracks right now (what expandPalFiles wrote).
    // Callers build the next fileHashes baseline from this — preserved local files must NOT
    // enter the baseline, or the next pull would mistake them for server-side deletes.
    const serverPaths = [...serverSet];

    // Snapshot the baseline CONTENT (lintable server files, now == server) for the new-errors
    // pre-push gate. Preserved local-only files are excluded (not in serverPaths), so they read
    // as "added" (no baseline) and any errors in them correctly count as new.
    baselineStore.snapshot(targetDir, serverPaths);

    return { resolved, serverPal, pal, written, removed, preserved, serverPaths };
}

module.exports = { pull, expandPalFiles, clearContent, saveLocal, manifestPaths, listTrackedFiles, pruneEmptySubdirs, planSync, mergePreservedEntries, ALL_FOLDERS, CREATABLE_FOLDERS };
