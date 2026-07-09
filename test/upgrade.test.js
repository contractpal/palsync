"use strict";
// Unit tests for `palsync upgrade` — pure, no network. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const pkg = require("../package.json");
const {
    repoSlug,
    installedSha,
    cleanupBrokenGlobalPackage,
    npmInstallSpec,
    manualInstallCommand,
    browserInstallCommand,
    npmInstall,
    installBrowser,
    NPM_INSTALL_FLAGS
} = require("../src/cli/upgradeCommand");

const playwrightInstall = require("../src/install/playwrightChromium");

function capture() {
    const buf = { text: "" };
    return { write: s => { buf.text += s; }, buf };
}

test("repoSlug: derives owner/repo from package.json repository", () => {
    assert.equal(repoSlug(), "contractpal/palsync");
});

test("postinstall: missing Playwright prints the tarball recovery command and fails", () => {
    const out = capture(), err = capture();
    let spawned = false;
    const code = playwrightInstall.run({
        env: {},
        cliPath: () => { throw new Error("Cannot find module 'playwright/package.json'"); },
        spawn: () => { spawned = true; return { status: 0 }; },
        out, err
    });

    assert.equal(code, 1);
    assert.equal(spawned, false, "must not try to launch the browser installer when Playwright is absent");
    assert.match(err.buf.text, /npm install -g https:\/\/codeload\.github\.com\/contractpal\/palsync\/tar\.gz\/refs\/heads\/main/);
    // The recovery command must carry the same flags the auto-upgrade uses, or a user who pastes it
    // gets deps but no Chromium under npm 11's script gating.
    for (const flag of NPM_INSTALL_FLAGS) assert.ok(err.buf.text.includes(flag), "recovery hint missing flag " + flag);
    assert.equal(out.buf.text, "");
});

test("postinstall: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD short-circuits without resolving Playwright", () => {
    const out = capture(), err = capture();
    const code = playwrightInstall.run({
        env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
        cliPath: () => { throw new Error("should not be called"); },
        spawn: () => { throw new Error("should not spawn"); },
        out, err
    });

    assert.equal(code, 0);
    assert.match(out.buf.text, /skipping Chromium install/);
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

test("npmInstallSpec: pins GitHub installs to an immutable tarball URL", () => {
    const sha = "a".repeat(40);
    assert.equal(npmInstallSpec("owner/repo", sha), "https://codeload.github.com/owner/repo/tar.gz/" + sha);
});

test("npmInstall: installs with lifecycle scripts OFF so npm's allow-scripts gate can't block it", () => {
    const sha = "a".repeat(40);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-upgrade-root-"));
    const calls = [];
    const ok = npmInstall("owner/repo", sha, {
        spawn: (cmd, args, opts) => {
            calls.push({ cmd, args, opts });
            if (args.join(" ") === "root -g") return { status: 0, stdout: root + "\n" };
            return { status: 0 };
        }
    });

    assert.equal(ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].cmd, "npm");
    assert.deepEqual(calls[0].args, ["root", "-g"]);
    assert.equal(calls[0].opts.encoding, "utf8");
    assert.equal(calls[0].opts.shell, process.platform === "win32");
    assert.equal(calls[1].cmd, "npm");
    assert.deepEqual(calls[1].args, [
        "install",
        "-g",
        "https://codeload.github.com/owner/repo/tar.gz/" + sha
    ].concat(NPM_INSTALL_FLAGS));
    // Scripts must be off — the strict-allow-scripts gate blocks unallowlisted lifecycle scripts
    // (palsync's postinstall AND transitive native deps), which would abort the whole install.
    assert.ok(calls[1].args.includes("--ignore-scripts"));
    assert.equal(calls[1].opts.stdio, "inherit");
    assert.equal(calls[1].opts.shell, process.platform === "win32");
    fs.rmSync(root, { recursive: true, force: true });
});

test("installBrowser: runs the freshly-installed package's Chromium installer in a fresh node process", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-upgrade-root-"));
    const calls = [];
    const ok = installBrowser("palsync", {
        execPath: "/usr/bin/node",
        spawn: (cmd, args, opts) => {
            calls.push({ cmd, args, opts });
            if (args.join(" ") === "root -g") return { status: 0, stdout: root + "\n" };
            return { status: 0 };
        }
    });

    assert.equal(ok, true);
    assert.equal(calls.length, 2, "resolves the global root, then runs the installer");
    assert.deepEqual(calls[0].args, ["root", "-g"]);
    assert.equal(calls[1].cmd, "/usr/bin/node");
    assert.deepEqual(calls[1].args, [path.join(root, "palsync", "src", "install", "playwrightChromium.js")]);
    assert.equal(calls[1].opts.stdio, "inherit");
    fs.rmSync(root, { recursive: true, force: true });
});

test("installBrowser: reports failure when the browser installer exits non-zero", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-upgrade-root-"));
    const ok = installBrowser("palsync", {
        execPath: "/usr/bin/node",
        spawn: (cmd, args) => (args.join(" ") === "root -g" ? { status: 0, stdout: root + "\n" } : { status: 1 })
    });
    assert.equal(ok, false);
    fs.rmSync(root, { recursive: true, force: true });
});

test("browserInstallCommand: resolves the global palsync installer at paste time", () => {
    assert.equal(browserInstallCommand(), 'node "$(npm root -g)/palsync/src/install/playwrightChromium.js"');
});

test("manualInstallCommand: pairs a scripts-off tarball install with the explicit browser step", () => {
    const sha = "a".repeat(40);
    const cmd = manualInstallCommand("owner/repo", sha);
    assert.match(cmd, /npm install -g https:\/\/codeload\.github\.com\/owner\/repo\/tar\.gz\/a{40} --ignore-scripts --include=optional/);
    assert.ok(cmd.includes(browserInstallCommand()), "must include the browser install step");
});

test("cleanupBrokenGlobalPackage: removes dangling npm git temp symlink", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-upgrade-root-"));
    const entry = path.join(root, "palsync");
    fs.symlinkSync(path.join(os.tmpdir(), "missing-palsync-git-clone"), entry);

    const logs = [];
    const result = cleanupBrokenGlobalPackage("palsync", {
        spawn: (cmd, args, opts) => {
            assert.equal(cmd, "npm");
            assert.deepEqual(args, ["root", "-g"]);
            assert.equal(opts.encoding, "utf8");
            return { status: 0, stdout: root + "\n" };
        },
        log: msg => logs.push(msg)
    });

    assert.equal(result.cleaned, true);
    assert.equal(fs.existsSync(entry), false);
    assert.match(logs[0], /Removed broken global palsync symlink/);
    fs.rmSync(root, { recursive: true, force: true });
});

test("cleanupBrokenGlobalPackage: keeps a real package directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-upgrade-root-"));
    const entry = path.join(root, "palsync");
    fs.mkdirSync(entry);

    const result = cleanupBrokenGlobalPackage("palsync", {
        spawn: () => ({ status: 0, stdout: root + "\n" }),
        log: () => { throw new Error("should not log cleanup"); }
    });

    assert.equal(result.cleaned, false);
    assert.equal(result.reason, "not-symlink");
    assert.equal(fs.statSync(entry).isDirectory(), true);
    fs.rmSync(root, { recursive: true, force: true });
});
