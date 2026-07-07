"use strict";
// Install the browser binary palsync actually drives. The npm `playwright` package is the JS
// dependency; Chromium is a downloaded runtime asset, so keep it attached to install/upgrade too.
const { spawnSync } = require("child_process");
const path = require("path");

function playwrightCliPath() {
    const pkgPath = require.resolve("playwright/package.json");
    const pkg = require(pkgPath);
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin && pkg.bin.playwright;
    return path.join(path.dirname(pkgPath), bin || "cli.js");
}

function run() {
    if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
        process.stdout.write("palsync postinstall: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set; skipping Chromium install.\n");
        return 0;
    }

    let cli;
    try {
        cli = playwrightCliPath();
    } catch (e) {
        process.stderr.write("palsync postinstall: Playwright is missing; npm did not install package dependencies.\n");
        return 1;
    }

    process.stdout.write("palsync postinstall: installing Playwright Chromium browser...\n");
    const r = spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
    if (r.error) {
        process.stderr.write("palsync postinstall: could not run Playwright installer: " + r.error.message + "\n");
        return 1;
    }
    return r.status === null ? 1 : r.status;
}

if (require.main === module) process.exit(run());

module.exports = { playwrightCliPath, run };
