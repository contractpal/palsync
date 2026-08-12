"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { tmpWorkspace } = require("./helpers");
const hooks = require("../src/launcher/claudeHooks");
const contextInject = require("../src/launcher/contextInject");

function settingsPath(ws) { return path.join(ws, ".claude", "settings.json"); }

test("Windows generated commands quote spaced paths and preserve the command tail", () => {
    const command = hooks.generateCommand(
        "guard",
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Program Files\\palsync\\bin\\palsync.js",
        "win32",
    );
    assert.equal(command, '"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\palsync\\bin\\palsync.js" hook guard --mode claude');
});

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
        assert.equal(result.manualRemediation.includes(hooks.COMPLETION_COMMAND), true);
        assert.equal(result.manualRemediation.includes(hooks.GUARD_COMMAND), true);
        assert.equal(result.manualRemediation.includes(hooks.POST_WRITE_COMMAND), true);
        assert.equal(result.manualRemediation.includes("palsync hook completion --mode claude"), false);
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

test("the PostToolUse post-write hook installs with its matcher and is idempotent", async () => {
    const ws = tmpWorkspace();
    await hooks.configure(ws, { install: true });
    const first = fs.readFileSync(settingsPath(ws), "utf8");
    const again = await hooks.configure(ws, { install: true });
    const value = JSON.parse(first);
    const group = value.hooks.PostToolUse.find(item => item.hooks.some(hook => hook.command === hooks.POST_WRITE_COMMAND));
    assert.ok(group, "post-write group present");
    assert.equal(group.matcher, hooks.POST_WRITE_MATCHER);
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

// --- Deterministic commands and migration ownership ---

function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function priorForm(adapter, node, script) {
    return shq(node) + " " + shq(script) + " hook " + adapter + " --mode claude";
}
const BARE = {
    completion: "palsync hook completion --mode claude",
    guard: "palsync hook guard --mode claude",
    "post-write": "palsync hook post-write --mode claude",
};

test("generated hook commands pin the running Node and the absolute script", () => {
    const absoluteScript = path.resolve(__dirname, "..", "bin", "palsync.js");
    for (const [adapter, command, hook] of [
        ["completion", hooks.COMPLETION_COMMAND, hooks.COMPLETION_HOOK],
        ["guard", hooks.GUARD_COMMAND, hooks.GUARD_HOOK],
        ["post-write", hooks.POST_WRITE_COMMAND, hooks.POST_WRITE_HOOK],
    ]) {
        assert.equal(hook.command, command);
        assert.equal(command.startsWith("palsync"), false);
        assert.equal(command.includes(shq(absoluteScript) + " hook "), true);
        assert.equal(command.endsWith(" hook " + adapter + " --mode claude"), true);
    }
    assert.equal(path.isAbsolute(absoluteScript), true);
});

test("install migrates all three legacy bare commands in place, preserving siblings and group fields", async () => {
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: {
        Stop: [{ hooks: [{ type: "command", command: BARE.completion }, { type: "command", command: "team-check" }], note: "keep" }],
        PreToolUse: [{ matcher: hooks.GUARD_MATCHER, hooks: [{ type: "command", command: BARE.guard, timeout: 30 }] }],
        PostToolUse: [{ matcher: hooks.POST_WRITE_MATCHER, hooks: [{ type: "command", command: BARE["post-write"] }] }],
    } }) + "\n" });
    await hooks.configure(ws, { install: true });
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.equal(value.hooks.Stop.length, 1, "no extra Stop group");
    assert.equal(value.hooks.Stop[0].note, "keep");
    assert.equal(value.hooks.Stop[0].hooks[0].command, hooks.COMPLETION_COMMAND);
    assert.equal(value.hooks.Stop[0].hooks[1].command, "team-check");
    assert.equal(value.hooks.PreToolUse.length, 1);
    assert.equal(value.hooks.PreToolUse[0].matcher, hooks.GUARD_MATCHER);
    assert.equal(value.hooks.PreToolUse[0].hooks[0].command, hooks.GUARD_COMMAND);
    assert.equal(value.hooks.PreToolUse[0].hooks[0].timeout, 30, "hook metadata preserved");
    assert.equal(value.hooks.PostToolUse.length, 1);
    assert.equal(value.hooks.PostToolUse[0].hooks[0].command, hooks.POST_WRITE_COMMAND);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("prior node+script forms migrate through configure while wrappers and suffixes stay user-owned", async () => {
    const spaced = priorForm("guard", "/Applications/Node js/node", "/opt/pal sync/bin/palsync.js");
    const windows = '"C:\\tools\\node.exe" "C:\\pal sync\\palsync.js" hook completion --mode claude';
    const wrapped = "env " + priorForm("completion", "node", "/opt/palsync.js");
    const suffixed = priorForm("completion", "node", "/opt/palsync.js") + " --custom";
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: {
        Stop: [{ hooks: [
            { type: "command", command: windows },
            { type: "command", command: wrapped },
            { type: "command", command: suffixed },
        ] }],
        PreToolUse: [{ matcher: hooks.GUARD_MATCHER, hooks: [{ type: "command", command: spaced }] }],
    } }) + "\n" });
    await hooks.configure(ws, { install: true });
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.deepEqual(value.hooks.Stop[0].hooks, [
        { type: "command", command: hooks.COMPLETION_COMMAND },
        { type: "command", command: wrapped },
        { type: "command", command: suffixed },
    ]);
    assert.equal(value.hooks.PreToolUse[0].hooks[0].command, hooks.GUARD_COMMAND);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("install drops stale guard entries under foreign matchers and keeps canonical-group entries in place", async () => {
    const userBash = { type: "command", command: "bash-check" };
    const userWrite = { type: "command", command: "team-write" };
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: { PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: BARE.guard }, userBash] },
        { matcher: hooks.GUARD_MATCHER, hooks: [{ type: "command", command: hooks.GUARD_COMMAND }, userWrite] },
    ] } }) + "\n" });
    await hooks.configure(ws, { install: true });
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.deepEqual(value.hooks.PreToolUse[0], { matcher: "Bash", hooks: [userBash] });
    assert.deepEqual(value.hooks.PreToolUse[1], {
        matcher: hooks.GUARD_MATCHER,
        hooks: [{ type: "command", command: hooks.GUARD_COMMAND }, userWrite],
    });
    fs.rmSync(ws, { recursive: true, force: true });
});

test("install drops stale post-write entries under foreign matchers and keeps canonical-group entries in place", async () => {
    const userBash = { type: "command", command: "bash-check" };
    const userWrite = { type: "command", command: "team-post-write" };
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: { PostToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: BARE["post-write"] }, userBash] },
        { matcher: hooks.POST_WRITE_MATCHER, hooks: [{ type: "command", command: hooks.POST_WRITE_COMMAND }, userWrite] },
    ] } }) + "\n" });
    await hooks.configure(ws, { install: true });
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.deepEqual(value.hooks.PostToolUse[0], { matcher: "Bash", hooks: [userBash] });
    assert.deepEqual(value.hooks.PostToolUse[1], {
        matcher: hooks.POST_WRITE_MATCHER,
        hooks: [{ type: "command", command: hooks.POST_WRITE_COMMAND }, userWrite],
    });
    fs.rmSync(ws, { recursive: true, force: true });
});

test("install reuses a canonical-matcher group when only stale entries existed", async () => {
    const userBash = { type: "command", command: "bash-check" };
    const userWrite = { type: "command", command: "team-write" };
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: { PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: BARE.guard }, userBash] },
        { matcher: hooks.GUARD_MATCHER, hooks: [userWrite] },
    ] } }) + "\n" });
    await hooks.configure(ws, { install: true });
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.deepEqual(value.hooks.PreToolUse[0], { matcher: "Bash", hooks: [userBash] });
    assert.deepEqual(value.hooks.PreToolUse[1], { matcher: hooks.GUARD_MATCHER, hooks: [userWrite, hooks.GUARD_HOOK] });
    fs.rmSync(ws, { recursive: true, force: true });
});

test("install creates a canonical group when none exists after stale removal", async () => {
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: { PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: BARE.guard }] },
    ] } }) + "\n" });
    await hooks.configure(ws, { install: true });
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.equal(value.hooks.PreToolUse.length, 1);
    assert.equal(value.hooks.PreToolUse[0].matcher, hooks.GUARD_MATCHER);
    assert.deepEqual(value.hooks.PreToolUse[0].hooks, [hooks.GUARD_HOOK]);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("install dedupes later owned hooks, preserving the first in hook order", async () => {
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: { Stop: [
        { hooks: [
            { type: "command", command: BARE.completion, timeout: 30, description: "mine" },
            { type: "command", command: hooks.COMPLETION_COMMAND },
            { type: "command", command: "user-a" },
        ] },
    ] } }) + "\n" });
    await hooks.configure(ws, { install: true });
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.deepEqual(value.hooks.Stop[0].hooks, [
        { type: "command", command: hooks.COMPLETION_COMMAND, timeout: 30, description: "mine" },
        { type: "command", command: "user-a" },
    ]);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("install dedupes owned hooks spread across groups, keeping the earliest group", async () => {
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: { Stop: [
        { hooks: [{ type: "command", command: hooks.COMPLETION_COMMAND }, { type: "command", command: "user-a" }] },
        { hooks: [{ type: "command", command: BARE.completion }] },
    ] } }) + "\n" });
    await hooks.configure(ws, { install: true });
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.equal(value.hooks.Stop.length, 1, "empty duplicate group cleaned up");
    assert.deepEqual(value.hooks.Stop[0].hooks, [
        { type: "command", command: hooks.COMPLETION_COMMAND },
        { type: "command", command: "user-a" },
    ]);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("install never touches wrappers, current or legacy --custom pins, or unrelated hooks", async () => {
    const pinned = { type: "command", command: BARE.completion + " --custom", timeout: 5 };
    const currentPinned = { type: "command", command: hooks.COMPLETION_COMMAND + " --custom", timeout: 6 };
    const wrapped = { type: "command", command: "env " + priorForm("completion", "node", "/opt/palsync.js") };
    const user = { type: "command", command: "team-check", description: "user's" };
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: { Stop: [
        { hooks: [pinned, currentPinned, wrapped, user], matcher: "keep-me" },
    ] } }) + "\n" });
    await hooks.configure(ws, { install: true });
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.deepEqual(value.hooks.Stop[0], { hooks: [pinned, currentPinned, wrapped, user], matcher: "keep-me" });
    assert.equal(value.hooks.Stop[1].hooks[0].command, hooks.COMPLETION_COMMAND, "canonical hook lands in its own group");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("uninstall removes every recognized generated form but keeps the rest", async () => {
    const user = { type: "command", command: "team-check" };
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: {
        Stop: [{ hooks: [
            { type: "command", command: hooks.COMPLETION_COMMAND },
            { type: "command", command: priorForm("completion", "/usr/local/bin/node", "/opt/palsync.js") },
            user,
        ] }],
        PreToolUse: [
            { matcher: hooks.GUARD_MATCHER, hooks: [{ type: "command", command: BARE.guard }] },
            { matcher: "Bash", hooks: [{ type: "command", command: priorForm("guard", "/x/node", "/x/palsync.js") }, user] },
        ],
    } }) + "\n" });
    await hooks.configure(ws, { install: false });
    const value = JSON.parse(fs.readFileSync(settingsPath(ws), "utf8"));
    assert.deepEqual(value.hooks.Stop, [{ hooks: [user] }]);
    assert.deepEqual(value.hooks.PreToolUse, [{ matcher: "Bash", hooks: [user] }]);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("install after a migration is byte- and mtime-idempotent", async () => {
    const ws = tmpWorkspace({ ".claude/settings.json": JSON.stringify({ hooks: {
        Stop: [{ hooks: [{ type: "command", command: BARE.completion }] }],
        PreToolUse: [{ matcher: hooks.GUARD_MATCHER, hooks: [{ type: "command", command: BARE.guard }] }],
    } }) + "\n" });
    await hooks.configure(ws, { install: true });
    const bytes = fs.readFileSync(settingsPath(ws));
    const mtime = fs.statSync(settingsPath(ws)).mtimeMs;
    const again = await hooks.configure(ws, { install: true });
    assert.equal(again.changed, false);
    assert.deepEqual(fs.readFileSync(settingsPath(ws)), bytes);
    assert.equal(fs.statSync(settingsPath(ws)).mtimeMs, mtime);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("a decoy on PATH cannot intercept the generated guard command", () => {
    const ws = tmpWorkspace({ ".palsync.json": "{}" });
    const decoyDir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-decoy-"));
    const marker = path.join(decoyDir, "decoy-ran");
    const decoy = path.join(decoyDir, "palsync");
    fs.writeFileSync(decoy, "#!/bin/sh\ntouch \"" + marker + "\"\nexit 1\n");
    fs.chmodSync(decoy, 0o755);
    const event = JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: path.join(ws, ".palsync.json") },
        cwd: ws,
    });
    const res = spawnSync("/bin/sh", ["-c", hooks.GUARD_COMMAND], {
        encoding: "utf8",
        input: event + "\n",
        env: Object.assign({}, process.env, { PATH: decoyDir + path.delimiter + process.env.PATH }),
    });
    try {
        assert.equal(fs.existsSync(marker), false, "the decoy binary must never run");
        assert.equal(res.status, 0, "hook adapters always exit 0: " + res.stderr);
        assert.equal(res.stderr.trim(), "", "no fail-open diagnostic: " + res.stderr);
        const parsed = JSON.parse(res.stdout.trim());
        assert.equal(parsed.hookSpecificOutput.hookEventName, "PreToolUse");
        assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
        assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /\.palsync\.json is PalSync's own push-gate record/);
    } finally {
        fs.rmSync(ws, { recursive: true, force: true });
        fs.rmSync(decoyDir, { recursive: true, force: true });
    }
});
