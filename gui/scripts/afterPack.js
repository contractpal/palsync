"use strict";
// electron-builder's node_modules copier doesn't reliably honor the deep "!node_modules/
// palsync/gui/**" / "!node_modules/palsync/.git/**" excludes in package.json's build.files for
// palsync (a "file:.." local dependency, i.e. a real symlink to the repo root on Mac/Linux, a
// junction on Windows). Since `gui/node_modules/palsync/gui` IS `gui/` itself, whatever this
// build has already staged under gui/dist/ during packaging (including, on a multi-arch run,
// a previous arch's own finished .app, or this same arch's own not-yet-renamed staging
// directory) is reachable through that symlink and can get swept into app.asar — confirmed live:
// a 2.4GB app.asar on a Mac build contained a full extra copy of Contents/Frameworks/Electron
// Framework.framework under node_modules/palsync/gui/dist/**. This mirrors the (Windows-only)
// fix already applied via those exclude patterns, which this hook does not replace — it's a
// second layer that acts on the concrete packaged result instead of hoping the glob excludes
// were honored, so it's correct regardless of why they weren't.
const fs = require("fs");
const os = require("os");
const path = require("path");
const asar = require("@electron/asar");
const { safeExtractAll, findZeroedFile, verifyPackageJsonReadable } = require("./asarIntegrity");

async function pruneOnce(asarPath) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-asar-prune-"));
    try {
        const prunedAny = safeExtractAll(asarPath, tmpDir, { skipJunk: true });

        // Always verify what electron-builder itself just produced, whether or not there was
        // anything to prune - confirmed live (2026-09-15, GitHub Actions Mac build): a build with
        // NO junk to prune still shipped a corrupted app.asar (package.json all 0x00 bytes, same
        // signature as the incident documented below) because electron-builder's own first-pass
        // asar.createPackage hit the same class of corruption in ITS OWN packaging step this time,
        // not in this hook's repackage step - and this check used to only run after this hook's
        // own repackage, so a build with nothing to prune shipped that corruption straight through
        // undetected. tmpDir already holds everything from the extraction above regardless of
        // skipJunk's outcome, so this costs nothing extra to check.
        const zeroedBeforePrune = findZeroedFile(tmpDir);
        if (zeroedBeforePrune) {
            throw new Error("[afterPack] integrity check failed: " + path.relative(tmpDir, zeroedBeforePrune) +
                " in electron-builder's own packaged app.asar is entirely 0x00 bytes");
        }
        if (!verifyPackageJsonReadable(tmpDir)) {
            throw new Error("[afterPack] integrity check failed: electron-builder's own packaged app.asar's " +
                "package.json is not valid JSON");
        }

        if (!prunedAny) return false;
        console.log("[afterPack] pruned self-referential palsync symlink content from app.asar");

        fs.rmSync(asarPath, { force: true });
        await asar.createPackage(tmpDir, asarPath);

        // @electron/asar caches parsed archive headers/offset tables internally, keyed by archive
        // path (it exposes uncache/uncacheAll specifically to invalidate this) — and this same
        // process already read from asarPath once, above, before deleting and completely replacing
        // it. Without dropping that cache, safeExtractAll's read-back below can apply the OLD
        // file's offset table against the NEW file's bytes, landing reads on the wrong byte ranges
        // (explains the exact symptom: deterministic, not timing-related — a wait/retry loop and
        // an explicit fsync were both tried first and neither helped — and absent when a fresh,
        // separate process reads the identical on-disk file with no stale cache to begin with).
        asar.uncache(asarPath);

        // Verify the round-trip actually worked before trusting this asar — re-extract fresh and
        // check, rather than assuming createPackage succeeding without throwing means the content
        // is correct.
        const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-asar-verify-"));
        try {
            safeExtractAll(asarPath, verifyDir);
            const zeroed = findZeroedFile(verifyDir);
            if (zeroed) {
                throw new Error("[afterPack] integrity check failed: " + path.relative(verifyDir, zeroed) +
                    " in the repackaged app.asar is entirely 0x00 bytes");
            }
            if (!verifyPackageJsonReadable(verifyDir)) {
                throw new Error("[afterPack] integrity check failed: repackaged app.asar's package.json is not " +
                    "valid JSON");
            }
        } finally {
            fs.rmSync(verifyDir, { recursive: true, force: true });
        }
        return true;
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// build-info.json is deliberately NOT in package.json's "files" list — it's placed directly here
// instead, copied straight to the app.asar.unpacked location Electron's fs already checks first
// for any path that would otherwise resolve inside app.asar (same runtime behavior electron-
// builder's own `asarUnpack` config would give, without going through it). Two independent
// problems ruled this out: (1) the file was one of the ones seen corrupting inside app.asar via
// the extractAll bug documented above, and (2) actually configuring
// `asarUnpack: ["build-info.json"]` triggered a SEPARATE, unrelated electron-builder bug: its
// asarUnpack path-matching (AsarPackager.unpackPattern/getRelativePath) walks the
// node_modules/palsync symlink (a real symlink to the repo root on Mac/Linux) and hard-fails
// the whole build the moment it encounters ANY repo-root file outside gui/ (e.g.
// .claude/settings.local.json) — reproduced identically even after excluding that specific path
// from "files", since this check runs on a different, symlink-following code path that "files"
// excludes don't reach. Bypassing electron-builder's asarUnpack config entirely and just placing
// the file ourselves sidesteps both problems at once.
function copyBuildInfoUnpacked(context, asarPath) {
    const src = path.join(__dirname, "..", "build-info.json");
    if (!fs.existsSync(src)) return; // writeBuildInfo.js wasn't run first — nothing to copy
    const unpackedDir = path.join(path.dirname(asarPath), "app.asar.unpacked");
    fs.mkdirSync(unpackedDir, { recursive: true });
    fs.copyFileSync(src, path.join(unpackedDir, "build-info.json"));
}

exports.default = async function afterPack(context) {
    const appName = context.packager.appInfo.productFilename;
    // Mac: <App>.app/Contents/Resources/app.asar. Windows/Linux: resources/app.asar directly.
    const macAsarPath = path.join(context.appOutDir, appName + ".app", "Contents", "Resources", "app.asar");
    const otherAsarPath = path.join(context.appOutDir, "resources", "app.asar");
    const asarPath = fs.existsSync(macAsarPath) ? macAsarPath : otherAsarPath;
    if (!fs.existsSync(asarPath)) return; // asar:false build, or nothing to prune

    copyBuildInfoUnpacked(context, asarPath);
    return await pruneOnce(asarPath);
};
