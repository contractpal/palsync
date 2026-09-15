"use strict";
// CI-only counterpart to afterLinuxBuild.js/afterWinBuild.js: the local Mac flow (see BUILD.md)
// still writes mac-versions.txt by hand, since it juggles up to 4 files (dmg+zip x2 archs). The
// GitHub Actions Mac workflow only ever produces one file (arm64 zip - see build-mac.yml for why
// x64 and dmg are deliberately out of scope for the first CI pass), so the mapping from "what got
// built" to "what the manifest says" can just be automatic here, same idea as Linux.
const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");

function main() {
    if (process.platform !== "darwin") {
        console.log("[afterMacCiBuild] not on macOS - skipping (this step only makes sense on the machine that produced the installer).");
        return;
    }

    const distDir = path.join(__dirname, "..", "dist");
    const zipFiles = fs.readdirSync(distDir).filter(f => f.endsWith(".zip"));
    if (zipFiles.length === 0) {
        console.error("[afterMacCiBuild] no .zip found in " + distDir + " - did electron-builder actually produce one?");
        process.exit(1);
    }
    if (zipFiles.length > 1) {
        console.error("[afterMacCiBuild] expected exactly one .zip in " + distDir + " but found " + zipFiles.length
            + " (" + zipFiles.join(", ") + ") - this script assumes a single-arch CI build, update it if that's changed.");
        process.exit(1);
    }

    const manifestPath = path.join(distDir, "mac-versions.txt");
    fs.writeFileSync(manifestPath, pkg.version + "\n" + zipFiles[0] + "\n", "utf8");

    console.log("");
    console.log("=================================================================");
    console.log(" MAC (arm64) BUILD READY - signed + notarized zip only");
    console.log(" Built: " + path.join(distDir, zipFiles[0]));
    console.log(" Manifest written: " + manifestPath + " (version " + pkg.version + ")");
    console.log("=================================================================");
    console.log("");
}

main();
