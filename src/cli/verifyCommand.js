"use strict";
// `palsync verify` — offline. Answers "what is PalSync going to check for this change, and what is
// it going to skip?" from deterministic local facts: the un-pushed diff, pal.json, and the same
// structural impact data pal_impact returns. No server, no model, no browser.
const fs = require("fs");
const path = require("path");
const policy = require("../core/policy");
const palsyncfile = require("../core/palsyncfile");
const { diffWorkspace } = require("../core/localDrift");
const { buildImpactSnapshot } = require("../core/validate/snapshot");
const { buildStructuralImpact, resolveImpactTarget } = require("../core/impactContext");

function readManifest(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, "pal.json"), "utf8")); }
    catch (e) { return null; }
}

// Highest dependent count across the touched markup files. Unknown (null) when nothing touched is
// markup — the caller must not read "0 dependents" out of "we did not look".
function markupDependents(dir, record, paths) {
    const markup = paths.filter(p => /^(pages|fragments)\//.test(p));
    if (!markup.length) return null;
    let snapshot;
    try { snapshot = buildImpactSnapshot(dir); } catch (e) { return null; }
    const analysis = buildStructuralImpact(snapshot, record);
    let max = 0;
    for (const target of markup) {
        const resolved = resolveImpactTarget(analysis, target);
        if (resolved && Array.isArray(resolved.directDependents)) {
            max = Math.max(max, resolved.directDependents.length);
        }
    }
    return max;
}

async function describe(dir) {
    let record = null;
    try { record = await palsyncfile.read(dir); } catch (e) { /* not a set-up workspace */ }
    const diff = record ? diffWorkspace(record, dir) : { changed: [], added: [], deleted: [], manifestChanged: false };
    const paths = [...(diff.changed || []), ...(diff.added || [])].sort();
    const current = policy.resolve();

    if (!paths.length && !diff.manifestChanged) {
        return policy.summaryLine(current) + "\nNo local changes to check yet.";
    }

    const manifest = readManifest(dir);
    const change = policy.classifyChange({
        paths,
        dependents: markupDependents(dir, record, paths),
        manifest,
        datasetChange: paths.some(p => p.startsWith("datasets/")) ||
            (diff.manifestChanged && paths.some(p => p.startsWith("datasets/")))
    });
    const publicWeb = paths.some(p => /^pages\//.test(p)) && !!manifest &&
        JSON.stringify(manifest.pages || {}).includes("palTypeWeb");
    const plan = policy.plan({
        verification: current.verification,
        risk: change.level,
        surface: change.surface,
        behavior: change.behavior,
        hasBaseline: fs.existsSync(path.join(dir, "baseline", "baseline.json")),
        publicWeb
    });

    return [
        policy.formatPlan({ risk: change.level, reasons: change.reasons, plan }, current),
        "",
        "Changed: " + paths.join(", ")
    ].join("\n");
}

module.exports = { describe, markupDependents };
