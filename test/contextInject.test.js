"use strict";
// Per-agent context injection: Claude/Codex drive palsync via MCP tools (pal_push, …); Pi has no
// MCP, so its AGENTS.md uses the palsync CLI subcommands instead and drops the session-lock framing.
// Pure (writes to a temp dir, no network). Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const ci = require("../src/launcher/contextInject");
const { tmpWorkspace } = require("./helpers");

test("every bundled skill injects, with its references/* assets (bundle dir = source of truth)", async () => {
    const ws = tmpWorkspace();
    await ci.inject(ws, { palName: "Demo", agent: "claude" });
    const skillsDir = path.join(ws, ".claude/skills");
    const bundled = path.join(__dirname, "..", "bundled-context", "skills");
    // Discover the bundle directly off disk — the test must not duplicate the inject logic; it
    // asserts the workspace ends up holding EXACTLY what the bundle ships.
    const names = fs.readdirSync(bundled, { withFileTypes: true })
        .filter(e => e.isDirectory() && fs.existsSync(path.join(bundled, e.name, "SKILL.md")))
        .map(e => e.name);
    assert.ok(names.includes("seo-core"), "seo-core is in the bundle (it must load with no opt-in flag)");
    for (const name of names) {
        assert.ok(fs.existsSync(path.join(skillsDir, name, "SKILL.md")), name + " SKILL.md injected");
        const refsDir = path.join(bundled, name, "references");
        if (fs.existsSync(refsDir)) {
            for (const f of fs.readdirSync(refsDir)) {
                assert.ok(fs.existsSync(path.join(skillsDir, name, "references", f)), name + "/references/" + f + " injected");
            }
        }
    }
});

test("Claude CLAUDE.md @imports the owned doc (real import, not backticked)", async () => {
    const ws = tmpWorkspace();
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
    // A Claude pal carries ONLY Claude files — no AGENTS.md / .agents skills.
    assert.ok(!fs.existsSync(path.join(ws, "AGENTS.md")), "Claude pal has no AGENTS.md");
    assert.ok(!fs.existsSync(path.join(ws, ".agents")), "Claude pal has no .agents dir");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("Pi pal carries only AGENTS.md + .agents skills — no CLAUDE files", async () => {
    const ws = tmpWorkspace();
    await ci.inject(ws, { palName: "Demo", agent: "pi" });
    assert.ok(fs.existsSync(path.join(ws, "AGENTS.md")), "Pi gets AGENTS.md");
    assert.ok(fs.existsSync(path.join(ws, ".agents/skills/palbuilder-workflow/SKILL.md")), "Pi skills at .agents/ (workflow)");
    assert.ok(fs.existsSync(path.join(ws, ".agents/skills/palbuilder-realtime/SKILL.md")), "Pi skills at .agents/ (realtime)");
    // The full doc is inlined in AGENTS.md (no fragile @import), with the stamp + contract.
    const md = fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8");
    assert.ok(/<!--\s*palsync-context v/.test(md), "AGENTS.md carries the stamp");
    assert.ok(md.includes("GOLDEN RULES"), "AGENTS.md inlines the coding contract");
    assert.ok(!md.includes("@CLAUDE.palsync.md"), "AGENTS.md must not depend on an import");
    // No Claude-owned files.
    assert.ok(!fs.existsSync(path.join(ws, "CLAUDE.palsync.md")), "Pi pal has no CLAUDE.palsync.md");
    assert.ok(!fs.existsSync(path.join(ws, ".claude/skills/palbuilder-backend")), "Pi pal has no .claude skills");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("switching a workspace's agent cleans the other agent's palsync files, keeps user notes", async () => {
    const ws = tmpWorkspace();
    fs.writeFileSync(path.join(ws, "CLAUDE.md"), "# My own notes\n", "utf8");
    await ci.inject(ws, { palName: "Demo", agent: "claude" });           // Claude first
    assert.ok(fs.existsSync(path.join(ws, "CLAUDE.palsync.md")), "claude doc written");
    assert.ok(fs.existsSync(path.join(ws, ".claude/skills/pal-spec")), "claude skills written");

    await ci.inject(ws, { palName: "Demo", agent: "pi" });               // switch to Pi
    assert.ok(!fs.existsSync(path.join(ws, "CLAUDE.palsync.md")), "owned doc removed on switch");
    assert.ok(!fs.existsSync(path.join(ws, ".claude/skills/pal-spec")), "palsync claude skills pruned on switch");
    assert.ok(!fs.existsSync(path.join(ws, ".claude")), "emptied .claude dir removed on switch");
    assert.ok(fs.existsSync(path.join(ws, "AGENTS.md")), "AGENTS.md written on switch");
    const claudeMd = fs.readFileSync(path.join(ws, "CLAUDE.md"), "utf8");
    assert.ok(claudeMd.includes("# My own notes"), "user's CLAUDE.md notes survive");
    assert.ok(!claudeMd.includes("palsync managed block"), "managed block stripped from CLAUDE.md");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("contextStatus flags a stale/missing stamp", async () => {
    const ws = tmpWorkspace();
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
    const ws = tmpWorkspace();
    await ci.inject(ws, { palName: "Demo", agent: "claude" });
    const skillsDir = path.join(ws, ".claude/skills");
    // simulate a retired skill from an older inject + a user-authored skill
    fs.mkdirSync(path.join(skillsDir, "design-core"), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "design-core/SKILL.md"), "old");
    fs.mkdirSync(path.join(skillsDir, "my-team-skill"), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "my-team-skill/SKILL.md"), "mine");

    const keep = (await ci.bundledSkills()).map(s => s.name);
    const removed = await ci.pruneSkills(ws, ".claude", keep);
    assert.ok(removed.includes("design-core"), "retired palsync skill is pruned");
    assert.ok(!fs.existsSync(path.join(skillsDir, "design-core")), "design-core dir removed");
    assert.ok(fs.existsSync(path.join(skillsDir, "my-team-skill")), "user skill is preserved");
    assert.ok(fs.existsSync(path.join(skillsDir, "palbuilder-frontend")), "kept skill survives");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("OpenCode pal carries only AGENTS.md + .agents skills, MCP flavor", async () => {
    const ws = tmpWorkspace();
    await ci.inject(ws, { palName: "Demo", agent: "opencode" });
    assert.ok(fs.existsSync(path.join(ws, "AGENTS.md")), "OpenCode gets AGENTS.md");
    assert.ok(fs.existsSync(path.join(ws, ".agents/skills/palbuilder-workflow/SKILL.md")), "OpenCode skills at .agents/");
    const md = fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8");
    assert.ok(md.includes("`pal_push`"), "OpenCode AGENTS.md uses the MCP tool pal_push");
    assert.ok(!md.includes("`palsync push`"), "OpenCode flavor must not use CLI subcommands");
    assert.ok(md.includes("locked for your session"), "OpenCode locks for the session like Codex, not per-command");
    assert.ok(!fs.existsSync(path.join(ws, "CLAUDE.palsync.md")), "OpenCode pal has no CLAUDE.palsync.md");
    assert.ok(!fs.existsSync(path.join(ws, ".claude/skills/palbuilder-backend")), "OpenCode pal has no .claude skills");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("Pi AGENTS.md uses the palsync CLI, not MCP", async () => {
    const ws = tmpWorkspace();
    await ci.inject(ws, { palName: "Demo", agent: "pi" });
    const md = fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8");
    for (const cmd of ["`palsync push`", "`palsync pull`", "`palsync validate`", "`palsync sync-datasets`"]) {
        assert.ok(md.includes(cmd), "Pi AGENTS.md should reference " + cmd);
    }
    assert.ok(!md.includes("`pal_push`"), "Pi must not reference MCP tools");
    assert.ok(!md.includes("locked for your session"), "Pi locks per-command, not per-session");
    assert.ok(fs.existsSync(path.join(ws, ".agents/skills/palbuilder-workflow/SKILL.md")), "Pi gets skills at .agents/");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("Claude doc references .claude/skills, never .agents/skills", async () => {
    const doc = await ci.buildPalsyncDoc("Demo", { cli: false });
    assert.ok(doc.includes(".claude/skills"), "Claude doc should reference .claude/skills");
    assert.ok(!doc.includes(".agents/skills"), "Claude doc must not reference .agents/skills");
    assert.ok(!doc.includes("never additionally Read/cat"), "the skill-tool-only line is non-Claude only");
});

test("Codex/OpenCode/Pi docs reference .agents/skills, never .claude/skills, and warn against raw-reading skill files", async () => {
    for (const opts of [{ cli: false }, { cli: true }]) {
        const doc = await ci.buildPalsyncDoc("Demo", Object.assign({ skillsDir: ".agents/skills" }, opts));
        assert.ok(doc.includes(".agents/skills"), "doc should reference .agents/skills");
        assert.ok(!doc.includes(".claude/skills"), "doc must not reference .claude/skills");
        assert.ok(doc.includes("never additionally Read/cat"), "non-Claude doc warns against raw-reading skill files");
    }
});

test("generated agent docs route every visible UI task through frontend + design-build and rendered review", async () => {
    for (const opts of [
        { cli: false, skillsDir: ".claude/skills" },
        { cli: false, skillsDir: ".agents/skills" },
        { cli: true, skillsDir: ".agents/skills" },
    ]) {
        const doc = await ci.buildPalsyncDoc("Demo", opts);
        assert.match(doc, /mandatory two-skill route/i);
        assert.match(doc, /load both `palbuilder-frontend`.*`design-build`/s);
        assert.match(doc, /render desktop and mobile/i);
        assert.match(doc, /`designAudit`/);
    }
});

test("exercise guidance covers the delete-absent rule in both MCP and CLI flavors", async () => {
    const mcpDoc = await ci.buildPalsyncDoc("Demo", { cli: false });
    const cliDoc = await ci.buildPalsyncDoc("Demo", { cli: true });
    for (const doc of [mcpDoc, cliDoc]) {
        assert.match(doc, /after a delete put the deleted name in `absent`/);
    }
});

test("inject() threads .agents/skills into the actual OpenCode/Codex/Pi AGENTS.md on disk", async () => {
    for (const agent of ["codex", "opencode", "pi"]) {
        const ws = tmpWorkspace();
        await ci.inject(ws, { palName: "Demo", agent });
        const md = fs.readFileSync(path.join(ws, "AGENTS.md"), "utf8");
        assert.ok(md.includes(".agents/skills"), agent + " AGENTS.md should reference .agents/skills");
        assert.ok(!md.includes(".claude/skills"), agent + " AGENTS.md must not reference .claude/skills");
        fs.rmSync(ws, { recursive: true, force: true });
    }
});
