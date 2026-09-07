"use strict";
// "New version available" check against CloudPiston's getVersionInfo.do endpoint. No
// auto-updater — this only ever produces a notice + a download link (per the agreed design:
// no auto-update, just "new version available, download here").
const fs = require("fs");
const path = require("path");

const VERSION_ENDPOINT = "https://www.cloudpiston.com/getVersionInfo.do";

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

async function checkForUpdate() {
    const local = readLocalBuildInfo();
    if (!local || !local.version) return null;

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

module.exports = { checkForUpdate, compareVersions, parseVersion, buildInfoPath, readLocalBuildInfo };
