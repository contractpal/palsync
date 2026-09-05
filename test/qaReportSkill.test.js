"use strict";

// Structural regression gate on the bundled qa-report skill and its report template.
// These checks are intentionally pattern-based (headings, keywords, filename convention) so
// the prose can still be edited and reorganized without breaking the test suite.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.join(__dirname, "..");
const SKILL = path.join(ROOT, "bundled-context", "skills", "qa-report", "SKILL.md");
const TEMPLATE = path.join(ROOT, "bundled-context", "skills", "qa-report", "references", "report-template.md");
const PAL_LOOP = path.join(ROOT, "bundled-context", "skills", "pal-loop", "SKILL.md");
const RUN_MD = path.join(ROOT, "eval", "run.md");

function read(rel) {
    return fs.readFileSync(rel, "utf8");
}

function sectionPresent(text, label) {
    // Accept a markdown heading, a bold label, or a numbered-list bold label.
    return new RegExp("(?:^#+\\s+|^\\d+\\.\\s+\\*\\*|^\\*\\*)" + label, "im").test(text);
}

function requiredSections(text) {
    return [
        ["Header metadata", sectionPresent(text, "Header metadata")],
        ["Executive verdict", sectionPresent(text, "Executive verdict")],
        ["Findings", sectionPresent(text, "Findings")],
        ["What worked well", sectionPresent(text, "What worked well")],
        ["Cost & usage", sectionPresent(text, "Cost(?:\\s*&?\\s*usage)?")],
        ["Recommendations for palsync", sectionPresent(text, "Recommendations")],
        ["Fix tasks", sectionPresent(text, "Fix tasks")],
    ];
}

function allSectionsPresent(text) {
    return requiredSections(text).every(([, ok]) => ok);
}

function missingSections(text) {
    return requiredSections(text).filter(([, ok]) => !ok).map(([name]) => name);
}

test("qa-report skill exists with valid frontmatter", () => {
    assert.ok(fs.existsSync(SKILL), "qa-report/SKILL.md must exist");
    const skill = read(SKILL);
    assert.match(skill, /^---\s*$/m, "SKILL.md must have YAML frontmatter");
    assert.match(skill, /^name:\s*qa-report\s*$/m, "frontmatter name must be qa-report");
    assert.match(skill, /^description:\s*["']?/m, "frontmatter must have a description");
});

test("qa-report skill documents the report filename convention", () => {
    const skill = read(SKILL);
    assert.match(skill, /reports\/YYYY-MM-DD_<spec-slug>_<harness>_<model-slug>\.md/,
        "filename convention must be present");
    assert.match(skill, /example/i, "filename convention must include an example");
});

test("qa-report skill encodes the required structural rules", () => {
    const skill = read(SKILL);
    assert.match(skill, /evidence[- ]?before[- ]?claim|Evidence before claim/i,
        "must require evidence before claim");
    assert.match(skill, /reviewer\s*==\s*builder|same agent|same context|self-review/i,
        "must disclose reviewer == builder");
    assert.match(skill, /severity\s+requires\s+user\s+impact|user\s+sees|user\s+loses/i,
        "must tie severity to user impact");
    assert.match(skill, /reports\/|archives\/|prior\s+report|cross-reference/i,
        "must instruct checking prior reports");
    assert.match(skill, /never\s+estimate|not\s+estimate|no\s+estimate|invented\s+numbers/i,
        "must forbid estimating unavailable numbers");
});

test("qa-report skill references the report template and all seven sections", () => {
    const skill = read(SKILL);
    assert.match(skill, /report-template\.md/, "must reference the report template");
    const missing = missingSections(skill);
    assert.deepStrictEqual(missing, [], "SKILL.md must mention all seven required sections");
});

test("report-template.md exists and contains all seven required sections", () => {
    assert.ok(fs.existsSync(TEMPLATE), "report-template.md must exist");
    const template = read(TEMPLATE);
    const missing = missingSections(template);
    assert.deepStrictEqual(missing, [], "template must contain all seven required sections");
});

test("report-template.md reminds the writer of the filename convention", () => {
    const template = read(TEMPLATE);
    assert.match(template, /reports\/YYYY-MM-DD_<spec-slug>_<harness>_<model-slug>\.md/,
        "template must remind writer of the filename convention");
});

test("report missing a required section is rejected by the structural check", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-qa-report-"));
    const badReport = path.join(tmpDir, "bad-report.md");
    // Omit the "Findings" section on purpose.
    fs.writeFileSync(badReport, [
        "# Report",
        "## Header metadata block",
        "## Executive verdict",
        "## What worked well",
        "## Cost & usage",
        "## Recommendations for palsync",
        "## Fix tasks",
    ].join("\n"));
    const text = read(badReport);
    assert.ok(!allSectionsPresent(text), "report missing Findings must fail the structural check");
    const missing = missingSections(text);
    assert.ok(missing.includes("Findings"), "missing-section list must include Findings");
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("QA report contract requires bounded usage and copied screenshot assets", () => {
    const skill = read(SKILL);
    const template = read(TEMPLATE);
    assert.match(skill, /\.palsync\/run-usage\.json/);
    assert.match(skill, /windows/);
    assert.match(skill, /bounded PalSync build window/i);
    assert.match(skill, /current Pi footer|\/info.*cumulative/i);
    assert.match(skill, /not available/i);
    assert.match(skill, /reports\/assets\/YYYY-MM-DD_<spec>_<harness>_<model>/);
    assert.match(template, /^## Visual evidence$/m);
    assert.match(template, /\*\*Source:\*\*.*agent-work-history/m);
    assert.match(template, /\]\(assets\/YYYY-MM-DD_<spec>_<harness>_<model>\//);
    assert.match(template, /Build phase[\s\S]*Review phase[\s\S]*Total measured PalSync run/);
});

test("pal-loop starts Pi usage before any session-start reads", () => {
    const loop = read(PAL_LOOP);
    const usageStart = loop.indexOf("palsync usage start --phase build");
    const sessionStartRead = loop.indexOf("references/session-start.md");
    assert.ok(usageStart >= 0 && usageStart < sessionStartRead, "usage boundary must precede session-start work");
    assert.match(loop, /before reading any reference[\s\S]*doctor\/status\/pull\/smoke checks/);
});

test("pal-loop end-of-run guidance points to the qa-report skill", () => {
    const loop = read(PAL_LOOP);
    assert.match(loop, /qa-report/, "pal-loop must reference qa-report for report writing");
    assert.match(loop, /report-template\.md/, "pal-loop must reference the report template");
});

test("eval run protocol points to the qa-report skill for reporting", () => {
    const run = read(RUN_MD);
    assert.match(run, /qa-report/, "eval/run.md must reference qa-report for reports");
    assert.match(run, /report-template\.md/, "eval/run.md must reference the report template");
});
