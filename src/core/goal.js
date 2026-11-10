"use strict";
// GOAL.md: the user-approved goal contract for goal-driven builds. A build that has GOAL.md is
// gated on passing, script-tagged pal_exercise evidence for the CURRENT pushed version. This
// module only parses/lints; completionGate applies the gate and src/mcp/tools.js resolves
// `pal_exercise {check}` against a check's script.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { stableStringify } = require("./stableStringify");
const { validateSteps, validateInitial, lintSteps } = require("./exercise");
const { readToolEvidence, filterToolEvidence } = require("./usage");
const { FILENAME: PALSYNC_FILE } = require("./palsyncfile");

const GOAL_FILE = "GOAL.md";
const CHECK_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const SCRIPT_KEYS = new Set(["steps", "workflow", "initial", "viewport", "browser"]);
const SCRIPT_WORKFLOWS = ["console", "web", "transaction"];
const SCRIPT_VIEWPORTS = ["desktop", "mobile"];

function digestScript(script) {
    return crypto.createHash("sha256").update(stableStringify(script)).digest("hex");
}

function parseCheckHeading(line) {
    const raw = line.replace(/^###\s+/, "").trim();
    let match = raw.match(/^(\S+?)\s*[—–]\s*(.*)$/);
    if (!match) match = raw.match(/^(\S+)\s+-\s+(.*)$/);
    if (!match) match = raw.match(/^([A-Za-z][A-Za-z0-9_-]{0,31}?)-(.*)$/);
    return match ? { id: match[1].trim(), title: match[2].trim() } : { id: raw, title: "" };
}

function parseScript(raw) {
    let value;
    try { value = JSON.parse(raw); }
    catch (e) { return { script: null, scriptError: "invalid JSON: " + (e && e.message ? e.message : e) }; }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { script: null, scriptError: "the script must be a JSON object with steps" };
    }
    const unknown = Object.keys(value).filter(key => !SCRIPT_KEYS.has(key));
    if (unknown.length) return { script: null, scriptError: "unknown key(s): " + unknown.join(", ") };
    if (!Array.isArray(value.steps) || value.steps.length === 0) {
        return { script: null, scriptError: "steps must be a non-empty array" };
    }
    const problems = validateSteps(value.steps).concat(validateInitial(value.initial));
    if (value.workflow !== undefined && !SCRIPT_WORKFLOWS.includes(value.workflow)) {
        problems.push("workflow must be console, web, or transaction");
    }
    if (value.viewport !== undefined && !SCRIPT_VIEWPORTS.includes(value.viewport)) {
        problems.push("viewport must be desktop or mobile");
    }
    if (value.browser !== undefined && typeof value.browser !== "boolean") {
        problems.push("browser must be true or false");
    }
    if (problems.length) return { script: null, scriptError: problems.join("; ") };
    return { script: value, scriptError: null, scriptDigest: digestScript(value) };
}

function parseGoal(text) {
    const lines = String(text == null ? "" : text).split(/\r?\n/);
    const errors = [];
    const checks = [];
    const blockers = {};
    const seen = new Set();

    // status: a line before the first "## " heading (case-insensitive key; draft|approved).
    let firstSection = lines.findIndex(line => /^##\s+/.test(line));
    if (firstSection === -1) firstSection = lines.length;
    let status = null;
    let statusLines = 0;
    for (let i = 0; i < firstSection; i++) {
        const match = lines[i].match(/^status:\s*(.*?)\s*$/i);
        if (!match) continue;
        statusLines++;
        if (statusLines === 1) {
            const value = match[1].toLowerCase();
            if (value === "draft" || value === "approved") status = value;
            else errors.push("status must be draft or approved (line " + (i + 1) + ").");
        }
    }
    if (!statusLines) errors.push("GOAL.md needs a status line (status: draft|approved) before the first ## heading.");
    else if (statusLines > 1) errors.push("GOAL.md has more than one status line before the first ## heading.");

    // Sections: find the ## Acceptance checks range, then its ### check sections.
    const acceptanceStart = lines.findIndex(line => /^##\s+Acceptance checks\s*$/i.test(line));
    let acceptanceEnd = lines.length;
    if (acceptanceStart !== -1) {
        for (let i = acceptanceStart + 1; i < lines.length; i++) {
            if (/^##\s+/.test(lines[i])) { acceptanceEnd = i; break; }
        }
        let current = null;
        const prose = () => current ? current.prose.join(" ").replace(/\s+/g, " ").trim() : "";
        for (let i = acceptanceStart + 1; i < acceptanceEnd; i++) {
            const line = lines[i];
            const heading = line.match(/^###\s+(.+?)\s*$/);
            if (heading) {
                if (current) current.check.sentence = prose();
                const parsed = parseCheckHeading(line);
                if (!CHECK_ID.test(parsed.id)) {
                    errors.push("Invalid acceptance-check id \"" + parsed.id + "\" (line " + (i + 1) + ").");
                }
                if (!parsed.title) errors.push("Acceptance check " + (parsed.id || "(unknown id)") + " has no title (line " + (i + 1) + ").");
                if (parsed.id && seen.has(parsed.id)) errors.push("Duplicate acceptance-check id " + parsed.id + ".");
                seen.add(parsed.id);
                current = { id: parsed.id, title: parsed.title, prose: [], check: {
                    id: parsed.id, title: parsed.title, sentence: "", script: null, scriptError: null, scriptDigest: null
                } };
                checks.push(current.check);
                continue;
            }
            if (!current) continue;
            const fence = line.match(/^```\s*([A-Za-z0-9_-]*)\s*$/);
            if (fence) {
                const fenceLines = [];
                let closed = false;
                for (i++; i < acceptanceEnd; i++) {
                    if (/^```\s*$/.test(lines[i])) { closed = true; break; }
                    fenceLines.push(lines[i]);
                }
                if (!closed) errors.push("Unclosed code fence in acceptance check " + current.id + ".");
                else if (!current.check.script && !current.check.scriptError && fence[1].toLowerCase() === "json") {
                    const parsedScript = parseScript(fenceLines.join("\n"));
                    current.check.script = parsedScript.script;
                    current.check.scriptError = parsedScript.scriptError;
                    current.check.scriptDigest = parsedScript.scriptDigest || null;
                }
                continue;
            }
            current.prose.push(line);
        }
        if (current) current.check.sentence = prose();
    }

    // Blockers: only lines inside ## Blockers are read.
    const blockersStart = lines.findIndex(line => /^##\s+Blockers\s*$/i.test(line));
    if (blockersStart !== -1) {
        let blockersEnd = lines.length;
        for (let i = blockersStart + 1; i < lines.length; i++) {
            if (/^##\s+/.test(lines[i])) { blockersEnd = i; break; }
        }
        for (let i = blockersStart + 1; i < blockersEnd; i++) {
            const line = lines[i];
            if (!/^\s*-\s*BLOCKED\b/i.test(line)) continue;
            const match = line.match(/^\s*-\s*BLOCKED\s+([A-Za-z][A-Za-z0-9_-]{0,31})\s*:\s*(.*?)\s*\|\|\s*tried\s*:\s*(.*?)\s*$/i);
            if (!match) {
                errors.push("Malformed blocker line (line " + (i + 1) + "); use - BLOCKED <id>: <reason> || tried: <text>.");
                continue;
            }
            let [, id, reason, tried] = match;
            reason = reason.trim();
            tried = tried.trim();
            if (!CHECK_ID.test(id) || !seen.has(id)) {
                errors.push("Blocker names unknown acceptance check " + id + " (line " + (i + 1) + ").");
                continue;
            }
            if (!reason || !tried) {
                errors.push("Blocker for " + id + " needs a non-empty reason and tried text (line " + (i + 1) + ").");
                continue;
            }
            blockers[id] = { reason, tried };
        }
    }

    const parsed = { ok: errors.length === 0, status, checks, blockers, errors };
    if (errors.length) parsed.error = errors.join(" ");
    return parsed;
}

function readGoal(workspaceDir) {
    const file = path.join(workspaceDir, GOAL_FILE);
    let text;
    try { text = fs.readFileSync(file, "utf8"); }
    catch (e) {
        if (e && e.code === "ENOENT") return null;
        const message = "Cannot read " + GOAL_FILE + ": " + (e && e.message ? e.message : e);
        return { ok: false, error: message, status: null, checks: [], blockers: {}, errors: [message], path: file };
    }
    return Object.assign(parseGoal(text), { path: file });
}

function readRecord(workspaceDir) {
    try { return JSON.parse(fs.readFileSync(path.join(workspaceDir, PALSYNC_FILE), "utf8")); }
    catch (e) { return null; }
}

// Per-check completion state shared by the gate and the review brief. A scripted check verifies
// only when a successful pal_exercise row for the CURRENT pushed source carries its exact script
// digest; a blocked check hands off instead of verifying.
function checkEvidence(workspaceDir, parsed) {
    const record = readRecord(workspaceDir);
    const entries = filterToolEvidence(readToolEvidence(workspaceDir), "pal_exercise",
        record && record.palGuid, record && record.lastModifiedDate, record && record.localHash);
    return parsed.checks.map(check => {
        const scripted = !!check.script;
        const blocked = Object.prototype.hasOwnProperty.call(parsed.blockers, check.id);
        const verified = scripted && !blocked &&
            entries.some(entry => entry.check === check.id && entry.scriptDigest === check.scriptDigest);
        return { id: check.id, scripted, verified, blocked };
    });
}

function lintGoal(text) {
    const parsed = parseGoal(text);
    const findings = [];
    for (const error of parsed.errors) findings.push({ severity: "error", check: null, message: error });
    if (parsed.status && parsed.status !== "approved") {
        findings.push({ severity: "warn", check: null,
            message: "status is " + parsed.status + "; approval is required before the build can complete." });
    }
    if (!parsed.checks.length) {
        findings.push({ severity: "error", check: null, message: "GOAL.md has no acceptance checks under ## Acceptance checks." });
    }
    let scripted = 0;
    for (const check of parsed.checks) {
        if (check.scriptError) {
            findings.push({ severity: "error", check: check.id, message: "invalid exercise script: " + check.scriptError });
            continue;
        }
        if (!check.script) continue;
        scripted++;
        const lint = lintSteps(check.script.steps);
        for (const error of lint.errors) findings.push({ severity: "error", check: check.id, message: error });
        for (const warning of lint.warnings) findings.push({ severity: "warn", check: check.id, message: warning });
    }
    if (parsed.checks.length && !scripted) {
        findings.push({ severity: "warn", check: null,
            message: "no check is script-verified; the completion gate cannot verify anything" });
    }
    return findings;
}

function formatGoalLint(findings) {
    const errors = findings.filter(finding => finding.severity === "error").length;
    const warnings = findings.filter(finding => finding.severity === "warn").length;
    const lines = ["GOAL LINT: " + errors + " error, " + warnings + " warn" + (findings.length ? "." : " — clean.")];
    for (const finding of findings) {
        lines.push("[" + finding.severity + "] " + (finding.check || "GOAL.md") + ": " + finding.message);
    }
    return lines.join("\n");
}

module.exports = { GOAL_FILE, parseGoal, readGoal, checkEvidence, lintGoal, formatGoalLint, digestScript };
