"use strict";
// Repository-Payload: the per-file change list a repository pal's save must carry. The server
// (PalBuilderTasks.updatePal -> PalManager.separateRepositoryContent) writes a repository pal's
// file rows ONLY for files named here; with no payload no row is touched. Wire format, from the
// server source (com.contractpal.pal.RepositoryPayload / RepositoryItem, PalXStreamUtil aliases):
//   header  Repository-Payload = base64( gzip( XStream XML ) )   — same encoding as the request
//           body, because the server decodes both with the same decodeWithSize
//   XML     <RepositoryPayload><changes><RepositoryItem>
//             <type>page</type><name>console.html</name><oldName>…</oldName><action>2</action>
//           </RepositoryItem>…</changes></RepositoryPayload>
//   action  1 insert, 2 update, 3 delete, 4 rename (rename carries the previous name in oldName)
//   type    singular lowercase: document email image page requirement fragment style font wizard
//           workflow script attachment automation (see READABLE_TYPES in resources.js for the
//           subset palsync reads on demand)
const zlib = require("zlib");

const ACTION = { INSERT: 1, UPDATE: 2, DELETE: 3, RENAME: 4 };

function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// items: [{ action: ACTION.*, type, name, oldName? }]
function buildPayloadXml(items) {
    const rows = items.map(it => {
        if (!Object.values(ACTION).includes(it.action)) throw new Error("bad repository action: " + it.action);
        if (!it.type || !it.name) throw new Error("repository item needs type and name");
        if (it.action === ACTION.RENAME && !it.oldName) throw new Error("rename needs oldName");
        return "<RepositoryItem><type>" + esc(it.type) + "</type><name>" + esc(it.name) + "</name>" +
            (it.oldName ? "<oldName>" + esc(it.oldName) + "</oldName>" : "") +
            "<action>" + it.action + "</action></RepositoryItem>";
    });
    return "<RepositoryPayload><changes>" + rows.join("") + "</changes></RepositoryPayload>";
}

function encodePayloadHeader(items) {
    return zlib.gzipSync(Buffer.from(buildPayloadXml(items), "utf8")).toString("base64");
}

// ---------------------------------------------------------------------------------------------
// Turning a workspace diff into a payload — the precise, per-file edit a repository pal needs.
// ---------------------------------------------------------------------------------------------

// workspace folder -> [payload type, entry sub-key in pal.json's entries]. Only these folders hold
// repository files; data/datalists/datasets/dataviews are pal structure and travel in the pal body.
const FOLDERS = {
    attachments: ["attachment", "Attachment"],
    documents: ["document", "Document"],
    emails: ["email", "Email"],
    fragments: ["fragment", "Fragment"],
    images: ["image", "Image"],
    pages: ["page", "Page"],
    scripts: ["script", "Script"],
    styles: ["style", "Style"],
    wizards: ["wizard", "Wizard"],
    workflows: ["workflow", "Workflow"]
};

// "fragments/a/b.html" -> { type: "fragment", name: "a/b.html" }; null for anything that is not a
// repository file (data folders, pal.json).
function relToItem(rel) {
    const slash = rel.indexOf("/");
    if (slash < 1) return null;
    const entry = FOLDERS[rel.slice(0, slash)];
    return entry ? { type: entry[0], name: rel.slice(slash + 1) } : null;
}

// diff: { added, changed, deleted } (rel paths, from core/localDrift diffWorkspace against the
// baseline). manifest: Set of rels the pal body lists (core/pull manifestPaths). serverRels: Set of
// rels the SERVER already lists (its own GetPal answer) — optional but important:
//   added   (in a file folder AND listed)  -> INSERT, content sent. If the server ALREADY has that
//           name (a stale or lost baseline made an existing file look new) it becomes UPDATE instead:
//           INSERT skips the server's row lookup and would create a DUPLICATE row (reproduced live),
//           while UPDATE updates the row or creates it when missing — never a duplicate.
//   changed (listed)                       -> UPDATE, content sent
//   deleted (gone from disk AND unlisted)  -> DELETE
// Everything else is deliberately NOT turned into an item, and reported in `skipped`:
//   - on disk but not listed in pal.json: the server would ignore it anyway;
//   - missing from disk but still listed: that is an un-downloaded file, not a deletion — removing
//     a repository row is destructive, so it takes an explicit pal.json entry removal.
// Returns { items, contentRels (Set of rels whose bytes must ride along), skipped }.
function planRepositoryPush(diff, manifest, serverRels = null) {
    const items = [];
    const contentRels = new Set();
    const skipped = [];
    const listed = rel => manifest.has(rel);
    for (const rel of diff.added || []) {
        const it = relToItem(rel);
        if (!it) continue;
        if (!listed(rel)) { skipped.push({ rel, reason: "new file has no pal.json entry, so it is not part of the pal — add one to push it" }); continue; }
        const onServer = !!(serverRels && serverRels.has(rel));
        items.push({ action: onServer ? ACTION.UPDATE : ACTION.INSERT, type: it.type, name: it.name });
        contentRels.add(rel);
    }
    for (const rel of diff.changed || []) {
        const it = relToItem(rel);
        if (!it) continue;
        if (!listed(rel)) { skipped.push({ rel, reason: "edited file has no pal.json entry — not pushed" }); continue; }
        items.push({ action: ACTION.UPDATE, type: it.type, name: it.name });
        contentRels.add(rel);
    }
    for (const rel of diff.deleted || []) {
        const it = relToItem(rel);
        if (!it) continue;
        if (listed(rel)) { skipped.push({ rel, reason: "file is missing locally but still listed in pal.json, so it is treated as not downloaded, not deleted — remove its pal.json entry to delete it" }); continue; }
        items.push({ action: ACTION.DELETE, type: it.type, name: it.name });
    }
    return { items, contentRels, skipped };
}

// Drop the content of every file that is NOT being pushed, so the request carries only the edits
// (exactly what PalBuilder's own client does). Mutates the pal's entries; the server leaves a file
// alone unless the payload names it. A repository can hold megabytes of unchanged binaries.
function stripUnchangedContent(pal, contentRels) {
    for (const [folder, [, key]] of Object.entries(FOLDERS)) {
        const node = pal[folder];
        const entries = node && node.entry ? (Array.isArray(node.entry) ? node.entry : [node.entry]) : [];
        for (const entry of entries) {
            const obj = entry && (entry[key] || entry[key.toLowerCase()]);
            if (obj && !contentRels.has(folder + "/" + entry.string)) delete obj.content;
        }
    }
}

module.exports = { ACTION, FOLDERS, buildPayloadXml, encodePayloadHeader, relToItem, planRepositoryPush, stripUnchangedContent };
