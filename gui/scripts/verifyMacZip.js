"use strict";
// Post-build safety net for the Mac CI workflow (build-mac.yml), run AFTER signing/notarization/
// zipping, right before the artifact gets uploaded/published. afterPack.js's own integrity check
// (see its comments) only proves app.asar was intact at that point in the pipeline - signing,
// notarization, and zipping all touch the artifact afterward, so this checks the actual file
// about to ship, not an earlier intermediate state. Confirmed live 2026-09-15: a build with a
// corrupted app.asar (root package.json all 0x00 bytes) shipped all the way to a downloaded,
// installed artifact before anyone noticed - this exists so that failure mode fails the CI job
// loudly instead.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { safeExtractAll, findZeroedFile, verifyPackageJsonReadable } = require("./asarIntegrity");

function findZipInDist() {
    const distDir = path.join(__dirname, "..", "dist");
    const zips = fs.readdirSync(distDir).filter(f => f.endsWith(".zip"));
    if (zips.length !== 1) {
        throw new Error("expected exactly one .zip in " + distDir + " but found " + zips.length +
            " (" + zips.join(", ") + ") - pass the path explicitly if that's expected.");
    }
    return path.join(distDir, zips[0]);
}

function main() {
    if (process.platform !== "darwin") {
        console.log("[verifyMacZip] not on macOS - skipping (this only makes sense on the machine that built the zip).");
        return;
    }

    const zipPath = process.argv[2] || findZipInDist();
    console.log("[verifyMacZip] checking " + zipPath);

    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-mac-zip-"));
    const asarVerifyDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-mac-asar-"));
    try {
        // ditto (not unzip) preserves symlinks/metadata correctly inside a .app bundle - the same
        // tool BUILD.md's own manual verification steps use.
        execFileSync("ditto", ["-x", "-k", zipPath, extractDir]);

        const appDirs = fs.readdirSync(extractDir).filter(f => f.endsWith(".app"));
        if (appDirs.length !== 1) {
            throw new Error("expected exactly one .app inside " + zipPath + " but found " + appDirs.length);
        }
        const asarPath = path.join(extractDir, appDirs[0], "Contents", "Resources", "app.asar");
        if (!fs.existsSync(asarPath)) {
            throw new Error("no app.asar found at " + asarPath + " - asar:false build?");
        }

        safeExtractAll(asarPath, asarVerifyDir, { skipJunk: true });

        const zeroed = findZeroedFile(asarVerifyDir);
        if (zeroed) {
            throw new Error("integrity check failed: " + path.relative(asarVerifyDir, zeroed) +
                " in " + zipPath + "'s app.asar is entirely 0x00 bytes");
        }
        if (!verifyPackageJsonReadable(asarVerifyDir)) {
            throw new Error("integrity check failed: " + zipPath + "'s app.asar package.json is not valid JSON");
        }

        console.log("[verifyMacZip] OK - app.asar has no zero-byte corruption, package.json is valid.");
    } finally {
        fs.rmSync(extractDir, { recursive: true, force: true });
        fs.rmSync(asarVerifyDir, { recursive: true, force: true });
    }
}

main();
