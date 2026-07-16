"use strict";
// Mechanical review-evidence gate. REVIEW.md remains human-authored; this only checks the
// invariant the MCP ledger can prove honestly: PASS claims for behavior/action rows require at
// least one successful pal_exercise call in the current session.
const fs = require("fs");
const path = require("path");
const { USAGE_FILE } = require("./usage");

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
    const flags = exercises === 0 ? rows.map(r => Object.assign({ code: "PASS WITHOUT EXERCISE EVIDENCE" }, r)) : [];
    return { ok: flags.length === 0 && !(verdictPass && exercises === 0), exercises, rows, flags, verdictMustChange: verdictPass && exercises === 0 };
}

function checkWorkspace(workspaceDir) {
    const reviewPath = path.join(workspaceDir, "REVIEW.md");
    let review;
    try { review = fs.readFileSync(reviewPath, "utf8"); }
    catch (e) { return { ok: false, missingReview: true, reviewPath, exercises: 0, rows: [], flags: [], verdictMustChange: false }; }
    return Object.assign(checkReview(review, readJson(path.join(workspaceDir, USAGE_FILE))), { reviewPath });
}

function formatReviewCheck(result) {
    const lines = ["palsync review check", "successful pal_exercise calls: " + result.exercises];
    if (result.missingReview) lines.push("FAIL: REVIEW.md not found.");
    for (const flag of result.flags) lines.push("FLAG line " + flag.line + ": " + flag.code + " — " + flag.label);
    if (result.verdictMustChange) lines.push("VERDICT CAP: zero successful pal_exercise calls; PASS must be changed to CHANGES-NEEDED.");
    lines.push("result: " + (result.ok ? "PASS" : "FAIL"));
    return lines.join("\n");
}

module.exports = { successfulExerciseCalls, passRows, checkReview, checkWorkspace, formatReviewCheck };
