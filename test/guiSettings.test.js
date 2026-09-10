"use strict";
// The desktop GUI's preference surface must be the same two settings, in the same file, as
// `palsync settings` — not a second copy of the policy.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const GUI_SETTINGS = path.join(ROOT, "gui", "src", "main", "palsyncSettings.js");

// The GUI resolves palsync through node_modules (`palsync: file:..`), which is not installed in
// this repo's own checkout, so the test provides that link itself.
function sandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-gui-settings-"));
    const modules = path.join(dir, "node_modules");
    fs.mkdirSync(modules);
    fs.symlinkSync(ROOT, path.join(modules, "palsync"), "dir");
    return { dir, modules };
}

function runInGui(box, body) {
    const script = "const settings = require(" + JSON.stringify(GUI_SETTINGS) + ");\n" + body;
    const result = spawnSync(process.execPath, ["-e", script], {
        cwd: box.dir,
        encoding: "utf8",
        env: Object.assign({}, process.env, {
            // os.homedir() reads HOME on POSIX but USERPROFILE on Windows (HOME is ignored there
            // entirely) - set both so this sandbox is actually isolated on either OS, not the real
            // ~/.palsync/config.json. See test/settingsCli.test.js's run() for the same fix.
            HOME: box.dir,
            USERPROFILE: box.dir,
            NODE_PATH: box.modules,
            PALSYNC_VERIFICATION: "",
            PALSYNC_REVIEW: ""
        })
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

function cli(box, args) {
    return spawnSync(process.execPath, [path.join(ROOT, "bin", "palsync.js"), "settings", ...args], {
        cwd: box.dir,
        encoding: "utf8",
        env: Object.assign({}, process.env, { HOME: box.dir, USERPROFILE: box.dir, PALSYNC_VERIFICATION: "", PALSYNC_REVIEW: "" })
    });
}

test("the GUI describes the canonical settings and defaults to standard + ask", () => {
    const box = sandbox();
    try {
        const described = runInGui(box, "console.log(JSON.stringify(settings.describe()));");
        assert.deepEqual(described.current, { verification: "standard", review: "ask" });
        assert.deepEqual(described.defaults, { verification: "standard", review: "ask" });
        assert.deepEqual(described.verification.map(o => o.value), ["fast", "standard", "thorough"]);
        assert.deepEqual(described.review.map(o => o.value), ["off", "ask", "auto"]);
        assert.deepEqual(described.verification.map(o => o.label), ["Fast", "Standard", "Thorough"]);
        assert.deepEqual(described.review.map(o => o.label), ["Off", "Ask me", "Automatic"]);
        assert.equal(described.verification[0].help, "Do basic checks and keep moving.");
        assert.equal(described.review[1].help, "Offer a final review when the work is done.");
    } finally {
        fs.rmSync(box.dir, { recursive: true, force: true });
    }
});

test("a GUI change persists immediately to the file the CLI and policy read", () => {
    const box = sandbox();
    try {
        const updated = runInGui(box,
            "console.log(JSON.stringify([settings.update('verification', 'thorough'), settings.update('review', 'auto')]));");
        assert.deepEqual(updated[1], { ok: true, current: { verification: "thorough", review: "auto" } });
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(box.dir, ".palsync", "config.json"), "utf8")),
            { verification: "thorough", review: "auto" });

        const shown = cli(box, []);
        assert.equal(shown.status, 0, shown.stderr);
        assert.match(shown.stdout, /PalSync: Thorough checks · Final review: Automatic/);

        // …and the other direction: a CLI change is what the GUI shows next time it opens.
        assert.equal(cli(box, ["verification", "fast", "review", "off"]).status, 0);
        const reopened = runInGui(box, "console.log(JSON.stringify(settings.describe().current));");
        assert.deepEqual(reopened, { verification: "fast", review: "off" });
    } finally {
        fs.rmSync(box.dir, { recursive: true, force: true });
    }
});

test("the GUI rejects an invalid value without writing it", () => {
    const box = sandbox();
    try {
        const bad = runInGui(box, "console.log(JSON.stringify(settings.update('verification', 'turbo')));");
        assert.equal(bad.ok, false);
        assert.match(bad.error, /Invalid verification/);
        assert.deepEqual(bad.current, { verification: "standard", review: "ask" });
        assert.equal(fs.existsSync(path.join(box.dir, ".palsync", "config.json")), false);
    } finally {
        fs.rmSync(box.dir, { recursive: true, force: true });
    }
});

test("the GUI wires the settings dialog through the menu, preload, and app shell", () => {
    const read = rel => fs.readFileSync(path.join(ROOT, "gui", rel), "utf8");
    const main = read("src/main/index.js");
    assert.match(main, /PalSync Settings…/);
    assert.match(main, /ipcMain\.handle\("settings:describe"/);
    assert.match(main, /ipcMain\.handle\("settings:update"/);
    const preload = read("src/main/preload.js");
    for (const api of ["describeSettings", "updateSetting", "onOpenSettings"]) {
        assert.match(preload, new RegExp(api));
    }
    const app = read("src/renderer/App.jsx");
    assert.match(app, /SettingsModal/);
    assert.match(app, /onOpenSettings/);
    // No second copy of the policy constants in the renderer.
    const modal = read("src/renderer/components/SettingsModal.jsx");
    assert.doesNotMatch(modal, /thorough|standard|"ask"/i);
});
