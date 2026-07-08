"use strict";
// Install the browser binary palsync actually drives. The npm `playwright` package is the JS
// dependency; Chromium is a downloaded runtime asset, so keep it attached to install/upgrade too.
const { spawnSync } = require("child_process");
const path = require("path");
const { repoSlug, manualInstallCommand } = require("../cli/upgradeCommand");

function playwrightCliPath() {
    const pkgPath = require.resolve("playwright/package.json");
    const pkg = require(pkgPath);
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin && pkg.bin.playwright;
    return path.join(path.dirname(pkgPath), bin || "cli.js");
}

// The one failure mode that isn't a real environment problem: npm installed palsync through its
// git path (`npm install -g github:<slug>` — what pre-tarball `palsync upgrade` versions ran),
// which links the package straight out of npm's cache and never places its dependencies. Playwright
// is then unresolvable and this whole install is broken, not just the browser. The fix is always the
// same — reinstall from the immutable branch tarball, which npm treats as a normal dep install.
function tarballRecoveryHint() {
    return "palsync postinstall: Playwright is missing — npm installed palsync via its git path, which\n"
        + "does not install dependencies. Reinstall from the tarball instead:\n\n"
        + "    " + manualInstallCommand(repoSlug(), "refs/heads/main") + "\n";
}

function run({ spawn = spawnSync, cliPath = playwrightCliPath, env = process.env, out = process.stdout, err = process.stderr } = {}) {
    if (env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
        out.write("palsync postinstall: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set; skipping Chromium install.\n");
        return 0;
    }

    let cli;
    try {
        cli = cliPath();
    } catch (e) {
        err.write(tarballRecoveryHint());
        return 1;
    }

    out.write("palsync postinstall: installing Playwright Chromium browser...\n");
    const r = spawn(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
    if (r.error) {
        err.write("palsync postinstall: could not run Playwright installer: " + r.error.message + "\n");
        return 1;
    }
    return r.status === null ? 1 : r.status;
}

if (require.main === module) process.exit(run());

module.exports = { playwrightCliPath, tarballRecoveryHint, run };
