"use strict";
// Lint the pal.json manifest against files actually present on disk — the failure mode that
// caused the "silent-push-skip" incident: 22 new pages had no manifest entry; palsync push
// reported success, but the server never received those files because push skips anything with
// no pal.json entry.
//
// For each creatable folder (pages, fragments, styles, scripts, images, emails, attachments):
//   files on disk (non-dotfiles) that have NO matching entry in pal.json → ERROR.
//
// The check is silently skipped when pal.json is absent or unparseable — validate also runs
// on non-workspace directories (temp dirs, partial trees, etc.) and we must not noise on those.
const fs = require("fs");
const path = require("path");

// Folders whose files are pushed via pal.json entries. Matches the keys used in real pal.json
// files (verified against V2-OE-Website).
const CREATABLE_FOLDERS = ["pages", "fragments", "styles", "scripts", "images", "emails", "attachments"];

// Type hint for the error message so the agent knows which stanza to copy.
const FOLDER_TYPE = {
    pages:       "Page",
    fragments:   "Fragment",
    styles:      "Style",
    scripts:     "Script",
    images:      "Image",
    emails:      "Email",
    attachments: "Attachment",
};

function lintPalJson(workspaceDir) {
    // Locate pal.json.
    const palJsonPath = path.join(workspaceDir, "pal.json");
    let raw;
    try { raw = fs.readFileSync(palJsonPath, "utf8"); }
    catch (e) { return []; } // not a workspace — skip silently

    let manifest;
    try { manifest = JSON.parse(raw); }
    catch (e) { return []; } // unparseable — skip silently

    const findings = [];

    for (const folder of CREATABLE_FOLDERS) {
        const folderPath = path.join(workspaceDir, folder);

        // Collect files on disk (non-recursive — pal.json entries are flat per folder).
        let diskFiles;
        try {
            diskFiles = fs.readdirSync(folderPath, { withFileTypes: true });
        } catch (e) {
            if (e.code === "ENOENT") continue; // folder doesn't exist — fine
            throw e;
        }

        // Build the set of strings registered in pal.json for this folder.
        const section = manifest[folder];
        const registered = new Set();
        if (section && Array.isArray(section.entry)) {
            for (const entry of section.entry) {
                if (typeof entry.string === "string") registered.add(entry.string);
            }
        }

        // Report any file on disk that has no pal.json entry.
        for (const de of diskFiles) {
            if (!de.isFile()) continue;
            if (de.name.startsWith(".")) continue; // skip dotfiles

            if (!registered.has(de.name)) {
                const typeHint = FOLDER_TYPE[folder] || folder;
                findings.push({
                    file: "pal.json",
                    line: 1,   // pal.json has no meaningful line for missing entries
                    column: 0,
                    severity: "error",
                    rule: "missingPalJsonEntry",
                    message: folder + "/" + de.name + " exists on disk but has NO pal.json entry — " +
                        "push will silently skip it and the server will never receive it. " +
                        "Fix: add a matching entry to pal.json (copy an existing " + typeHint + " entry " +
                        "inside the \"" + folder + "\".entry array and set both \"string\" and \"filename\" to \"" + de.name + "\").",
                });
            }
        }
    }

    // datasets/*.json — same silent-skip failure as CREATABLE_FOLDERS above, but the entry
    // shape differs: pal.json's datasets.entry[].string is the dataset NAME (basename without
    // ".json"), wrapped in a "Dataset" object, not a "filename" pointing at the file on disk
    // (see palbuilder-data/references/datasets.md, "Registering a dataset"). Handled separately
    // from CREATABLE_FOLDERS for that reason.
    {
        const folderPath = path.join(workspaceDir, "datasets");
        let diskFiles;
        try { diskFiles = fs.readdirSync(folderPath, { withFileTypes: true }); }
        catch (e) { if (e.code !== "ENOENT") throw e; diskFiles = null; }

        if (diskFiles) {
            const section = manifest.datasets;
            const registered = new Set();
            if (section && Array.isArray(section.entry)) {
                for (const entry of section.entry) {
                    if (typeof entry.string === "string") registered.add(entry.string);
                }
            }

            for (const de of diskFiles) {
                if (!de.isFile()) continue;
                if (de.name.startsWith(".") || !de.name.endsWith(".json")) continue;
                const baseName = de.name.slice(0, -".json".length);

                if (!registered.has(baseName)) {
                    findings.push({
                        file: "pal.json",
                        line: 1,
                        column: 0,
                        severity: "error",
                        rule: "missingPalJsonEntry",
                        message: "datasets/" + de.name + " exists on disk but has NO pal.json entry — " +
                            "the table will never be provisioned server-side. " +
                            "Fix: add an entry to pal.json's \"datasets\".entry array with \"string\": \"" + baseName +
                            "\" and a \"Dataset\" object (name, fields.DatasetField[], freeform:true) matching " +
                            "datasets/" + de.name + ".",
                    });
                }
            }
        }
    }

    return findings;
}

module.exports = { lintPalJson };
