"use strict";
// Windows can't sign automatically the way the Mac build does (Developer ID cert in the
// keychain + Apple ID env vars) - the code-signing cert lives on a thumb drive that
// deliberately never touches the build machine (see BUILD.md). So this step ends the automated
// part of the pipeline: copy the freshly built, still-unsigned installer to a fixed staging
// path and print an explicit notice, rather than silently leaving it sitting in gui/dist where
// it's easy to forget it still needs a manual signing pass before anyone runs it.
//
// Deliberately a plain console message, not an OS toast/notification - this script only ever
// runs interactively, in the same terminal the person doing the release is already watching (an
// IntelliJ run configuration, per David's own workflow), so there's nothing extra to wire up.
const fs = require("fs");
const path = require("path");

const SIGN_STAGING_PATH = "C:\\build\\ChipPalBuilder.exe";

function main() {
    if (process.platform !== "win32") {
        console.log("[afterWinBuild] not on Windows - skipping the sign-staging copy (this step only makes sense on the machine that produced the installer).");
        return;
    }

    const builtExePath = path.join(__dirname, "..", "dist", "ChipPalBuilder.exe");
    if (!fs.existsSync(builtExePath)) {
        console.error("[afterWinBuild] expected " + builtExePath + " but it doesn't exist - did electron-builder actually produce it?");
        process.exit(1);
    }

    fs.mkdirSync(path.dirname(SIGN_STAGING_PATH), { recursive: true });
    fs.copyFileSync(builtExePath, SIGN_STAGING_PATH);

    console.log("");
    console.log("=================================================================");
    console.log(" MANUAL SIGNING NEEDED");
    console.log(" Unsigned build copied to: " + SIGN_STAGING_PATH);
    console.log(" Plug in the signing thumb drive and sign that file now.");
    console.log(" Once signed, upload it + a matching windows-versions.txt to S3.");
    console.log("=================================================================");
    console.log("");
}

main();
