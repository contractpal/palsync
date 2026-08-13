"use strict";
// `palsync upgrade` — self-update to the LATEST commit on the repo's default branch.
//
// Why a commit SHA (not a branch name or a tag): npm re-uses cached resolution of the default
// branch, so a plain reinstall often silently keeps the old build. A SHA-pinned GitHub tarball is
// immutable and avoids npm's git-dependency preparation path, which can trip over global installs.
//
// Flow: read the SHA this build was installed from → fetch the default branch's HEAD SHA from the
// GitHub API → if they differ (or ours is unknown), run `npm install -g <sha-pinned tarball>`
// (inherits the user's npm prefix), then fetch the Chromium binary explicitly (see installBrowser).
// `--check` reports without installing.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const pkg = require("../../package.json");

// Install with scripts OFF, then run palsync's own browser install explicitly (see installBrowser).
// Why not let npm fire the postinstall: npm 11's `strict-allow-scripts` (opt-in today, trending
// toward default) BLOCKS any lifecycle script not in an allowlist — and the blocker isn't just
// palsync's postinstall but every transitive native dep (fsevents, node-gyp rebuilds, …), whose set
// varies by platform. `--allow-scripts=palsync` can't cover them, so the whole install aborts with
// ESTRICTALLOWSCRIPTS. `--ignore-scripts` sidesteps the gate entirely and installs cleanly under any
// npm config; the browser — the one script we actually need — we run ourselves afterward.
const NPM_INSTALL_FLAGS = ["--ignore-scripts", "--include=optional"];

// npm strips _resolved/gitHead from installed git packages and keeps no global lockfile, so the
// only durable record of which commit this build came from is one we write ourselves: after a
// successful install we stamp the SHA here. npm wipes the package dir on each reinstall, so the
// file is recreated every upgrade and can't go stale.
const SHA_STAMP = path.join(__dirname, "..", "..", ".installed-sha");

// Owner/repo from package.json repository (any GitHub URL form), else a sane default.
function repoSlug() {
    const url = pkg.repository && (typeof pkg.repository === "string" ? pkg.repository : pkg.repository.url) || "";
    const m = String(url).match(/github\.com[/:]([^/]+\/[^/.]+)/i);
    return m ? m[1] : "contractpal/palsync";
}

// The commit this build was installed from, read from the stamp a prior `palsync upgrade` wrote.
// null on the first run after a manual `npm install` (no stamp yet) or in a dev clone — which makes
// upgrade reinstall once and then stamp, after which it correctly no-ops when current.
function installedSha(stampPath = SHA_STAMP) {
    try {
        const s = fs.readFileSync(stampPath, "utf8").trim().toLowerCase();
        return /^[0-9a-f]{40}$/.test(s) ? s : null;
    } catch { return null; }
}

// HEAD SHA of the repo's default branch. Accept: …sha makes the API return the bare SHA as text.
async function fetchLatestSha(slug) {
    const res = await fetch("https://api.github.com/repos/" + slug + "/commits/HEAD", {
        headers: { "User-Agent": "palsync-upgrade", "Accept": "application/vnd.github.sha" }
    });
    if (!res.ok) throw new Error("GitHub API " + res.status + " for " + slug + " (rate-limited? try again later)");
    const sha = (await res.text()).trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("unexpected response from GitHub (no commit SHA)");
    return sha;
}

function npmGlobalRoot({ spawn = spawnSync } = {}) {
    const useShell = process.platform === "win32";
    const r = spawn("npm", ["root", "-g"], { encoding: "utf8", shell: useShell });
    if (r.status !== 0) return null;
    const stdout = r.stdout === undefined || r.stdout === null ? "" : String(r.stdout);
    return stdout.trim().split(/\r?\n/).filter(Boolean).pop() || null;
}

function cleanupBrokenGlobalPackage(name = pkg.name, { spawn = spawnSync, fsMod = fs, log = console.warn } = {}) {
    const root = npmGlobalRoot({ spawn });
    if (!root) return { cleaned: false, reason: "unknown-npm-root" };

    const entry = path.join(root, name);
    let stat;
    try { stat = fsMod.lstatSync(entry); }
    catch { return { cleaned: false, root, entry, reason: "missing" }; }
    if (!stat.isSymbolicLink()) return { cleaned: false, root, entry, reason: "not-symlink" };

    let target = "";
    try { target = fsMod.readlinkSync(entry); } catch { /* best effort for diagnostics */ }
    try {
        fsMod.realpathSync(entry);
        return { cleaned: false, root, entry, target, reason: "live-symlink" };
    } catch (e) {
        if (!e || (e.code !== "ENOENT" && e.code !== "ENOTDIR")) {
            return { cleaned: false, root, entry, target, reason: e && e.code || "realpath-failed" };
        }
    }

    fsMod.unlinkSync(entry);
    if (log) log("Removed broken global " + name + " symlink: " + entry + (target ? " -> " + target : ""));
    return { cleaned: true, root, entry, target };
}

function npmInstallSpec(slug, sha) {
    const safeSlug = String(slug).split("/").map(encodeURIComponent).join("/");
    return "https://codeload.github.com/" + safeSlug + "/tar.gz/" + sha;
}

// A copy-pasteable command that runs palsync's browser install against the globally-installed
// package. Resolved at paste time via `npm root -g` so it works regardless of the user's npm prefix.
function browserInstallCommand() {
    return 'node "$(npm root -g)/' + pkg.name + '/src/install/playwrightChromium.js"';
}

// The exact commands a user can paste to reinstall/recover by hand — the same two steps the
// automated upgrade runs: install with scripts off (works under any npm config), then fetch the
// Chromium binary palsync drives (npm's script gate never runs it, so we always run it ourselves).
function manualInstallCommand(slug, sha) {
    return "npm install -g " + npmInstallSpec(slug, sha) + " " + NPM_INSTALL_FLAGS.join(" ")
        + "\n    " + browserInstallCommand();
}

function npmInstall(slug, sha, { spawn = spawnSync, fsMod = fs, log = console.warn } = {}) {
    // npm can leave git global installs as dangling links into ~/.npm/_cacache/tmp/git-clone*
    // after a failed/interrupted upgrade. Its next rename then fails with ENOTDIR before install.
    cleanupBrokenGlobalPackage(pkg.name, { spawn, fsMod, log });
    const spec = npmInstallSpec(slug, sha);
    const useShell = process.platform === "win32";
    const r = spawn("npm", ["install", "-g", spec].concat(NPM_INSTALL_FLAGS), { stdio: "inherit", shell: useShell });
    return r.status === 0;
}

// Run the browser install for the freshly-installed global palsync. We install with --ignore-scripts
// (so the install itself can't be blocked by npm's allow-scripts gate), which means the postinstall
// never fired — so we fetch Chromium here, in a fresh node process pointed at the newly-written
// script on disk (not this old, about-to-be-replaced process's copy). Respects
// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD via the script itself. Returns true on success.
function installBrowser(name = pkg.name, { spawn = spawnSync, execPath = process.execPath } = {}) {
    const root = npmGlobalRoot({ spawn });
    if (!root) return false;
    const script = path.join(root, name, "src", "install", "playwrightChromium.js");
    const r = spawn(execPath, [script], { stdio: "inherit" });
    return r.status === 0;
}

// argv = args after "upgrade". Returns an exit code.
async function run(argv) {
    const check = argv.includes("--check");
    const slug = repoSlug();
    const installed = installedSha();
    console.log("palsync " + pkg.version + "  (" + slug + (installed ? "@" + installed.slice(0, 7) : "") + ")");

    let latest;
    try {
        latest = await fetchLatestSha(slug);
    } catch (e) {
        console.error("Could not check for updates: " + e.message);
        return 1;
    }

    if (installed && installed === latest) {
        console.log("Already up to date (latest is " + latest.slice(0, 7) + ").");
        return 0;
    }

    console.log("Update available: " + (installed ? installed.slice(0, 7) : "unknown") + " -> " + latest.slice(0, 7));
    if (check) {
        console.log("Run `palsync upgrade` to install " + npmInstallSpec(slug, latest));
        return 0;
    }
    console.log("Installing " + npmInstallSpec(slug, latest) + " …");
    const ok = npmInstall(slug, latest);
    if (!ok) {
        console.error("npm install failed. Install manually:  " + manualInstallCommand(slug, latest));
        return 1;
    }
    // Stamp the freshly-installed dir (npm just rewrote it) so the next run knows it's current.
    try { fs.writeFileSync(SHA_STAMP, latest + "\n"); } catch { /* best effort; falls back to reinstall-each-time */ }

    // We installed with scripts off, so fetch the Chromium binary palsync drives ourselves. Best
    // effort: the CLI is already updated and Chromium is often cached, so a download hiccup shouldn't
    // fail the version bump — but tell the user exactly how to finish if it didn't complete.
    if (!installBrowser()) {
        console.error("palsync updated, but the Chromium browser install did not finish. Complete it with:\n    " + browserInstallCommand());
    }
    console.log("Upgraded to " + latest.slice(0, 7) + ". (New shell or `hash -r` if `palsync --version` looks stale.)");
    // Workspaces keep their own .claude/settings.json hook entries; the pinned commands are only
    // refreshed by a relaunch or by `palsync hooks repair`. This hint rides along on upgrades so
    // the recovery surface is discoverable (the first upgrade from an old build runs old code, so
    // it only prints on later upgrades — README.md carries the same guidance).
    console.log("Claude Code workspaces: run `palsync hooks check`, then `palsync hooks repair`, in each workspace to refresh stale hook commands.");
    return 0;
}

module.exports = {
    run,
    repoSlug,
    installedSha,
    fetchLatestSha,
    npmGlobalRoot,
    cleanupBrokenGlobalPackage,
    npmInstallSpec,
    manualInstallCommand,
    browserInstallCommand,
    npmInstall,
    installBrowser,
    NPM_INSTALL_FLAGS
};
