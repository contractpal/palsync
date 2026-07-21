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

function successfulEvidenceCalls(evidence, tool, palGuid, marker) {
    return filterToolEvidence(evidence, tool, palGuid, marker).length;
}

function successfulExerciseCalls(evidence, palGuid, marker) {
    return successfulEvidenceCalls(evidence, "pal_exercise", palGuid, marker);
}

function passRows(review) {
    const lines = String(review || "").split(/\r?\n/);
    const rows = [];
    let evidenceSection = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const heading = line.match(/^#{2,6}\s+(.+)/);
        if (heading) {
            evidenceSection = /(?:§\s*(?:5|12)|action[ -]+trace|happy[ -]path)/i.test(heading[1]);
            continue;
        }
        if (!/^\s*\|/.test(line) || /^\s*\|[\s:|-]+\|?\s*$/.test(line)) continue;
        const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
        const isPass = cells.some(c => /^PASS$/i.test(c));
        const namesEvidenceRow = /§\s*(?:5|12)|happy[ -]path/i.test(cells[0] || "");
        if (isPass && (evidenceSection || namesEvidenceRow)) rows.push({ line: i + 1, label: cells[0] || "(unlabelled row)" });
    }
    return rows;
}

function passDeclaration(line) {
    const decoration = "(?:\\*{1,2}|_{1,2})?";
    return new RegExp("^\\s*(?:#{1,6}\\s*)?" + decoration +
        "(?:verdict|overall|result|status)\\s*:\\s*PASS\\b" + decoration + "[^\\w`]*$", "i").test(line);
}

function verdictPass(review) {
    const lines = String(review || "").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (passDeclaration(line) ||
            /^\s*#{1,6}\s+(?:verdict\s*[-:—]\s*)?PASS\b[^\w`]*$/i.test(line)) return true;
        if (!/^\s*#{1,6}\s+verdict\s*[^\w`]*$/i.test(line)) continue;
        let next = i + 1;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next < lines.length && (passDeclaration(lines[next]) ||
            /^\s*(?:\*{1,2}|_{1,2})PASS(?:\*{1,2}|_{1,2})[^\w`]*$/i.test(lines[next]))) return true;
    }
    return false;
}

function checkReview(review, evidenceContext = {}) {
    const exercises = successfulExerciseCalls(
        evidenceContext.entries, evidenceContext.palGuid, evidenceContext.marker);
    const rows = passRows(review);
    const reviewText = String(review || "");
    const declaresPass = verdictPass(reviewText);
    const biasWarning = /\bBIAS WARNING:/i.test(reviewText);
    const flags = exercises === 0 ? rows.map(r => Object.assign({ code: "PASS WITHOUT EXERCISE EVIDENCE" }, r)) : [];
    return {
        ok: flags.length === 0 && !(declaresPass && exercises === 0) && !biasWarning,
        exercises, rows, flags, biasWarning,
        verdictMustChange: declaresPass && (exercises === 0 || biasWarning)
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
    catch (e) { return { ok: false, missingReview: true, reviewPath, exercises: 0, rows: [], flags: [], biasWarning: false, verdictMustChange: false }; }
    const record = readJson(path.join(workspaceDir, PALSYNC_FILE));
    const evidence = readToolEvidence(workspaceDir);
    const result = Object.assign(checkReview(review, {
        entries: evidence,
        palGuid: record && record.palGuid,
        marker: record && record.lastModifiedDate
    }), { reviewPath });
    const reviewMtimeMs = mtimeMs(reviewPath);
    const freshnessSources = [PALSYNC_FILE, USAGE_FILE, TOOL_EVIDENCE_FILE, "EXECUTION.md"]
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

function formatReviewCheck(result) {
    const lines = ["palsync " + PACKAGE_VERSION + " review check", "successful pal_exercise calls: " + result.exercises];
    if (result.missingReview) lines.push("FAIL: REVIEW.md not found.");
    if (result.staleReview) lines.push("FAIL: REVIEW.md is stale — " + result.newestEvidence.file +
        " changed after the review. Re-run pal-review and overwrite REVIEW.md with fresh evidence.");
    for (const flag of result.flags) lines.push("FLAG line " + flag.line + ": " + flag.code + " — " + flag.label);
    if (result.biasWarning) lines.push("VERDICT CAP: BIAS WARNING present; self-review cannot receive PASS.");
    if (result.biasWarning && result.verdictMustChange) lines.push("REVIEW.md declares PASS while bias-capped — edit the verdict to CHANGES-NEEDED.");
    if (result.verdictMustChange && !result.biasWarning) lines.push("VERDICT CAP: zero successful pal_exercise calls; PASS must be changed to CHANGES-NEEDED.");
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
    const cost = readSessionCost(workspaceDir);
    return {
        evidenceAvailable: fs.existsSync(evidencePath),
        evidence: {
            pal_exercise: successfulEvidenceCalls(evidence, "pal_exercise", palGuid, marker),
            pal_push: successfulEvidenceCalls(evidence, "pal_push", palGuid, marker)
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
    lines.push("  pal_exercise: " + brief.evidence.pal_exercise);
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
    successfulExerciseCalls, passRows, verdictPass, checkReview, checkWorkspace, formatReviewCheck,
    buildReviewBrief, formatReviewBrief
};
