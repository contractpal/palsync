"use strict";
// Decides whether a PR's diff touches anything that actually ships inside the packaged
// Electron app (gui/package.json's own `build.files` bundles almost the entire repo root as
// node_modules/palsync/** minus a short exclusion list) without gui/package.json's `version`
// field having changed. Used by .github/workflows/version-bump-reminder.yml to post/update a PR
// comment - a reminder, not a merge block, since major/minor bumps are still a human semver call.
const { execFileSync } = require("child_process");

// gui/'s own build-output, lockfile and doc paths - not part of gui/package.json's build.files
// exclusion list (that list is scoped to the bundled node_modules/palsync/** copy of the repo
// root, not to gui/ itself), so these stay hand-maintained here.
const GUI_EXACT_EXCLUDES = new Set(["gui/BACKLOG.md", "gui/package-lock.json"]);
const GUI_PREFIX_EXCLUDES = ["gui/dist/", "gui/node_modules/"];

function git(args) {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
}

// Reads the root-repo exclusions straight from gui/package.json's build.files (entries like
// "!node_modules/palsync/bench/**"), translated to root-relative paths, so this never drifts
// from what electron-builder actually packages.
function loadRootExcludesFromPackageJson(ref) {
    const pkg = JSON.parse(git(["show", ref + ":gui/package.json"]));
    const files = (pkg.build && pkg.build.files) || [];
    const prefix = "node_modules/palsync/";
    const exact = new Set();
    const prefixes = [];
    for (const entry of files) {
        if (typeof entry !== "string" || !entry.startsWith("!")) continue;
        let pattern = entry.slice(1);
        if (!pattern.startsWith(prefix)) continue; // not a root-repo exclusion
        pattern = pattern.slice(prefix.length);
        // "gui/**" here excludes the nested copy of gui/ within the bundled node_modules/palsync
        // copy of the repo (avoids packaging gui inside itself) - it says nothing about the real
        // top-level gui/, which is exactly what this check most needs to treat as relevant.
        if (pattern === "gui/**") continue;
        if (pattern.endsWith("/**")) {
            prefixes.push(pattern.slice(0, -2)); // "dir/**" -> "dir/" prefix match
        } else {
            exact.add(pattern);
        }
    }
    return { exact, prefixes };
}

function isRelevant(file, rootExcludes) {
    if (file.endsWith(".md")) return false; // docs anywhere
    if (GUI_EXACT_EXCLUDES.has(file) || rootExcludes.exact.has(file)) return false;
    if (GUI_PREFIX_EXCLUDES.some(p => file.startsWith(p))) return false;
    return !rootExcludes.prefixes.some(p => file.startsWith(p));
}

function versionAt(ref) {
    try {
        return JSON.parse(git(["show", ref + ":gui/package.json"])).version;
    } catch (e) {
        return null; // ref predates gui/package.json, or it's otherwise unreadable there
    }
}

function main() {
    const base = process.argv[2];
    const head = process.argv[3] || "HEAD";
    if (!base) {
        console.error("usage: check-version-bump.js <base-ref-or-sha> [head-ref-or-sha]");
        process.exit(2);
    }

    const rootExcludes = loadRootExcludesFromPackageJson(head);
    const changed = git(["diff", "--name-only", base + "..." + head]).split("\n").filter(Boolean);
    const relevantFiles = changed.filter(file => isRelevant(file, rootExcludes));

    if (relevantFiles.length === 0) {
        console.log(JSON.stringify({ needsBump: false, relevantFiles: [] }));
        return;
    }

    const baseVersion = versionAt(base);
    const headVersion = versionAt(head);
    const needsBump = baseVersion === headVersion;

    console.log(JSON.stringify({ needsBump, baseVersion, headVersion, relevantFiles }));
}

main();
