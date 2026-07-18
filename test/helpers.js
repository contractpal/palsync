"use strict";
// Shared test helper: create a temp workspace dir and write fixture files into it.
// `files` maps relative paths to contents; parent dirs are created as needed.
// Callers own cleanup (fs.rmSync(dir, { recursive: true, force: true })), matching
// the existing inline pattern in these tests.
const fs = require("fs");
const os = require("os");
const path = require("path");

function tmpWorkspace(files = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-test-"));
    for (const rel of Object.keys(files)) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, files[rel]);
    }
    return dir;
}

function parseEnvelope(text) {
    const lines = String(text).split("\n");
    const trailer = lines.pop();
    if (!/^Full result: .+$/.test(trailer || "")) throw new Error("Missing final Full result trailer");
    return { envelope: JSON.parse(lines.join("\n")), trailer };
}

module.exports = { tmpWorkspace, parseEnvelope };
