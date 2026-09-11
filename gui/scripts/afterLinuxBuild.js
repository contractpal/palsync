"use strict";
// Unlike Windows, Linux AppImages need no code signing at all (no cert, no thumb drive, no
// manual step) - so there's nothing to stage for a human signing pass. This step also writes
// linux-versions.txt right next to the AppImage (David's ask, 2026-09-11: the publish step
// should always happen automatically on a successful build, not be a hand-typed afterthought) -
// the exact flat format versionCheck.js's checkForLinuxUpdate expects (version on line 1, one
// filename per line after), generated from THIS build's own just-bumped package.json version so
// it can never drift from what was actually built. Uploading these two files to S3 and shutting
// down the build VM still happens from the machine you actually run the upload from (BUILD.md's
// existing convention, matching Windows) - not from here, since this script only ever runs
// inside the VM itself.
const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");

function main() {
    if (process.platform !== "linux") {
        console.log("[afterLinuxBuild] not on Linux - skipping (this step only makes sense on the machine that produced the installer).");
        return;
    }

    const distDir = path.join(__dirname, "..", "dist");
    const builtAppImagePath = path.join(distDir, "ChipPalBuilder.AppImage");
    if (!fs.existsSync(builtAppImagePath)) {
        console.error("[afterLinuxBuild] expected " + builtAppImagePath + " but it doesn't exist - did electron-builder actually produce it?");
        process.exit(1);
    }

    const manifestPath = path.join(distDir, "linux-versions.txt");
    fs.writeFileSync(manifestPath, pkg.version + "\nChipPalBuilder.AppImage\n", "utf8");

    console.log("");
    console.log("=================================================================");
    console.log(" LINUX BUILD READY - no signing needed");
    console.log(" Built: " + builtAppImagePath);
    console.log(" Manifest written: " + manifestPath + " (version " + pkg.version + ")");
    console.log(" Copy both files to the upload machine, then:");
    console.log(" aws s3 cp " + builtAppImagePath + " s3://contractpal-cloudpiston-downloads/ChipPalBuilder.AppImage");
    console.log(" aws s3 cp " + manifestPath + " s3://contractpal-cloudpiston-downloads/linux-versions.txt");
    console.log(" Then shut down the build VM.");
    console.log("=================================================================");
    console.log("");
}

main();
