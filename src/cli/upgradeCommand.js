"use strict";
// `palsync upgrade` — self-update to the latest GitHub release TAG.
//
// Why tags: `npm install -g github:<repo>` re-uses npm's cached resolution of the default branch,
// so a plain reinstall often silently keeps the old build. Installing an IMMUTABLE tag
// (github:<repo>#vX.Y.Z) is a fresh ref npm hasn't cached, so the update actually lands.
//
// Flow: read current version → fetch tags from the GitHub API → pick the highest semver tag →
// if newer, run `npm install -g github:<repo>#<tag>` (inherits the user's npm prefix). `--check`
// reports without installing.
const { spawnSync } = require("child_process");
const pkg = require("../../package.json");

// Owner/repo from package.json repository (any GitHub URL form), else a sane default.
function repoSlug() {
    const url = pkg.repository && (typeof pkg.repository === "string" ? pkg.repository : pkg.repository.url) || "";
    const m = String(url).match(/github\.com[/:]([^/]+\/[^/.]+)/i);
    return m ? m[1] : "contractpal/palsync";
}

function parseSemver(s) {
    const m = String(s).trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// >0 if a newer than b, <0 if older, 0 if equal. Unparseable sorts lowest.
function cmpSemver(a, b) {
    const pa = parseSemver(a), pb = parseSemver(b);
    if (!pa) return pb ? -1 : 0;
    if (!pb) return 1;
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
}

// Highest semver tag name from a GitHub /tags response array. Returns null if none parse.
function pickLatestTag(tags) {
    const named = (tags || []).map(t => t && t.name).filter(n => parseSemver(n));
    if (!named.length) return null;
    return named.sort((a, b) => cmpSemver(b, a))[0];
}

async function fetchTags(slug) {
    const res = await fetch("https://api.github.com/repos/" + slug + "/tags?per_page=100", {
        headers: { "User-Agent": "palsync-upgrade", "Accept": "application/vnd.github+json" }
    });
    if (!res.ok) throw new Error("GitHub API " + res.status + " for " + slug + " (rate-limited? try again later)");
    return res.json();
}

function npmInstall(slug, tag) {
    const spec = "github:" + slug + "#" + tag;
    const useShell = process.platform === "win32";
    const r = spawnSync("npm", ["install", "-g", spec], { stdio: "inherit", shell: useShell });
    return r.status === 0;
}

// argv = args after "upgrade". Returns an exit code.
async function run(argv) {
    const check = argv.includes("--check");
    const slug = repoSlug();
    const current = pkg.version;
    console.log("palsync " + current + "  (" + slug + ")");

    let latest;
    try {
        latest = pickLatestTag(await fetchTags(slug));
    } catch (e) {
        console.error("Could not check for updates: " + e.message);
        return 1;
    }
    if (!latest) {
        console.log("No release tags published yet — nothing to upgrade to.");
        return 0;
    }

    if (cmpSemver(latest, current) <= 0) {
        console.log("Already up to date (latest tag is " + latest + ").");
        return 0;
    }

    console.log("Update available: " + current + " -> " + latest.replace(/^v/i, ""));
    if (check) {
        console.log("Run `palsync upgrade` to install github:" + slug + "#" + latest);
        return 0;
    }
    console.log("Installing github:" + slug + "#" + latest + " …");
    const ok = npmInstall(slug, latest);
    if (!ok) {
        console.error("npm install failed. Install manually:  npm install -g github:" + slug + "#" + latest);
        return 1;
    }
    console.log("Upgraded to " + latest.replace(/^v/i, "") + ". (New shell or `hash -r` if `palsync --version` looks stale.)");
    return 0;
}

module.exports = { run, parseSemver, cmpSemver, pickLatestTag, repoSlug };
