"use strict";
// pal_regression core: check a brownfield pal against baseline/baseline.json (captured by pal-init
// Step 3). This is the MECHANICAL half of pal-loop's 7b regression re-check and pal-review's
// regression arm — deterministic comparison, not judgment (the LOOK-shifted question stays with
// pal-review's visual arm).
//
// Order is load-bearing:
//   1. FRESHNESS — compare baseline.mapped against the live pal_status marker. Server moved -> the
//      baseline is STALE; STOP and report {stale:true}. NEVER compare against a stale baseline.
//   2. validate error/warning counts vs baseline.validate.
//   3. pal_test each workflow in baseline.test vs its recorded VALIDATED/notes.
//   4. fetch each page with any captured:true viewport; confirm its recorded h1s still render
//      (via the expect mechanism — verdict only, never the HTML).
// Every failure is cross-referenced against known_issues: an already-listed defect is INHERITED
// (noted, not blocking); a new one is CAUSED (blocks). eyeball_only viewports are never pass/fail —
// they are reported needs_human, same as pal-review's eyeball fallback.
const fs = require("fs");
const path = require("path");
const { validateWorkspace } = require("./validate");
const { runTest } = require("./test");
const { fetchPagePath, checkExpect } = require("./preview");
const { resolveServerPalByGuid } = require("./resolve");
const drift = require("./drift");

function readBaseline(workspaceDir) {
    return JSON.parse(fs.readFileSync(path.join(workspaceDir, "baseline", "baseline.json"), "utf8"));
}

// A failure is INHERITED if any known_issues line mentions its subject (page path / workflow kind).
// Free-text match by design — known_issues are human sentences, not structured keys.
function makeInheritedTest(knownIssues) {
    const lower = (knownIssues || []).map(k => String(k).toLowerCase());
    return (subject) => !!subject && lower.some(k => k.indexOf(String(subject).toLowerCase()) !== -1);
}

function formatSummary(r) {
    if (r.noBaseline) return "No baseline/baseline.json — regression does not apply (greenfield, or pal-init never mapped this pal).";
    if (r.stale) return r.summary;
    const head = r.pass ? "REGRESSION PASSED" : "REGRESSION FAILED";
    const lines = [head + " — " + r.caused.length + " caused, " + r.inherited.length + " inherited (known), " + r.needs_human.length + " needs-human."];
    lines.push("  validate: errors " + r.validate.baseline.errors + "->" + r.validate.current.errors +
        ", warnings " + r.validate.baseline.warnings + "->" + r.validate.current.warnings);
    for (const t of r.tests) lines.push("  test " + t.workflow + ": " + t.baseline.status + "(" + (t.baseline.notes||0) + ") -> " + t.current.status + "(" + t.current.notes + ")");
    if (r.caused.length) { lines.push("CAUSED (this build — must fix):"); for (const c of r.caused) lines.push("   - " + c.subject + ": " + c.detail); }
    if (r.inherited.length) { lines.push("INHERITED (in known_issues — not caused here):"); for (const c of r.inherited) lines.push("   - " + c.subject + ": " + c.detail); }
    if (r.needs_human.length) { lines.push("NEEDS-HUMAN (eyeball / uncapturable — never auto-passed):"); for (const n of r.needs_human) lines.push("   - " + n.page + " " + n.viewport + ": " + n.reason); }
    if (r.notes.length) { lines.push("Notes: " + r.notes.join("; ")); }
    return lines.join("\n");
}

// `deps` lets tests inject the network-touching calls (freshness marker, pal_test, page fetch)
// with fixtures; production passes none and the real modules are used. validateWorkspace runs
// against the real workspace dir either way (it's offline).
async function runRegression(session, record, workspaceDir, deps = {}) {
    const resolveFn = deps.resolveServerPalByGuid || resolveServerPalByGuid;
    const validateFn = deps.validateWorkspace || validateWorkspace;
    const testFn = deps.runTest || runTest;
    const fetchFn = deps.fetchPagePath || fetchPagePath;
    let baseline;
    try { baseline = readBaseline(workspaceDir); }
    catch (e) {
        if (e && e.code === "ENOENT") return { ran: false, noBaseline: true, summary: formatSummary({ noBaseline: true }) };
        return { ran: false, error: true, reason: "Could not read baseline/baseline.json: " + (e && e.message ? e.message : e) };
    }

    const knownIssues = Array.isArray(baseline.known_issues) ? baseline.known_issues : [];
    const isInherited = makeInheritedTest(knownIssues);

    // 1 — FRESHNESS. Server moved since mapped -> stale; never verdict against a stale baseline.
    const live = await resolveFn(session, record.palGuid);
    const current = live ? live.lastModifiedDate : null;
    const mapped = baseline.mapped || null;
    if (current && mapped && drift.serverAdvanced(mapped, current)) {
        const stale = { ran: true, stale: true, mapped, current };
        stale.summary = "STALE baseline — the server moved since mapped (" + mapped + " -> " + current +
            "). Re-run pal-init Step 3 to refresh baseline/. No regression verdict produced.";
        return stale;
    }

    const caused = [], inherited = [], needs_human = [], notes = [];
    const recordFail = (subject, detail) => (isInherited(subject) ? inherited : caused).push({ subject, detail });

    // 2 — VALIDATE counts. A rise in ERRORS is a caused failure; a rise in warnings is a note.
    const lint = validateFn(workspaceDir);
    const bv = { errors: (baseline.validate && baseline.validate.errors) || 0, warnings: (baseline.validate && baseline.validate.warnings) || 0 };
    const validate = { baseline: bv, current: { errors: lint.errors, warnings: lint.warnings } };
    if (lint.errors > bv.errors) recordFail("validate", "errors rose " + bv.errors + " -> " + lint.errors);
    if (lint.warnings > bv.warnings) notes.push("validate warnings rose " + bv.warnings + " -> " + lint.warnings);

    // 3 — TEST each baseline workflow.
    const tests = [];
    for (const kind of Object.keys(baseline.test || {})) {
        const base = baseline.test[kind] || {};
        const t = await testFn(session, record.palGuid, { kind });
        const validated = !!t.validated;
        const noteCount = (t.validation || []).length;
        tests.push({ workflow: kind, baseline: { status: base.status || "?", notes: base.notes || 0 },
            current: { status: t.ran ? (validated ? "VALIDATED" : "NOT_VALIDATED") : "DID_NOT_RUN", notes: noteCount } });
        if (base.status === "VALIDATED" && !validated) recordFail(kind, kind + " workflow no longer VALIDATED (was VALIDATED)");
        else if (noteCount > (base.notes || 0)) recordFail(kind, kind + " validation notes rose " + (base.notes || 0) + " -> " + noteCount);
    }

    // 4 — FETCH each page with any captured:true viewport; confirm recorded h1s still render.
    const pages = [];
    for (const page of Object.keys(baseline.pages || {})) {
        const pinfo = baseline.pages[page] || {};
        const viewports = pinfo.viewports || {};
        for (const vn of Object.keys(viewports)) {
            if (viewports[vn] && viewports[vn].eyeball_only) needs_human.push({ page, viewport: vn, reason: "eyeball_only viewport — compare against the saved baseline screenshot by hand" });
        }
        const anyCaptured = Object.keys(viewports).some(vn => viewports[vn] && viewports[vn].captured === true);
        if (!anyCaptured) continue;
        const h1s = Array.isArray(pinfo.h1s) ? pinfo.h1s : [];
        const res = await fetchFn(session, record.palGuid, page);
        if (!res.fetched) { recordFail(page, "page no longer fetches (" + (res.reason || "unknown") + ")"); pages.push({ page, fetched: false, reason: res.reason }); continue; }
        const chk = checkExpect(res.html, h1s);
        pages.push({ page, fetched: true, status: res.status, h1s: chk.results });
        for (const rr of chk.results) if (!rr.found) recordFail(page, "recorded H1 missing from " + page + ": " + JSON.stringify(rr.string));
    }

    const result = { ran: true, stale: false, pass: caused.length === 0, mapped, current,
        validate, tests, pages, caused, inherited, needs_human, notes, known_issues: knownIssues };
    result.summary = formatSummary(result);
    return result;
}

module.exports = { runRegression, readBaseline, formatSummary, makeInheritedTest };
