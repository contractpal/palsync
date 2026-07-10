"use strict";
// Regression gate on palsync's REAL always-injected surface: the generated CLAUDE.palsync.md +
// every bundled skill DESCRIPTION (the always-loaded frontmatter line) + every MCP tool
// description. This block is re-read by the model on EVERY turn of every session, so growth
// here multiplies across all users — usage.test.js checks the threshold plumbing with stubs;
// this test measures the actual shipped bytes. If it fails, trim what you just added (or make
// a deliberate, argued decision to raise SOFT_THRESHOLD_BYTES — never raise it as a reflex).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const usage = require("../src/core/usage");
const { buildPalsyncDoc } = require("../src/launcher/contextInject");
const { TOOLS } = require("../src/mcp/tools");

const SKILLS_DIR = path.join(__dirname, "..", "bundled-context", "skills");

test("real injected context (doc + skill descriptions + tool defs) stays under the soft threshold", async () => {
    const doc = await buildPalsyncDoc("budget_gate_pal", {});
    let skillDescBytes = 0;
    let skillCount = 0;
    for (const name of fs.readdirSync(SKILLS_DIR)) {
        const md = path.join(SKILLS_DIR, name, "SKILL.md");
        if (!fs.existsSync(md)) continue;
        skillDescBytes += Buffer.byteLength(usage.skillDescription(fs.readFileSync(md, "utf8")), "utf8");
        skillCount++;
    }
    const toolDefBytes = TOOLS.reduce((n, t) => n + Buffer.byteLength(t.description || "", "utf8"), 0);
    const total = Buffer.byteLength(doc, "utf8") + skillDescBytes + toolDefBytes;

    assert.ok(skillCount > 5, `expected bundled skills, found ${skillCount}`);
    assert.ok(TOOLS.length > 5, `expected MCP tools, found ${TOOLS.length}`);
    assert.ok(
        total <= usage.SOFT_THRESHOLD_BYTES,
        `always-injected surface is ${total} bytes (~${Math.ceil(total / 4)} tokens), over the ` +
        `${usage.SOFT_THRESHOLD_BYTES}-byte soft threshold — trim the doc/skill/tool description you just grew`
    );
});
