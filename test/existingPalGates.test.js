"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SKILLS = path.join(__dirname, "..", "bundled-context", "skills");
const palFix = fs.readFileSync(path.join(SKILLS, "pal-fix", "SKILL.md"), "utf8");
const palInit = fs.readFileSync(path.join(SKILLS, "pal-init", "SKILL.md"), "utf8");

test("pal-fix skips spec ceremony, not verification gates", () => {
    assert.match(palFix, /not gate-light/, "pal-fix must explicitly keep the proof ladder");
    for (const tool of [
        "pal_validate",
        "pal_push",
        "pal_test",
        "pal_screenshot",
        "pal_exercise",
        "pal_regression"
    ]) {
        assert.match(palFix, new RegExp(tool), "pal-fix must name " + tool);
    }
    assert.match(palFix, /step-1 reproduction must now pass/, "fix proof must use the repro tool");
});

test("pal-init handoff requires the existing-pal verification floor", () => {
    assert.match(palInit, /Existing-pal verification floor/, "pal-init must define the handoff gate floor");
    assert.match(palInit, /EXECUTION\.md must include verification tasks\/criteria/, "handoff must force explicit tasks");
    for (const tool of [
        "pal_validate",
        "pal_push",
        "pal_sync_datasets",
        "pal_test",
        "pal_fetch",
        "pal_preview",
        "pal_screenshot",
        "pal_exercise",
        "pal_regression"
    ]) {
        assert.match(palInit, new RegExp(tool), "pal-init handoff must name " + tool);
    }
    assert.match(palInit, /if stale, stop and refresh Step 3/, "stale baselines must block regression claims");
});
