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

// Resolves the exact same playwright package instance playwrightCliPath() uses (relative to
// THIS file's own location within the palsync package), rather than a bare `require("playwright")`
// from an unrelated caller's location. Confirmed live 2026-09-15: Chip's GUI (a separate package
// that depends on palsync) had its own bare `require("playwright")` in dependencyCheck.js, which
// resolves relative to ITS OWN file location - inside a packaged Electron app, only the copy
// nested under node_modules/palsync/node_modules/playwright actually ships in app.asar (electron-
// builder's own default `files` inclusion never picks up a separate, gui-hoisted top-level copy),
// so that bare require threw MODULE_NOT_FOUND on every real installed copy, silently caught and
// reported as "Chromium not installed" even right after a successful install (which itself
// succeeded, via this file's own correctly-resolving playwrightCliPath()). This existed
// undetected because the same bug happened to look fine when tested by building and running in
// place inside this exact repo checkout, where Node's module resolution falls through past the
// asar boundary to a real, incidentally-nearby gui/node_modules/playwright on disk - something no
// real installed copy would ever have.
function resolvePlaywright() {
    const pkgPath = require.resolve("playwright/package.json");
    return require(path.dirname(pkgPath));
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

module.exports = { playwrightCliPath, resolvePlaywright, tarballRecoveryHint, run };
