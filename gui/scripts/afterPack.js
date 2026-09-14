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

// Recursively find any non-empty file whose content is ENTIRELY 0x00 bytes — the exact, specific
// signature of a known, long-standing, non-deterministic bug in @electron/asar's extractAll/
// createPackage round-trip on macOS/APFS (confirmed live 2026-09-14: a shipped, notarized Mac
// build's app.asar had a root package.json that came out as 581 bytes of pure 0x00 — identical
// size to the real 581-byte package.json, content replaced with zeros — causing Node's own
// package.json reader to throw and the whole app to exit silently, before any of our code or even
// Electron's own error handling ever ran; see electron/asar#153 for the same class of bug reported
// since at least 2018, never permanently fixed upstream). Checking every file for this exact
// signature (rather than comparing total extracted byte counts against the pre-repackage source)
// is both more targeted and more reliable: a total-byte-count comparison across two independent
// extractions produced a large, spurious mismatch in practice (APFS clone/hardlink-aware
// extraction can report different logical totals for content-identical files without anything
// actually being corrupt — confirmed live the same day: a "corrupted" build's actual packed
// app.asar on disk was a perfectly normal ~150MB, matching every other build, despite one
// extraction reporting ~720MB of logical content vs ~150MB for the other).
function findZeroedFile(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = findZeroedFile(full);
            if (found) return found;
        } else if (entry.isFile()) {
            const stat = fs.statSync(full);
            if (stat.size === 0) continue; // a real empty file is not this corruption
            const buf = fs.readFileSync(full);
            if (buf.every(b => b === 0)) return full;
        }
    }
    return null;
}

// Spot-check package.json specifically (always present, always expected to be valid, parseable
// JSON) — a second, independent check catching any corruption shape findZeroedFile's exact
// all-zero signature might not (e.g. partial/truncated corruption, not full-zero).
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

        fs.rmSync(asarPath, { force: true });
        await asar.createPackage(tmpDir, asarPath);

        // Verify the round-trip actually worked before trusting this asar — re-extract fresh and
        // check, rather than assuming createPackage succeeding without throwing means the content
        // is correct (the corruption this guards against throws no error at all).
        const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-asar-verify-"));
        try {
            asar.extractAll(asarPath, verifyDir);
            const zeroed = findZeroedFile(verifyDir);
            if (zeroed) {
                throw new Error("[afterPack] integrity check failed: " + path.relative(verifyDir, zeroed) +
                    " in the repackaged app.asar is entirely 0x00 bytes — the known @electron/asar " +
                    "macOS extract/repackage corruption, see electron/asar#153");
            }
            if (!verifyPackageJsonReadable(verifyDir)) {
                throw new Error("[afterPack] integrity check failed: repackaged app.asar's package.json is not " +
                    "valid JSON — likely the known @electron/asar macOS extract/repackage corruption, " +
                    "see electron/asar#153");
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

    // Confirmed live 2026-09-14: retrying just this hook (extract/prune/repackage) achieves
    // nothing when it fails — the corruption is already present in electron-builder's OWN
    // initial app.asar, before this hook ever runs (three retries here hit the exact same
    // corrupted file, identically, every time — garbage in, garbage out). Fail immediately with
    // a clear next step instead of silently repeating a pointless retry: re-run the WHOLE build
    // command from the top. A fresh electron-builder invocation actually has a chance of avoiding
    // whatever produced the corrupt source asar (still not root-caused precisely — plausibly a
    // write-then-immediate-read race between writeBuildInfo.js/bumpVersion.js's fresh writes and
    // electron-builder's own packaging step reading them moments later, given both known
    // incidents so far hit a file that had just been (re)written seconds earlier — but not
    // confirmed).
    try {
        return await pruneOnce(asarPath);
    } catch (e) {
        e.message += "\n[afterPack] This is NOT something retrying this hook fixes — the corrupt " +
            "source asar comes from electron-builder's own packaging step, before this hook ever " +
            "runs. Re-run the WHOLE build command from the top instead.";
        throw e;
    }
};
