"use strict";
// Mechanical review-evidence gate. REVIEW.md remains human-authored; this only checks the
// invariant the MCP ledger can prove honestly: PASS claims for behavior/action rows require at
// least one successful pal_exercise call in the current session.
const fs = require("fs");
const path = require("path");
const { version: PACKAGE_VERSION } = require("../../package.json");
const { USAGE_FILE, SESSION_COST_FILE, readSessionCost, phaseTotals } = require("./usage");
const { parseTasks, STATUSES } = require("./taskState");
const { diffWorkspace } = require("./localDrift");
const { FILENAME: PALSYNC_FILE } = require("./palsyncfile");

const REVIEW_TOOLS = ["pal_exercise", "pal_test", "pal_push", "pal_screenshot"];

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { return null; }
}

function successfulExerciseCalls(ledger) {
    const tool = ledger && ledger.tools && ledger.tools.pal_exercise;
    return tool && Number.isFinite(Number(tool.successfulCalls)) ? Number(tool.successfulCalls) : 0;
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

function checkReview(review, ledger) {
    const exercises = successfulExerciseCalls(ledger);
    const rows = passRows(review);
    const verdictPass = /^\s*verdict\s*:\s*PASS\s*$/im.test(String(review || ""));
    const biasWarning = /\bBIAS WARNING:/i.test(String(review || ""));
    const flags = exercises === 0 ? rows.map(r => Object.assign({ code: "PASS WITHOUT EXERCISE EVIDENCE" }, r)) : [];
    return {
        ok: flags.length === 0 && !(verdictPass && exercises === 0) && !biasWarning,
        exercises, rows, flags, biasWarning,
        verdictMustChange: verdictPass && (exercises === 0 || biasWarning)
    };
}

function checkWorkspace(workspaceDir) {
    const reviewPath = path.join(workspaceDir, "REVIEW.md");
    let review;
    try { review = fs.readFileSync(reviewPath, "utf8"); }
    catch (e) { return { ok: false, missingReview: true, reviewPath, exercises: 0, rows: [], flags: [], biasWarning: false, verdictMustChange: false }; }
    const result = Object.assign(checkReview(review, readJson(path.join(workspaceDir, USAGE_FILE))), { reviewPath });
    const localDrift = diffWorkspace(readJson(path.join(workspaceDir, PALSYNC_FILE)), workspaceDir);
    result.localDrift = localDrift;
    if (localDrift.dirty) result.ok = false;
    return result;
}

function formatReviewCheck(result) {
    const lines = ["palsync " + PACKAGE_VERSION + " review check", "successful pal_exercise calls: " + result.exercises];
    if (result.missingReview) lines.push("FAIL: REVIEW.md not found.");
    for (const flag of result.flags) lines.push("FLAG line " + flag.line + ": " + flag.code + " — " + flag.label);
    if (result.biasWarning) lines.push("VERDICT CAP: BIAS WARNING present; self-review cannot receive PASS.");
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
    return {
        successful: tool && Number.isFinite(Number(tool.successfulCalls)) ? Number(tool.successfulCalls) : 0,
        total: tool && Number.isFinite(Number(tool.calls)) ? Number(tool.calls) : 0
    };
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
    const cost = readSessionCost(workspaceDir);
    return {
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
    lines.push("usage sidecar: " + (brief.usageAvailable ? "available" : "not available"));
    lines.push("tool calls (successful/total):");
    for (const name of REVIEW_TOOLS) {
        const calls = brief.tools[name];
        lines.push("  " + name + ": " + (calls ? calls.successful + "/" + calls.total : "not available"));
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
    successfulExerciseCalls, passRows, checkReview, checkWorkspace, formatReviewCheck,
    buildReviewBrief, formatReviewBrief
};
