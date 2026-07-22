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
    return {
        ok: declaresPass && flags.length === 0 && !biasWarning,
        verdict, exercises, exerciseEntries, rows, flags, biasWarning,
        verdictMustChange: declaresPass && (flags.length > 0 || biasWarning)
    };
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
    if (result.verdictMustChange && !result.biasWarning) lines.push("VERDICT CAP: declared behavior has no exercise evidence for the current pushed source; PASS must be changed to CHANGES-NEEDED.");
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
    buildReviewBrief, formatReviewBrief, exerciseSummaryLines
};
