"use strict";
// The launcher CLI's flag surface (bin/palsync.js) and its guards. Each invocation runs in an
// isolated HOME (both HOME and USERPROFILE — see test/settingsCli.test.js for why both) and with
// stdin/stdout piped, so nothing here can reach the real ~/.palsync/config.json or a live cloud.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.join(__dirname, "..", "bin", "palsync.js");

function home(files = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-cli-"));
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
    }
    return dir;
}

function run(homeDir, args, extraEnv = {}) {
    return spawnSync(process.execPath, [CLI, ...args], {
        cwd: homeDir,
        encoding: "utf8",
        timeout: 30000,
        input: "",
        env: Object.assign({}, process.env, { HOME: homeDir, USERPROFILE: homeDir }, extraEnv)
    });
}

test("--help documents the recent-Pal startup, --dir, and the default directory", () => {
    const dir = home();
    try {
        const res = run(dir, ["--help"]);
        assert.equal(res.status, 0, res.stderr);
        assert.match(res.stdout, /recent Pals/);
        assert.match(res.stdout, /--dir <path>/);
        assert.match(res.stdout, /overrides the remembered one/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("--dir without a value fails fast with a clear message", () => {
    const dir = home();
    try {
        const res = run(dir, ["--dir"]);
        assert.equal(res.status, 1);
        assert.match(res.stderr, /--dir needs a directory path/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a non-TTY invocation still fails cleanly instead of hanging on a prompt", () => {
    const dir = home();
    try {
        const res = run(dir, []);
        assert.equal(res.status, 1);
        assert.match(res.stderr, /needs a terminal/);
        assert.match(res.stderr, /palsync setup --pal/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("unknown subcommands fail instead of opening the interactive launcher", () => {
    const dir = home();
    try {
        const res = run(dir, ["sync_datasets_typo"]);
        assert.equal(res.status, 1);
        assert.match(res.stderr, /unknown subcommand 'sync_datasets_typo'/);
        // and the retired name points at its replacement
        const ctx = run(dir, ["context"]);
        assert.equal(ctx.status, 2);
        assert.match(ctx.stderr, /renamed to `palsync ctx`/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("palsync setup --dir keeps its meaning: an exact workspace path, no prompts", () => {
    const dir = home();
    try {
        // No credentials anywhere -> the headless path fails before touching a server, which is
        // exactly the unchanged behavior this test pins (a --dir typo must not fall through to a
        // prompt or a wizard).
        const res = run(dir, ["setup", "--pal", "Some Pal", "--dir", "/tmp/nowhere-at-all", "--user", "dev@example.com"], { CP_PASS: "" });
        assert.notEqual(res.status, 0);
        assert.ok(!/needs a terminal/.test(res.stderr), "setup never needs a TTY: " + res.stderr);
        assert.match(res.stderr + res.stdout, /password|credential|authenticat|login|CP_PASS/i, res.stderr + res.stdout);
        // usage text still documents --dir
        const help = run(dir, ["setup", "--help"]);
        assert.equal(help.status, 0);
        assert.match(help.stdout, /--dir <dir>\s+workspace directory \(default: ~\/PalBuilder\/<pal-name>\)/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("existing subcommands are untouched (status/pull fail on a missing workspace, not on prompts)", () => {
    const dir = home();
    try {
        const res = run(dir, ["status"]);
        assert.notEqual(res.status, 0);
        assert.ok(!/needs a terminal/.test(res.stderr), res.stderr);
        assert.ok(!/recent Pals/.test(res.stdout + res.stderr), "subcommands never open the launcher");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("no credential or token ever lands in the config file the launcher writes", () => {
    const dir = home({ ".palsync/config.json": JSON.stringify({ verification: "thorough", recentPals: [] }) });
    try {
        // Drive the store directly through the CLI's own dependency, in this HOME, so the test
        // covers the real file path resolution rather than a mock.
        const script = [
            "const recent = require(" + JSON.stringify(path.join(__dirname, "..", "src", "platform", "recentPals")) + ");",
            "recent.record({ cloudUrl: 'https://cloud.example', username: 'dev@example.com', palGuid: 'G', palName: 'P',",
            "  workspaceDir: '/tmp/p', agent: 'pi', password: 'hunter2', sessionAuthToken: 'tok', userId: 'U' });"
        ].join("\n");
        const res = spawnSync(process.execPath, ["-e", script], {
            encoding: "utf8", env: Object.assign({}, process.env, { HOME: dir, USERPROFILE: dir })
        });
        assert.equal(res.status, 0, res.stderr);
        const raw = fs.readFileSync(path.join(dir, ".palsync", "config.json"), "utf8");
        assert.ok(!/hunter2|sessionAuthToken|"tok"/.test(raw), raw);
        assert.equal(JSON.parse(raw).verification, "thorough", "unrelated preferences survive");
        assert.equal(JSON.parse(raw).recentPals[0].palGuid, "G");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
