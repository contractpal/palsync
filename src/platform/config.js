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

function writeConfig(config) {
    try {
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
    } catch (e) {
        // Silently fail if we can't write config (e.g. read-only filesystem)
    }
}

function get(key, defaultValue) {
    const config = readConfig();
    return config[key] !== undefined ? config[key] : defaultValue;
}

function set(key, value) {
    const config = readConfig();
    config[key] = value;
    writeConfig(config);
}

module.exports = { get, set };
