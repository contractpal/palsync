"use strict";
// Mechanical review-evidence gate. REVIEW.md remains human-authored; this only checks the
// invariant durable tool evidence can prove honestly: PASS claims for behavior/action rows require
// at least one successful pal_exercise run against the current pushed pal version.
const fs = require("fs");
const path = require("path");
const { version: PACKAGE_VERSION } = require("../../package.json");
const {
    USAGE_FILE, TOOL_EVIDENCE_FILE, readSessionCost, phaseTotals,
    readToolEvidence, filterToolEvidence
} = require("./usage");
const { parseTasks, STATUSES } = require("./taskState");
const { diffWorkspace } = require("./localDrift");
const { FILENAME: PALSYNC_FILE } = require("./palsyncfile");

const REVIEW_TOOLS = ["pal_exercise", "pal_test", "pal_push", "pal_screenshot"];

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { return null; }
}

function successfulEvidenceEntries(evidence, tool, palGuid, marker, sourceDigest) {
    return filterToolEvidence(evidence, tool, palGuid, marker, sourceDigest);
}

function successfulEvidenceCalls(evidence, tool, palGuid, marker, sourceDigest) {
    return successfulEvidenceEntries(evidence, tool, palGuid, marker, sourceDigest).length;
}

function successfulExerciseCalls(evidence, palGuid, marker, sourceDigest) {
    return successfulEvidenceCalls(evidence, "pal_exercise", palGuid, marker, sourceDigest);
}

function passRows(review) {
    const lines = String(review || "").split(/\r?\n/);
    const rows = [];
    let behaviorSection = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const heading = line.match(/^#{2,6}\s+(.+)/);
        if (heading) {
            behaviorSection = /(?:§\s*5\b|action[ -]+trace|happy[ -]path)/i.test(heading[1]);
            continue;
        }
        if (!/^\s*\|/.test(line) || /^\s*\|[\s:|-]+\|?\s*$/.test(line)) continue;
        const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
        const isPass = cells.some(c => /^PASS$/i.test(c));
        const namesBehaviorRow = /(?:§\s*5\b|happy[ -]path)/i.test(cells[0] || "");
        if (isPass && (behaviorSection || namesBehaviorRow)) rows.push({ line: i + 1, label: cells[0] || "(unlabelled row)" });
    }
    return rows;
}

function passDeclaration(line) {
    const decoration = "(?:\\*{1,2}|_{1,2})?";
    return new RegExp("^\\s*(?:#{1,6}\\s*)?" + decoration +
        "(?:verdict|overall|result|status)\\s*:\\s*PASS\\b" + decoration + "[^\\w`]*$", "i").test(line);
}

function reviewVerdict(review) {
    const lines = String(review || "").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(?:#{1,6}\s*)?(?:\*{1,2}|_{1,2})?(?:verdict|overall|result|status)\s*:\s*CHANGES[- ]NEEDED\b/i.test(line) ||
            /^\s*#{1,6}\s+(?:verdict\s*[-:—]\s*)?CHANGES[- ]NEEDED\b/i.test(line)) return "CHANGES-NEEDED";
        if (passDeclaration(line) ||
            /^\s*#{1,6}\s+(?:verdict\s*[-:—]\s*)?PASS\b[^\w`]*$/i.test(line)) return "PASS";
        if (!/^\s*#{1,6}\s+verdict\s*[^\w`]*$/i.test(line)) continue;
        let next = i + 1;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next < lines.length && /^\s*(?:\*{1,2}|_{1,2})?CHANGES[- ]NEEDED\b/i.test(lines[next])) return "CHANGES-NEEDED";
        if (next < lines.length && (passDeclaration(lines[next]) ||
            /^\s*(?:\*{1,2}|_{1,2})PASS(?:\*{1,2}|_{1,2})[^\w`]*$/i.test(lines[next]))) return "PASS";
    }
    return "MISSING/UNKNOWN";
}

function verdictPass(review) { return reviewVerdict(review) === "PASS"; }

const RESPONSIVE_ROUTE_CAP = 10; // brief/check route lines render on every review — cap the block

function viewportState(entry) {
    if (!entry) return "missing";
    return entry.renderClean ? "clean" : "render-error";
}

function routeAuditRules(cov) {
    return [...new Set([
        ...(cov.desktop ? cov.desktop.auditRules : []),
        ...(cov.mobile ? cov.mobile.auditRules : [])
    ])];
}

function routeAuditErrors(cov) {
    return (cov.desktop ? cov.desktop.auditErrors : 0) + (cov.mobile ? cov.mobile.auditErrors : 0);
}

// Durable responsive render evidence, reconstructed from pal_screenshot rows in the tool-evidence
// sidecar. Gate predicate is renderClean only — audit fields ride along for reporting and never
// affect completeness (owner decision 2026-07-30 #3: advisory audit rules must not become walls).
function responsiveEvidence(entries, palGuid, marker, sourceDigest) {
    const rows = filterToolEvidence(entries, "pal_screenshot", palGuid, marker, sourceDigest);
    // Signal rows (viewportName:null) mark "capture impossible here" — unavailable browser or
    // testing switched off. appendToolEvidence stamps successful:true on every row, so they
    // survive filterToolEvidence and must be excluded from the route map; left in, their route
    // would be permanently incomplete, turning the human-gate escape into a hard fail.
    const captures = rows.filter(r => r.viewportName != null);
    const routes = {};
    // Replay ascending so a later failed capture overwrites a prior pass per (route, viewport) —
    // the same semantic as the in-memory recordScreenshotEvidence. Never collapse with .some().
    for (const row of [...captures].sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")))) {
        const route = String(row.route || "/");
        if (!routes[route]) routes[route] = {};
        routes[route][String(row.viewportName)] = {
            renderClean: row.renderClean === true,
            auditErrors: Number(row.auditErrors) || 0,
            auditRules: Array.isArray(row.auditRules) ? row.auditRules.map(String) : []
        };
    }
    const incomplete = [];
    let auditErrorTotal = 0;
    const auditRuleIds = new Set();
    for (const [route, cov] of Object.entries(routes)) {
        for (const viewport of ["desktop", "mobile"]) {
            if (!cov[viewport]) continue;
            auditErrorTotal += cov[viewport].auditErrors;
            for (const rule of cov[viewport].auditRules) auditRuleIds.add(rule);
        }
        if (!(cov.desktop && cov.desktop.renderClean && cov.mobile && cov.mobile.renderClean)) {
            incomplete.push({ route, desktop: viewportState(cov.desktop), mobile: viewportState(cov.mobile) });
        }
    }
    return {
        routes,
        incomplete,
        complete: Object.keys(routes).length > 0 && incomplete.length === 0,
        auditErrorTotal,
        auditRuleIds: [...auditRuleIds],
        unavailable: rows.some(r => r.unavailable === true),
        testingDisabled: rows.some(r => r.testingDisabled === true),
        anyEvidence: captures.length > 0,
        anyCleanCapture: captures.some(r => r.renderClean === true)
    };
}

function checkReview(review, evidenceContext = {}) {
    const exerciseEntries = successfulEvidenceEntries(
        evidenceContext.entries, "pal_exercise", evidenceContext.palGuid,
        evidenceContext.marker, evidenceContext.sourceDigest);
    const exercises = exerciseEntries.length;
    const rows = passRows(review);
    const reviewText = String(review || "");
    const verdict = reviewVerdict(reviewText);
    const declaresPass = verdict === "PASS";
    const biasWarning = /\bBIAS WARNING:/i.test(reviewText);
    const flags = exercises === 0 ? rows.map(r => Object.assign({ code: "PASS WITHOUT EXERCISE EVIDENCE" }, r)) : [];
    const result = {
        ok: declaresPass && flags.length === 0 && !biasWarning,
        verdict, exercises, exerciseEntries, rows, flags, biasWarning,
        verdictMustChange: declaresPass && (flags.length > 0 || biasWarning)
    };
    // Responsive render gate — evaluated only when the caller supplies a durable evidence array
    // (checkWorkspace always does). For direct checkReview(review) callers, an absent array means
    // "not evaluated", never "no evidence" — that would be a false block.
    if (Array.isArray(evidenceContext.entries)) {
        const responsive = responsiveEvidence(evidenceContext.entries, evidenceContext.palGuid,
            evidenceContext.marker, evidenceContext.sourceDigest);
        result.responsive = responsive;
        // Unconditional on a PASS verdict (owner decision #8): declaring PASS asserts the UI is
        // acceptable — a UI claim by construction — so there is no row-scoping escape here.
        if (declaresPass) {
            if ((responsive.unavailable || responsive.testingDisabled) && !responsive.anyCleanCapture) {
                // Durable capture-impossible signal AND zero clean captures: degrade to a human
                // gate, never a hard fail (owner decisions #4/#9). The anyCleanCapture guard is
                // load-bearing — one clean capture proves capture works on this machine, so
                // incomplete coverage there must FAIL rather than degrade (otherwise a two-call
                // toggle bypass keeps the gate advisory for the whole sourceDigest).
                result.responsiveHumanGate = true;
            } else if (!responsive.anyEvidence) {
                responsive.code = "PASS WITHOUT RESPONSIVE EVIDENCE";
                result.ok = false;
                result.verdictMustChange = true;
            } else if (responsive.incomplete.length) {
                responsive.code = "PASS WITH INCOMPLETE VIEWPORT COVERAGE";
                result.ok = false;
                result.verdictMustChange = true;
            }
        }
    }
    return result;
}

function mtimeMs(file) {
    try { return fs.statSync(file).mtimeMs; }
    catch (e) { return null; }
}

function checkWorkspace(workspaceDir) {
    const reviewPath = path.join(workspaceDir, "REVIEW.md");
    let review;
    try { review = fs.readFileSync(reviewPath, "utf8"); }
    catch (e) { return { ok: false, missingReview: true, reviewPath, verdict: "MISSING/UNKNOWN", exercises: 0, exerciseEntries: [], rows: [], flags: [], biasWarning: false, verdictMustChange: false }; }
    const record = readJson(path.join(workspaceDir, PALSYNC_FILE));
    const evidence = readToolEvidence(workspaceDir);
    const result = Object.assign(checkReview(review, {
        entries: evidence,
        palGuid: record && record.palGuid,
        marker: record && record.lastModifiedDate,
        sourceDigest: record && record.localHash
    }), { reviewPath });
    const reviewMtimeMs = mtimeMs(reviewPath);
    const freshnessSources = [PALSYNC_FILE, TOOL_EVIDENCE_FILE, "EXECUTION.md"]
        .map(file => ({ file, mtimeMs: mtimeMs(path.join(workspaceDir, file)) }))
        .filter(source => source.mtimeMs !== null);
    const newestEvidence = freshnessSources.reduce((latest, source) =>
        !latest || source.mtimeMs > latest.mtimeMs ? source : latest, null);
    result.reviewMtimeMs = reviewMtimeMs;
    result.newestEvidence = newestEvidence;
    result.staleReview = !!(newestEvidence && reviewMtimeMs < newestEvidence.mtimeMs);
    if (result.staleReview) result.ok = false;
    const localDrift = diffWorkspace(record, workspaceDir);
    result.localDrift = localDrift;
    if (localDrift.dirty) result.ok = false;
    return result;
}

function shortDigest(value) { return value ? String(value).slice(0, 12) : null; }

function exerciseSummaryLines(entries) {
    if (!entries || !entries.length) return ["exercise evidence for current pushed source: none"];
    const latest = [...entries].sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")))[0];
    const s = latest.summary || {};
    const lines = ["exercise evidence for current pushed source: available"];
    if (latest.summary) {
        lines.push("latest successful run: " + [s.workflow || latest.kind || "unknown", latest.mode || "unknown"].join("/") +
            ", " + (s.viewport || "desktop") + ", " + (Number(s.stepCount) || 0) + " steps");
        lines.push("observed: " + (Array.isArray(s.webActions) ? s.webActions.length : 0) + " named web actions; " +
            (Number(s.browserInteractionCount) || 0) + " browser interactions; " +
            (Array.isArray(s.filledFields) ? s.filledFields.length : 0) + " filled fields; " +
            (Number(s.positiveAssertionCount) || 0) + " positive assertions; " +
            (Number(s.absenceAssertionCount) || 0) + " absence assertions");
    }
    const digest = shortDigest(latest.sourceDigest);
    if (digest) lines.push("source digest: " + digest);
    else if (latest.marker) lines.push("legacy source marker: " + String(latest.marker).slice(0, 40));
    return lines;
}

function formatReviewCheck(result) {
    const lines = ["palsync " + PACKAGE_VERSION + " review check", ...exerciseSummaryLines(result.exerciseEntries)];
    if (result.missingReview) lines.push("FAIL: REVIEW.md not found.");
    if (result.staleReview) lines.push("FAIL: REVIEW.md is stale — " + result.newestEvidence.file +
        " changed after the review. Re-run pal-review and overwrite REVIEW.md with fresh evidence.");
    if (!result.missingReview && result.verdict !== "PASS") lines.push("FAIL: reviewer verdict is " + result.verdict + "; an explicit independent PASS is required.");
    for (const flag of result.flags) lines.push("FLAG line " + flag.line + ": " + flag.code + " — " + flag.label);
    if (result.biasWarning) lines.push("VERDICT CAP: BIAS WARNING present; self-review cannot receive PASS.");
    if (result.biasWarning && result.verdictMustChange) lines.push("REVIEW.md declares PASS while bias-capped — edit the verdict to CHANGES-NEEDED.");
    if (result.verdictMustChange && !result.biasWarning && result.flags.length > 0) lines.push("VERDICT CAP: declared behavior has no exercise evidence for the current pushed source; PASS must be changed to CHANGES-NEEDED.");
    if (result.responsive) {
        const responsive = result.responsive;
        if (result.responsiveHumanGate) lines.push("HUMAN GATE: screenshot capture unavailable on this machine (or automated testing is off); a person must confirm the 390px layout.");
        if (responsive.code === "PASS WITHOUT RESPONSIVE EVIDENCE") {
            lines.push("VERDICT CAP: PASS WITHOUT RESPONSIVE EVIDENCE — a PASS verdict requires a clean desktop and mobile capture for every reviewed route; PASS must be changed to CHANGES-NEEDED.");
            lines.push("REMEDIATION: run pal_screenshot for each reviewed route at desktop and mobile. If this machine reports screenshot unavailable, that is recorded and downgrades to a human gate.");
        }
        if (responsive.code === "PASS WITH INCOMPLETE VIEWPORT COVERAGE") {
            lines.push("VERDICT CAP: PASS WITH INCOMPLETE VIEWPORT COVERAGE; PASS must be changed to CHANGES-NEEDED.");
            for (const gap of responsive.incomplete.slice(0, RESPONSIVE_ROUTE_CAP)) {
                lines.push("  " + gap.route + " — desktop: " + gap.desktop + ", mobile: " + gap.mobile);
            }
            if (responsive.incomplete.length > RESPONSIVE_ROUTE_CAP) lines.push("  +" + (responsive.incomplete.length - RESPONSIVE_ROUTE_CAP) + " more routes");
            lines.push("REMEDIATION: capture the missing viewport, then re-run pal-review and overwrite REVIEW.md — new evidence makes the existing review stale.");
        }
        // Advisory only — audit findings inform the reviewer; they never flip ok/verdictMustChange.
        // An audit-error count with NO rule ids still gets a line: rule ids can be absent (older
        // evidence rows, truncated rule lists, an audit that counted errors it could not name), and
        // silently dropping the route would hide real findings from the reviewer.
        const advisory = Object.entries(responsive.routes)
            .map(([route, cov]) => {
                const rules = routeAuditRules(cov);
                if (rules.length) return "ADVISORY: design audit findings on " + route + ": " + rules.join(", ");
                const errors = routeAuditErrors(cov);
                if (errors > 0) return "ADVISORY: design audit findings on " + route + ": " + errors +
                    " audit error(s) recorded; rule identifiers unavailable in the recorded evidence.";
                return null;
            })
            .filter(Boolean);
        lines.push(...advisory.slice(0, RESPONSIVE_ROUTE_CAP));
        if (advisory.length > RESPONSIVE_ROUTE_CAP) lines.push("+" + (advisory.length - RESPONSIVE_ROUTE_CAP) + " more routes with audit findings");
    }
    if (result.localDrift && result.localDrift.dirty) {
        lines.push("UNPUSHED CHANGES: server-tracked files differ from the last pull/push:");
        for (const rel of result.localDrift.changed) lines.push("  modified: " + rel);
        for (const rel of result.localDrift.deleted) lines.push("  deleted: " + rel);
        if (result.localDrift.manifestOnly) lines.push("  modified: pal.json (not explained by new files)");
        if (result.localDrift.legacy) lines.push("  file list unavailable from legacy sync baseline");
        lines.push("REMEDIATION: push, then re-capture evidence.");
    }
    lines.push("result: " + (result.ok ? "PASS" : "FAIL"));
    return lines.join("\n");
}

function toolCalls(ledger, name) {
    if (!ledger) return null;
    const tool = ledger.tools && ledger.tools[name];
    return tool && Number.isFinite(Number(tool.calls)) ? Number(tool.calls) : 0;
}

function taskEvidence(workspaceDir) {
    try {
        const parsed = parseTasks(fs.readFileSync(path.join(workspaceDir, "EXECUTION.md"), "utf8"));
        if (!parsed.ok) return { available: false, detail: "unreadable (" + parsed.error + ")" };
        const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
        for (const row of parsed.rows) counts[row.status] = (counts[row.status] || 0) + 1;
        return { available: true, total: parsed.rows.length, counts };
    } catch (e) {
        return { available: false, detail: "not available" };
    }
}

function buildReviewBrief(workspaceDir) {
    const usage = readJson(path.join(workspaceDir, USAGE_FILE));
    const evidencePath = path.join(workspaceDir, TOOL_EVIDENCE_FILE);
    const evidence = readToolEvidence(workspaceDir);
    const record = readJson(path.join(workspaceDir, PALSYNC_FILE));
    const palGuid = record && record.palGuid;
    const marker = record && record.lastModifiedDate;
    const sourceDigest = record && record.localHash;
    const exerciseEntries = successfulEvidenceEntries(evidence, "pal_exercise", palGuid, marker, sourceDigest);
    const cost = readSessionCost(workspaceDir);
    return {
        evidenceAvailable: fs.existsSync(evidencePath),
        exerciseEntries,
        responsive: responsiveEvidence(evidence, palGuid, marker, sourceDigest),
        evidence: {
            pal_exercise: exerciseEntries.length,
            pal_push: successfulEvidenceCalls(evidence, "pal_push", palGuid, marker, sourceDigest)
        },
        usageAvailable: usage !== null,
        tools: Object.fromEntries(REVIEW_TOOLS.map(name => [name, toolCalls(usage, name)])),
        cost: cost ? Object.assign({ available: true, entries: cost.entries }, phaseTotals(cost.entries)) : { available: false },
        tasks: taskEvidence(workspaceDir)
    };
}

function responsiveCoverageLines(responsive) {
    const lines = ["RESPONSIVE COVERAGE"];
    if (responsive.unavailable || responsive.testingDisabled) {
        lines.push("  " + (responsive.testingDisabled ? "testing-disabled" : "capture-unavailable") + " signal recorded");
    }
    const names = Object.keys(responsive.routes);
    if (!names.length) {
        lines.push("  none recorded");
        return lines;
    }
    for (const route of names.slice(0, RESPONSIVE_ROUTE_CAP)) {
        const cov = responsive.routes[route];
        const rules = routeAuditRules(cov);
        lines.push("  " + route + " — desktop: " + viewportState(cov.desktop) + ", mobile: " + viewportState(cov.mobile) +
            (rules.length ? " (audit: " + rules.join(", ") + ")" : ""));
    }
    if (names.length > RESPONSIVE_ROUTE_CAP) lines.push("  +" + (names.length - RESPONSIVE_ROUTE_CAP) + " more routes");
    return lines;
}

function formatAccumulator(acc, currency) {
    const cost = acc.hasCost ? acc.cost.toFixed(4) + " " + currency : "not provided";
    return "in=" + acc.tokensIn + " cached=" + acc.tokensCached + " out=" + acc.tokensOut + " cost=" + cost;
}

function formatReviewBrief(brief) {
    const lines = ["palsync " + PACKAGE_VERSION + " review brief", "EVIDENCE LEDGER"];
    lines.push("tool evidence sidecar: " + (brief.evidenceAvailable ? "available" : "not available"));
    lines.push("current-version successful evidence:");
    lines.push(...exerciseSummaryLines(brief.exerciseEntries).map(line => "  " + line));
    lines.push("  pal_push: " + brief.evidence.pal_push);
    lines.push(...responsiveCoverageLines(brief.responsive));
    lines.push("MCP usage sidecar: " + (brief.usageAvailable ? "available" : "not available"));
    lines.push("MCP attempts this session:");
    for (const name of REVIEW_TOOLS) {
        const calls = brief.tools[name];
        lines.push("  " + name + ": " + (calls === null ? "not available" : calls));
    }
    lines.push("session cost sidecar: " + (brief.cost.available ? "available" : "not available"));
    if (brief.cost.available) {
        const currency = (brief.cost.entries[0] && brief.cost.entries[0].currency) || "USD";
        lines.push("  total: " + formatAccumulator(brief.cost.total, currency));
        for (const phase of ["build", "review", "other"]) {
            lines.push("  " + phase + ": " + (brief.cost.phases[phase] ? formatAccumulator(brief.cost.phases[phase], currency) : "not available"));
        }
    } else {
        lines.push("  total: not available");
        lines.push("  build: not available");
        lines.push("  review: not available");
        lines.push("  other: not available");
    }
    lines.push("EXECUTION.md tasks: " + (brief.tasks.available ? brief.tasks.total + " total" : brief.tasks.detail));
    for (const status of STATUSES) lines.push("  " + status + ": " + (brief.tasks.available ? brief.tasks.counts[status] || 0 : "not available"));
    lines.push("NO EVIDENCE — open source only for these:");
    lines.push("- SPEC requirements not represented by the tool and task tallies above");
    lines.push("- action-to-workflow-to-data traces not proven by a named exercise result");
    lines.push("- implementation constraints and workflow-payload-to-fragment contracts");
    return lines.join("\n");
}

module.exports = {
    successfulExerciseCalls, passRows, reviewVerdict, verdictPass, checkReview, checkWorkspace, formatReviewCheck,
    buildReviewBrief, formatReviewBrief, exerciseSummaryLines, responsiveEvidence
};
