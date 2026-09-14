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

const JUNK_SUBPATHS = [
    ["node_modules", "palsync", "gui"],
    ["node_modules", "palsync", ".git"],
];

// Sum of file sizes under a directory, walked recursively — a cheap, order-independent integrity
// check: @electron/asar's extractAll/createPackage round-trip has a known, long-standing,
// non-deterministic bug on macOS/APFS where some files silently extract or repackage as
// zero-byte/null-byte garbage of the SAME reported size (confirmed live 2026-09-14: a shipped,
// notarized Mac build's app.asar had a root package.json that was 581 bytes of pure 0x00 —
// identical size to the real 581-byte package.json, content replaced with zeros — causing Node's
// own package.json reader to throw and the whole app to exit silently, before any of our code or
// even Electron's own error handling ever ran; see electron/asar#153 for the same class of bug
// reported since at least 2018, never permanently fixed upstream). A full byte-for-byte re-diff
// of every file would be the most bulletproof check but is expensive for an app this size; total
// byte count is cheap and would have caught this exact incident (the corrupted file's real bytes
// became zeros, but its length was unchanged only because the corruption target was already-sized
// space — a genuine content change with a size mismatch is the far more common failure shape this
// catches; see the also-added spot check below for the "same size, wrong content" shape too).
function totalBytes(dir) {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) total += totalBytes(full);
        else if (entry.isFile()) total += fs.statSync(full).size;
    }
    return total;
}

// Spot-check package.json specifically (always present, always expected to be valid, parseable
// JSON) — catches the exact "same size, zeroed content" corruption shape totalBytes() alone can't,
// since that shape doesn't change the byte count at all.
function verifyPackageJsonReadable(dir) {
    const pkgPath = path.join(dir, "package.json");
    let content;
    try {
        content = fs.readFileSync(pkgPath, "utf8");
        JSON.parse(content);
        return true;
    } catch (e) {
        return false;
    }
}

async function pruneOnce(asarPath) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-asar-prune-"));
    try {
        asar.extractAll(asarPath, tmpDir);
        let prunedAny = false;
        for (const subpath of JUNK_SUBPATHS) {
            const junkPath = path.join(tmpDir, ...subpath);
            if (fs.existsSync(junkPath)) {
                fs.rmSync(junkPath, { recursive: true, force: true });
                prunedAny = true;
                console.log("[afterPack] pruned " + subpath.join("/") + " from app.asar (self-referential palsync symlink)");
            }
        }
        if (!prunedAny) return false;

        const expectedBytes = totalBytes(tmpDir);
        fs.rmSync(asarPath, { force: true });
        await asar.createPackage(tmpDir, asarPath);

        // Verify the round-trip actually worked before trusting this asar — re-extract fresh and
        // compare, rather than assuming createPackage succeeding without throwing means the
        // content is correct (the corruption this guards against throws no error at all).
        const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-asar-verify-"));
        try {
            asar.extractAll(asarPath, verifyDir);
            const actualBytes = totalBytes(verifyDir);
            if (actualBytes !== expectedBytes) {
                throw new Error("[afterPack] integrity check failed: repackaged app.asar has " + actualBytes +
                    " total bytes, expected " + expectedBytes + " (pruned source) — likely the known " +
                    "@electron/asar macOS extract/repackage corruption, see electron/asar#153");
            }
            if (!verifyPackageJsonReadable(verifyDir)) {
                throw new Error("[afterPack] integrity check failed: repackaged app.asar's package.json is not " +
                    "valid JSON — likely the known @electron/asar macOS extract/repackage corruption " +
                    "(same-size, zeroed content), see electron/asar#153");
            }
        } finally {
            fs.rmSync(verifyDir, { recursive: true, force: true });
        }
        return true;
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

exports.default = async function afterPack(context) {
    const appName = context.packager.appInfo.productFilename;
    // Mac: <App>.app/Contents/Resources/app.asar. Windows/Linux: resources/app.asar directly.
    const macAsarPath = path.join(context.appOutDir, appName + ".app", "Contents", "Resources", "app.asar");
    const otherAsarPath = path.join(context.appOutDir, "resources", "app.asar");
    const asarPath = fs.existsSync(macAsarPath) ? macAsarPath : otherAsarPath;
    if (!fs.existsSync(asarPath)) return; // asar:false build, or nothing to prune

    // The underlying corruption is non-deterministic (a known, unresolved upstream bug — not
    // something triggered by any input we control), so a few retries before giving up is
    // reasonable rather than failing the whole build on what's likely a transient APFS hiccup.
    const MAX_ATTEMPTS = 3;
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const prunedAny = await pruneOnce(asarPath);
            if (attempt > 1) console.log("[afterPack] asar integrity verified on attempt " + attempt);
            return prunedAny;
        } catch (e) {
            lastError = e;
            console.log("[afterPack] attempt " + attempt + "/" + MAX_ATTEMPTS + " failed: " + e.message);
        }
    }
    // Never silently ship a corrupted asar — fail the build loudly instead (this is exactly what
    // let a broken Mac release through undetected on 2026-09-14).
    throw lastError;
};
