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
const { lintDatasetDef, lintPalDatasets } = require("./datasetDef");
const { lintPalJson, checkUnknownKeys, checkDataStructures, checkEntryShape, checkEntryFilenames,
    checkFolderRegistrations, lineForFinding } = require("./palJson");
const { lintContracts, lintFileContracts } = require("./contracts");
const { buildSnapshot } = require("./snapshot");
const { cachedLint } = require("../lintCache");

const MARKUP_EXT = new Set([".html", ".htm", ".xhtml"]);

// Fragments flagged parseable:false in pal.json — the server skips tag processing for them,
// so script/EL lint rules don't apply.
function nonParseableSet(snapshot) {
    const set = new Set();
    const manifest = snapshot.palJson.parsed;
    for (const e of (((manifest && manifest.fragments) || {}).entry || [])) {
        if (e && e.Fragment && e.Fragment.parseable === false) set.add("fragments/" + e.string);
    }
    return set;
}

function hasDesignSystem(workspaceDir) {
    return fs.existsSync(path.join(workspaceDir, "DESIGN_SYSTEM.md")) ||
        fs.existsSync(path.join(workspaceDir, "styles", "design-system.css")) ||
        fs.existsSync(path.join(workspaceDir, "Styles", "design-system.css"));
}

// Lint a workspace. Returns { findings, errors, warnings, filesChecked, scope }.
//   opts.only — optional Set of POSIX rel paths; when given, ONLY those files are linted (used
//   by the pre-push gate to check just the files THIS push changes, so a pal with pre-existing
//   violations in untouched files isn't blocked forever — that's not this push's responsibility).
//   Omit `only` to lint the whole workspace (the standalone `validate` command / MCP tool).
function validateWorkspace(workspaceDir, { only = null } = {}) {
    const snapshot = buildSnapshot(workspaceDir);
    const findings = [];
    const nonParseable = nonParseableSet(snapshot);
    const designSystemPresent = snapshot.allFiles.includes("DESIGN_SYSTEM.md") ||
        snapshot.allFiles.includes("styles/design-system.css") ||
        snapshot.allFiles.includes("Styles/design-system.css");
    let filesChecked = 0;
    const inScope = (rel) => !only || only.has(rel);

    // workflows/*.js (restricted engine)
    for (const f of snapshot.workflows) {
        if (!f.rel.endsWith(".js") || !inScope(f.rel)) continue;
        const src = f.content;
        filesChecked++;
        findings.push(...cachedLint(workspaceDir,
            { rel: f.rel, content: src, mode: "workspace-workflow" },
            () => lintWorkflowJs(f.rel, src)));
    }

    // pages/** and fragments/** (markup)
    for (const folder of ["pages", "fragments"]) {
        for (const f of snapshot.markup) {
            if (!f.rel.startsWith(folder + "/")) continue;
            if (!MARKUP_EXT.has(path.extname(f.rel).toLowerCase()) || !inScope(f.rel)) continue;
            const src = f.content;
            filesChecked++;
            findings.push(...cachedLint(workspaceDir, {
                rel: f.rel,
                content: src,
                mode: "workspace-markup",
                deps: [
                    { path: "pal.json#parseable:" + f.rel, content: String(nonParseable.has(f.rel)) },
                    { path: "design-system#present", content: String(designSystemPresent) }
                ]
            }, () => lintMarkup(f.rel, src, { nonParseable, designSystemPresent })));
        }
    }

    // Dataset definition files and the authoritative inline pal.json Dataset objects.
    for (const f of snapshot.datasets) {
        if (!f.rel.endsWith(".json") || !inScope(f.rel)) continue;
        const src = f.content;
        filesChecked++;
        findings.push(...cachedLint(workspaceDir,
            { rel: f.rel, content: src, mode: "workspace-dataset" },
            () => lintDatasetDef(f.rel, src)));
    }
    if (snapshot.palJson.raw !== null && inScope("pal.json")) {
        findings.push(...lintPalDatasets("pal.json", snapshot.palJson.parsed));
    }

    // pal.json manifest check (Check 2 — silent-push-skip incident).
    // Not scoped by `only` — a missing pal.json entry is a workspace-level problem regardless
    // of which files changed, and the check is cheap (no file parsing).
    // Cross-file contract checks (c:list name/id, ajax-target, action routing, EL syntax,
    // href-action anti-pattern, fabricated API methods, dropped params, ajax transport).
    // Not scoped by `only` — these check a fragment/page against a workflow that may live in
    // a DIFFERENT file than the one this push changed, so limiting to changed files would miss
    // exactly the mismatches this exists to catch (e.g. a fragment edit that now names a
    // DataList the workflow never produces).
    const contractInput = Object.entries(snapshot.contentHashByRel)
        .filter(([rel]) => rel === "pal.json" || rel.startsWith("workflows/") ||
            rel.startsWith("pages/") || rel.startsWith("fragments/") || rel.startsWith("datasets/") ||
            /^(?:styles|Styles)\//.test(rel))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([rel, hash]) => rel + ":" + hash)
        .concat(snapshot.allFiles
            .filter(rel => /^(?:pages|fragments|styles|Styles|scripts|images|emails|attachments|wizards|datasets)\//.test(rel))
            .sort()
            .map(rel => "manifest-path:" + rel))
        .concat("DESIGN_SYSTEM.md:<" + (snapshot.allFiles.includes("DESIGN_SYSTEM.md") ? "present" : "absent") + ">")
        .join("\n");
    findings.push(...cachedLint(workspaceDir, {
        rel: "<workspace>", content: contractInput, mode: "workspace-contracts"
    }, () => [...lintPalJson(snapshot), ...lintContracts(snapshot)]));

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
        : "WARNING = likely unsupported / risky; fix each warning or record a checkpoint explaining why it is safe. " +
          "No errors, so a push is allowed, but a pal-loop task is not done while warnings are silently ignored.";
    // A rule's remediation is usually repeated verbatim at every location. Print each distinct
    // remediation once while retaining every rule code and file:line occurrence.
    const byRule = new Map();
    for (const finding of findings) {
        const rule = finding.rule || "unknown-rule";
        const key = finding.severity + "\0" + rule;
        if (!byRule.has(key)) byRule.set(key, { rule, severity: finding.severity, findings: [] });
        byRule.get(key).findings.push(finding);
    }
    const blocks = [];
    let grouped = 0;
    for (const group of byRule.values()) {
        const { rule, findings: ruleFindings } = group;
        const severity = group.severity === "error" ? "ERROR" : "WARNING";
        const byMessage = new Map();
        for (const finding of ruleFindings) {
            const shape = String(finding.message)
                .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "$1<value>$1")
                .replace(/\b\d+\b/g, "<number>");
            if (!byMessage.has(shape)) byMessage.set(shape, []);
            byMessage.get(shape).push(finding);
        }
        grouped += ruleFindings.length - byMessage.size;
        const lines = [severity + " " + rule + " — " + ruleFindings.length + " finding(s)"];
        for (const messageFindings of byMessage.values()) {
            const message = messageFindings[0].message;
            lines.push("   Fix: " + message);
            if (messageFindings.length === 1 || messageFindings.every(f => f.message === message)) {
                lines.push("   At: " + messageFindings.map(f => f.file + ":" + f.line).join(", "));
                continue;
            }
            lines.push("   Values (apply the remediation above to each):");
            const sampleTokens = String(message).match(/(["'`])(?:\\.|(?!\1).)*\1|\b\d+\b/g) || [];
            for (const finding of messageFindings) {
                const tokens = String(finding.message).match(/(["'`])(?:\\.|(?!\1).)*\1|\b\d+\b/g) || [];
                const changed = tokens.filter((token, index) => token !== sampleTokens[index]);
                lines.push("   " + finding.file + ":" + finding.line + " — " +
                    (changed.length ? changed.join("; ") : tokens.join("; ")));
            }
        }
        blocks.push(lines.join("\n"));
    }
    const groupedLine = grouped ? "\n" + grouped + " repeated remediation line(s) grouped; every location retained." : "";
    return head + "\n" + meaning + "\n\n" + blocks.join("\n\n") + groupedLine;
}

// Lint a single file's CONTENT (not read from disk), dispatching by its rel path. Used by the
// pre-push gate to lint a baseline version vs the current version. Must mirror the folder
// dispatch in validateWorkspace and the isLintable set in core/baseline.
function lintContent(rel, content, { designSystemPresent } = {}) {
    if (rel.startsWith("workflows/") && rel.endsWith(".js")) return lintWorkflowJs(rel, content);
    if ((rel.startsWith("pages/") || rel.startsWith("fragments/")) && MARKUP_EXT.has(path.extname(rel).toLowerCase())) {
        return [...lintMarkup(rel, content, { designSystemPresent }), ...lintFileContracts(rel, content)];
    }
    if (rel.startsWith("datasets/") && rel.endsWith(".json")) return lintDatasetDef(rel, content);
    if (rel === "pal.json") {
        try {
            const manifest = JSON.parse(content);
            const findings = [
                ...lintPalDatasets(rel, manifest),
                ...checkEntryShape(manifest),
                ...checkEntryFilenames(manifest),
                ...checkUnknownKeys(manifest),
                ...checkDataStructures(manifest),
                ...checkFolderRegistrations(manifest)
            ];
            for (const finding of findings) finding.line = lineForFinding(content, finding);
            return findings;
        } catch (e) { return []; }
    }
    return [];
}

module.exports = { validateWorkspace, formatValidation, lintContent, hasDesignSystem };
