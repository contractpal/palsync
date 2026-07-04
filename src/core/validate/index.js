"use strict";
// pal_validate core: lint a pal workspace OFFLINE for the mistakes that silently break in
// PalBuilder — invalid workflow JS (object literals, let/const, …) and invalid markup
// (unclosed void tags, undocumented c: attributes, aria on c:field, ${} in inline script, …).
// Catches the most common failure mode BEFORE a push, where it's fastest and cheapest to fix.
//
// Scope by folder:
//   workflows/*.js     → restricted-engine JS lint (workflowJs)
//   pages/**, fragments/** (markup) → XHTML/c:-tag lint (markup)
//   scripts/ styles/ images/ data/… → NOT linted (client JS is unrestricted; CSS/assets/data
//                                      have no rules here)
// The result is built for the least capable agent: a one-line verdict it can branch on, then
// each finding as a full sentence with file:line, an ERROR/WARNING word, and the fix.
const fs = require("fs");
const path = require("path");
const { lintWorkflowJs } = require("./workflowJs");
const { lintMarkup } = require("./markup");
const { lintDatasetDef } = require("./datasetDef");
const { lintPalJson } = require("./palJson");
const { lintContracts } = require("./contracts");
const { capRepeats } = require("../findingCap");

const MARKUP_EXT = new Set([".html", ".htm", ".xhtml"]);

// Fragments flagged parseable:false in pal.json — the server skips tag processing for them,
// so script/EL lint rules don't apply.
function nonParseableSet(rootDir) {
    try {
        const pj = JSON.parse(require("fs").readFileSync(path.join(rootDir, "pal.json"), "utf8"));
        const set = new Set();
        for (const e of (((pj.fragments || {}).entry) || [])) {
            if (e && e.Fragment && e.Fragment.parseable === false) set.add("fragments/" + e.string);
        }
        return set;
    } catch (e) { return new Set(); }
}

function walkFiles(absDir, relBase, out) {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch (e) { if (e.code === "ENOENT") return; throw e; }
    for (const e of entries) {
        const abs = path.join(absDir, e.name);
        const rel = relBase + "/" + e.name;
        if (e.isDirectory()) walkFiles(abs, rel, out);
        else out.push({ abs, rel });
    }
}

function readUtf8(abs) {
    try { return fs.readFileSync(abs, "utf8"); } catch (e) { return null; }
}

// Lint a workspace. Returns { findings, errors, warnings, filesChecked, scope }.
//   opts.only — optional Set of POSIX rel paths; when given, ONLY those files are linted (used
//   by the pre-push gate to check just the files THIS push changes, so a pal with pre-existing
//   violations in untouched files isn't blocked forever — that's not this push's responsibility).
//   Omit `only` to lint the whole workspace (the standalone `validate` command / MCP tool).
function validateWorkspace(workspaceDir, { only = null } = {}) {
    const findings = [];
    const nonParseable = nonParseableSet(workspaceDir);
    let filesChecked = 0;
    const inScope = (rel) => !only || only.has(rel);

    // workflows/*.js (restricted engine)
    const wf = [];
    walkFiles(path.join(workspaceDir, "workflows"), "workflows", wf);
    for (const f of wf) {
        if (!f.rel.endsWith(".js") || !inScope(f.rel)) continue;
        const src = readUtf8(f.abs);
        if (src == null) continue;
        filesChecked++;
        findings.push(...lintWorkflowJs(f.rel, src));
    }

    // pages/** and fragments/** (markup)
    for (const folder of ["pages", "fragments"]) {
        const files = [];
        walkFiles(path.join(workspaceDir, folder), folder, files);
        for (const f of files) {
            if (!MARKUP_EXT.has(path.extname(f.rel).toLowerCase()) || !inScope(f.rel)) continue;
            const src = readUtf8(f.abs);
            if (src == null) continue;
            filesChecked++;
            findings.push(...lintMarkup(f.rel, src, { nonParseable }));
        }
    }

    // datasets/*.json (definition sanity — invalid fieldType, missing PK; all WARNINGS)
    const dsFiles = [];
    walkFiles(path.join(workspaceDir, "datasets"), "datasets", dsFiles);
    for (const f of dsFiles) {
        if (!f.rel.endsWith(".json") || !inScope(f.rel)) continue;
        const src = readUtf8(f.abs);
        if (src == null) continue;
        filesChecked++;
        findings.push(...lintDatasetDef(f.rel, src));
    }

    // pal.json manifest check (Check 2 — silent-push-skip incident).
    // Not scoped by `only` — a missing pal.json entry is a workspace-level problem regardless
    // of which files changed, and the check is cheap (no file parsing).
    findings.push(...lintPalJson(workspaceDir));

    // Cross-file contract checks (c:list name/id, ajax-target, action routing, EL syntax,
    // href-action anti-pattern, fabricated API methods, dropped params, ajax transport).
    // Not scoped by `only` — these check a fragment/page against a workflow that may live in
    // a DIFFERENT file than the one this push changed, so limiting to changed files would miss
    // exactly the mismatches this exists to catch (e.g. a fragment edit that now names a
    // DataList the workflow never produces).
    findings.push(...lintContracts(workspaceDir));

    findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    const errors = findings.filter(f => f.severity === "error").length;
    const warnings = findings.filter(f => f.severity === "warn").length;
    return { findings, errors, warnings, filesChecked, scope: only ? "changed" : "workspace" };
}

// Format for an agent. `context` tags the message ("pre-push" vs standalone). Leads with an
// unambiguous verdict line, then every finding spelled out. Never a bare count.
function formatValidation(result, { context = "validate" } = {}) {
    const { findings, errors, warnings, filesChecked } = result;
    if (!findings.length) {
        return "VALIDATION PASSED — 0 problems found in " + filesChecked + " file(s). " +
            "The workflow JS and markup follow PalBuilder's rules" +
            (context === "pre-push" ? "; the push can proceed." : ".");
    }
    const head = (errors > 0 ? "VALIDATION FAILED" : "VALIDATION PASSED WITH WARNINGS") +
        " — " + errors + " error(s) and " + warnings + " warning(s) in " + filesChecked + " file(s).";
    const meaning = errors > 0
        ? "ERROR = this WILL fail to compile or save in PalBuilder; you must fix every error" +
          (context === "pre-push" ? " before pushing. Each finding says exactly how to fix it; a passing pal_test does not clear these." : ".")
        : "WARNING = likely unsupported / risky; review each one. No errors, so a push is allowed.";
    // Collapse repeats of the same message (a workflow full of the same violation shouldn't flood
    // context): keep the first few per file+message, count the rest. Group by file for readability.
    const { shown, more } = capRepeats(findings, f => f.file + "\t" + f.message);
    const byFile = {};
    for (const f of shown) (byFile[f.file] = byFile[f.file] || []).push(f);
    const blocks = [];
    for (const file of Object.keys(byFile)) {
        const lines = byFile[file].map(f =>
            "   " + (f.severity === "error" ? "ERROR" : "WARNING") + " " + file + ":" + f.line + " — " + f.message);
        blocks.push(lines.join("\n"));
    }
    const moreBlock = more.length
        ? "\n\n" + more.map(m => "   …and " + m.count + " more of the same (" + m.key.split("\t")[0] + ": " + m.key.split("\t")[1] + ")").join("\n")
        : "";
    return head + "\n" + meaning + "\n\n" + blocks.join("\n\n") + moreBlock;
}

// Lint a single file's CONTENT (not read from disk), dispatching by its rel path. Used by the
// pre-push gate to lint a baseline version vs the current version. Must mirror the folder
// dispatch in validateWorkspace and the isLintable set in core/baseline.
function lintContent(rel, content) {
    if (rel.startsWith("workflows/") && rel.endsWith(".js")) return lintWorkflowJs(rel, content);
    if ((rel.startsWith("pages/") || rel.startsWith("fragments/")) && MARKUP_EXT.has(path.extname(rel).toLowerCase())) return lintMarkup(rel, content);
    if (rel.startsWith("datasets/") && rel.endsWith(".json")) return lintDatasetDef(rel, content);
    return [];
}

module.exports = { validateWorkspace, formatValidation, lintContent };
