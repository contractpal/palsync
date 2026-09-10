"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pickSettings } = require("../src/launcher/prompts");

const CLI = path.join(__dirname, "..", "bin", "palsync.js");

function home() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "palsync-settings-cli-"));
}

function run(homeDir, args = []) {
    return spawnSync(process.execPath, [CLI, "settings", ...args], {
        cwd: homeDir,
        encoding: "utf8",
        env: Object.assign({}, process.env, {
            // src/platform/config.js resolves ~/.palsync/config.json via os.homedir(), which reads
            // HOME on POSIX but USERPROFILE on Windows (confirmed directly - HOME is ignored there
            // entirely). Setting only HOME left this test writing to the REAL home dir on Windows
            // instead of the isolated tmp one, found 2026-09-10 after it silently overwrote real
            // ~/.palsync/config.json preferences during a test run. Set both - each OS ignores the
            // one it doesn't use, so this is harmless cross-platform.
            HOME: homeDir,
            USERPROFILE: homeDir,
            PALSYNC_VERIFICATION: "",
            PALSYNC_REVIEW: ""
        })
    });
}

test("settings CLI shows simple defaults when config is missing", () => {
    const dir = home();
    try {
        const result = run(dir);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /PalSync: Standard checks · Final review: Ask/);
        assert.match(result.stdout, /Standard — Check what changed without testing everything\./);
        assert.match(result.stdout, /Ask me — Offer a final review when the work is done\./);
        assert.doesNotMatch(result.stdout, /fanout|decision table|policy engine|strategy/i);
        assert.equal(fs.existsSync(path.join(dir, ".palsync", "config.json")), false,
            "showing defaults must not create a config file");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("settings CLI normalizes and persists both preferences while preserving older keys", () => {
    const dir = home();
    const configDir = path.join(dir, ".palsync");
    const configFile = path.join(configDir, "config.json");
    try {
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(configFile, JSON.stringify({ legacySetting: true, verification: "old-value" }));
        const changed = run(dir, ["verification", " THOROUGH ", "review", "AUTO"]);
        assert.equal(changed.status, 0, changed.stderr);
        assert.match(changed.stdout, /PalSync: Thorough checks · Final review: Automatic/);
        assert.deepEqual(JSON.parse(fs.readFileSync(configFile, "utf8")), {
            legacySetting: true,
            verification: "thorough",
            review: "auto"
        });
        const shown = run(dir);
        assert.equal(shown.status, 0, shown.stderr);
        assert.match(shown.stdout, /Thorough checks · Final review: Automatic/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("settings CLI rejects incomplete, unknown, invalid, and unsupported flag input without writing", () => {
    const cases = [
        [["verification"], /Usage: palsync settings/],
        [["speed", "fast"], /Unknown setting 'speed'/],
        [["verification", "turbo"], /Invalid verification 'turbo'/],
        [["--unknown"], /Usage: palsync settings/]
    ];
    for (const [args, expected] of cases) {
        const dir = home();
        try {
            const result = run(dir, args);
            assert.equal(result.status, 1, "expected failure for " + args.join(" "));
            assert.match(result.stderr, expected);
            assert.equal(fs.existsSync(path.join(dir, ".palsync", "config.json")), false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

test("settings CLI validates all pairs before changing either preference", () => {
    const dir = home();
    const configDir = path.join(dir, ".palsync");
    const configFile = path.join(configDir, "config.json");
    try {
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(configFile, JSON.stringify({ verification: "standard", review: "ask" }));
        const result = run(dir, ["verification", "fast", "review", "sometimes"]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Invalid review 'sometimes'/);
        assert.deepEqual(JSON.parse(fs.readFileSync(configFile, "utf8")), {
            verification: "standard",
            review: "ask"
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("settings CLI has focused help", () => {
    const dir = home();
    try {
        const result = run(dir, ["--help"]);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(),
            "Usage: palsync settings [verification fast|standard|thorough] [review off|ask|auto]");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("the launcher settings picker exposes the same plain-language choices", async () => {
    const prompts = [];
    const answers = ["fast", "auto"];
    const clack = {
        select: async prompt => { prompts.push(prompt); return answers.shift(); },
        isCancel: value => value === Symbol.for("cancel")
    };
    assert.deepEqual(await pickSettings({ verification: "standard", review: "ask" }, clack), {
        verification: "fast",
        review: "auto"
    });
    assert.deepEqual(prompts[0].options, [
        { value: "fast", label: "Fast", hint: "Do basic checks and keep moving." },
        { value: "standard", label: "Standard", hint: "Check what changed without testing everything." },
        { value: "thorough", label: "Thorough", hint: "Run the full set of relevant checks." }
    ]);
    assert.deepEqual(prompts[1].options, [
        { value: "off", label: "Off", hint: "Finish when the work is done." },
        { value: "ask", label: "Ask me", hint: "Offer a final review when the work is done." },
        { value: "auto", label: "Automatic", hint: "Always run a final review." }
    ]);
});

test("cancelling launcher settings keeps the current values", async () => {
    const cancel = Symbol.for("cancel");
    const clack = { select: async () => cancel, isCancel: value => value === cancel };
    assert.deepEqual(await pickSettings({ verification: "standard", review: "ask" }, clack), {
        verification: "standard",
        review: "ask"
    });
});
