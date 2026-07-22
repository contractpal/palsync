"use strict";
const completionGate = require("./completionGate");

function claudeStopOutput(gate) {
    if (gate.allow) return null;
    return { decision: "block", reason: gate.message };
}

function evaluate({ mode, cwd, event, checkWorkspace = completionGate.checkWorkspace }) {
    const workspace = cwd || (event && event.cwd);
    if (!workspace) throw new Error("hook event has no cwd");
    const gate = checkWorkspace(workspace);
    return { gate, output: mode === "claude" ? claudeStopOutput(gate) : gate };
}

module.exports = { claudeStopOutput, evaluate };
