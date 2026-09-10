"use strict";
// Auto-bumps gui/package.json's version before every build, based on conventional-commit
// prefixes (fix(gui): ..., feat(gui): ..., already this repo's own convention) in commits
// touching gui/ since the last auto-bump: any `feat` commit bumps MINOR (and resets patch to 0,
// per semver), else any `fix` commit bumps PATCH. No feat/fix commits since the last bump (e.g.
// rebuilding the same commit twice, or a run with only chore/docs changes) leaves the version
// untouched, so repeat builds never runaway-bump. MAJOR is never touched here - David's own call,
// bumped by hand.
//
// "Since the last bump" is tracked with a git tag (gui-v<version>) rather than an extra state
// file - git's own idiom for this, nothing new to keep in sync. Tags created here are LOCAL
// ONLY: this script never runs `git push`, so nothing is shared until you push tags yourself.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PKG_PATH = path.join(__dirname, "..", "package.json");
const REPO_ROOT = path.join(__dirname, "..", "..");

function git(args) {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function lastBumpTag() {
    try {
        return git(["describe", "--tags", "--match", "gui-v*", "--abbrev=0"]);
    } catch (e) {
        return null; // no prior tag yet
    }
}

function commitsSince(tag) {
    const range = tag ? tag + "..HEAD" : "HEAD";
    let log;
    try {
        log = git(["log", range, "--format=%s", "--", "gui/"]);
    } catch (e) {
        return [];
    }
    return log ? log.split("\n") : [];
}

function classify(messages) {
    const isFeat = m => /^feat(\(.+\))?!?:/.test(m);
    const isFix = m => /^fix(\(.+\))?!?:/.test(m);
    if (messages.some(isFeat)) return "minor";
    if (messages.some(isFix)) return "patch";
    return null;
}

function bump(version, kind) {
    const [major, minor, patch] = version.split(".").map(n => parseInt(n, 10) || 0);
    if (kind === "minor") return major + "." + (minor + 1) + ".0";
    return major + "." + minor + "." + (patch + 1);
}

function main() {
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
    const tag = lastBumpTag();
    const messages = commitsSince(tag);
    const kind = classify(messages);

    if (!kind) {
        console.log("[bumpVersion] no feat/fix commits touching gui/ since " + (tag || "the beginning") + " - keeping " + pkg.version);
        return;
    }

    const oldVersion = pkg.version;
    const newVersion = bump(oldVersion, kind);
    pkg.version = newVersion;
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");

    try {
        git(["tag", "gui-v" + newVersion]);
        console.log("[bumpVersion] " + kind + " bump: " + oldVersion + " -> " + newVersion + " (tagged gui-v" + newVersion + ", local only)");
    } catch (e) {
        console.log("[bumpVersion] " + kind + " bump: " + oldVersion + " -> " + newVersion + " (tag creation failed: " + e.message + ")");
    }
}

main();
