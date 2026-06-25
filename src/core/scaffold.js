"use strict";
// Template starters: apply a pre-built pal scaffold (pages/fragments/scripts/styles + the
// matching pal.json entries) into a workspace, so a new pal starts from a correct, designed,
// SEO-sound skeleton instead of a blank page. The agent then customizes content — the starter
// guarantees the structure, the design floor, and the SEO floor from the first push.
//
// Platform rules this respects (all empirically confirmed):
//   - Pages/fragments/scripts/styles/workflows CAN be created via push (file + pal.json entry).
//     Workflows need a workflowType — derived here from the template's palType (web=9, console=7,
//     transaction=2). (The old "workflows are fixed slots" rule was a Base64 artifact, not real.)
//   - Existing files are NEVER overwritten (starters fill empty/stub pals; report skips).
//   - {{PAL_NAME}} in text files is replaced with the pal's name.
//
// A template lives at bundled-context/starters/<name>/ with a template.json manifest:
//   { "description": "...", "palType": "palTypeWeb"|"palTypeConsole", "files": [
//       { "path": "pages/home.html" }, ...        // folder prefix decides the pal.json entry type
//   ] }
const fs = require("fs");
const path = require("path");

const STARTERS_DIR = path.join(__dirname, "..", "..", "bundled-context", "starters");

// folder → pal.json node + entry sub-key + whether palType applies.
const ENTRY_TYPES = {
    pages: { key: "pages", sub: "Page", contentType: "text/html", palTyped: true, extra: { hideConsoleMenu: false } },
    fragments: { key: "fragments", sub: "Fragment", contentType: "text/html", palTyped: true, extra: { parseable: false } },
    scripts: { key: "scripts", sub: "Script", contentType: "text/javascript", palTyped: true, extra: { bookmarks: "" } },
    styles: { key: "styles", sub: "Style", contentType: "text/css", palTyped: false, extra: {} },
    images: { key: "images", sub: "Image", contentType: "image/png", palTyped: false, extra: {} },
    workflows: { key: "workflows", sub: "Workflow", contentType: "text/javascript", palTyped: false, workflowTyped: true, extra: {} }
};

// Workflow type number for a pal type (the create-pal wizard's mapping). Web pals get web
// workflows, console pals console workflows, etc.; default web.
function workflowTypeFor(palType) {
    if (palType === "palTypeConsole") return 7;
    if (palType === "palTypeTransaction") return 2;
    return 9; // palTypeWeb / default
}

function listTemplates() {
    let names = [];
    try { names = fs.readdirSync(STARTERS_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
    catch (e) { /* no starters dir */ }
    return names.map(name => {
        let description = "";
        try { description = JSON.parse(fs.readFileSync(path.join(STARTERS_DIR, name, "template.json"), "utf8")).description || ""; }
        catch (e) { /* unreadable manifest */ }
        return { name, description };
    });
}

function loadTemplate(name) {
    const dir = path.join(STARTERS_DIR, name);
    const manifestPath = path.join(dir, "template.json");
    if (!fs.existsSync(manifestPath)) {
        const known = listTemplates().map(t => t.name);
        throw new Error("Unknown template \"" + name + "\". Available templates: " +
            (known.length ? known.join(", ") : "(none bundled)") + ". Run `palsync scaffold --list` to see them.");
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return { dir, manifest };
}

function substitute(content, vars) {
    return content.replace(/\{\{PAL_NAME\}\}/g, vars.palName || "My Pal");
}

// Apply template `name` into workspaceDir. Mutates pal.json (adds entries for created files).
// Returns { created, skipped, workflows, entriesAdded } — every item human/dumb-model readable.
function applyTemplate(workspaceDir, name, { palName } = {}) {
    const { dir, manifest } = loadTemplate(name);
    const palJsonPath = path.join(workspaceDir, "pal.json");
    if (!fs.existsSync(palJsonPath)) {
        throw new Error("No pal.json in " + workspaceDir + " — this isn't a pal workspace yet. Run `palsync setup` (or the launcher) first, then scaffold.");
    }
    const pal = JSON.parse(fs.readFileSync(palJsonPath, "utf8"));
    const palType = manifest.palType || "palTypeWeb";
    const vars = { palName: palName || pal.layout && pal.layout.name || "My Pal" };

    const created = [], skipped = [], workflows = [], entriesAdded = [];

    for (const f of manifest.files || []) {
        const rel = f.path;                                   // e.g. "pages/home.html"
        const folder = rel.split("/")[0];
        let entryString = rel.slice(folder.length + 1);       // path inside the folder
        const type = ENTRY_TYPES[folder];
        if (!type) { skipped.push({ rel, reason: "unsupported folder \"" + folder + "\" — template bug" }); continue; }

        // Enforcement: workflows MUST have a .js extension for the server compile engine.
        // If the template manifest or the user omitted it, fix it here so the file on disk
        // and the pal.json entry both carry it.
        if (type.workflowTyped && !entryString.toLowerCase().endsWith(".js")) {
            entryString += ".js";
        }

        const srcAbs = path.join(dir, rel);
        const destAbs = path.join(workspaceDir, folder, ...entryString.split("/"));
        // A manifest entry whose source file is missing must not crash the whole scaffold —
        // skip it and report so the rest of the starter still applies.
        if (!fs.existsSync(srcAbs)) { skipped.push({ rel, reason: "template file missing from the starter — skipped (report to maintainers)" }); continue; }
        const raw = fs.readFileSync(srcAbs, "utf8");
        const content = substitute(raw, vars);

        // Create file + manifest entry, never overwrite (pages/fragments/scripts/styles/images/
        // workflows all flow through here — workflows now push like any other creatable type).
        if (fs.existsSync(destAbs)) { skipped.push({ rel, reason: "file already exists — left untouched" }); continue; }
        fs.mkdirSync(path.dirname(destAbs), { recursive: true });
        fs.writeFileSync(destAbs, content, "utf8");
        created.push(folder + "/" + entryString);

        // pal.json entry (idempotent — skip if an entry already exists).
        if (pal[type.key] === "" || pal[type.key] == null) pal[type.key] = { entry: [] };
        if (!Array.isArray(pal[type.key].entry)) pal[type.key].entry = [];
        if (!pal[type.key].entry.some(e => e && e.string === entryString)) {
            const body = Object.assign({ content: "", contentType: type.contentType, filename: entryString }, type.extra);
            if (type.palTyped) body.palType = palType;
            if (type.workflowTyped) body.workflowType = workflowTypeFor(palType);
            const entry = { string: entryString };
            entry[type.sub] = body;
            pal[type.key].entry.push(entry);
            entriesAdded.push(folder + "/" + entryString + (type.workflowTyped ? " (workflowType " + body.workflowType + ")" : ""));
        }
    }

    fs.writeFileSync(palJsonPath, JSON.stringify(pal, null, 2), "utf8");

    // Point layout pointers if missing (webWorkflow / consoleWorkflow).
    if (pal.layout) {
        // webWorkflow: point to first type 9 if missing
        if (!pal.layout.webWorkflow) {
            const webWf = (pal.workflows && pal.workflows.entry || []).find(e => {
                const obj = e.Workflow || e.workflow;
                return obj && Number(obj.workflowType) === 9;
            });
            if (webWf) pal.layout.webWorkflow = webWf.string;
        }
        // consoleWorkflow: point to first type 7 if missing
        if (!pal.layout.consoleWorkflow) {
            const conWf = (pal.workflows && pal.workflows.entry || []).find(e => {
                const obj = e.Workflow || e.workflow;
                return obj && Number(obj.workflowType) === 7;
            });
            if (conWf) pal.layout.consoleWorkflow = conWf.string;
        }
        fs.writeFileSync(palJsonPath, JSON.stringify(pal, null, 2), "utf8");
    }

    return { template: name, palType, created, skipped, workflows, entriesAdded };
}

// Dumb-model-grade report: what happened, then exactly what to do next.
function formatScaffoldReport(r) {
    const lines = ["Applied template \"" + r.template + "\" (" + r.palType + ")."];
    if (r.created.length) lines.push("Created " + r.created.length + " file(s) + pal.json entries:\n" + r.created.map(x => "   - " + x).join("\n"));
    else lines.push("No new files were created.");
    for (const w of r.workflows) lines.push((w.applied ? "Workflow applied: " : "Workflow NOT applied: ") + w.rel + " — " + w.reason + ".");
    for (const s of r.skipped) lines.push("Skipped: " + s.rel + " — " + s.reason + ".");
    lines.push("Next steps: customize the content (the files are placeholders with correct structure), run `palsync validate`, then `palsync push`. For a web pal, run `palsync seo-audit` after pushing.");
    return lines.join("\n");
}

module.exports = { applyTemplate, listTemplates, loadTemplate, formatScaffoldReport, STARTERS_DIR, ENTRY_TYPES };
