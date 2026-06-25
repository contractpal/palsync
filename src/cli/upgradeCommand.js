"use strict";
// `palsync upgrade` — self-update to the LATEST commit on the repo's default branch.
//
// Why a commit SHA (not a branch name or a tag): `npm install -g github:<repo>` re-uses npm's
// cached resolution of the default branch, so a plain reinstall often silently keeps the old build.
// A commit SHA (github:<repo>#<40-hex>) is an IMMUTABLE ref npm hasn't cached, so the install always
// lands — and it always points at the tip of the branch, so you get the latest code no matter what
// (no release tagging required).
//
// Flow: read the SHA this build was installed from → fetch the default branch's HEAD SHA from the
// GitHub API → if they differ (or ours is unknown), run `npm install -g github:<repo>#<sha>`
// (inherits the user's npm prefix). `--check` reports without installing.
const { spawnSync } = require("child_process");
const pkg = require("../../package.json");

// Owner/repo from package.json repository (any GitHub URL form), else a sane default.
function repoSlug() {
    const url = pkg.repository && (typeof pkg.repository === "string" ? pkg.repository : pkg.repository.url) || "";
    const m = String(url).match(/github\.com[/:]([^/]+\/[^/.]+)/i);
    return m ? m[1] : "contractpal/palsync";
}

// The commit this build was installed from. npm records it on git installs: `_resolved` carries
// `...#<sha>`, with `gitHead` as a fallback. null in a dev clone (no git install metadata) — which
// makes upgrade always reinstall, the intended "always latest" behavior for non-installed runs.
function installedSha() {
    const m = pkg._resolved && String(pkg._resolved).match(/#([0-9a-f]{40})\b/i);
    if (m) return m[1].toLowerCase();
    if (pkg.gitHead) return String(pkg.gitHead).toLowerCase();
    return null;
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

function npmInstall(slug, sha) {
    const spec = "github:" + slug + "#" + sha;
    const useShell = process.platform === "win32";
    const r = spawnSync("npm", ["install", "-g", spec], { stdio: "inherit", shell: useShell });
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
        console.log("Run `palsync upgrade` to install github:" + slug + "#" + latest);
        return 0;
    }
    console.log("Installing github:" + slug + "#" + latest + " …");
    const ok = npmInstall(slug, latest);
    if (!ok) {
        console.error("npm install failed. Install manually:  npm install -g github:" + slug + "#" + latest);
        return 1;
    }
    console.log("Upgraded to " + latest.slice(0, 7) + ". (New shell or `hash -r` if `palsync --version` looks stale.)");
    return 0;
}

module.exports = { run, repoSlug, installedSha, fetchLatestSha };
