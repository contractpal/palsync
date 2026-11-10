"use strict";
// Offline completion state machine. It decides only whether lifecycle completion enforcement
// applies and whether its deterministic evidence is satisfied; it performs no writes or I/O beyond
// reading workspace files through reviewCheck/goal.
//
// One mode: GOAL.md. Completion requires passing, script-tagged pal_exercise evidence for the
// CURRENT pushed version. A workspace without GOAL.md is not under completion enforcement.
const reviewCheck = require("./reviewCheck");
const policy = require("./policy");
const goal = require("./goal");

function result(state, allow, completionPassed, message, extra = {}) {
    return Object.assign({ state, code: state, allow, completionPassed, message }, extra);
}

// Review is a user preference, not a lifecycle law. Only `auto` makes an independent review part
// of completion; under `off`/`ask` the work is complete when the work is done, and a stale
// REVIEW.md from an earlier build is not even read (it used to trap unrelated sessions).
// `allDone` and `complete` are the mode-specific sentences; the review semantics stay identical.
function completeWithReview(workspaceDir, reviewMode, extra, { allDone, complete }) {
    if (reviewMode !== "auto") {
        return result("COMPLETE", true, true,
            complete + " Final review: not run because your preference is " +
            policy.REVIEW_LABEL[reviewMode] + "." +
            (reviewMode === "ask" ? " Offer to run pal-review; the user decides." : ""),
            Object.assign({ reviewMode }, extra));
    }
    const reviewState = reviewCheck.checkWorkspace(workspaceDir);
    if (!reviewState.ok || reviewState.verdict !== "PASS") {
        // Scope-aware on purpose. The bare imperative this replaced ("Run pal-review, then ... again")
        // was read as an order by a session that had been asked to do something else entirely, and it
        // started an unrequested review of a stale build. A gate must say what is unmet and what
        // satisfies it; it must not conscript whatever session happens to end its turn in the workspace.
        return result("REVIEW_FAILED", false, false,
            allDone + ", and your review preference is Automatic: a fresh pal-review recording " +
            "REVIEW.md result: PASS is required before this build can be called complete. " +
            "If finishing this build IS your current task, run pal-review, then `palsync completion check` " +
            "again. If it is not — you were asked to do something else, or you need an owner decision — " +
            "report this blocker and stop. Do not start a review on your own initiative.",
            Object.assign({ reviewMode, review: reviewState, reviewOutput: reviewCheck.formatReviewCheck(reviewState) }, extra));
    }
    return result("COMPLETE", true, true, complete + " Independent review PASS is current.",
        Object.assign({ reviewMode, review: reviewState }, extra));
}

function checkGoal(workspaceDir, parsed, reviewMode) {
    if (!parsed.ok) {
        return result("MALFORMED_GOAL", false, false,
            "GOAL.md is malformed: " + (parsed.error || "it could not be parsed"));
    }
    if (parsed.status !== "approved") {
        return result("NOT_APPLICABLE", true, false,
            "GOAL.md is not approved yet; the interview is in progress.");
    }
    const invalid = parsed.checks.filter(check => check.scriptError);
    if (!parsed.checks.length) {
        return result("MALFORMED_GOAL", false, false,
            "GOAL.md has no acceptance checks; goal mode cannot verify completion.");
    }
    if (invalid.length) {
        return result("MALFORMED_GOAL", false, false,
            "GOAL.md acceptance-check script(s) are invalid: " +
            invalid.map(check => check.id + " (" + check.scriptError + ")").join(", ") + ".");
    }
    const checks = goal.checkEvidence(workspaceDir, parsed);
    const unverified = checks.filter(check => check.scripted && !check.verified && !check.blocked);
    if (unverified.length) {
        return result("UNVERIFIED_CHECKS", false, false,
            "GOAL.md acceptance checks are not verified against the current pushed version: " +
            unverified.map(check => check.id + " (run pal_exercise {\"check\":\"" + check.id + "\"})").join(", ") +
            ". If finishing this goal IS your current task: a failing check goes back to the builder, and a " +
            "check that cannot pass after real attempts goes in GOAL.md \"## Blockers\" with the reason and " +
            "what was tried. If it is not (a later push made the evidence stale while you did other work), " +
            "report that these checks need a re-run and stop; do not start a goal build on your own initiative.",
            { checks });
    }
    const blocked = checks.filter(check => check.blocked);
    if (blocked.length) {
        return result("BLOCKED_HANDOFF", true, false,
            "All script-verified goal checks pass or are blocked; terminal blocked/human handoff recorded for: " +
            blocked.map(check => check.id).join(", ") + ".",
            { checks });
    }
    // Review-only checks have no script, so the gate proved only the scripted ones;
    // formatCompletion lists the review-only ids.
    const hasReviewOnly = checks.some(check => !check.scripted);
    return completeWithReview(workspaceDir, reviewMode, { checks }, {
        allDone: "All script-verified goal checks pass",
        complete: hasReviewOnly
            ? "All scripted acceptance checks are verified."
            : "All goal acceptance checks are verified."
    });
}

function checkWorkspace(workspaceDir, { review } = {}) {
    const reviewMode = policy.normalize(review, policy.REVIEW_MODES) || policy.resolve().review;
    const parsedGoal = goal.readGoal(workspaceDir);
    if (!parsedGoal) {
        return result("NOT_APPLICABLE", true, false,
            "No GOAL.md; completion enforcement does not apply.");
    }
    return checkGoal(workspaceDir, parsedGoal, reviewMode);
}

function formatCompletion(value) {
    const heading = value.state === "COMPLETE" ? "COMPLETE"
        : value.state === "BLOCKED_HANDOFF" ? "BLOCKED HANDOFF"
        : value.state === "NOT_APPLICABLE" ? "WORK IN PROGRESS"
        : "FAIL";
    const lines = ["palsync completion check — " + heading, "state: " + value.state, value.message];
    if (value.state === "COMPLETE" && value.reviewMode === "ask") {
        lines.push("Ask the user: run a final review, or finish?");
    }
    if ((value.state === "COMPLETE" || value.state === "BLOCKED_HANDOFF") && Array.isArray(value.checks)) {
        const reviewOnly = value.checks.filter(check => !check.scripted).map(check => check.id);
        if (reviewOnly.length) lines.push("verify by review: " + reviewOnly.join(", "));
    }
    if (value.reviewOutput) lines.push(value.reviewOutput);
    return lines.join("\n");
}

module.exports = { checkWorkspace, formatCompletion };
