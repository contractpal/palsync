"use strict";
// Per-agent context injection: Claude/Codex drive palsync via MCP tools (pal_push, …); Pi has no
// MCP, so its AGENTS.md uses the palsync CLI subcommands instead and drops the session-lock framing.
// Pure (writes to a temp dir, no network). Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ci = require("../src/launcher/contextInject");

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "palsync-inject-")); }

test("Claude CLAUDE.md @imports the owned doc (real import, not backticked)", async () => {
    const ws = tmp();
    await ci.inject(ws, { palName: "Demo", agent: "claude" });
    const md = fs.readFileSync(path.join(ws, "CLAUDE.md"), "utf8");
    // Import must be on its own line and NOT inside backticks, or Claude Code skips it.
    assert.ok(/^@CLAUDE\.palsync\.md$/m.test(md), "CLAUDE.md must @import on its own line");
    assert.ok(!md.includes("`@CLAUDE.palsync.md`"), "the import must not be backtick-wrapped (code spans are not imported)");

    // The actual rules live in the owned doc: coding contract + MCP-flavor etiquette under a stamp.
    const doc = fs.readFileSync(path.join(ws, "CLAUDE.palsync.md"), "utf8");
    assert.ok(/<!--\s*palsync-context v/.test(doc), "owned doc carries a version stamp");
    assert.ok(doc.includes("GOLDEN RULES"), "owned doc includes the coding contract");
    assert.ok(doc.includes("`pal_push`"), "owned doc references the MCP tool pal_push");
    assert.ok(doc.includes("MCP server"), "owned doc describes the MCP server");
    assert.ok(!doc.includes("`palsync push`"), "Claude flavor must not use CLI subcommands");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("contextStatus flags a stale/missing stamp", async () => {
    const ws = tmp();
    await ci.inject(ws, { palName: "Demo", agent: "claude" });
    const fresh = await ci.contextStatus(ws);
    assert.equal(fresh.stale, false, "freshly injected workspace is current");
    assert.equal(fresh.version, ci.VERSION);

    fs.writeFileSync(path.join(ws, "CLAUDE.palsync.md"), "<!-- palsync-context v0.0.1 -->\nold", "utf8");
    assert.equal((await ci.contextStatus(ws)).stale, true, "older stamp is stale");

    fs.rmSync(path.join(ws, "CLAUDE.palsync.md"));
    assert.equal((await ci.contextStatus(ws)).present, false, "missing doc reports not present");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pruneSkills removes retired/owned skills, keeps user skills", async () => {
    const ws = tmp();
    await ci.inject(ws, { palName: "Demo", agent: "claude" });
    const skillsDir = path.join(ws, ".claude/skills");
    // simulate a retired skill from an older inject + a user-authored skill
    fs.mkdirSync(path.join(skillsDir, "design-core"), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "design-core/SKILL.md"), "old");
    fs.mkdirSync(path.join(skillsDir, "my-team-skill"), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "my-team-skill/SKILL.md"), "mine");

    const removed = await ci.pruneSkills(ws, ".claude", ci.ALWAYS_ON_SKILLS);
    assert.ok(removed.includes("design-core"), "retired palsync skill is pruned");
    assert.ok(!fs.existsSync(path.join(skillsDir, "design-core")), "design-core dir removed");
    assert.ok(fs.existsSync(path.join(skillsDir, "my-team-skill")), "user skill is preserved");
    assert.ok(fs.existsSync(path.join(skillsDir, "palbuilder-frontend")), "kept skill survives");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("Pi AGENTS.md uses the palsync CLI, not MCP", async () => {
    const ws = tmp();
    await ci.inject(ws, { palName: "Demo", agent: "pi" });
    const md = fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8");
    for (const cmd of ["`palsync push`", "`palsync pull`", "`palsync validate`", "`palsync sync-datasets`"]) {
        assert.ok(md.includes(cmd), "Pi AGENTS.md should reference " + cmd);
    }
    assert.ok(!md.includes("`pal_push`"), "Pi must not reference MCP tools");
    assert.ok(!md.includes("locked for your session"), "Pi locks per-command, not per-session");
    assert.ok(fs.existsSync(path.join(ws, ".agents/skills/palbuilder-backend/SKILL.md")), "Pi gets skills at .agents/");
    fs.rmSync(ws, { recursive: true, force: true });
});
