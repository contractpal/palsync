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
const { timestampText } = require("./resolve");

const RESOURCES_DIR = ".resources";

// Chain files PalBuilder lazy-loads, readable one at a time through CheckOut.do:
//   singular fileType -> [pulled-pal getter, on-disk folder]. Workflows are not here: the chain
//   response already carries their content. Fonts are not here: the server never reads them back.
const READABLE_TYPES = {
    attachment: ["allAttachments", "attachments"],
    document: ["allDocuments", "documents"],
    email: ["allEmails", "emails"],
    fragment: ["allFragments", "fragments"],
    image: ["allImages", "images"],
    page: ["allPages", "pages"],
    script: ["allScripts", "scripts"],
    style: ["allStyles", "styles"],
    wizard: ["allWizards", "wizards"]
};

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

function chainFailure(resp) {
    if (resp && resp.success) return null;
    const msg = resp && resp.messages && resp.messages["com.contractpal.Message"] && resp.messages["com.contractpal.Message"].message;
    return msg || "GET_CHAIN did not succeed";
}

// Chain entries that carry a pal, each with its folder slug. The slug is derived from the whole
// list (collisions get -2, -3…) so a later single-file fetch lands in the same folder the full
// extraction used.
function chainItems(resp) {
    const list = (resp.customObject && resp.customObject.palInfoList && resp.customObject.palInfoList.PalInfoEx) || [];
    const out = [];
    const usedSlugs = new Set();
    for (const item of list) {
        if (!item || !item.importPal) continue;
        const layout = item.importPal.layout || {};
        let slug = slugify(layout.name) || slugify(item.guid) || "resource";
        if (usedSlugs.has(slug)) {
            let n = 2;
            while (usedSlugs.has(slug + "-" + n)) n++;
            slug = slug + "-" + n;
        }
        usedSlugs.add(slug);
        out.push({ item, slug });
    }
    return out;
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
    const failure = chainFailure(resp);
    if (failure) return { ok: false, reason: failure };
    await clearResourcesDir(workspaceDir);
    const entries = [];
    for (const { item, slug } of chainItems(resp)) {
        const layout = item.importPal.layout || {};
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

    // No fetchedAt timestamp: entries already persist server lastModifiedDate, and a fresh
    // timestamp would make index.json byte-volatile for identical chain content.
    const index = { entries };
    await fs.mkdir(path.join(workspaceDir, RESOURCES_DIR), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, RESOURCES_DIR, "index.json"), JSON.stringify(index, null, 2), "utf8");

    return { ok: true, entries };
}

// What kind of pal a chain item is, from the fields the chain response carries (verified live):
//   no id        -> the CloudPiston Resource Root pal, shipped with full content
//   SYS- guid    -> a system resource pal ("CloudPiston Resource (Cloud)", the enterprise resource pal).
//                   The server builds these with content kept (clearContent=false) and swaps in a
//                   random SYS- guid, so on secure.cloudpiston.com they arrive complete, like Root.
//                   If one ever arrives with empty files it is read like a repository — one file at a
//                   time — and never with a whole-pal GetPal, which the server refuses for them.
//   repository   -> per-file rows, can be huge
//   shadow       -> a pal that overlays a parent
//   otherwise    -> an ordinary pal (modules and skins included): content lives in the pal itself
function chainKind(item) {
    if (!item.id) return "root";
    if (/^SYS-/.test(String(item.guid || ""))) return "system";
    if (item.repository) return "repository";
    if (item.shadow) return "shadow";
    return "ordinary";
}

// Content a chain response already carries for one entry ("" when it was only a name). Entries look
// like { string, <Type>: { content, ... } } — the type key varies, so take the one non-"string" key.
function entryContent(entry) {
    const key = Object.keys(entry || {}).find(k => k !== "string");
    return key && entry[key] ? (timestampText(entry[key].content) || "") : "";
}

// Non-workflow files of a chain pal whose content did NOT arrive, by type key — what is still worth
// fetching. Workflows always arrive with content and are not counted.
function emptyFileCount(item) {
    const listing = new Pal(Object.assign({}, item.importPal, { path: "" }));
    let n = 0;
    for (const [getter] of Object.values(READABLE_TYPES)) for (const e of listing[getter] || []) if (!entryContent(e)) n++;
    return n;
}

function missingNameReason(slug, singular, folder, names, file) {
    const needle = String(file).toLowerCase();
    const near = names.filter(n => n.toLowerCase().includes(needle) || needle.includes(n.toLowerCase())).slice(0, 8);
    return slug + " has no " + singular + " named \"" + file + "\"" +
        (near.length ? ". Similar: " + near.join(", ") : names.length ? ". It has " + names.length + " " + singular + "(s); see .resources/" + slug + "/" + folder + "/" : ". It has no " + singular + "s.");
}

// An ordinary chain pal: one full GetPal brings down every file's content, and the whole pal is
// written into .resources/<slug>/ in place of its placeholders. These pals are small (nothing is
// stored as per-file rows), so a single call beats one CheckOut round trip per file — and having
// all of it lets the validators see ids, names and routes they could only guess at from a name.
// The chain item's id is the pal id (GetPal does not lock the pal). The request is refused for pals
// the developer cannot open — pals deployed on the system enterprise, or another enterprise's.
async function fetchWholeChainPal(session, item, slug, workspaceDir, { singular, getter, folder, file }) {
    let resp;
    try { resp = await CloudPistonAPIManager.getPal(session, item.id); }
    catch (e) { return { ok: false, reason: "GetPal.do failed: " + (e && e.message ? e.message : e) }; }
    if (!resp || !resp.success || !resp.pal) {
        const msg = resp && resp.messages && resp.messages["com.contractpal.Message"] && resp.messages["com.contractpal.Message"].message;
        return { ok: false, reason: "GetPal.do refused " + slug + (msg ? ": " + msg : "") +
            " — a pal you cannot open (another enterprise's, or a deployed pal) refuses on-demand reads; work from the names and workflows the chain gave you" };
    }
    const destDir = path.join(workspaceDir, RESOURCES_DIR, slug);
    const pal = new Pal(Object.assign(JSON.parse(JSON.stringify(resp.pal)), { path: destDir }));
    if (file) {
        const names = (pal[getter] || []).map(e => e.string);
        if (!names.includes(file)) return { ok: false, reason: missingNameReason(slug, singular, folder, names, file) };
    }
    const written = await expandPalFiles(pal);
    const files = written.base64.length + written.json.length;

    // Record that this pal now holds real content, next to its entry in index.json (best-effort).
    try {
        const indexPath = path.join(workspaceDir, RESOURCES_DIR, "index.json");
        const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
        const entry = (index.entries || []).find(e => e.slug === slug);
        if (entry) { entry.files = files; entry.fullContent = true; await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8"); }
    } catch (e) { /* advisory metadata */ }

    return Object.assign({ ok: true, pal: slug, mode: "full-pal", files },
        file ? { type: singular, file, path: path.posix.join(RESOURCES_DIR, slug, folder, file.replace(/\\/g, "/")) } : {});
}

// Fetch ONE file of ONE chain pal on demand and write it into .resources/<slug>/<folder>/<name>,
// replacing the empty stub the chain extraction left there. Nothing else is touched — unlike
// fetchAndExtract this never wipes .resources/. The chain is re-requested because a chain item's
// id is opaque and rotates (it is never persisted), then matched by slug or guid.
//   args: { pal: slug|guid, type: singular or folder name, file: name as listed in the pal }
// How a chain pal is read depends on what kind of pal it is (see chainKind):
//   ordinary   — small, content lives in the pal itself: ONE full GetPal replaces its placeholders
//                with real content for every file (type + file optional; omit both to just fetch it)
//   repository — large, content in per-file rows: ONE file per call through CheckOut.do
//   shadow     — per-file through CheckOut.do, as before
//   root       — already ships full content
// Returns { ok: true, pal, ... } or { ok: false, reason }. Never throws.
async function fetchResourceFile(session, resolved, workspaceDir, { pal: palRef, type, file } = {}) {
    if (!palRef) return { ok: false, reason: "pal is required" };
    const wantsFile = !!(type || file);
    if (wantsFile && (!type || !file)) return { ok: false, reason: "type and file go together (omit both to fetch a whole ordinary pal)" };

    let singular, getter, folder;
    if (wantsFile) {
        const typeKey = String(type).trim().toLowerCase();
        singular = READABLE_TYPES[typeKey] ? typeKey
            : Object.keys(READABLE_TYPES).find(k => READABLE_TYPES[k][1] === typeKey);
        if (!singular) {
            return {
                ok: false,
                reason: "type \"" + type + "\" is not readable on demand. Use one of: " + Object.keys(READABLE_TYPES).join(", ") +
                    (typeKey === "workflow" || typeKey === "workflows" ? " (workflows already carry their content in .resources/)" : "")
            };
        }
        [getter, folder] = READABLE_TYPES[singular];
    }

    let resp;
    try {
        resp = await getChain(session, resolved);
    } catch (e) {
        return { ok: false, reason: "chain request failed: " + (e && e.message ? e.message : e) };
    }
    const failure = chainFailure(resp);
    if (failure) return { ok: false, reason: failure };

    const items = chainItems(resp);
    const ref = String(palRef).trim().toLowerCase();
    const hit = items.find(c => c.slug.toLowerCase() === ref || String(c.item.guid || "").toLowerCase() === ref);
    if (!hit) {
        return { ok: false, reason: "no chain pal \"" + palRef + "\". Chain pals: " + items.map(c => c.slug).join(", ") };
    }
    const { item, slug } = hit;
    const kind = chainKind(item);

    // Content that already came with the chain needs no request at all — this is how Root, and Cloud
    // on clouds that ship it complete, are read: straight from .resources/.
    if (wantsFile) {
        const have = [].concat((new Pal(Object.assign({}, item.importPal, { path: "" })))[getter] || []).find(e => e.string === file);
        const content = have ? entryContent(have) : "";
        if (content) {
            return { ok: true, pal: slug, mode: "already-present", type: singular, file,
                path: path.posix.join(RESOURCES_DIR, slug, folder, file.replace(/\\/g, "/")), bytes: Buffer.from(content, "base64").length };
        }
    } else if (emptyFileCount(item) === 0) {
        return { ok: true, pal: slug, mode: "already-present", note: slug + " already has content for every file — read it straight from .resources/" + slug + "/" };
    }

    if (kind === "ordinary") return fetchWholeChainPal(session, item, slug, workspaceDir, { singular, getter, folder, file });
    if (!wantsFile) {
        return { ok: false, reason: slug + " is a " + (kind === "system" ? "system resource" : kind) + " pal and is read one file at a time: pass type and file" };
    }

    // The listing is the source of truth for names: CheckOut.do answers a name the pal does not
    // hold with success and EMPTY content, which would be written out as a convincing 0-byte file.
    const destDir = path.join(workspaceDir, RESOURCES_DIR, slug);
    const listing = new Pal(Object.assign({}, item.importPal, { path: destDir }));
    const names = (listing[getter] || []).map(e => e.string);
    if (!names.includes(file)) return { ok: false, reason: missingNameReason(slug, singular, folder, names, file) };
    if (kind === "root") {
        return { ok: false, reason: slug + " ships its full content with the chain (no server id to read from); the file is already at .resources/" + slug + "/" + folder + "/" + file };
    }

    let read;
    try {
        read = await CloudPistonAPIManager.checkOutFile(session, item.id, singular, file);
    } catch (e) {
        return { ok: false, reason: "CheckOut.do request failed: " + (e && e.message ? e.message : e) };
    }
    if (!read || !read.success || !read.palFile) {
        const msg = read && read.messages && read.messages["com.contractpal.Message"] && read.messages["com.contractpal.Message"].message;
        // Deployed/system pals (e.g. "CloudPiston Resource (Cloud)") answer "not a development Pal":
        // their files can't be read on demand (Root and Cloud need no read: they arrive with content).
        const deployedHint = msg && /not a development pal/i.test(msg)
            ? " — a pal you cannot open (a deployed pal, or another enterprise's) refuses on-demand reads; work from the names and workflows the chain gave you"
            : "";
        return { ok: false, reason: "CheckOut.do refused " + slug + "/" + folder + "/" + file + (msg ? ": " + msg : "") + deployedHint };
    }

    const base64 = timestampText(read.palFile.content) || "";
    const dest = path.resolve(destDir, folder, file);
    if (!dest.startsWith(path.resolve(destDir, folder) + path.sep)) {
        return { ok: false, reason: "refused: \"" + file + "\" resolves outside .resources/" + slug + "/" + folder + "/" };
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const buf = Buffer.from(base64, "base64");
    await fs.writeFile(dest, buf);
    return {
        ok: true,
        pal: slug,
        type: singular,
        file,
        path: path.posix.join(RESOURCES_DIR, slug, folder, file.replace(/\\/g, "/")),
        bytes: buf.length
    };
}

module.exports = { fetchAndExtract, fetchResourceFile, getChain, slugify, READABLE_TYPES, RESOURCES_DIR };
