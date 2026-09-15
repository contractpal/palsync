"use strict";
// Shared asar-safety primitives, used by afterPack.js (mid-build, before signing) and
// verifyMacZip.js (post-build, on the actual artifact about to be published) - the two ends of
// the pipeline that can each independently see a corrupted app.asar (see both callers' own
// comments for the specific incidents that made each check necessary).
const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");

const JUNK_SUBPATHS = [
    ["node_modules", "palsync", "gui"],
    ["node_modules", "palsync", ".git"],
];

function junkSubpathOf(relPath) {
    // asar.listPackage's separator follows the host OS (backslash on Windows, forward slash on
    // macOS/Linux, where this actually matters live) - normalize before comparing.
    const normalized = relPath.replace(/\\/g, "/");
    return JUNK_SUBPATHS.find(subpath => {
        const prefix = subpath.join("/");
        return normalized === prefix || normalized.startsWith(prefix + "/");
    });
}

// @electron/asar's own `extractAll` has a real, reproducible bug (confirmed live 2026-09-14,
// both macOS and Windows): it can write a file's content as entirely 0x00 bytes at the correct
// size, deterministically — not a timing race (an 8-attempt/2-second poll for the write to
// "catch up" never once resolved it), not upstream in electron-builder's own first-pass asar
// (confirmed byte-correct via `asar.extractFile` on the exact file `extractAll` corrupted, read
// from the very same archive), and not platform-specific (hit a root package.json on Mac, a
// renderer JS bundle on Windows — different files, same signature). Whatever `extractAll` does
// internally to batch/stream multiple files at once is where this happens; extracting the same
// files one at a time via `extractFile` (which every direct test here got right, every time) does
// not reproduce it. So nothing here ever calls `extractAll` — it lists the archive's real
// contents and recreates them on disk itself, file by file.
//
// `skipJunk` (confirmed live 2026-09-15, GitHub Actions macOS runner): the self-referential
// node_modules/palsync/gui symlink can point back at THIS SAME BUILD's own not-yet-finished
// appOutDir, captured mid-write when electron-builder's own asar packager walked it — so the
// archive's file index can list an entry under a JUNK_SUBPATH whose content is missing/broken,
// and `asar.statFile` throws "not found in this archive" for it. That entry was always going to
// get pruned anyway, so skip calling statFile/extractFile on anything under a JUNK_SUBPATH in the
// first place rather than crashing on it.
function safeExtractAll(archivePath, destDir, { skipJunk = false } = {}) {
    let skippedAny = false;
    for (const rawPath of asar.listPackage(archivePath)) {
        const relPath = rawPath.replace(/^[/\\]/, "");
        if (!relPath) continue; // the archive root itself
        if (skipJunk && junkSubpathOf(relPath)) {
            skippedAny = true;
            continue;
        }
        const destPath = path.join(destDir, relPath);
        const info = asar.statFile(archivePath, relPath);
        if ("files" in info) {
            fs.mkdirSync(destPath, { recursive: true });
        } else if ("link" in info) {
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.symlinkSync(info.link, destPath);
        } else {
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.writeFileSync(destPath, asar.extractFile(archivePath, relPath));
            if (info.executable) {
                try { fs.chmodSync(destPath, 0o755); } catch (e) { /* best-effort, e.g. Windows */ }
            }
        }
    }
    return skippedAny;
}

// Recursively find any non-empty file whose content is ENTIRELY 0x00 bytes — the exact signature
// of every corruption incident seen so far (see safeExtractAll's own comment, and afterPack.js/
// verifyMacZip.js for where else this class of bug has shown up).
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
    try {
        JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = { safeExtractAll, findZeroedFile, verifyPackageJsonReadable };
