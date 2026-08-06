"use strict";
const completionGate = require("./completionGate");

// Stop-hook adapter for the completion gate.
//
// It blocks ONCE per stop chain and then yields. The reason is a live incident, not a preference: a
// `/doctor` session in a pal workspace ended its turn, the gate blocked on leftover state from an
// earlier build (a stale REVIEW.md, uncommitted changes postdating it), and the agent surfaced the
// blocker and asked the owner two questions -- the correct behavior. Because the hook re-fired
// regardless, the question could not end the turn, so the agent concluded the only way out was to obey
// the block, and launched a fresh `pal-review` subagent that began running `palsync exercise` against
// a build nobody had asked it to touch. The gate converted "surface the blocker and ask" into
// "autonomously execute a substantial, lock-taking, server-touching task."
//
// `stop_hook_active` is the host's documented signal that Claude is ALREADY continuing because of a
// stop hook; a hook is expected to check it precisely so it cannot run indefinitely. Ignoring it was
// the defect.
//
// Blocking once is what the gate is actually for: a model must not be able to SILENTLY declare a build
// complete. One block delivers that -- the refusal is stated, and it is in the transcript. What the
// second, third and ninth block bought was not enforcement but coercion, since a model that has been
// told and still ends its turn has visibly failed, which is what evals score. The hard gates for the
// deployment transition remain `palsync completion check` and `palsync review check`, which do not
// yield at all.
function claudeStopOutput(gate, { alreadyContinuing = false } = {}) {
    if (gate.allow) return null;
    if (alreadyContinuing) {
        // Allow the turn to end, but keep the unmet gate on the record rather than falling silent --
        // yielding must not look like passing.
        return {
            systemMessage: "palsync completion gate is UNMET (not blocking again this turn): " + gate.message
        };
    }
    return { decision: "block", reason: gate.message };
}

function evaluate({ mode, cwd, event, checkWorkspace = completionGate.checkWorkspace }) {
    const workspace = cwd || (event && event.cwd);
    if (!workspace) throw new Error("hook event has no cwd");
    const gate = checkWorkspace(workspace);
    const alreadyContinuing = !!(event && event.stop_hook_active);
    return {
        gate,
        alreadyContinuing,
        output: mode === "claude" ? claudeStopOutput(gate, { alreadyContinuing }) : gate
    };
}

module.exports = { claudeStopOutput, evaluate };
