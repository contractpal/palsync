"use strict";
// pal_regression core: check an existing pal against baseline/baseline.json (an OPTIONAL artifact;
// see shared/references/regression-baseline.md). This is the MECHANICAL half of the regression check
// pal-loop and pal-review run when a baseline exists — deterministic comparison, not judgment (the LOOK-shifted question stays with
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
const fsp = require("fs/promises");
const path = require("path");
const { validateWorkspace } = require("./validate");
const { runTest } = require("./test");
const { fetchPagePath, checkExpect } = require("./preview");
const { runScreenshot } = require("./screenshot");
const { resolveServerPalByGuid } = require("./resolve");
const { diffWorkspace } = require("./localDrift");
const { writeIfChanged } = require("./atomicWrite");
const drift = require("./drift");

function readBaseline(workspaceDir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(workspaceDir, "baseline", "baseline.json"), "utf8"));
    } catch (e) {
        throw e;
    }
}

// A failure is INHERITED if any known_issues line mentions its subject (page path / workflow kind).
// Free-text match by design — known_issues are human sentences, not structured keys.
function makeInheritedTest(knownIssues) {
    const lower = (knownIssues || []).map(k => String(k).toLowerCase());
    return (subject) => !!subject && lower.some(k => k.indexOf(String(subject).toLowerCase()) !== -1);
}

function formatSummary(r) {
    if (r.noBaseline) return "No baseline/baseline.json — regression does not apply (no baseline was ever captured for this pal).";
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
            "). Recapture baseline/ before comparing again. No regression verdict produced.";
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

// Capture is deliberately separate from comparison: a push never calls this. The approval is a
// human-entered phrase bound to the stable pal GUID and the marker the operator just observed.
function captureApproval(record, revision) {
    return "CAPTURE " + record.palGuid + " @ " + revision;
}

function validRevision(value) {
    return typeof value === "string" && Number.isFinite(drift.parseTs(value));
}

function captureFailure(reason, extra = {}) {
    return Object.assign({ captured: false, reason, filesWritten: [], evidenceGaps: [], humanReviewRequired: true }, extra);
}

function captureSummary(result) {
    if (!result.captured) return "BASELINE NOT CAPTURED — " + result.reason;
    return "BASELINE CAPTURED — revision " + result.mapped + "; " + result.filesWritten.length +
        " file(s) written" + (result.evidenceGaps.length ? "; evidence gaps: " + result.evidenceGaps.join(", ") : "") +
        (result.humanReviewRequired ? "; human review remains necessary." : ".");
}

function extractH1s(html) {
    const headings = [];
    for (const match of String(html || "").matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)) {
        const text = match[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
        if (text) headings.push(text);
    }
    return headings;
}

async function copyDir(source, dest, io) {
    if (!fs.existsSync(source)) return;
    await io.mkdir(dest, { recursive: true });
    for (const entry of await io.readdir(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name), to = path.join(dest, entry.name);
        if (entry.isDirectory()) await copyDir(from, to, io);
        else if (entry.isFile()) await io.copyFile(from, to);
    }
}

// The capture only refreshes arms already approved in baseline/baseline.json. For a first capture
// it records validate + one server workflow test; page/screenshot coverage is intentionally empty
// until an operator adds it through a reviewed baseline, rather than guessing which UI matters.
async function captureBaseline(session, record, workspaceDir, { approval, revision } = {}, deps = {}) {
    const resolveFn = deps.resolveServerPalByGuid || resolveServerPalByGuid;
    const validateFn = deps.validateWorkspace || validateWorkspace;
    const testFn = deps.runTest || runTest;
    const fetchFn = deps.fetchPagePath || fetchPagePath;
    const screenshotFn = deps.runScreenshot || runScreenshot;
    const driftFn = deps.diffWorkspace || diffWorkspace;
    const writeFn = deps.writeIfChanged || writeIfChanged;
    const io = deps.fs || fsp;
    if (!record || !record.palGuid) return captureFailure("Pal identity is unavailable.");
    if (!validRevision(revision)) return captureFailure("A valid observed server revision is required.");
    if (approval !== captureApproval(record, revision)) {
        return captureFailure("Explicit operator approval is required: " + captureApproval(record, revision));
    }
    if (!record.fileHashes && !record.localHash) return captureFailure("Local tracked-file state cannot be verified (pull the Pal first).");
    const local = driftFn(record, workspaceDir);
    if (local.dirty || (local.added || []).length || (local.changed || []).length || (local.deleted || []).length) {
        return captureFailure("Local tracked files have unpushed changes.", { local });
    }

    let initial;
    try { initial = await resolveFn(session, record.palGuid); }
    catch (e) { return captureFailure("Server identity/revision could not be verified: " + (e.message || e)); }
    if (!initial || initial.guid !== record.palGuid || !validRevision(initial.lastModifiedDate)) {
        return captureFailure("Server identity/revision could not be verified.");
    }
    if (initial.lastModifiedDate !== revision) {
        return captureFailure("Observed revision no longer matches the server.", { observed: revision, current: initial.lastModifiedDate });
    }

    const lint = validateFn(workspaceDir);
    if (lint.errors > 0) return captureFailure("Validation failed; baseline was not changed.", { validate: { errors: lint.errors, warnings: lint.warnings } });

    let prior = null;
    try { prior = readBaseline(workspaceDir); }
    catch (e) { if (e.code !== "ENOENT") return captureFailure("Could not read existing baseline: " + e.message); }
    const test = {};
    const testKinds = prior && prior.test && Object.keys(prior.test).length ? Object.keys(prior.test) : [null];
    for (const kind of testKinds) {
        const result = await testFn(session, record.palGuid, kind ? { kind } : {});
        const name = kind || result.kind;
        if (!name || !result.ran || !result.validated) {
            return captureFailure("Required workflow test evidence failed" + (kind ? " for " + kind : "") + ".", { testResult: result });
        }
        test[name] = { status: "VALIDATED", notes: (result.validation || []).length };
    }

    await io.mkdir(path.join(workspaceDir, ".palsync"), { recursive: true });
    const stageRoot = await io.mkdtemp(path.join(workspaceDir, ".palsync", "baseline-capture-"));
    const stagedBaseline = path.join(stageRoot, "baseline");
    const targetBaseline = path.join(workspaceDir, "baseline");
    const filesWritten = [];
    try {
        await copyDir(targetBaseline, stagedBaseline, io);
        const pages = {};
        for (const page of Object.keys((prior && prior.pages) || {})) {
            const oldPage = prior.pages[page] || {};
            const fetched = await fetchFn(session, record.palGuid, page);
            if (!fetched.fetched) return captureFailure("Required page evidence failed for " + page + ".", { filesWritten });
            const h1s = extractH1s(fetched.html);
            if (Array.isArray(oldPage.h1s) && oldPage.h1s.length && !h1s.length) {
                return captureFailure("Required H1 evidence failed for " + page + ".", { filesWritten });
            }
            const viewports = {};
            for (const viewport of Object.keys(oldPage.viewports || {})) {
                const oldViewport = oldPage.viewports[viewport] || {};
                if (oldViewport.captured !== true) {
                    viewports[viewport] = Object.assign({}, oldViewport);
                    continue;
                }
                const shot = await screenshotFn(session, record.palGuid, { page, viewport, fullPage: true });
                if (!shot.captured || !shot.pngBase64) {
                    return captureFailure("Required screenshot evidence failed for " + page + " " + viewport + ".", { filesWritten });
                }
                const rel = oldViewport.screenshot || ("screenshots/" + page.replace(/[\\/]/g, "-") + "-" + viewport + ".png");
                const dest = path.join(stagedBaseline, ...rel.split("/"));
                await writeFn(dest, Buffer.from(shot.pngBase64, "base64"));
                if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
                    return captureFailure("Required screenshot PNG was not written for " + page + " " + viewport + ".", { filesWritten });
                }
                filesWritten.push("baseline/" + rel);
                viewports[viewport] = Object.assign({}, oldViewport, { captured: true, screenshot: rel });
            }
            pages[page] = { h1s, viewports };
        }
        let final;
        try { final = await resolveFn(session, record.palGuid); }
        catch (e) { return captureFailure("Server revision could not be verified before publish: " + (e.message || e), { filesWritten }); }
        if (!final || final.guid !== record.palGuid || final.lastModifiedDate !== revision) {
            return captureFailure("Server revision changed during capture; prior baseline was preserved.", { filesWritten, current: final && final.lastModifiedDate });
        }
        const baseline = {
            mapped: revision,
            captured_at: new Date().toISOString(),
            metadata: { pal_guid: record.palGuid, pal_name: record.palName || null, server_timestamp: revision },
            validate: { errors: lint.errors, warnings: lint.warnings },
            test,
            pages,
            known_issues: Array.isArray(prior && prior.known_issues) ? prior.known_issues : []
        };
        await writeFn(path.join(stagedBaseline, "baseline.json"), JSON.stringify(baseline, null, 2) + "\n");
        filesWritten.push("baseline/baseline.json");
        const backup = path.join(workspaceDir, ".palsync", "baseline-backup-" + process.pid + "-" + Date.now());
        let movedOld = false;
        try {
            if (fs.existsSync(targetBaseline)) { await io.rename(targetBaseline, backup); movedOld = true; }
            await io.rename(stagedBaseline, targetBaseline);
            if (movedOld) await io.rm(backup, { recursive: true, force: true });
        } catch (e) {
            if (movedOld && !fs.existsSync(targetBaseline) && fs.existsSync(backup)) await io.rename(backup, targetBaseline);
            return captureFailure("Could not publish baseline safely; prior baseline was preserved: " + (e.message || e), { filesWritten });
        }
        const evidenceGaps = [];
        for (const page of Object.values(pages)) for (const v of Object.values(page.viewports || {})) {
            if (v.captured !== true) evidenceGaps.push(v.reason || "uncaptured screenshot");
        }
        const result = { captured: true, mapped: revision, filesWritten, evidenceGaps, humanReviewRequired: evidenceGaps.length > 0 || Object.keys(pages).length === 0,
            validate: baseline.validate, test: baseline.test, pages: baseline.pages };
        result.summary = captureSummary(result);
        return result;
    } catch (e) {
        return captureFailure("Capture failed; prior baseline was preserved: " + (e.message || e), { filesWritten });
    } finally {
        await io.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = { runRegression, readBaseline, formatSummary, makeInheritedTest, captureBaseline, captureApproval, captureSummary, validRevision, extractH1s };
