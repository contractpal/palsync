"use strict";
// Backing logic for the GUI's Images side-panel (ConsoleTab.jsx) — two independent listings for
// one pal folder:
//   "images" — the pal's own shipped image assets, at workspace-root /images, matching how every
//              other manifest-backed entry type (pages, scripts, styles, ...) stores its real
//              file at the pal.json entry's `filename` path. Confirmed against a real pal (David,
//              2026-09-14) rather than guessed — PalBuilder's own manifest-shape rule ("never
//              invent manifest shapes") is about writing/pushing pal.json content, not reading a
//              folder for display, but the *location* itself still isn't something to guess at.
//   "assets" — the staging convention added to the shared contract doc (contextInject.js's
//              "Creating new files" section) for generated/downloaded visual assets not yet
//              turned into a real pal Image entry (e.g. Codex's $imagegen output, always copied
//              here rather than left in a harness's own scratch directory). Sorted most-recent-
//              first, unlike "images" (alphabetical) — there's no "recently generated" framing
//              for a pal's actual shipped assets.
const fs = require("fs/promises");
const path = require("path");

const IMAGE_EXT_MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp"
};

const FOLDER_FOR = { images: "images", assets: "assets" };

async function listImages(workspaceDir, kind) {
    const folder = FOLDER_FOR[kind];
    if (!folder) throw new Error("Unknown image panel kind '" + kind + "' (expected 'images' or 'assets').");
    const dir = path.join(workspaceDir, folder);

    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
        return []; // folder doesn't exist yet — nothing to show, not an error
    }

    const files = entries.filter(e => e.isFile() && IMAGE_EXT_MIME[path.extname(e.name).toLowerCase()]);
    const withStat = await Promise.all(files.map(async e => {
        const filePath = path.join(dir, e.name);
        const stat = await fs.stat(filePath);
        return { name: e.name, path: filePath, mtimeMs: stat.mtimeMs, size: stat.size };
    }));

    withStat.sort(kind === "assets"
        ? (a, b) => b.mtimeMs - a.mtimeMs
        : (a, b) => a.name.localeCompare(b.name));

    // Embed each image as a data: URI up front — these are pal-scale asset/icon folders, not a
    // large media library, so eagerly reading bytes for a thumbnail grid is simple and cheap
    // enough (same base64-embedding pattern pal_screenshot's MCP tool already uses); no separate
    // thumbnail-generation step.
    return Promise.all(withStat.map(async f => {
        const mime = IMAGE_EXT_MIME[path.extname(f.name).toLowerCase()];
        const buf = await fs.readFile(f.path);
        return {
            name: f.name, mtimeMs: f.mtimeMs, size: f.size, path: f.path,
            dataUri: "data:" + mime + ";base64," + buf.toString("base64")
        };
    }));
}

module.exports = { listImages };
