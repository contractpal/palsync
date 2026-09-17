"use strict";
// CI-only counterpart to afterWinBuild.js/afterLinuxBuild.js/afterMacCiBuild.js. The local
// Windows flow (afterWinBuild.js) stages the unsigned exe to C:\build for a human to sign by
// hand with the thumb-drive cert - not applicable in CI, where build-win.yml signs the exe
// itself via Azure Artifact Signing right after this script runs. This just writes
// windows-versions.txt next to the exe, generated from THIS build's own just-bumped
// package.json version so it can never drift from what was actually built - same idea as
// Linux/Mac's CI manifest writers.
const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");

function main() {
    if (process.platform !== "win32") {
        console.log("[afterWinCiBuild] not on Windows - skipping (this step only makes sense on the machine that produced the installer).");
        return;
    }

    const distDir = path.join(__dirname, "..", "dist");
    const builtExePath = path.join(distDir, "ChipPalBuilder.exe");
    if (!fs.existsSync(builtExePath)) {
        console.error("[afterWinCiBuild] expected " + builtExePath + " but it doesn't exist - did electron-builder actually produce it?");
        process.exit(1);
    }

    const manifestPath = path.join(distDir, "windows-versions.txt");
    fs.writeFileSync(manifestPath, pkg.version + "\nChipPalBuilder.exe\n", "utf8");

    console.log("");
    console.log("=================================================================");
    console.log(" WINDOWS BUILD READY (unsigned) - build-win.yml signs it next via Azure Artifact Signing");
    console.log(" Built: " + builtExePath);
    console.log(" Manifest written: " + manifestPath + " (version " + pkg.version + ")");
    console.log("=================================================================");
    console.log("");
}

main();
