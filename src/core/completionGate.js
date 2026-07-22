"use strict";
// Offline completion state machine. It decides only whether lifecycle completion enforcement
// applies and whether its deterministic evidence is satisfied; it performs no writes or I/O beyond
// reading workspace files through taskState/reviewCheck.
const fs = require("fs");
const path = require("path");
const { parseTasks, STATUSES, BLOCKED_STATUSES, terminalReasonState } = require("./taskState");
const reviewCheck = require("./reviewCheck");

function result(state, allow, completionPassed, message, extra = {}) {
    return Object.assign({ state, code: state, allow, completionPassed, message }, extra);
}

function checkWorkspace(workspaceDir) {
    const file = path.join(workspaceDir, "EXECUTION.md");
    let text;
    try { text = fs.readFileSync(file, "utf8"); }
    catch (e) {
        if (e && e.code === "ENOENT") return result("NOT_APPLICABLE", true, false, "No EXECUTION.md; completion enforcement does not apply.");
        return result("MALFORMED_EXECUTION", false, false, "Cannot read EXECUTION.md: " + (e.message || e));
    }
    const parsed = parseTasks(text);
    if (!parsed.ok) return result("MALFORMED_EXECUTION", false, false, parsed.error);
    if (!parsed.rows.length) return result("NOT_APPLICABLE", true, false, "EXECUTION.md has no task rows; completion enforcement does not apply.");
    const invalid = parsed.rows.filter(row => !STATUSES.includes(row.status));
    if (invalid.length) return result("MALFORMED_EXECUTION", false, false,
        "EXECUTION.md has invalid task status: " + invalid.map(row => row.id + "=" + row.status).join(", ") + ".");
    if (parsed.rows.some(row => row.status === "todo" || row.status === "in_progress")) {
        return result("WORK_IN_PROGRESS", true, false, "Tasks remain todo/in_progress; normal work or proactive handoff may continue.");
    }
    const nonDone = parsed.rows.filter(row => row.status !== "done");
    if (nonDone.length) {
        const reasonState = terminalReasonState(text);
        if (!reasonState.ok) return result("MALFORMED_EXECUTION", false, false, reasonState.error);
        if (reasonState.missing.length) {
            const commands = reasonState.missing.map(row => "palsync task " + row.id + " " + row.status + " --reason \"<why>\"");
            return result("MISSING_BLOCKER_REASON", false, false,
                "Terminal task(s) lack reason checkpoints: " + reasonState.missing.map(row => row.id).join(", ") + ". Run: " + commands.join("; "),
                { missing: reasonState.missing.map(row => row.id) });
        }
        if (nonDone.some(row => row.status === "needs-frontier")) {
            return result("FRONTIER_HANDOFF", true, false, "Terminal frontier handoff recorded with reasons.");
        }
        if (nonDone.every(row => BLOCKED_STATUSES.includes(row.status))) {
            return result("BLOCKED_HANDOFF", true, false, "Terminal blocked/human handoff recorded with reasons.");
        }
    }
    const review = reviewCheck.checkWorkspace(workspaceDir);
    if (!review.ok || review.verdict !== "PASS") {
        return result("REVIEW_FAILED", false, false,
            "All tasks are done, but independent review is not passing. Run pal-review, then `palsync completion check` again.",
            { review, reviewOutput: reviewCheck.formatReviewCheck(review) });
    }
    return result("COMPLETE", true, true, "All tasks are done and independent review PASS is current.", { review });
}

function formatCompletion(value) {
    const heading = value.state === "COMPLETE" ? "COMPLETE"
        : value.state === "BLOCKED_HANDOFF" || value.state === "FRONTIER_HANDOFF" ? "BLOCKED HANDOFF"
        : value.state === "WORK_IN_PROGRESS" || value.state === "NOT_APPLICABLE" ? "WORK IN PROGRESS"
        : "FAIL";
    const lines = ["palsync completion check — " + heading, "state: " + value.state, value.message];
    if (value.reviewOutput) lines.push(value.reviewOutput);
    return lines.join("\n");
}

module.exports = { checkWorkspace, formatCompletion };
