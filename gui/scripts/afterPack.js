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

exports.default = async function afterPack(context) {
    const appName = context.packager.appInfo.productFilename;
    // Mac: <App>.app/Contents/Resources/app.asar. Windows/Linux: resources/app.asar directly.
    const macAsarPath = path.join(context.appOutDir, appName + ".app", "Contents", "Resources", "app.asar");
    const otherAsarPath = path.join(context.appOutDir, "resources", "app.asar");
    const asarPath = fs.existsSync(macAsarPath) ? macAsarPath : otherAsarPath;
    if (!fs.existsSync(asarPath)) return; // asar:false build, or nothing to prune

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
        if (!prunedAny) return;
        fs.rmSync(asarPath, { force: true });
        await asar.createPackage(tmpDir, asarPath);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
};
