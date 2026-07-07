"use strict";
// Unit tests for `palsync upgrade` — pure, no network. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const pkg = require("../package.json");
const { repoSlug, installedSha, npmInstall, NPM_INSTALL_FLAGS } = require("../src/cli/upgradeCommand");

test("repoSlug: derives owner/repo from package.json repository", () => {
    assert.equal(repoSlug(), "contractpal/palsync");
});

test("installedSha: null when no SHA stamp is present (dev clone / first run)", () => {
    // A dev clone has no .installed-sha stamp, so it reports unknown — which makes the first
    // `palsync upgrade` reinstall and write the stamp, after which it no-ops when current.
    assert.equal(installedSha(path.join(os.tmpdir(), "palsync-missing-installed-sha")), null);
});

test("package installs Playwright as a required runtime dependency", () => {
    assert.match(pkg.dependencies.playwright, /^\^/);
    assert.equal(pkg.optionalDependencies && pkg.optionalDependencies.playwright, undefined);
    assert.match(pkg.scripts.postinstall, /playwrightChromium\.js/);
});

test("npmInstall: upgrades with dependency and lifecycle scripts enabled", () => {
    const sha = "a".repeat(40);
    const calls = [];
    const ok = npmInstall("owner/repo", sha, {
        spawn: (cmd, args, opts) => {
            calls.push({ cmd, args, opts });
            return { status: 0 };
        }
    });

    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, "npm");
    assert.deepEqual(calls[0].args, ["install", "-g", "github:owner/repo#" + sha].concat(NPM_INSTALL_FLAGS));
    assert.equal(calls[0].opts.stdio, "inherit");
    assert.equal(calls[0].opts.shell, process.platform === "win32");
});
