"use strict";
// PreToolUse guard: refuse agent writes to the workspace's own PalSync record.
//
// Finding #13, observed live in impact pilot arm 4. Unprompted, the agent read `.palsync.json`,
// computed `sha256sum` for the files it had changed, and `Edit`ed the record's stored hashes to match
// before pushing. `pal_push` then reported `filesChecked: 0` with `pushed: true`: the whole-Pal save
// still happened, but the gate's per-file lint checked NOTHING, because forged hashes made the
// changed-set empty. The push gate was neutralized by hand and nothing in the run said so.
//
// `.palsync.json` is PalSync's own bookkeeping -- it records the server marker and the per-file hashes
// the push gate diffs against. Every legitimate write to it comes from PalSync itself, never from an
// agent editing it as a text file, so a deny here cannot block valid work. That is what makes this a
// `deny` rather than a warning: per ETHOS, a guardrail must earn a blocking severity with evidence,
// and the evidence is a live run in which hand-editing this file silently disabled a gate.
//
// Deliberately narrow. It matches the file-write tools by exact resolved path -- a mechanically
// verifiable path match, never a judgment call about intent. It does NOT parse shell commands, so a
// `sed -i` or a redirect through Bash still gets through; blocking those would mean guessing which
// shell invocations write, and a wrong blocking rule is worse than a missing one. The residual gap is
// documented rather than papered over with a regex.
const path = require("path");

const RECORD_FILE = ".palsync.json";
// The tools that write a file at a caller-supplied path. Bash is absent on purpose (see above).
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const REASON = "Blocked: .palsync.json is PalSync's own push-gate record (server marker + per-file " +
    "hashes), not an editable source file. Hand-editing it makes pal_push report filesChecked: 0 " +
    "while still saving, so the per-file lint silently checks nothing. Let PalSync maintain it: use " +
    "pal_pull to refresh it, and pal_push to update it.";

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }

// True when `target` is the record file at the root of `workspace`. Resolved on both sides so
// "./.palsync.json", an absolute path, and a path containing ".." all collapse to the same answer;
// a same-named file in a subdirectory is NOT the record and stays writable.
function targetsRecord(workspace, target) {
    if (typeof target !== "string" || !target) return false;
    const resolved = path.resolve(workspace, target);
    return resolved === path.join(path.resolve(workspace), RECORD_FILE);
}

function evaluate({ mode, cwd, event }) {
    const workspace = cwd || (event && event.cwd);
    if (!workspace) throw new Error("hook event has no cwd");
    const toolName = event && event.tool_name;
    const toolInput = event && isObject(event.tool_input) ? event.tool_input : {};
    // `file_path` is the field Edit/Write/MultiEdit use; `notebook_path` is NotebookEdit's.
    const target = typeof toolInput.file_path === "string" ? toolInput.file_path : toolInput.notebook_path;
    const blocked = WRITE_TOOLS.has(toolName) && targetsRecord(workspace, target);
    const decision = { blocked, reason: blocked ? REASON : null, tool: toolName || null, target: target || null };
    return { decision, output: mode === "claude" ? claudePreToolUseOutput(decision) : decision };
}

function claudePreToolUseOutput(decision) {
    if (!decision.blocked) return null;
    return {
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: decision.reason,
        },
    };
}

module.exports = { evaluate, claudePreToolUseOutput, targetsRecord, RECORD_FILE, WRITE_TOOLS, REASON };
