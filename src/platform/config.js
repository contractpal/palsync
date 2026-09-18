"use strict";
// Simple file-backed configuration store for user preferences that aren't sensitive (like
// credentials). Stored in ~/.palsync/config.json.
const fs = require("fs");
const path = require("path");
const os = require("os");

// PALSYNC_CONFIG_DIR redirects the store, so a test (or a sandboxed run) never writes into the
// real ~/.palsync. Resolved per call, not once at load: a test that sets it after requiring this
// module still gets an isolated store.
function configDir() {
    const override = process.env.PALSYNC_CONFIG_DIR;
    if (override) return override;
    return path.join(os.homedir(), ".palsync");
}

function configFile() {
    return path.join(configDir(), "config.json");
}

// Reading never throws. It reports whether the existing file could be understood, because a
// file we could NOT read must not be replaced: overwriting it would erase preferences that are
// still in there (or still recoverable by hand). `damaged` is what makes set() refuse.
let warned = false;

function warnDamaged(reason) {
    if (warned) return;
    warned = true;
    try {
        process.stderr.write(
            "palsync: could not read " + configFile() + " (" + reason + ").\n" +
            "         Settings (including the recent-Pal list) will not be saved until that file is " +
            "fixed or removed.\n");
    } catch (e) { /* stderr gone */ }
}

function readConfig() {
    const file = configFile();
    try {
        if (!fs.existsSync(file)) return { config: {}, damaged: false };
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("the file does not contain a JSON object");
        }
        return { config: parsed, damaged: false };
    } catch (e) {
        warnDamaged(e && e.message ? e.message : String(e));
        return { config: {}, damaged: true };
    }
}

// Returns true when the file was written. Callers may ignore it (a preference that can't be
// saved is not worth failing a launch over) — but the recent-pal history reports it, so a
// read-only home is at least diagnosable instead of silently losing history.
function writeConfig(config) {
    try {
        const dir = configDir();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config, null, 2), "utf8");
        return true;
    } catch (e) {
        // Fail quietly if we can't write config (e.g. read-only filesystem)
        return false;
    }
}

function get(key, defaultValue) {
    const { config } = readConfig();
    return config[key] !== undefined ? config[key] : defaultValue;
}

// A damaged file is never overwritten: the in-memory view of it is empty, so writing would
// destroy every unrelated preference it still holds. The caller gets false, exactly as it does
// for a read-only home, and treats it as a non-fatal failed save.
function set(key, value) {
    const { config, damaged } = readConfig();
    if (damaged) return false;
    config[key] = value;
    return writeConfig(config);
}

module.exports = { get, set };
