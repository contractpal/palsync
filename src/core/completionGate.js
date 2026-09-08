"use strict";
// Offline completion state machine. It decides only whether lifecycle completion enforcement
// applies and whether its deterministic evidence is satisfied; it performs no writes or I/O beyond
// reading workspace files through taskState/reviewCheck.
const fs = require("fs");
const path = require("path");
const { parseTasks, STATUSES, BLOCKED_STATUSES, terminalReasonState } = require("./taskState");
const reviewCheck = require("./reviewCheck");
const policy = require("./policy");

function result(state, allow, completionPassed, message, extra = {}) {
    return Object.assign({ state, code: state, allow, completionPassed, message }, extra);
}

function checkWorkspace(workspaceDir, { review } = {}) {
    const reviewMode = policy.normalize(review, policy.REVIEW_MODES) || policy.resolve().review;
    const file = path.join(workspaceDir, "EXECUTION.md");
    let text;
    try { text = fs.readFileSync(file, "utf8"); }
    catch (e) {
        if (e && e.code === "ENOENT") return result("NOT_APPLICABLE", true, false, "No EXECUTION.md; completion enforcement does not apply.");
        return result("MALFORMED_EXECUTION", false, false, "Cannot read EXECUTION.md: " + (e.message || e));
    }
    const parsed = parseTasks(text);
    // An EXECUTION.md with no "## Tasks" section at all is not a malformed task table — it is a
    // workspace that does not use task tracking, exactly like a Tasks table with no rows below.
    // Blocking it created an UNSATISFIABLE gate: the section is evaluator-owned, so the agent
    // cannot add it, and the Stop hook re-blocked every turn until the host force-overrode. The
    // impact eval fixtures (a bounded rename, no task table) hit this on the first live arm.
    if (!parsed.ok && parsed.missingSection) {
        return result("NOT_APPLICABLE", true, false,
            "EXECUTION.md has no \"## Tasks\" section; completion enforcement does not apply.");
    }
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
    // Review is a user preference, not a lifecycle law. Only `auto` makes an independent review
    // part of completion; under `off`/`ask` the work is complete when the work is done, and a stale
    // REVIEW.md from an earlier build is not even read (it used to trap unrelated sessions).
    if (reviewMode !== "auto") {
        return result("COMPLETE", true, true,
            "Implementation complete. Final review: not run because your preference is " +
            policy.REVIEW_LABEL[reviewMode] + "." +
            (reviewMode === "ask" ? " Offer to run pal-review; the user decides." : ""),
            { reviewMode });
    }
    const reviewState = reviewCheck.checkWorkspace(workspaceDir);
    if (!reviewState.ok || reviewState.verdict !== "PASS") {
        // Scope-aware on purpose. The bare imperative this replaced ("Run pal-review, then ... again")
        // was read as an order by a session that had been asked to do something else entirely, and it
        // started an unrequested review of a stale build. A gate must say what is unmet and what
        // satisfies it; it must not conscript whatever session happens to end its turn in the workspace.
        return result("REVIEW_FAILED", false, false,
            "All tasks are done, and your review preference is Automatic: a fresh pal-review recording " +
            "REVIEW.md result: PASS is required before this build can be called complete. " +
            "If finishing this build IS your current task, run pal-review, then `palsync completion check` " +
            "again. If it is not — you were asked to do something else, or you need an owner decision — " +
            "report this blocker and stop. Do not start a review on your own initiative.",
            { reviewMode, review: reviewState, reviewOutput: reviewCheck.formatReviewCheck(reviewState) });
    }
    return result("COMPLETE", true, true, "All tasks are done and independent review PASS is current.",
        { reviewMode, review: reviewState });
}

function formatCompletion(value) {
    const heading = value.state === "COMPLETE" ? "COMPLETE"
        : value.state === "BLOCKED_HANDOFF" || value.state === "FRONTIER_HANDOFF" ? "BLOCKED HANDOFF"
        : value.state === "WORK_IN_PROGRESS" || value.state === "NOT_APPLICABLE" ? "WORK IN PROGRESS"
        : "FAIL";
    const lines = ["palsync completion check — " + heading, "state: " + value.state, value.message];
    if (value.state === "COMPLETE" && value.reviewMode === "ask") {
        lines.push("Ask the user: run a final review, or finish?");
    }
    if (value.reviewOutput) lines.push(value.reviewOutput);
    return lines.join("\n");
}

module.exports = { checkWorkspace, formatCompletion };
