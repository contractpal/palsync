"use strict";
// Helpers for pal.json `folders` registrations.
//
// PalBuilder category folders (Pages, Fragments, Workflows, ...) are implicit. The `folders`
// section is only for real subfolders inside a category, such as workflows/defaults or
// fragments/equipment. Weak models sometimes register the local workspace bucket names themselves
// (`pages`, `fragments`, `styles`, ...), which creates empty-looking folders in PalBuilder.

const SECTION_FOLDER_TYPES = {
    pages: "Pages",
    fragments: "Fragments",
    styles: "Styles",
    scripts: "Scripts",
    images: "Images",
    emails: "Emails",
    attachments: "Attachments",
    documents: "Documents",
    fonts: "Fonts",
    workflows: "Workflows",
    wizards: "Wizards"
};

const WORKSPACE_BUCKET_NAMES = new Set([
    "pages", "fragments", "styles", "scripts", "images", "emails", "attachments",
    "documents", "fonts", "workflows", "datasets", "dataviews", "data", "datalists", "wizards"
]);

function asArray(node) {
    if (!node) return [];
    return Array.isArray(node) ? node : [node];
}

function sectionEntries(manifest, key) {
    const section = manifest && manifest[key];
    return asArray(section && section.entry);
}

function folderEntries(manifest) {
    const folders = manifest && manifest.folders;
    if (!folders || folders === "") return [];
    if (Array.isArray(folders)) return folders;
    return asArray(folders.Folder);
}

function parentDirs(entryString) {
    if (typeof entryString !== "string" || entryString.indexOf("/") === -1) return [];
    const parts = entryString.split("/").filter(Boolean);
    parts.pop();
    const out = [];
    for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("/"));
    return out;
}

function usedFolderKeys(manifest) {
    const used = new Set();
    for (const key of Object.keys(SECTION_FOLDER_TYPES)) {
        const folderType = SECTION_FOLDER_TYPES[key];
        for (const entry of sectionEntries(manifest, key)) {
            for (const dir of parentDirs(entry && entry.string)) {
                used.add(folderType + "\0" + dir);
            }
        }
    }
    return used;
}

function analyzeFolderRegistrations(manifest) {
    const used = usedFolderKeys(manifest);
    const out = [];
    const entries = folderEntries(manifest);
    for (let i = 0; i < entries.length; i++) {
        const f = entries[i] || {};
        const name = typeof f.name === "string" ? f.name : "";
        const folderType = typeof f.folderType === "string" ? f.folderType : "";
        if (!name || !folderType) continue;
        const isUsed = used.has(folderType + "\0" + name);
        if (isUsed) continue;
        out.push({
            index: i,
            name,
            folderType,
            phantomBucket: WORKSPACE_BUCKET_NAMES.has(name),
            reason: WORKSPACE_BUCKET_NAMES.has(name)
                ? "workspace bucket name registered as a PalBuilder subfolder"
                : "no manifest file lives under this registered subfolder"
        });
    }
    return out;
}

function prunePhantomFolderRegistrations(manifest) {
    const unused = analyzeFolderRegistrations(manifest).filter(f => f.phantomBucket);
    if (!unused.length || !manifest || !manifest.folders || manifest.folders === "") return [];

    const remove = new Set(unused.map(f => f.index));
    const original = folderEntries(manifest);
    const kept = original.filter((_, i) => !remove.has(i));
    if (Array.isArray(manifest.folders)) manifest.folders = kept;
    else manifest.folders.Folder = kept;
    return unused.map(f => ({ name: f.name, folderType: f.folderType, reason: f.reason }));
}

module.exports = {
    SECTION_FOLDER_TYPES,
    WORKSPACE_BUCKET_NAMES,
    analyzeFolderRegistrations,
    prunePhantomFolderRegistrations,
    parentDirs
};
