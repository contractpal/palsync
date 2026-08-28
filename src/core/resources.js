"use strict";
// GET_CHAIN: fetch every pal in the current pal's chain (module dependencies, resource pals,
// and cloud-wide system pals like CloudPiston Resource) and extract them to <workspaceDir>/
// .resources/<slug>/ — read-only reference material, never pushed, never part of the pal being
// edited. Reuses pull.js's expandPalFiles/Pal machinery: each chain entry's `importPal` is the
// exact same shape as a pulled pal's server response, so no new decode logic is needed.
//
// Wire format verified live (test-vm1, 2026-08-27): ProcessPalBuilder.do / GET_CHAIN requires
// the real profileId in BOTH the palId/profileId headers AND the PalBuilderRequest task body —
// "-1" (used by every other ProcessPalBuilder operation) fails with "Secure ID is null" for this
// operation specifically. A held lock is also required (same as GET_PLATFORM_INFO).
const fs = require("fs/promises");
const path = require("path");
const { CloudPistonAPIManager } = require("../../lib/apiManager");
const { Pal } = require("../../lib/pal");
const { expandPalFiles } = require("./pull");

const RESOURCES_DIR = ".resources";

function slugify(name) {
    return String(name || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function getChain(session, resolved) {
    const headers = new Headers({
        "palId": resolved.id,
        "profileId": resolved.profileId,
        "repository-Hint": "false",
        "lock-information": session.lockInfo.toHeaderString()
    });
    const task = {
        "com.contractpal.palbuilder.PalBuilderRequest": {
            operation: "GET_CHAIN",
            includeDependencies: false,
            profileId: resolved.profileId
        }
    };
    return await CloudPistonAPIManager.fetchAPI(session, "ProcessPalBuilder.do", headers, task);
}

// Wipe any previous extraction — .resources/ reflects current server truth, not something a
// user hand-edits, so there is no preserve/merge logic to run (unlike pull.js's workspace sync).
async function clearResourcesDir(workspaceDir) {
    await fs.rm(path.join(workspaceDir, RESOURCES_DIR), { recursive: true, force: true });
}

// Fetch the chain and extract every entry to disk. Returns:
//   { ok: true, entries: [{ slug, name, guid, category, module }] }
//   { ok: false, reason }
// Never throws — the caller (setup/pal_resources) decides whether a failure is fatal.
async function fetchAndExtract(session, resolved, workspaceDir) {
    let resp;
    try {
        resp = await getChain(session, resolved);
    } catch (e) {
        return { ok: false, reason: "request failed: " + (e && e.message ? e.message : e) };
    }
    if (!resp || !resp.success) {
        const msg = resp && resp.messages && resp.messages["com.contractpal.Message"] && resp.messages["com.contractpal.Message"].message;
        return { ok: false, reason: msg || "GET_CHAIN did not succeed" };
    }
    const list = (resp.customObject && resp.customObject.palInfoList && resp.customObject.palInfoList.PalInfoEx) || [];

    await clearResourcesDir(workspaceDir);
    const entries = [];
    const usedSlugs = new Set();
    for (const item of list) {
        if (!item || !item.importPal) continue;
        const layout = item.importPal.layout || {};
        let slug = slugify(layout.name) || slugify(item.guid) || "resource";
        // Disambiguate name collisions (e.g. two chain entries sharing a display name).
        if (usedSlugs.has(slug)) {
            let n = 2;
            while (usedSlugs.has(slug + "-" + n)) n++;
            slug = slug + "-" + n;
        }
        usedSlugs.add(slug);

        const destDir = path.join(workspaceDir, RESOURCES_DIR, slug);
        const pal = new Pal(Object.assign({}, item.importPal, { path: destDir }));
        const written = await expandPalFiles(pal);

        entries.push({
            slug,
            name: layout.name || null,
            category: layout.category || null,
            guid: item.guid || null,
            module: !!item.module,
            files: written.base64.length + written.json.length
        });
    }

    const index = { fetchedAt: new Date().toISOString(), entries };
    await fs.mkdir(path.join(workspaceDir, RESOURCES_DIR), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, RESOURCES_DIR, "index.json"), JSON.stringify(index, null, 2), "utf8");

    return { ok: true, entries };
}

module.exports = { fetchAndExtract, getChain, slugify, RESOURCES_DIR };
