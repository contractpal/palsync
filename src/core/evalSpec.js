"use strict";
// Eval-harness specs: benchmark scenarios under eval/specs/<key>/ (SPEC.md + EXECUTION.md), plus
// two files shared across all specs (DESIGN_SYSTEM.md, COMPONENTS.md). `--eval` in bin/palsync.js
// picks one of these, forces the launcher's create-new-pal flow with the name prefilled, and
// injectSpec() drops the spec's docs into the workspace root once the pal/workspace exist.
const fs = require("fs");
const path = require("path");

const SPECS_DIR = path.join(__dirname, "..", "..", "eval", "specs");
const SHARED_FILES = ["DESIGN_SYSTEM.md", "COMPONENTS.md"];

// One entry per scenario folder that has a SPEC.md. A malformed folder (unreadable SPEC.md) is
// skipped rather than crashing the whole list — the other specs should still be usable.
function listSpecs() {
    let entries = [];
    try { entries = fs.readdirSync(SPECS_DIR, { withFileTypes: true }).filter(e => e.isDirectory()); }
    catch (e) { return []; }

    const specs = [];
    for (const entry of entries) {
        const dir = path.join(SPECS_DIR, entry.name);
        const specPath = path.join(dir, "SPEC.md");
        let content;
        try { content = fs.readFileSync(specPath, "utf8"); }
        catch (e) { continue; } // no SPEC.md (or unreadable) — not a scenario folder, skip

        const key = entry.name;
        const palMatch = content.match(/^pal:\s*([^\s(]+)/m);
        const suggestedName = palMatch ? palMatch[1] : key;
        const titleMatch = content.match(/^#\s*SPEC\s*—\s*(.+)$/m);
        const title = titleMatch ? titleMatch[1] : key;
        specs.push({ key, dir, suggestedName, title, description: title });
    }
    return specs;
}

// Resolve a --eval value to a spec: exact key, numeric prefix ("01" / "1"), or suggestedName.
function resolveSpec(key) {
    const specs = listSpecs();
    const k = String(key);
    let spec = specs.find(s => s.key === k);
    if (!spec) {
        const digits = k.match(/^0*(\d+)$/);
        if (digits) spec = specs.find(s => { const m = s.key.match(/^0*(\d+)/); return m && m[1] === digits[1]; });
    }
    if (!spec) spec = specs.find(s => s.suggestedName === k);
    if (!spec) {
        throw new Error("Unknown eval spec \"" + key + "\". Available: " + specs.map(s => s.key).join(", ") + ".");
    }
    return spec;
}

// Copy the spec's SPEC.md + EXECUTION.md and the two shared design docs into workspaceDir (flat,
// workspace root). SPEC.md gets its placeholder header filled in and its ../ references to the
// shared docs rewritten to ./ (they now live alongside it, not one directory up). Never overwrites
// an existing file — mirrors scaffold.js's non-destructive rule.
function injectSpec(workspaceDir, spec, { fillValue } = {}) {
    const written = [], skipped = [];

    function writeIfAbsent(name, content) {
        const dest = path.join(workspaceDir, name);
        if (fs.existsSync(dest)) { skipped.push(name); return; }
        fs.writeFileSync(dest, content, "utf8");
        written.push(name);
    }

    let specContent = fs.readFileSync(path.join(spec.dir, "SPEC.md"), "utf8");
    specContent = specContent.replace(/<WORKSPACE[^>]*>/, fillValue);
    specContent = specContent.replace("../DESIGN_SYSTEM.md", "./DESIGN_SYSTEM.md").replace("../COMPONENTS.md", "./COMPONENTS.md");
    writeIfAbsent("SPEC.md", specContent);

    writeIfAbsent("EXECUTION.md", fs.readFileSync(path.join(spec.dir, "EXECUTION.md"), "utf8"));
    for (const name of SHARED_FILES) {
        writeIfAbsent(name, fs.readFileSync(path.join(SPECS_DIR, name), "utf8"));
    }

    return { written, skipped };
}

module.exports = { listSpecs, resolveSpec, injectSpec, SPECS_DIR };
