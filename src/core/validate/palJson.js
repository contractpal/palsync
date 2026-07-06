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
const { findSuggestion } = require("./suggest");
const { analyzeFolderRegistrations } = require("../palFolders");

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

// Manually extracted from the vendored server source (Pal.java / Layout.java field
// declarations) — update this list if those classes gain/lose a serialized field. Excludes
// `transient` Layout fields (logoImage, javaPluginRequired, acrobatPluginRequired,
// acrobatVersionRequired, dashboardWorkflow) — those never reach pal.json.
const TOP_LEVEL_KEYS = [
    "layout", "documents", "emails", "images", "pages", "fragments", "styles", "wizards",
    "workflows", "scripts", "fonts", "datasets", "dataviews", "data", "datalists",
    "attachments", "automatedScripts", "mobileConfigurations", "desktopBindings", "folders",
    "trashCan", "readme", "storeSettings", "consoleSettings", "releaseNotes", "secureFields",
    // palsync-managed bookkeeping (not server fields, but legitimately on disk)
    "id", "path", "environment",
];

const LAYOUT_KEYS = [
    "name", "category", "description", "exportDate", "userWorkflow", "transactionWorkflow",
    "systemWorkflow", "webServiceWorkflow", "consoleWorkflow", "webWorkflow",
    "consoleSystemWorkflow", "consoleWebServiceWorkflow", "userWebServiceWorkflow",
    "tunnelServiceWorkflow", "inheritanceEnabled", "inheritConsole", "inheritWeb",
    "inheritTransaction", "inheritUser", "errorPage", "webErrorPage", "consoleErrorPage",
    "loginPage", "robotsPage", "properties", "roles", "auditDocumentView", "workflowVersion",
    "consoleControlled", "mobileLoginPage", "mobileAccessType", "defaultMobileConfiguration",
    "groupAccessOnly",
];

// A DesktopBinding entry (console home-screen tile) — verified from the vendored server source
// (DesktopBinding extends AbstractConfiguration<DesktopFeature>: name, icon, features,
// resources). No local pal uses this section; it is NOT required for a console pal to work —
// the console workflow registered in layout.consoleWorkflow is what makes a pal usable.
const DESKTOP_BINDING_KEYS = ["name", "icon", "features", "resources"];

// Field names an agent guesses when it needs a tile label/icon and hasn't found the real ones
// (observed: an eval run invented exactly these). Checked before falling back to edit distance
// since they're not textually close to "name"/"icon" but ARE the exact recurring wrong guess.
const DESKTOP_BINDING_ALIASES = {
    desktoplabel: "name", consolelabel: "name", label: "name",
    desktopimage: "icon", consoleimage: "icon", image: "icon",
};

// Same guessed tile-field names, but seen directly under `layout` (an agent that hasn't found
// desktopBindings yet reaches for a plausible-looking layout key instead). No real name/icon
// value exists at this level to alias TO — the whole desktopBindings entry is the correct
// pointer — so this maps to null and the message below tells the agent to go there instead.
const LAYOUT_ALIASES = {
    consoledesktopimage: null, consoledesktoplabel: null,
    desktopimage: null, desktoplabel: null, consoleimage: null, consolelabel: null,
};

// Unknown top-level or layout key with a close real match → error (near-certain invention,
// e.g. a case slip or a plausible-sounding guess). No close match → warn, never error — the
// server's real field set is bigger than this manually-extracted list (wizards/fonts/etc. have
// no local example to verify their shape further, and future platform fields are unknown to us).
function checkUnknownKeys(manifest) {
    const findings = [];
    for (const key of Object.keys(manifest)) {
        if (TOP_LEVEL_KEYS.includes(key)) continue;
        const suggestion = findSuggestion(key, TOP_LEVEL_KEYS);
        findings.push({
            file: "pal.json", line: 1, column: 0,
            severity: suggestion ? "error" : "warn",
            rule: "unknownPalJsonKey",
            message: suggestion
                ? "pal.json top-level key \"" + key + "\" is not a PalBuilder manifest field — the " +
                  "server ignores it silently and your intended change never happens. Did you mean \"" +
                  suggestion + "\"?"
                : "pal.json top-level key \"" + key + "\" is not in palsync's known field list — verify " +
                  "it against a real pal export before relying on it; it may silently no-op.",
        });
    }

    const layout = manifest.layout;
    if (layout && typeof layout === "object" && !Array.isArray(layout)) {
        for (const key of Object.keys(layout)) {
            if (LAYOUT_KEYS.includes(key)) continue;
            const isTileGuess = Object.prototype.hasOwnProperty.call(LAYOUT_ALIASES, key.toLowerCase());
            const suggestion = findSuggestion(key, LAYOUT_KEYS);
            findings.push({
                file: "pal.json", line: 1, column: 0,
                severity: (suggestion || isTileGuess) ? "error" : "warn",
                rule: "unknownPalJsonKey",
                message: isTileGuess
                    ? "pal.json layout.\"" + key + "\" is not a field — there is no layout field for a " +
                      "console pal's home-screen tile label/icon. That lives in the top-level " +
                      "desktopBindings section instead: [{ \"string\": \"<name>\", \"DesktopBinding\": " +
                      "{ \"name\": \"...\", \"icon\": \"...\" } }]. The tile is optional — a console pal " +
                      "works via layout.consoleWorkflow alone; skip it if the spec doesn't ask for one."
                    : suggestion
                    ? "pal.json layout.\"" + key + "\" is not a PalBuilder manifest field — the server " +
                      "ignores it silently and your intended change never happens. Did you mean \"" +
                      suggestion + "\"? Note: there is no layout field for a console pal's desktop " +
                      "tile label/icon — that's the separate, rarely-needed `desktopBindings` section " +
                      "(name/icon per binding), not a `layout` key."
                    : "pal.json layout.\"" + key + "\" is not in palsync's known field list — verify it " +
                      "against a real pal export before relying on it; it may silently no-op.",
            });
        }
    }

    const bindings = manifest.desktopBindings;
    if (bindings != null && bindings !== "" && !Array.isArray(bindings)) {
        findings.push({
            file: "pal.json", line: 1, column: 0, severity: "error", rule: "unknownPalJsonKey",
            message: "pal.json \"desktopBindings\" must be an ARRAY of entries shaped like every " +
                "other section — [{ \"string\": \"<name>\", \"DesktopBinding\": { \"name\": \"...\", " +
                "\"icon\": \"...\" } }] — not an object. (This section registers a console pal's " +
                "home-screen tile and is rarely needed — a console pal works without one via " +
                "layout.consoleWorkflow; don't add it unless the spec asks for a tile.)",
        });
    } else if (Array.isArray(bindings)) {
        for (const entry of bindings) {
            const binding = entry && entry.DesktopBinding;
            if (!binding || typeof binding !== "object") continue;
            for (const key of Object.keys(binding)) {
                if (DESKTOP_BINDING_KEYS.includes(key)) continue;
                const alias = DESKTOP_BINDING_ALIASES[key.toLowerCase()];
                const suggestion = alias || findSuggestion(key, DESKTOP_BINDING_KEYS);
                findings.push({
                    file: "pal.json", line: 1, column: 0,
                    severity: suggestion ? "error" : "warn",
                    rule: "unknownPalJsonKey",
                    message: suggestion
                        ? "pal.json desktopBindings[].DesktopBinding.\"" + key + "\" is not a real field " +
                          "— the server ignores it silently. Did you mean \"" + suggestion + "\"? A " +
                          "DesktopBinding has only name/icon/features/resources — there is no separate " +
                          "label/image field name."
                        : "pal.json desktopBindings[].DesktopBinding.\"" + key + "\" is not in palsync's " +
                          "known field list (name/icon/features/resources) — verify it against a real " +
                          "pal export before relying on it.",
                });
            }
        }
    }
    return findings;
}

function listFilesRecursive(root) {
    const out = [];
    function walk(abs, relBase) {
        let entries;
        try { entries = fs.readdirSync(abs, { withFileTypes: true }); }
        catch (e) { if (e.code === "ENOENT") return; throw e; }
        for (const de of entries) {
            if (de.name.startsWith(".")) continue;
            const childAbs = path.join(abs, de.name);
            const childRel = relBase ? relBase + "/" + de.name : de.name;
            if (de.isDirectory()) walk(childAbs, childRel);
            else if (de.isFile()) out.push(childRel);
        }
    }
    walk(root, "");
    return out;
}

function checkFolderRegistrations(manifest) {
    return analyzeFolderRegistrations(manifest).map(f => {
        const isBucket = f.phantomBucket;
        return {
            file: "pal.json",
            line: 1,
            column: 0,
            severity: "warn",
            rule: "unusedFolderRegistration",
            message: isBucket
                ? "pal.json folders registers " + f.folderType + "/" + f.name + ", but \"" + f.name +
                  "\" is a local workspace bucket name, not a real PalBuilder subfolder. PalBuilder will show an unnecessary empty folder. " +
                  "Fix: remove this folders.Folder entry; files already belong to the " + f.folderType + " category via their own manifest section."
                : "pal.json folders registers " + f.folderType + "/" + f.name + ", but no manifest entry in that category lives under \"" +
                  f.name + "/\". This creates an empty PalBuilder folder. Fix: remove the folders.Folder entry, or move/register a file under \"" +
                  f.name + "/...\" if the subfolder is intentional."
        };
    });
}

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

        const diskFiles = listFilesRecursive(folderPath);

        // Build the set of strings registered in pal.json for this folder.
        const section = manifest[folder];
        const registered = new Set();
        if (section && Array.isArray(section.entry)) {
            for (const entry of section.entry) {
                if (typeof entry.string === "string") registered.add(entry.string);
            }
        }

        // Report any file on disk that has no pal.json entry. Recursive because manifest strings
        // may contain subpaths, e.g. fragments/equipment/list.html.
        for (const rel of diskFiles) {
            if (!registered.has(rel)) {
                const typeHint = FOLDER_TYPE[folder] || folder;
                findings.push({
                    file: "pal.json",
                    line: 1,   // pal.json has no meaningful line for missing entries
                    column: 0,
                    severity: "error",
                    rule: "missingPalJsonEntry",
                    message: folder + "/" + rel + " exists on disk but has NO pal.json entry — " +
                        "push will silently skip it and the server will never receive it. " +
                        "Fix: add a matching entry to pal.json (copy an existing " + typeHint + " entry " +
                        "inside the \"" + folder + "\".entry array and set both \"string\" and \"filename\" to \"" + rel + "\").",
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

    findings.push(...checkUnknownKeys(manifest));
    findings.push(...checkFolderRegistrations(manifest));

    return findings;
}

module.exports = { lintPalJson, checkUnknownKeys, checkFolderRegistrations, listFilesRecursive };
