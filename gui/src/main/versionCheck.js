"use strict";
// "New version available" check against CloudPiston's getVersionInfo.do endpoint. No
// auto-updater — this only ever produces a notice + a download link (per the agreed design:
// no auto-update, just "new version available, download here").
const fs = require("fs");
const path = require("path");

const VERSION_ENDPOINT = "https://www.cloudpiston.com/getVersionInfo.do";
// getVersionInfo.do isn't Mac-aware yet (it returns the same Windows .exe URL regardless of the
// `os` param) - that's a server-side gap outside this repo. Mac instead checks this flat text
// manifest directly: line 1 is the version, every line after is a filename served at
// https://downloads.cloudpiston.com/<filename>. Re-uploaded by hand alongside the installers on
// every Mac release (see BUILD.md) - there's no build-time automation for it yet.
const MAC_VERSIONS_URL = "https://downloads.cloudpiston.com/mac-versions.txt";
const DOWNLOADS_BASE = "https://downloads.cloudpiston.com/";

// Build info gets dropped here by the build process (not yet wired up as of this writing —
// {commit, version, date, downloadUrl}, version like "2026.1.1.212"). Its absence just means
// "skip the check" (there's nothing meaningful to compare a dev checkout's version against),
// not an error.
function buildInfoPath() {
    return path.join(__dirname, "..", "..", "build-info.json");
}

function readLocalBuildInfo() {
    try {
        return JSON.parse(fs.readFileSync(buildInfoPath(), "utf8"));
    } catch (e) {
        return null;
    }
}

// "2026.1.1.212" -> [2026,1,1,212]. Non-numeric or empty segments compare as 0 so mismatched
// segment counts don't throw off the comparison.
function parseVersion(v) {
    return String(v).split(".").map(seg => parseInt(seg, 10) || 0);
}

// > 0 if a is newer than b, < 0 if older, 0 if equal.
function compareVersions(a, b) {
    const pa = parseVersion(a), pb = parseVersion(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

function osParam() {
    // Node's own platform names (win32/darwin/linux) — adjust server-side if different tokens
    // are expected there.
    return process.platform;
}

// mac-versions.txt -> {version, files}. Blank/whitespace-only lines are dropped so a trailing
// newline (or one added by hand-editing the file) doesn't become a bogus empty filename.
function parseMacVersions(text) {
    const lines = String(text).split("\n").map(line => line.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const [version, ...files] = lines;
    return { version, files };
}

// Picks the file matching THIS BUILD's own architecture (process.arch — not the host CPU: we
// ship separate arm64/x64 builds, no universal binary, so a user already running the x64 build
// under Rosetta should keep being offered x64, not silently switched), preferring a .dmg (the
// normal double-click installer) over the .zip (electron-builder's own format, not meant for a
// fresh manual download). Falls back to any file of the right kind if the arch match is missing,
// so a manifest edited by hand into a slightly different shape doesn't just come up empty.
function pickMacFile(files, arch) {
    const isArm64Name = f => f.toLowerCase().includes("arm64");
    const archMatches = files.filter(f => (arch === "arm64") === isArm64Name(f));
    const pool = archMatches.length ? archMatches : files;
    return pool.find(f => f.toLowerCase().endsWith(".dmg")) || pool[0] || null;
}

async function checkForMacUpdate(local) {
    let text;
    try {
        const resp = await fetch(MAC_VERSIONS_URL);
        if (!resp.ok) return null;
        text = await resp.text();
    } catch (e) {
        return null; // offline / unreachable — never block or error the launcher over this
    }

    const parsed = parseMacVersions(text);
    if (!parsed) return null;
    if (compareVersions(parsed.version, local.version) <= 0) return null;

    const file = pickMacFile(parsed.files, process.arch);
    if (!file) return null;
    return { localVersion: local.version, remoteVersion: parsed.version, buildDate: null, downloadUrl: DOWNLOADS_BASE + file };
}

async function checkForUpdate() {
    const local = readLocalBuildInfo();
    if (!local || !local.version) return null;

    if (process.platform === "darwin") {
        return checkForMacUpdate(local);
    }

    let text;
    try {
        const url = VERSION_ENDPOINT + "?ide=chip&os=" + encodeURIComponent(osParam());
        const resp = await fetch(url);
        if (!resp.ok) return null;
        text = (await resp.text()).trim();
    } catch (e) {
        return null; // offline / unreachable — never block or error the launcher over this
    }

    const parts = text.split("|");
    if (parts.length < 4) return null;
    const [, remoteVersion, buildDate, downloadUrl] = parts;

    if (compareVersions(remoteVersion, local.version) <= 0) return null;
    return { localVersion: local.version, remoteVersion, buildDate, downloadUrl };
}

module.exports = {
    checkForUpdate, compareVersions, parseVersion, buildInfoPath, readLocalBuildInfo,
    checkForMacUpdate, parseMacVersions, pickMacFile
};
