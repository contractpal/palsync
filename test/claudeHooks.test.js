"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");
const hooks = require("../src/launcher/claudeHooks");
const contextInject = require("../src/launcher/contextInject");

function settingsPath(ws) { return path.join(ws, ".claude", "settings.json"); }

test("Claude completion hook merge preserves user settings and is idempotent", async () => {
    const userStop = { matcher: "", hooks: [{ type: "command", command: "team-check" }, { type: "prompt", prompt: "review" }] };
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ permissions: { allow: ["Read"] }, hooks: { Stop: [userStop], PreToolUse: [{ hooks: [{ type: "command", command: "guard" }] }] } }, null, 2) + "\n" });
    const first = await hooks.configure(ws, { install: true });
    const bytes = fs.readFileSync(settingsPath(ws));
    const mtime = fs.statSync(settingsPath(ws)).mtimeMs;
    const second = await hooks.configure(ws, { install: true });
    const value = JSON.parse(bytes);
    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(fs.statSync(settingsPath(ws)).mtimeMs, mtime);
    assert.deepEqual(value.permissions, { allow: ["Read"] });
    assert.deepEqual(value.hooks.Stop[0], userStop);
    assert.equal(value.hooks.Stop.flatMap(group => group.hooks || []).filter(item => item.command === hooks.COMPLETION_COMMAND).length, 1);
    assert.equal(value.hooks.PreToolUse[0].hooks[0].command, "guard");
    assert.equal(fs.readdirSync(path.dirname(settingsPath(ws))).some(name => name.includes("palsync-tmp")), false);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("switching away removes only the exact PalSync-owned hook", async () => {
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: { Stop: [
        { hooks: [{ type: "command", command: hooks.COMPLETION_COMMAND }, { type: "command", command: "team-check" }] },
        { matcher: "special", hooks: [{ type: "command", command: hooks.COMPLETION_COMMAND + " --custom" }] }
    ] } }, null, 2) + "\n" });
    await contextInject.inject(ws, { palName: "Demo", agent: "pi" });
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.equal(value.hooks.Stop[0].hooks[0].command, "team-check");
    assert.equal(value.hooks.Stop[1].hooks[0].command, hooks.COMPLETION_COMMAND + " --custom");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("switching away leaves settings byte-identical when no owned hook exists", async () => {
    for (const raw of ["{}", '{"permissions":{"allow":["Read"]}}']) {
        const ws = tmpWorkspace({ ".claude/settings.json": raw });
        const result = await hooks.configure(ws, { install: false });
        assert.equal(result.changed, false);
        assert.equal(fs.readFileSync(settingsPath(ws), "utf8"), raw);
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("malformed and structurally incompatible settings remain byte-identical", async () => {
    for (const raw of ["{broken\n", JSON.stringify({ hooks: [] }) + "\n"]) {
        const ws = tmpWorkspace({ ".claude/settings.json": raw });
        const before = fs.readFileSync(settingsPath(ws));
        const result = await hooks.configure(ws, { install: true });
        assert.equal(result.skipped, true);
        assert.match(result.manualRemediation, /palsync hook completion --mode claude/);
        assert.deepEqual(fs.readFileSync(settingsPath(ws)), before);
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("Claude context injection creates the owned Stop hook automatically", async () => {
    const ws = tmpWorkspace();
    const result = await contextInject.inject(ws, { palName: "Demo", agent: "claude" });
    assert.equal(result.hookSettings.ok, true);
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.equal(value.hooks.Stop[0].hooks[0].command, hooks.COMPLETION_COMMAND);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("the PreToolUse guard installs with its matcher and is idempotent", async () => {
    const ws = tmpWorkspace();
    await hooks.configure(ws, { install: true });
    const first = fs.readFileSync(settingsPath(ws), "utf8");
    const again = await hooks.configure(ws, { install: true });
    const value = JSON.parse(first);
    const group = value.hooks.PreToolUse.find(item => item.hooks.some(hook => hook.command === hooks.GUARD_COMMAND));
    assert.ok(group, "guard group present");
    // Without the matcher the guard would run on every tool call, not just the file-write tools.
    assert.equal(group.matcher, hooks.GUARD_MATCHER);
    assert.equal(again.changed, false);
    assert.equal(fs.readFileSync(settingsPath(ws), "utf8"), first);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("switching away removes both owned hooks and leaves no empty scaffolding", async () => {
    const ws = tmpWorkspace();
    await hooks.configure(ws, { install: true });
    const removed = await hooks.configure(ws, { install: false });
    assert.equal(removed.changed, true);
    // configure() deletes a settings file it has emptied, so absence is the correct end state here.
    assert.equal(fs.existsSync(settingsPath(ws)), false);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("removing the guard preserves a user hook sharing its matcher group", async () => {
    const userHook = { type: "command", command: "team-precheck" };
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: { PreToolUse: [
        { matcher: hooks.GUARD_MATCHER, hooks: [{ type: "command", command: hooks.GUARD_COMMAND }, userHook] },
    ] } }, null, 2) + "\n" });
    await hooks.configure(ws, { install: false });
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.deepEqual(value.hooks.PreToolUse, [{ matcher: hooks.GUARD_MATCHER, hooks: [userHook] }]);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("a non-array PreToolUse is structurally incompatible and changes nothing", async () => {
    const raw = JSON.stringify({ hooks: { PreToolUse: {} } }) + "\n";
    const ws = tmpWorkspace({ ".claude/settings.json": raw });
    const result = await hooks.configure(ws, { install: true });
    assert.equal(result.skipped, true);
    assert.match(result.error, /settings\.hooks\.PreToolUse must be an array/);
    assert.equal(fs.readFileSync(settingsPath(ws), "utf8"), raw);
    fs.rmSync(ws, { recursive: true, force: true });
});
