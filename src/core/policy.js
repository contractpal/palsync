"use strict";
// The single verification/review policy for PalSync. Two user settings, three values each, one
// decision table — deliberately not a rule engine.
//
//   verification: fast | standard | thorough   how much proof a change gets
//   review:       off  | ask      | auto       whether pal-review runs at the end
//
// Preferences live in ~/.palsync/config.json (src/platform/config.js). There is no workspace
// override: .palsync.json is rebuilt from scratch by the launcher on every session and is
// write-guarded, so a per-workspace copy would silently disappear.
const config = require("../platform/config");

const VERIFICATION_LEVELS = ["fast", "standard", "thorough"];
const REVIEW_MODES = ["off", "ask", "auto"];
const DEFAULTS = { verification: "standard", review: "ask" };

const VERIFICATION_LABEL = { fast: "Fast", standard: "Standard", thorough: "Thorough" };
const VERIFICATION_HELP = {
    fast: "Do basic checks and keep moving.",
    standard: "Check what changed without testing everything.",
    thorough: "Run the full set of relevant checks."
};
const REVIEW_LABEL = { off: "Off", ask: "Ask me", auto: "Automatic" };
const REVIEW_HELP = {
    off: "Finish when the work is done.",
    ask: "Offer a final review when the work is done.",
    auto: "Always run a final review."
};

function normalize(value, allowed) {
    if (typeof value !== "string") return null;
    const v = value.trim().toLowerCase();
    return allowed.includes(v) ? v : null;
}

// Hierarchy: per-invocation env override -> saved user preference -> PalSync default. An
// unreadable, older, or partially-filled config falls back to the default per key.
function resolve(read = config.get, env = process.env) {
    return {
        verification: normalize(env.PALSYNC_VERIFICATION, VERIFICATION_LEVELS) ||
            normalize(read("verification"), VERIFICATION_LEVELS) || DEFAULTS.verification,
        review: normalize(env.PALSYNC_REVIEW, REVIEW_MODES) ||
            normalize(read("review"), REVIEW_MODES) || DEFAULTS.review
    };
}

function set(key, value, write = config.set) {
    const allowed = key === "verification" ? VERIFICATION_LEVELS : key === "review" ? REVIEW_MODES : null;
    if (!allowed) throw new Error("Unknown setting '" + key + "'. Use verification or review.");
    const v = normalize(value, allowed);
    if (!v) throw new Error("Invalid " + key + " '" + value + "'. Use one of: " + allowed.join(", ") + ".");
    write(key, v);
    return v;
}

// The one line PalSync shows at the start of work.
const REVIEW_SHORT = { off: "Off", ask: "Ask", auto: "Automatic" };
function summaryLine(policy = resolve()) {
    return "PalSync: " + VERIFICATION_LABEL[policy.verification] + " checks · Final review: " +
        REVIEW_SHORT[policy.review];
}

// --- risk, from deterministic facts only (never a model's opinion) ---

const HIGH_RISK_WORKFLOW_TYPES = [2, 3, 5, 15]; // transaction, transaction-system, webservice, tunnel

function folderOf(rel) {
    const i = String(rel).indexOf("/");
    return i === -1 ? "" : String(rel).slice(0, i);
}

function workflowTypes(manifest, paths) {
    const entries = manifest && manifest.workflows && manifest.workflows.entry;
    if (!Array.isArray(entries)) return [];
    const names = new Set(paths.filter(p => folderOf(p) === "workflows").map(p => p.slice("workflows/".length)));
    return entries
        .filter(e => e && names.has(e.string))
        .map(e => e.Workflow && e.Workflow.workflowType)
        .filter(t => typeof t === "number");
}

// paths        — workspace-relative files this change touches
// dependents   — how many other files reference the touched markup (pal_impact); null = unknown
// manifest       — parsed pal.json, when available (workflow types)
// datasetChange  — true when a dataset definition/schema changed
// manifestChange — true when pal.json itself changed without a new file explaining it
function classifyChange({ paths = [], dependents = null, manifest = null, datasetChange = false,
    manifestChange = false } = {}) {
    const folders = paths.map(folderOf);
    const surface = folders.some(f => ["pages", "fragments", "styles", "images"].includes(f));
    const behavior = folders.some(f => ["workflows", "scripts", "wizards"].includes(f));
    const types = workflowTypes(manifest, paths);
    const reasons = [];

    let level = "low";
    const raise = (next, why) => { level = next; reasons.push(why); };

    if (behavior) raise("medium", "workflow or script behavior changed");
    if (dependents !== null && dependents >= 1 && dependents < 3 && level === "low") {
        raise("medium", "this file is used by " + dependents + " other file" + (dependents === 1 ? "" : "s"));
    }
    if (dependents !== null && dependents >= 3) {
        raise("high", "this file is used in " + dependents + " places");
    }
    if (types.some(t => HIGH_RISK_WORKFLOW_TYPES.includes(t))) {
        raise("high", "a transaction or webservice/tunnel workflow changed");
    }
    if (paths.some(p => /(?:^|[\/_.-])(auth|login|session|permission|security)(?:[\/_.-]|$)/i.test(p))) {
        raise("high", "authentication or access-control code changed");
    }
    if (datasetChange) raise("high", "a dataset definition changed");
    if (manifestChange) raise("high", "pal.json structure changed");
    if (paths.length >= 8) raise("high", paths.length + " files changed at once");

    if (!reasons.length) reasons.push("presentation-only change with no known dependents");
    return { level, reasons, surface, behavior };
}

// --- the decision table ---
//
// Each step is { id, run, why }. `why` is one plain sentence, shown before an expensive step or in
// the completion summary when it was skipped. No jargon, no strategy names.
const STEP_TITLES = {
    static: "static checks",
    push: "push",
    compile: "workflow compile check",
    render: "render check",
    "render-mobile": "mobile render check",
    behavior: "behavior check",
    regression: "regression check",
    seo: "SEO audit"
};

function plan({ verification = DEFAULTS.verification, risk = "low", surface = false, behavior = false,
    hasBaseline = false, publicWeb = false } = {}) {
    const steps = [];
    const add = (id, run, why) => steps.push({ id, title: STEP_TITLES[id], run, why });
    const fast = verification === "fast";
    const thorough = verification === "thorough";

    add("static", true, "Local diagnostics catch problems while editing; no separate validate call is needed before push.");
    add("push", true, "Runtime checks only see pushed code, so the change is pushed first.");

    add("compile", behavior && !fast,
        behavior
            ? (fast ? "Workflow compile check skipped in Fast mode." : "Checking the workflow still compiles because its code changed.")
            : "No workflow changed, so there is nothing to compile-check.");

    const renderRun = surface && !fast;
    add("render", renderRun,
        surface
            ? (fast ? "Render check skipped in Fast mode." : "Rendering the affected page to confirm the change looks right.")
            : "Nothing visible changed, so no render check is needed.");

    add("render-mobile", surface && thorough,
        surface
            ? (thorough ? "Also rendering at mobile width, because Thorough checks both." : "One render is enough for this change; the mobile pass is a Thorough-mode check.")
            : "Nothing visible changed, so no mobile render is needed.");

    const behaviorRun = behavior && !fast && (thorough || risk !== "low");
    add("behavior", behaviorRun,
        behavior
            ? (behaviorRun ? "Testing the behavior that changed, end to end." : "Behavior check skipped: no action or write behavior changed here.")
            : "No action or write behavior changed, so there is nothing to exercise.");

    const regressionRun = hasBaseline && !fast && (thorough || risk === "high");
    add("regression", regressionRun,
        !hasBaseline ? "No regression baseline exists for this pal, so regression does not apply."
            : regressionRun ? "Checking related pages because this change reaches beyond the file you edited."
                : "Regression skipped because this change only affects what you edited.");

    const seoRun = publicWeb && (thorough || (verification === "standard" && surface));
    add("seo", seoRun,
        publicWeb ? (seoRun ? "Auditing the public page's SEO because its markup changed." : "SEO audit skipped for this change.")
            : "Not a public web page, so no SEO audit.");

    return { verification, risk, steps };
}

// Rendered plan: what will run, and what will not and why. Kept to a few short lines.
function formatPlan(result, policy = resolve()) {
    const lines = [summaryLine(policy)];
    lines.push("Change: " + result.risk + " risk — " + result.reasons.join("; ") + ".");
    for (const step of result.plan.steps) {
        lines.push((step.run ? "  ✓ " : "  – ") + step.title + " — " + step.why);
    }
    if (policy.review === "off") lines.push("  – final review — not run: your review setting is Off.");
    else if (policy.review === "ask") lines.push("  – final review — offered when the work is done (your setting is Ask me).");
    else lines.push("  ✓ final review — runs once at the end (your setting is Automatic).");
    return lines.join("\n");
}

module.exports = {
    VERIFICATION_LEVELS, REVIEW_MODES, DEFAULTS,
    VERIFICATION_LABEL, VERIFICATION_HELP, REVIEW_LABEL, REVIEW_HELP,
    normalize, resolve, set, summaryLine, classifyChange, plan, formatPlan
};
