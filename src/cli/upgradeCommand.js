"use strict";
// `palsync upgrade` — self-update to the LATEST commit on the repo's default branch.
//
// Why a commit SHA (not a branch name or a tag): npm re-uses cached resolution of the default
// branch, so a plain reinstall often silently keeps the old build. A SHA-pinned GitHub tarball is
// immutable and avoids npm's git-dependency preparation path, which can trip over global installs.
//
// Flow: read the SHA this build was installed from → fetch the default branch's HEAD SHA from the
// GitHub API → if they differ (or ours is unknown), run `npm install -g <sha-pinned tarball>`
// (inherits the user's npm prefix). `--check` reports without installing.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const pkg = require("../../package.json");
const NPM_INSTALL_FLAGS = ["--ignore-scripts=false", "--include=optional", "--allow-scripts=palsync"];

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

// The exact command a user can paste to reinstall/recover by hand. Includes the same flags the
// automated upgrade uses — notably --allow-scripts=palsync, which npm 11 now requires or it silently
// skips the postinstall and never downloads the Chromium binary palsync drives.
function manualInstallCommand(slug, sha) {
    return "npm install -g " + npmInstallSpec(slug, sha) + " " + NPM_INSTALL_FLAGS.join(" ");
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
    console.log("Upgraded to " + latest.slice(0, 7) + ". (New shell or `hash -r` if `palsync --version` looks stale.)");
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
    npmInstall,
    NPM_INSTALL_FLAGS
};
