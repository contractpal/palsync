"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { RULES: WORKFLOW_RULES } = require("../src/core/validate/workflowJs");
const {
    RULE_REGISTRY,
    WORKSPACE_GATE_RULES,
    WORKSPACE_WARNING_RULES,
} = require("../src/core/validate/registry");

const VALIDATE_DIR = path.join(__dirname, "..", "src", "core", "validate");
const EMITTERS = ["markup.js", "workflowJs.js", "palJson.js", "datasetDef.js", "tagBalance.js", "contracts.js"];

function emittedRuleCodes() {
    const codes = new Set(Object.keys(WORKFLOW_RULES));
    for (const name of EMITTERS) {
        const source = fs.readFileSync(path.join(VALIDATE_DIR, name), "utf8");
        for (const pattern of [
            /rule:\s*["']([^"']+)["']/g,
            /\badd\([^\n]*?["'](?:error|warn)["']\s*,\s*["']([^"']+)["']/g,
            /\berr\(\s*["']([^"']+)["']/g,
        ]) {
            let match;
            while ((match = pattern.exec(source))) codes.add(match[1]);
        }
    }
    return codes;
}

test("rule registry covers every validator rule emitter", () => {
    const emitted = emittedRuleCodes();
    const registered = new Set(Object.keys(RULE_REGISTRY));
    assert.deepEqual([...emitted].filter(code => !registered.has(code)).sort(), [], "emitted but unregistered");
    assert.deepEqual([...registered].filter(code => !emitted.has(code)).sort(), [], "registered but never emitted");
});

test("every cross-file rule belongs to exactly one workspace gate set", () => {
    for (const [code, meta] of Object.entries(RULE_REGISTRY)) {
        if (meta.category !== "cross-file") continue;
        const memberships = Number(WORKSPACE_GATE_RULES.has(code)) + Number(WORKSPACE_WARNING_RULES.has(code));
        assert.equal(memberships, 1, code + " must belong to exactly one workspace set");
    }
});

test("blocking registry rules cite evidence", () => {
    for (const [code, meta] of Object.entries(RULE_REGISTRY)) {
        if (meta.severity !== "error" && meta.severity !== "both") continue;
        assert.equal(typeof meta.evidence, "string", code + " evidence type");
        assert.ok(meta.evidence.trim(), code + " evidence must not be empty");
    }
});
