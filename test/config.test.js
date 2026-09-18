"use strict";
// ~/.palsync/config.json (src/platform/config.js). The rule this pins: a config file PalSync
// could not read is never overwritten. Reading it fails open (an empty view, so a launch still
// works), but writing back that empty view would erase every unrelated preference the damaged
// file still holds — so set() refuses instead, exactly as it does for a read-only home.
// Each case runs in its own process with HOME pointed at a temp directory, because config.js
// resolves the path once at load time.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

// Run `code` with require("config") bound to `config`, in a home of its own.
function inHome(home, code) {
    const script = 'const config = require(' + JSON.stringify(path.join(ROOT, "src/platform/config.js")) + ');\n' + code;
    const res = spawnSync(process.execPath, ["-e", script], {
        encoding: "utf8", timeout: 30000, cwd: home,
        env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home })
    });
    assert.equal(res.status, 0, res.stderr);
    return res;
}

function home() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "palsync-config-test-"));
}

function configFile(dir) {
    return path.join(dir, ".palsync", "config.json");
}

test("a missing config file is created normally", () => {
    const dir = home();
    try {
        const res = inHome(dir, 'process.stdout.write(String(config.set("theme", "dark")));');
        assert.equal(res.stdout, "true");
        assert.deepEqual(JSON.parse(fs.readFileSync(configFile(dir), "utf8")), { theme: "dark" });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a valid config keeps its unrelated preferences on update", () => {
    const dir = home();
    try {
        fs.mkdirSync(path.join(dir, ".palsync"), { recursive: true });
        fs.writeFileSync(configFile(dir), JSON.stringify({ verification: "thorough", review: "auto" }));
        inHome(dir, 'config.set("recentPals", [{ palGuid: "G" }]);');
        const parsed = JSON.parse(fs.readFileSync(configFile(dir), "utf8"));
        assert.equal(parsed.verification, "thorough");
        assert.equal(parsed.review, "auto");
        assert.equal(parsed.recentPals[0].palGuid, "G");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a malformed config is never overwritten, and says so once", () => {
    const dir = home();
    try {
        fs.mkdirSync(path.join(dir, ".palsync"), { recursive: true });
        // Recognizable, hand-editable content: this is what a user would have to recover.
        const damaged = '{\n  "verification": "thorough",\n  "recentPals": [ { "palGuid": "KEEP-ME" }\n';
        fs.writeFileSync(configFile(dir), damaged);
        const before = fs.readFileSync(configFile(dir));

        const res = inHome(dir, [
            'const first = config.set("recentPals", [{ palGuid: "NEW" }]);',
            'const second = config.set("theme", "dark");',
            'process.stdout.write(JSON.stringify({ first, second, read: config.get("verification", "fallback") }));'
        ].join("\n"));

        assert.deepEqual(JSON.parse(res.stdout), { first: false, second: false, read: "fallback" },
            "reads fail open, writes refuse");
        assert.deepEqual(fs.readFileSync(configFile(dir)), before, "the damaged file is byte-for-byte unchanged");
        assert.match(res.stderr, /could not read .*config\.json/);
        assert.match(res.stderr, /will not be saved until that file is fixed or removed/);
        assert.equal(res.stderr.match(/could not read/g).length, 1, "warned once, not once per call");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an unreadable config (not just malformed) is not replaced either", () => {
    const dir = home();
    try {
        // A directory where the file should be: the read fails with EISDIR, and nothing about
        // that says the path is safe to overwrite.
        fs.mkdirSync(configFile(dir), { recursive: true });
        const res = inHome(dir, 'process.stdout.write(String(config.set("theme", "dark")));');
        assert.equal(res.stdout, "false");
        assert.ok(fs.statSync(configFile(dir)).isDirectory(), "left exactly as it was");
        assert.match(res.stderr, /could not read/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
