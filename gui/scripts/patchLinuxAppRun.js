"use strict";
// Post-build fix for the Linux CI build: bakes ELECTRON_DISABLE_SANDBOX=1 into the AppImage's own
// AppRun launcher script. Confirmed live 2026-09-15 (real SSH session into an Ubuntu 24.04
// machine): the packaged app FATAL-aborts on every launch ("The SUID sandbox helper binary was
// found, but is not configured correctly") because chrome-sandbox can never be root-owned+setuid
// for a self-extracting AppImage - true regardless of any fix attempted from inside the app's own
// JS. Proved this precisely: added a debug print as the literal first line of index.js and it
// NEVER printed before the crash, meaning the failure happens in Electron's native bootstrap
// before the app's own main script gets a chance to run at all - so app.commandLine.appendSwitch,
// setting process.env, and even a self-relaunch-with-env-set pattern were all confirmed NOT to
// work (tested each directly). The only place that runs early enough is AppRun itself (a plain
// bash script electron-builder generates as part of the AppImage), which this patches after the
// fact by extracting the built .AppImage, editing AppRun, and repackaging with appimagetool -
// confirmed this exact one-line AppRun change fixes the launch completely, on the same machine.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// Matches the exact line electron-builder's AppImage template currently emits - if this ever
// changes upstream, this script fails loudly (see the throw below) rather than silently
// producing an AppImage that's still missing the fix.
const ANCHOR = 'export GSETTINGS_SCHEMA_DIR="${APPDIR}/usr/share/glib-2.0/schemas:${GSETTINGS_SCHEMA_DIR}"';
const EXPORT_LINE = "export ELECTRON_DISABLE_SANDBOX=1";

function findAppImage() {
    const distDir = path.join(__dirname, "..", "dist");
    const files = fs.readdirSync(distDir).filter(f => f.endsWith(".AppImage"));
    if (files.length !== 1) {
        throw new Error("[patchLinuxAppRun] expected exactly one .AppImage in " + distDir +
            " but found " + files.length + " (" + files.join(", ") + ")");
    }
    return path.join(distDir, files[0]);
}

function main() {
    if (process.platform !== "linux") {
        console.log("[patchLinuxAppRun] not on Linux - skipping.");
        return;
    }

    const appImagePath = findAppImage();
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-appimage-"));

    console.log("[patchLinuxAppRun] extracting " + appImagePath);
    // --appimage-extract needs no FUSE (unlike a normal launch) - safe on any CI runner regardless
    // of whether FUSE is available there.
    execFileSync(appImagePath, ["--appimage-extract"], { cwd: extractDir, stdio: "inherit" });
    const squashfsRoot = path.join(extractDir, "squashfs-root");
    const appRunPath = path.join(squashfsRoot, "AppRun");

    let appRun = fs.readFileSync(appRunPath, "utf8");
    if (appRun.includes("ELECTRON_DISABLE_SANDBOX")) {
        console.log("[patchLinuxAppRun] AppRun already patched - nothing to do.");
        return;
    }
    if (!appRun.includes(ANCHOR)) {
        throw new Error("[patchLinuxAppRun] expected anchor line not found in AppRun - " +
            "electron-builder's generated template may have changed; update ANCHOR in this script.");
    }
    appRun = appRun.replace(ANCHOR, ANCHOR + "\n" + EXPORT_LINE);
    fs.writeFileSync(appRunPath, appRun, "utf8");
    console.log("[patchLinuxAppRun] patched AppRun: " + EXPORT_LINE);

    console.log("[patchLinuxAppRun] repackaging via appimagetool");
    fs.rmSync(appImagePath, { force: true });
    execFileSync("appimagetool", [squashfsRoot, appImagePath], {
        stdio: "inherit",
        env: Object.assign({}, process.env, { ARCH: "x86_64" })
    });

    const stat = fs.statSync(appImagePath);
    if (stat.size < 10 * 1024 * 1024) {
        throw new Error("[patchLinuxAppRun] repackaged AppImage looks too small (" + stat.size +
            " bytes) - something went wrong during repackaging.");
    }
    fs.chmodSync(appImagePath, 0o755);
    console.log("[patchLinuxAppRun] OK - " + appImagePath + " (" + stat.size + " bytes)");

    fs.rmSync(extractDir, { recursive: true, force: true });
}

main();
