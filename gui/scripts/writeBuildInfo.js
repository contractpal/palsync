"use strict";
// Generates gui/build-info.json - the LOCAL half of versionCheck.js's "new version available"
// check. Until this script existed, nothing ever wrote this file (it was referenced in
// package.json's build.files and read by versionCheck.js, but never produced), so
// readLocalBuildInfo() always returned null and the whole update-check feature was silently
// dead on every platform. Run before electron-builder packages (see build:mac/build:win in
// package.json), so the file exists on disk in time to match that files pattern.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const pkg = require("../package.json");

function gitCommit() {
    try {
        return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim();
    } catch (e) {
        return null; // not a git checkout (e.g. a CI source archive) - omitted, not fatal
    }
}

const buildInfo = {
    commit: gitCommit(),
    version: pkg.version,
    date: new Date().toISOString(),
};

fs.writeFileSync(path.join(__dirname, "..", "build-info.json"), JSON.stringify(buildInfo, null, 2) + "\n");
console.log("[writeBuildInfo] wrote build-info.json: " + JSON.stringify(buildInfo));
