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
const { buildSnapshot, isUnsafeTarget } = require("./snapshot");
const { analyzeFolderRegistrations } = require("../palFolders");

// Folders whose files are pushed via pal.json entries. Matches the keys used in real pal.json
// files (verified against V2-OE-Website).
const CREATABLE_FOLDERS = ["pages", "fragments", "styles", "scripts", "images", "emails", "attachments", "wizards"];

// Type hint for the error message so the agent knows which stanza to copy.
const FOLDER_TYPE = {
    pages:       "Page",
    fragments:   "Fragment",
    styles:      "Style",
    scripts:     "Script",
    images:      "Image",
    emails:      "Email",
    attachments: "Attachment",
    wizards:     "Wizard",
};

function manifestEntryTemplate(rel, typeName) {
    const name = rel.replace(/\.[^./]+$/, "");
    return [
        "{",
        "  \"string\": \"" + rel + "\",",
        "  \"" + typeName + "\": { \"name\": \"" + name + "\", \"filename\": \"" + rel + "\" }",
        "}"
    ].join("\n");
}

function datasetEntryTemplate(name, snapshot) {
    const source = (snapshot.datasets || []).find(file => file.rel === "datasets/" + name + ".json");
    let dataset = { name, fields: { DatasetField: [] }, freeform: true };
    try { if (source) dataset = JSON.parse(source.content); } catch (e) { /* dataset linter reports parse failure */ }
    return [
        "{",
        "  \"string\": \"" + name + "\",",
        "  \"Dataset\": " + JSON.stringify(dataset),
        "}"
    ].join("\n");
}

function arrayObjectBounds(raw, arrayStart, wantedIndex) {
    let inString = false;
    let escaped = false;
    let depth = 0;
    let index = -1;
    let start = -1;
    for (let i = arrayStart + 1; i < raw.length; i++) {
        const ch = raw[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === "{") {
            if (depth === 0) {
                index++;
                if (index === wantedIndex) start = i;
            }
            depth++;
        } else if (ch === "}") {
            depth--;
            if (depth === 0 && index === wantedIndex) return { start, end: i + 1 };
        } else if (ch === "]" && depth === 0) break;
    }
    return null;
}

function lineForFinding(raw, finding) {
    if (!raw) return 1;
    const message = String(finding.message || "");
    const stringValue = message.match(/"string"\s*:\s*"([^"]+)"/);
    const entryPath = message.match(/pal\.json\s+([A-Za-z]+)\.entry\[(\d+)\]((?:\.[A-Za-z]+)*)/);
    if (entryPath) {
        const sectionAt = raw.indexOf(JSON.stringify(entryPath[1]));
        const entryAt = sectionAt === -1 ? -1 : raw.indexOf('"entry"', sectionAt);
        const arrayAt = entryAt === -1 ? -1 : raw.indexOf("[", entryAt);
        const bounds = arrayAt === -1 ? null : arrayObjectBounds(raw, arrayAt, Number(entryPath[2]));
        if (bounds) {
            const fields = entryPath[3].split(".").filter(Boolean);
            const field = fields.length ? fields[fields.length - 1] : null;
            const valueAt = stringValue ? raw.indexOf(JSON.stringify(stringValue[1]), bounds.start) : -1;
            const fieldAt = field ? raw.indexOf(JSON.stringify(field), bounds.start) : valueAt;
            const at = fieldAt >= bounds.start && fieldAt < bounds.end ? fieldAt : bounds.start;
            return raw.slice(0, at).split("\n").length;
        }
    }
    const quoted = (stringValue ? [stringValue[1]] : [])
        .concat([...message.matchAll(/"([^"]+)"/g)].map(match => match[1]))
        .filter((value, index, values) => values.indexOf(value) === index);
    for (const value of quoted) {
        const at = raw.indexOf(JSON.stringify(value));
        if (at !== -1) return raw.slice(0, at).split("\n").length;
    }
    return 1;
}

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

function shapeFinding(message) {
    return {
        file: "pal.json", line: 1, column: 0,
        severity: "error", rule: "invalidPalJsonShape", message,
    };
}

function isObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}

// `Data` and `DataList` shapes are grounded in the vendored JAXB classes and in the
// corresponding always-array paths in lib/xmlParser.js:
//   Data.values.entry[].string                 -> [key, value]
//   DataList.cols.string                       -> column names
//   DataList.recs["string-array"][].string     -> row values
// These checks intentionally accept empty-string containers because empty XML elements are
// represented as "" by the pull parser.
function checkNamedManifestSection(manifest, sectionName, typeName, validateBody) {
    const findings = [];
    const section = manifest[sectionName];
    if (section == null || section === "") return findings;
    if (!isObject(section) || !Array.isArray(section.entry)) {
        findings.push(shapeFinding("pal.json \"" + sectionName + "\" must be an object with an " +
            "entry array: { \"entry\": [{ \"string\": \"<name>\", \"" + typeName +
            "\": { ... } }] }."));
        return findings;
    }

    for (let i = 0; i < section.entry.length; i++) {
        const entry = section.entry[i];
        const at = "pal.json " + sectionName + ".entry[" + i + "]";
        if (!isObject(entry) || !nonEmptyString(entry.string)) {
            findings.push(shapeFinding(at + " must be an object with a non-empty string identifier."));
            continue;
        }
        const body = entry[typeName];
        if (!isObject(body)) {
            findings.push(shapeFinding(at + " must contain a \"" + typeName + "\" object."));
            continue;
        }
        if (!nonEmptyString(body.name)) {
            findings.push(shapeFinding(at + "." + typeName + ".name must be a non-empty string."));
        } else if (body.name !== entry.string) {
            findings.push(shapeFinding(at + ".string (\"" + entry.string + "\") must match " +
                typeName + ".name (\"" + body.name + "\")."));
        }
        findings.push(...validateBody(body, at + "." + typeName));
    }
    return findings;
}

function checkDataStructures(manifest) {
    const findings = [];
    findings.push(...checkNamedManifestSection(manifest, "data", "Data", (data, at) => {
        const out = [];
        for (const key of Object.keys(data)) {
            if (key !== "name" && key !== "values") {
                out.push(shapeFinding(at + "." + key + " is not a serialized Data field; use " +
                    "values.entry[].string key/value pairs."));
            }
        }
        if (data.values == null || data.values === "") return out;
        if (!isObject(data.values) || !Array.isArray(data.values.entry)) {
            out.push(shapeFinding(at + ".values must be { \"entry\": [{ \"string\": " +
                "[\"<key>\", \"<value>\"] }] }."));
            return out;
        }
        for (let i = 0; i < data.values.entry.length; i++) {
            const pair = data.values.entry[i];
            if (!isObject(pair) || !Array.isArray(pair.string) || pair.string.length !== 2 ||
                !nonEmptyString(pair.string[0])) {
                out.push(shapeFinding(at + ".values.entry[" + i + "].string must be a two-item " +
                    "[key, value] array with a non-empty string key."));
            }
        }
        return out;
    }));

    findings.push(...checkNamedManifestSection(manifest, "datalists", "DataList", (list, at) => {
        const out = [];
        for (const key of Object.keys(list)) {
            if (key !== "name" && key !== "cols" && key !== "recs") {
                out.push(shapeFinding(at + "." + key + " is not a serialized DataList field; use " +
                    "cols.string and recs[\"string-array\"]."));
            }
        }
        const columns = isObject(list.cols) ? list.cols.string : null;
        if (!Array.isArray(columns) || columns.length === 0 || !columns.every(nonEmptyString)) {
            out.push(shapeFinding(at + ".cols.string must be a non-empty array of column names; " +
                "the serialized field is \"cols\", not \"columns\"."));
            return out;
        }
        if (list.recs == null || list.recs === "") return out;
        const rows = isObject(list.recs) ? list.recs["string-array"] : null;
        if (!Array.isArray(rows)) {
            out.push(shapeFinding(at + ".recs must be { \"string-array\": " +
                "[{ \"string\": [<cell>, ...] }] }."));
            return out;
        }
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!isObject(row) || !Array.isArray(row.string) || row.string.length !== columns.length) {
                out.push(shapeFinding(at + ".recs[\"string-array\"][" + i + "].string must contain " +
                    columns.length + " cell(s), one for each cols.string entry."));
            }
        }
        return out;
    }));

    const bindings = manifest.desktopBindings;
    if (Array.isArray(bindings)) {
        for (let i = 0; i < bindings.length; i++) {
            const entry = bindings[i];
            const at = "pal.json desktopBindings[" + i + "]";
            if (!isObject(entry) || !nonEmptyString(entry.string)) {
                findings.push(shapeFinding(at + " must have a non-empty string identifier."));
                continue;
            }
            const binding = entry.DesktopBinding;
            if (!isObject(binding)) {
                findings.push(shapeFinding(at + " must contain a DesktopBinding object."));
                continue;
            }
            if (!nonEmptyString(binding.name)) {
                findings.push(shapeFinding(at + ".DesktopBinding.name must be a non-empty tile label."));
            }
            if (!nonEmptyString(binding.icon)) {
                findings.push(shapeFinding(at + ".DesktopBinding.icon must be a non-empty icon identifier."));
            }
        }
    }
    return findings;
}

// Unknown top-level or layout key with a close real match → error (near-certain invention,
// e.g. a case slip or a plausible-sounding guess). No close match → warn, never error — the
// server's real field set is bigger than this manually-extracted list (fonts/etc. have
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

// Filename-resolution conventions, verified live (reports/2026-07-18 equipment_checkout runs):
// workflows and fragments are resolved by the platform's internal NAME registry, so their
// manifest filename is category-relative WITHOUT the folder prefix. "workflows/console.js"
// pushes fine but breaks at runtime — "Error: Invalid workflow: console" for workflows, a
// silently-empty getAjaxFragment() for fragments; removing the prefix fixed both (haiku-4.5
// report, findings #1/#2). styles/scripts are loaded by literal URL and legitimately keep the
// "styles/x.css" disk-relative form (observed working in the same pal) — not checked here.
// A fragment entry with no Fragment.filename is save-REJECTED by the server after clean local
// lint (deepseek-v4-flash report, finding #4 — 52 retries against this exact rejection).
const NAME_RESOLVED_FOLDERS = { workflows: "Workflow", fragments: "Fragment" };

function checkEntryFilenames(manifest) {
    const findings = [];
    const err = (rule, message) => findings.push({
        file: "pal.json", line: 1, column: 0, severity: "error", rule, message,
    });

    for (const folder of Object.keys(NAME_RESOLVED_FOLDERS)) {
        const typeName = NAME_RESOLVED_FOLDERS[folder];
        const section = manifest[folder];
        if (!isObject(section) || !Array.isArray(section.entry)) continue;
        for (let i = 0; i < section.entry.length; i++) {
            const entry = section.entry[i];
            if (!isObject(entry)) continue;
            const body = entry[typeName];
            if (!isObject(body)) continue;
            const at = "pal.json " + folder + ".entry[" + i + "]." + typeName;
            if (folder === "fragments" && !nonEmptyString(body.filename)) {
                err("missingManifestFilename", at + ".filename is missing — the server REJECTS " +
                    "the whole save when a fragment entry has no filename, even when local lint " +
                    "is clean. Fix: set " + typeName + ".filename to the category-relative file, " +
                    "e.g. { \"string\": \"" + entry.string + "\", \"" + typeName + "\": { \"name\": \"" +
                    entry.string + "\", \"filename\": \"" + entry.string + "\" } }.");
                continue;
            }
            if (nonEmptyString(body.filename) && body.filename.startsWith(folder + "/")) {
                const fixed = body.filename.slice(folder.length + 1);
                err("bannedFilenamePrefix", at + ".filename \"" + body.filename + "\" repeats its " +
                    "own category folder — " + folder + " are resolved by internal name lookup, " +
                    "so this pushes fine but BREAKS at runtime (" +
                    (folder === "workflows"
                        ? "\"Error: Invalid workflow\" on page load"
                        : "the fragment silently renders nothing") +
                    "). Fix: use the category-relative value \"" + fixed + "\".");
            }
        }
    }

    // The same runtime lookup applies to layout.*Workflow pointers ("workflows/console.js" in
    // layout.consoleWorkflow was the exact bug that broke the haiku-built console pal).
    const layout = manifest.layout;
    if (isObject(layout)) {
        for (const key of Object.keys(layout)) {
            if (!/Workflow$/.test(key)) continue;
            const value = layout[key];
            if (typeof value === "string" && value.startsWith("workflows/")) {
                err("bannedFilenamePrefix", "pal.json layout." + key + " \"" + value + "\" repeats " +
                    "the workflows/ folder — layout workflow pointers are category-relative names. " +
                    "This pushes fine but the page fails at runtime with \"Error: Invalid workflow\". " +
                    "Fix: \"" + value.slice("workflows/".length) + "\".");
            }
        }
    }
    return findings;
}

// Entry shape contract, verified against lib/pal.js injectFileContent() (the only push path):
// file content is injected exclusively through entry[<Type>] (or its lowercase twin), so an
// entry with no <Type> wrapper object ships NOTHING — the push "succeeds" locally but the
// server never receives the file. Live repro: equipment_checkout-cc-haiku-5918066-01
// (2026-07-18 haiku QA report, finding #2) authored flat { "string", "filename" } entries for
// every page/fragment/style/workflow; nothing ever reached the server.
const SHAPE_CHECKED_FOLDERS = Object.assign({ workflows: "Workflow" }, FOLDER_TYPE);

function entryWrapper(entry, typeName) {
    if (isObject(entry) && isObject(entry[typeName])) {
        return { key: typeName, body: entry[typeName], canonical: true };
    }
    const lowercase = typeName.toLowerCase();
    if (isObject(entry) && isObject(entry[lowercase])) {
        return { key: lowercase, body: entry[lowercase], canonical: false };
    }
    return { key: null, body: null, canonical: false };
}

function registrationEntries(manifest, section) {
    const value = isObject(manifest) ? manifest[section] : null;
    return isObject(value) && Array.isArray(value.entry) ? value.entry : null;
}

function pointerToken(value) {
    return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

function registrationPointer(tokens) {
    return "/" + tokens.map(pointerToken).join("/");
}

function registrationNearMatches(entries, categoryRel, typeName) {
    const extensionless = categoryRel.replace(/\.(?:html?|xhtml)$/i, "");
    const otherType = typeName === "Page" ? "Fragment" : "Page";
    const wrapperKeys = [typeName, typeName.toLowerCase(), otherType, otherType.toLowerCase()];
    const matches = [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!isObject(entry)) continue;
        if (entry.string === extensionless) matches.push(["entry", i, "string"]);
        if (entry.filename === categoryRel) matches.push(["entry", i, "filename"]);
        for (const key of wrapperKeys) {
            const body = entry[key];
            if (!isObject(body)) continue;
            if (body.filename === categoryRel) matches.push(["entry", i, key, "filename"]);
            if (body.name === categoryRel || body.name === extensionless) {
                matches.push(["entry", i, key, "name"]);
            }
        }
    }
    return matches;
}

const REGISTRATION_CHECK_ORDER = [
    "manifest-json",
    "section-entry-array",
    "entry-string-identity",
    "entry-shape",
    "fragment-filename-present",
    "category-prefix-absent",
    "local-file-present",
    "unique-file-identity",
];
const REGISTRATION_OMISSION_ORDER = [
    "server-save-validation",
    "body-name-identity",
    "page-wrapper-filename",
    "fragment-filename-equals-entry",
    "lowercase-fragment-filename-rules",
];

function analyzeMarkupRegistration(snapshot, targetRel, identityFiles) {
    const section = targetRel.startsWith("pages/") ? "pages" : "fragments";
    const typeName = section === "pages" ? "Page" : "Fragment";
    const categoryRel = targetRel.slice(section.length + 1);
    const applied = new Set();
    const notApplied = new Set(["server-save-validation"]);
    const reasons = [];
    let status = "absent";
    let pointer = null;
    let evidence = [];

    const finish = () => {
        const pointers = [...new Set(evidence)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
        return {
            status,
            section,
            pointer,
            checksApplied: REGISTRATION_CHECK_ORDER.filter(check => applied.has(check)),
            checksNotApplied: REGISTRATION_OMISSION_ORDER.filter(check => notApplied.has(check)),
            reasons: [...new Set(reasons)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
            evidencePointers: pointers.slice(0, 8),
            evidenceOmitted: Math.max(0, pointers.length - 8),
        };
    };

    if (!snapshot.palJson || snapshot.palJson.raw === null) {
        reasons.push("manifest-absent");
        return finish();
    }

    applied.add("manifest-json");
    let manifest = snapshot.palJson.parsed;
    if (manifest === null) {
        try { manifest = JSON.parse(snapshot.palJson.raw); }
        catch (e) {
            status = "candidate";
            reasons.push("manifest-unparseable");
            return finish();
        }
    }

    applied.add("section-entry-array");
    if (!isObject(manifest)) {
        status = "candidate";
        reasons.push("section-malformed");
        return finish();
    }

    const sectionValue = manifest[section];
    if (sectionValue == null || sectionValue === "") {
        reasons.push("section-absent");
        return finish();
    }
    const entries = registrationEntries(manifest, section);
    if (entries === null) {
        status = "candidate";
        reasons.push("section-malformed");
        return finish();
    }

    applied.add("entry-string-identity");
    const exactIndexes = [];
    for (let i = 0; i < entries.length; i++) {
        if (isObject(entries[i]) && entries[i].string === categoryRel) exactIndexes.push(i);
    }

    if (exactIndexes.length === 0) {
        const near = registrationNearMatches(entries, categoryRel, typeName);
        evidence = near.map(tokens => registrationPointer([section, ...tokens]));
        if (near.length) {
            status = "candidate";
            reasons.push("near-match");
        } else {
            reasons.push("entry-absent");
        }
        return finish();
    }

    evidence = exactIndexes.map(index => registrationPointer([section, "entry", index]));
    if (exactIndexes.length > 1) {
        status = "candidate";
        reasons.push("duplicate-entry-string");
        return finish();
    }

    const index = exactIndexes[0];
    pointer = registrationPointer([section, "entry", index]);
    const wrapper = entryWrapper(entries[index], typeName);
    applied.add("entry-shape");
    notApplied.add("body-name-identity");
    notApplied.add(section === "pages" ? "page-wrapper-filename" : "fragment-filename-equals-entry");

    let locallyInvalid = false;
    if (!wrapper.body) {
        locallyInvalid = true;
        reasons.push("entry-shape-invalid");
    } else if (section === "fragments" && wrapper.canonical) {
        applied.add("fragment-filename-present");
        if (!nonEmptyString(wrapper.body.filename)) {
            locallyInvalid = true;
            reasons.push("fragment-filename-missing");
        } else {
            applied.add("category-prefix-absent");
            if (wrapper.body.filename.startsWith("fragments/")) {
                locallyInvalid = true;
                reasons.push("fragment-filename-prefixed");
            }
        }
    } else if (section === "fragments") {
        notApplied.add("lowercase-fragment-filename-rules");
        reasons.push("lowercase-fragment-wrapper");
    }

    applied.add("local-file-present");
    const skipped = snapshot.skippedInputs || [];
    const targetFile = (snapshot.markup || []).find(file => file.rel === targetRel);
    if (isUnsafeTarget(skipped, targetRel)) {
        locallyInvalid = true;
        reasons.push("local-file-unsafe");
    } else if (skipped.some(item => item.rel === targetRel &&
        (item.reason === "notRegular" || item.reason === "invalidUtf8" || item.reason === "unreadable"))) {
        locallyInvalid = true;
        reasons.push("local-file-unreadable");
    } else if (!targetFile) {
        locallyInvalid = true;
        reasons.push("local-file-absent");
    } else {
        applied.add("unique-file-identity");
        const identity = targetRel.replace(/\.(?:html?|xhtml)$/i, "");
        const files = identityFiles instanceof Map ? identityFiles.get(identity) || [] : [];
        if (files.length > 1) reasons.push("duplicate-file-identity");
    }

    if (locallyInvalid) status = "locallyInvalid";
    else if (reasons.includes("lowercase-fragment-wrapper") || reasons.includes("duplicate-file-identity")) {
        status = "candidate";
    } else {
        status = "locallyValid";
    }
    return finish();
}

function checkEntryShape(manifest) {
    const findings = [];
    for (const folder of Object.keys(SHAPE_CHECKED_FOLDERS)) {
        const typeName = SHAPE_CHECKED_FOLDERS[folder];
        const section = manifest[folder];
        if (!isObject(section) || !Array.isArray(section.entry)) continue;
        for (let i = 0; i < section.entry.length; i++) {
            const entry = section.entry[i];
            if (!isObject(entry) || typeof entry.string !== "string") continue;
            if (entryWrapper(entry, typeName).body) continue;
            findings.push({
                file: "pal.json", line: 1, column: 0, severity: "error", rule: "malformedManifestEntry",
                message: "pal.json " + folder + ".entry[" + i + "] (\"string\": \"" + entry.string + "\") has no \"" +
                    typeName + "\" object — push injects file content only through the \"" + typeName +
                    "\" wrapper, so this entry ships NOTHING and the server never receives the file" +
                    (typeof entry.filename === "string"
                        ? " (a flat top-level \"filename\" key is ignored)"
                        : "") +
                    ". Replace it with this complete entry:\n" + manifestEntryTemplate(entry.string, typeName) +
                    "\nCopy any category-specific optional fields from pal-json.md only when needed.",
            });
        }
    }
    return findings;
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

function lintPalJson(snapshotOrDir) {
    const snapshot = typeof snapshotOrDir === "string" ? buildSnapshot(snapshotOrDir) : snapshotOrDir;
    const manifest = snapshot && snapshot.palJson && snapshot.palJson.parsed;
    if (!manifest) return []; // absent/unparseable manifest — skip silently

    const findings = [];

    for (const folder of CREATABLE_FOLDERS) {
        const prefix = folder + "/";
        const diskFiles = snapshot.allFiles
            .filter(rel => rel.startsWith(prefix) && !rel.slice(prefix.length).split("/").some(part => part.startsWith(".")))
            .map(rel => rel.slice(prefix.length));

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
        //
        // Push resolves content strictly by entry.string: lib/pal.js injectFileContent() reads
        // <folder>/<entry.string> from disk into entry.<Type>.content. So "string" must be the
        // EXACT category-relative filename — an extensionless "string" (e.g. "console" for
        // console.html) is a distinct, unmatched entry that ships nothing. That exact shape
        // hard-walled the 2026-07-18 haiku run (5 identical push failures); when a near-miss
        // entry exists, say so instead of repeating "add an entry" the agent believes it did.
        const entries = (section && Array.isArray(section.entry)) ? section.entry : [];
        for (const rel of diskFiles) {
            if (!registered.has(rel)) {
                const typeHint = FOLDER_TYPE[folder] || folder;
                const base = rel.replace(/\.[^./]+$/, "");
                const near = entries.find(e => isObject(e) && (e.string === base ||
                    e.filename === rel ||
                    (isObject(e[typeHint]) && e[typeHint].filename === rel)));
                const fixShape = manifestEntryTemplate(rel, typeHint);
                findings.push({
                    file: "pal.json",
                    line: 1,   // pal.json has no meaningful line for missing entries
                    column: 0,
                    severity: "error",
                    rule: "missingPalJsonEntry",
                    message: near
                        ? folder + "/" + rel + " has no MATCHING pal.json entry. A near-miss entry exists " +
                          "(\"string\": \"" + String(near.string) + "\") but push locates the file by the exact " +
                          "value of \"string\" — it must be the category-relative filename \"" + rel + "\", " +
                          "extension included. Replace that entry with:\n" + fixShape
                        : folder + "/" + rel + " exists on disk but has NO pal.json entry — " +
                          "push will silently skip it and the server will never receive it. " +
                          "Add this complete entry to the \"" + folder + "\".entry array:\n" + fixShape,
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
        const diskFiles = snapshot.allFiles
            .filter(rel => /^datasets\/[^/]+\.json$/.test(rel))
            .map(rel => rel.slice("datasets/".length));

        if (diskFiles.length) {
            const section = manifest.datasets;
            const registered = new Set();
            if (section && Array.isArray(section.entry)) {
                for (const entry of section.entry) {
                    if (typeof entry.string === "string") registered.add(entry.string);
                }
            }

            for (const name of diskFiles) {
                const baseName = name.slice(0, -".json".length);

                if (!registered.has(baseName)) {
                    findings.push({
                        file: "pal.json",
                        line: 1,
                        column: 0,
                        severity: "error",
                        rule: "missingPalJsonEntry",
                        message: "datasets/" + name + " exists on disk but has NO pal.json entry — " +
                            "the table will never be provisioned server-side. " +
                            "Add this complete entry to pal.json's \"datasets\".entry array (its Dataset object is copied from datasets/" +
                            name + "):\n" + datasetEntryTemplate(baseName, snapshot),
                    });
                }
            }
        }
    }

    // data/datalists/*.json — same silent-skip failure as CREATABLE_FOLDERS/datasets above: the
    // entry name is the basename without ".json", not a "filename" pointer, so it's handled
    // separately for the same reason datasets is. Create/update/delete these through
    // core/dataObjects.js (pal_data_set/pal_data_delete/pal_datalist_set/pal_datalist_delete) —
    // never hand-write the entry shape.
    for (const folder of ["data", "datalists"]) {
        const prefix = folder + "/";
        const diskFiles = snapshot.allFiles
            .filter(rel => rel.startsWith(prefix) && rel.endsWith(".json") && !rel.slice(prefix.length).includes("/"))
            .map(rel => rel.slice(prefix.length));
        if (!diskFiles.length) continue;

        const section = manifest[folder];
        const registered = new Set();
        if (section && Array.isArray(section.entry)) {
            for (const entry of section.entry) {
                if (typeof entry.string === "string") registered.add(entry.string);
            }
        }

        const typeName = folder === "data" ? "Data" : "DataList";
        for (const name of diskFiles) {
            const baseName = name.slice(0, -".json".length);
            if (!registered.has(baseName)) {
                findings.push({
                    file: "pal.json",
                    line: 1,
                    column: 0,
                    severity: "error",
                    rule: "missingPalJsonEntry",
                    message: folder + "/" + name + " exists on disk but has NO pal.json entry — it will never " +
                        "reach the server. Use the palsync MCP's create/update tool for " + typeName +
                        " objects (pal_" + folder.replace(/s$/, "") + "_set) instead of hand-editing pal.json's \"" +
                        folder + "\".entry array.",
                });
            }
        }
    }

    findings.push(...checkEntryShape(manifest));
    findings.push(...checkEntryFilenames(manifest));
    findings.push(...checkUnknownKeys(manifest));
    findings.push(...checkDataStructures(manifest));
    findings.push(...checkFolderRegistrations(manifest));

    const raw = snapshot.palJson.raw;
    for (const finding of findings) {
        if (finding.line === 1) finding.line = lineForFinding(raw, finding);
    }

    return findings;
}

module.exports = { lintPalJson, checkUnknownKeys, checkDataStructures, checkEntryShape, checkEntryFilenames,
    checkFolderRegistrations, lineForFinding, listFilesRecursive, analyzeMarkupRegistration };
