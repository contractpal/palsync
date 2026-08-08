"use strict";
// PostToolUse feedback: after a direct Edit/Write to a server-tracked file, show what the push gate
// already sees. Advisory only -- the write succeeded and stays succeeded.
//
// WHY (ETHOS, "hooks are how we enforce the lifecycle" + the feedback-latency argument): today a
// missed rule surfaces at `pal_validate`, `pal_test`, review, or `pal_push` -- one to several tool
// calls after the mistake, by which point the agent has built on it. The facts needed to say so are
// available the instant the file is written, so latency is a harness choice, not a limitation.
//
// This is NOT a gate, and the distinction is the whole design:
//   - it never denies, never returns isError, never marks the original tool failed, never retries or
//     rewrites, and never counts as completion evidence;
//   - it reports GROUND TRUTH (a rule the push gate will apply) rather than advice about what the
//     agent might want to look at. That is why it needs no eval to justify, unlike the impact-facts
//     advisory that was gated on the pilot;
//   - `pal_push` remains authoritative and unchanged.
//
// It reuses `gateLint(record, dir)` from core/push.js deliberately, NOT `validateWorkspace(dir)`:
// gateLint is baseline-aware and scopes errors to the net-new ones, so a pre-existing error in a file
// the agent has not touched can never surface here as if this edit caused it. `validateWorkspace`
// would run whole-workspace contracts and re-report old problems -- the exact false-blocking class
// CLAUDE.md's validator-rule policy warns about, and it would train the agent to ignore this channel.
//
// Deliberate limits, documented rather than papered over:
//   - direct Edit/Write only. Bash `cp`/heredocs/scripts, external editors and MCP tools that write
//     local mirrors do not trigger it. The push gate still catches all of those.
//   - no login, no network, no lock, no server call. It reads local files and the existing lint cache.
//   - a cross-file relationship may be mid-repair: file A can look broken until the paired edit to
//     file B lands. The message says so instead of pretending the finding is final.
const fs = require("fs");
const path = require("path");
const { IN_SCOPE, MANIFEST_FILE } = require("./workspaceHash");

// Same set the PreToolUse guard matches, so one matcher string serves both and neither drifts.
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// A hook's output rides in every subsequent request's context, so it is bounded hard. 600 bytes is
// the C3 budget: enough for a couple of findings with locations, cheap enough to fire on every write.
const MAX_BYTES = 600;
const MAX_FINDINGS = 3;
const HEADER = "PalSync post-write check (your edit succeeded; this is what the push gate sees now):";
const TRAILER = "Cross-file work in progress may clear this once the paired edit lands.";

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }

// The workspace-relative POSIX path of a written file, or null when the write is not something the
// push gate would ever lint: outside the workspace, or outside the 14 manifest folders + pal.json.
// Resolved on both sides so "./pages/x.html", an absolute path and a path with ".." agree.
function scopedRelPath(workspace, target) {
    if (typeof target !== "string" || !target) return null;
    const root = path.resolve(workspace);
    const resolved = path.resolve(root, target);
    const rel = path.relative(root, resolved);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    const posix = rel.split(path.sep).join("/");
    if (posix === MANIFEST_FILE) return posix;
    const top = posix.split("/")[0];
    return IN_SCOPE.includes(top) ? posix : null;
}

function readRecord(workspace) {
    try { return JSON.parse(fs.readFileSync(path.join(workspace, ".palsync.json"), "utf8")); }
    catch (e) { return null; }
}

// One finding on one line: severity, rule, location, message. Kept terse because the budget is 600
// bytes for everything -- the agent can run `palsync validate` for the full text and the fix hint.
function formatFinding(finding) {
    const where = finding.line ? finding.file + ":" + finding.line : finding.file;
    const label = finding.severity === "error" ? "ERROR (must fix before push)" : "warning";
    return "- " + label + " " + where + " [" + (finding.rule || "lint") + "] " + (finding.message || "");
}

function bytes(text) { return Buffer.byteLength(text, "utf8"); }

// Clip to a byte budget without splitting a multi-byte character.
function clip(text, budget) {
    if (bytes(text) <= budget) return text;
    // "…" is 3 bytes in UTF-8; reserve them or the clipped line overshoots its own budget.
    const buf = Buffer.from(text, "utf8").subarray(0, Math.max(0, budget - 3));
    return buf.toString("utf8").replace(/�$/, "").trimEnd() + "…";
}

// Errors before warnings, capped by count and by total bytes.
//
// Two things this has to get right, both learned from the real output: a push-gate message runs several
// hundred bytes because it carries the full fix (the `hrefAction` text alone is ~700), so a naive
// "append while it fits" loop emits NOTHING at all -- silence that reads as "your write was clean".
// Hence per-finding clipping, with a floor on how short a line may be: below ~120 bytes a finding is an
// unactionable stub, so it is better to show fewer findings in full than more in fragments. And
// truncation is always declared -- a silent cap reads as "that was everything", the worst thing to
// believe about a diagnostic channel, so the "N more" line is reserved BEFORE the findings are laid out
// rather than appended if it happens to fit.
function buildText(findings) {
    const ordered = [...findings.filter(f => f.severity === "error"),
        ...findings.filter(f => f.severity !== "error")];
    if (!ordered.length) return null;
    const MIN_LINE = 120;
    let show = Math.min(MAX_FINDINGS, ordered.length), lines = null;
    while (show > 0) {
        const hidden = ordered.length - show;
        const more = hidden > 0 ? "- " + hidden + " more not shown; run palsync validate for the full list." : null;
        const fixed = [HEADER, ...(more ? [more] : []), TRAILER];
        // +1 byte per finding line for its newline.
        const available = MAX_BYTES - bytes(fixed.join("\n")) - show;
        const per = Math.floor(available / show);
        if (per < MIN_LINE && show > 1) { show--; continue; }
        if (per <= 0) return null;
        lines = [HEADER, ...ordered.slice(0, show).map(f => clip(formatFinding(f), per)),
            ...(more ? [more] : []), TRAILER];
        break;
    }
    if (!lines) return null;
    const text = lines.join("\n");
    return bytes(text) <= MAX_BYTES ? text : clip(text, MAX_BYTES);
}

// gateLint baseline-diffs ERRORS but surfaces every WARNING on a changed file, which is right for a
// once-per-push report and wrong for a channel that fires on every keystroke-level write: an inherited
// "fragment root is missing pb-section" would repeat after each edit until the agent learns to ignore
// the whole channel. So warnings are diffed the same way errors are -- by rule, against the baseline
// copy of this file. A file with no baseline (newly added) keeps all of its warnings: nothing there is
// inherited. Errors pass through untouched; gateLint has already scoped them to the net-new ones.
function dropInheritedWarnings(workspace, rel, findings) {
    const warnings = findings.filter(f => f.severity !== "error");
    if (!warnings.length) return findings;
    const baseline = require("./baseline");
    let baseContent = null;
    try { baseContent = baseline.exists(workspace) ? baseline.read(workspace, rel) : null; }
    catch (e) { baseContent = null; }
    if (baseContent == null) return findings;
    const { lintContent, hasDesignSystem } = require("./validate");
    let inherited;
    try {
        inherited = new Set(lintContent(rel, baseContent, { designSystemPresent: hasDesignSystem(workspace) })
            .filter(f => f.severity !== "error").map(f => f.rule));
    } catch (e) { return findings; }
    return findings.filter(f => f.severity === "error" || !inherited.has(f.rule));
}

function evaluate({ mode, cwd, event }) {
    const workspace = cwd || (event && event.cwd);
    if (!workspace) throw new Error("hook event has no cwd");
    const toolName = event && event.tool_name;
    const toolInput = event && isObject(event.tool_input) ? event.tool_input : {};
    const target = typeof toolInput.file_path === "string" ? toolInput.file_path : toolInput.notebook_path;
    const rel = WRITE_TOOLS.has(toolName) ? scopedRelPath(workspace, target) : null;
    const empty = { file: rel, findings: [], text: null };
    if (!rel) return finish(mode, empty);
    // No record means no push-gate baseline to diff against. Staying silent is correct: gateLint's
    // recordless fallback is a whole-workspace validate, which would report pre-existing problems in
    // files this edit never touched.
    const record = readRecord(workspace);
    if (!record || !record.fileHashes) return finish(mode, empty);
    const lint = require("./push").gateLint(record, workspace);
    const { WORKSPACE_GATE_RULES, WORKSPACE_WARNING_RULES } = require("./validate/registry");
    const mine = (lint && Array.isArray(lint.findings) ? lint.findings : [])
        .filter(finding => finding && finding.file === rel)
        // Workspace-scope rules lint the workspace's CURRENT form, not what this write changed, so they
        // fire identically after every edit until someone fixes them elsewhere. Correct for a
        // once-per-push report; pure noise on a per-write channel. Per-file rules only here.
        .filter(finding => !WORKSPACE_GATE_RULES.has(finding.rule) && !WORKSPACE_WARNING_RULES.has(finding.rule));
    const findings = dropInheritedWarnings(workspace, rel, mine);
    return finish(mode, { file: rel, findings, text: buildText(findings) });
}

function finish(mode, result) {
    return { result, output: mode === "claude" ? claudePostToolUseOutput(result) : result };
}

// The official non-blocking channel. Emitting `additionalContext` (never `decision: "block"`, never
// exit 2) is what keeps the original Edit/Write successful.
function claudePostToolUseOutput(result) {
    if (!result.text) return null;
    return {
        hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: result.text,
        },
    };
}

module.exports = {
    evaluate, claudePostToolUseOutput, scopedRelPath, buildText,
    WRITE_TOOLS, MAX_BYTES, MAX_FINDINGS, HEADER, TRAILER,
};
