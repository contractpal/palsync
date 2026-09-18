"use strict";
// Simple file-backed configuration store for user preferences that aren't sensitive (like
// credentials). Stored in ~/.palsync/config.json.
const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG_DIR = path.join(os.homedir(), ".palsync");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function readConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) return {};
        const data = fs.readFileSync(CONFIG_FILE, "utf8");
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

// Returns true when the file was written. Callers may ignore it (a preference that can't be
// saved is not worth failing a launch over) — but the recent-pal history reports it, so a
// read-only home is at least diagnosable instead of silently losing history.
function writeConfig(config) {
    try {
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
        return true;
    } catch (e) {
        // Fail quietly if we can't write config (e.g. read-only filesystem)
        return false;
    }
}

function get(key, defaultValue) {
    const config = readConfig();
    return config[key] !== undefined ? config[key] : defaultValue;
}

function set(key, value) {
    const config = readConfig();
    config[key] = value;
    return writeConfig(config);
}

module.exports = { get, set };
