"use strict";
// Unlike Windows, Linux AppImages need no code signing at all (no cert, no thumb drive, no
// manual step) - so this script just confirms the artifact exists and prints the upload command,
// rather than staging it somewhere to wait on a human step the way afterWinBuild.js does.
const fs = require("fs");
const path = require("path");

function main() {
    if (process.platform !== "linux") {
        console.log("[afterLinuxBuild] not on Linux - skipping (this step only makes sense on the machine that produced the installer).");
        return;
    }

    const builtAppImagePath = path.join(__dirname, "..", "dist", "ChipPalBuilder.AppImage");
    if (!fs.existsSync(builtAppImagePath)) {
        console.error("[afterLinuxBuild] expected " + builtAppImagePath + " but it doesn't exist - did electron-builder actually produce it?");
        process.exit(1);
    }

    console.log("");
    console.log("=================================================================");
    console.log(" LINUX BUILD READY - no signing needed");
    console.log(" Built: " + builtAppImagePath);
    console.log(" Upload it + a matching linux-versions.txt to S3:");
    console.log(" aws s3 cp " + builtAppImagePath + " s3://contractpal-cloudpiston-downloads/ChipPalBuilder.AppImage");
    console.log("=================================================================");
    console.log("");
}

main();
