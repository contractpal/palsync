"use strict";
// pal_search_templates core: search the pal store's templates via SearchTemplates.do.
//
// The server answers with a ComposerResult whose `files` map holds one PalFile (an Image) per
// template. The template's data rides on the PalFile: filename = name, palType = the opaque
// template token (what a later GetTemplate would take), content = the icon PNG (base64), and
// `bookmarks` = ten fixed-position metadata strings. Line numbers are the contract (verified
// against PalStoreManager.createTemplateRow and live on test-vm1, 2026-10-06).
const { CloudPistonAPIManager } = require("../../lib/apiManager");

const BOOKMARK_FIELDS = {
    1: "publisher",
    2: "publisherEmail",
    3: "publisherPhone",
    4: "description",
    5: "enterprise",
    6: "version",
    7: "modified",
    8: "source",
    9: "categories",
    10: "industries"
};

// The XML parser collapses a one-element list to the bare object and an empty list to "".
function asArray(v) {
    if (v === undefined || v === null || v === "") return [];
    return Array.isArray(v) ? v : [v];
}

function splitList(s) {
    return String(s || "").split(",").map(x => x.trim()).filter(Boolean);
}

// One PalFile → a flat template entry. The icon is dropped by default: it is a base64 PNG of
// several KB per template and useless to an agent; the GUI opts in with includeIcon.
function toTemplate(palFile, { includeIcon = false } = {}) {
    const t = { name: palFile.filename === undefined ? "" : String(palFile.filename), token: palFile.palType === undefined ? "" : String(palFile.palType) };
    const bookmarks = palFile.bookmarks && typeof palFile.bookmarks === "object" ? asArray(palFile.bookmarks.Bookmark) : [];
    for (const b of bookmarks) {
        const field = BOOKMARK_FIELDS[b.line];
        if (field) t[field] = b.text === undefined || b.text === null ? "" : String(b.text);
    }
    for (const f of Object.values(BOOKMARK_FIELDS)) if (t[f] === undefined) t[f] = "";
    t.categories = splitList(t.categories);
    t.industries = splitList(t.industries);
    if (includeIcon && palFile.content) t.icon = { contentType: palFile.contentType || "image/png", base64: String(palFile.content).replace(/\s+/g, "") };
    return t;
}

// ComposerResult → template list. `files` is keyed by PalFile subclass (today always "Image");
// walk every key rather than hard-coding it.
function parseTemplates(resp, opts) {
    const files = resp && resp.files && typeof resp.files === "object" ? resp.files : {};
    const out = [];
    for (const group of Object.values(files)) for (const pf of asArray(group)) out.push(toTemplate(pf, opts));
    return out;
}

// Returns { ok, templates, search } or { ok:false, error }. `search` is optional; omitted = all.
async function searchTemplates(session, { search, includeIcon = false } = {}) {
    const term = typeof search === "string" ? search.trim() : "";
    const resp = await CloudPistonAPIManager.searchTemplates(session, term);
    if (!resp) {
        const t = session.lastTransport;
        return { ok: false, error: "SearchTemplates.do returned no result" + (t && t.status && !t.ok ? " (HTTP " + t.status + ")" : "") +
            ". The server may not support templates yet, or the connection was lost." };
    }
    if (resp.success === false) return { ok: false, error: "The server reported failure for SearchTemplates.do." };
    return { ok: true, search: term, templates: parseTemplates(resp, { includeIcon }) };
}

// Full record for one template, including the preview image. Returns { ok, template } or { ok:false, error }.
async function getTemplate(session, token) {
    if (!token) return { ok: false, error: "A template token is required." };
    const resp = await CloudPistonAPIManager.getTemplate(session, token);
    if (!resp) return { ok: false, error: "GetTemplate.do returned no result." };
    if (resp.success === false) {
        const m = resp.messages && resp.messages["com.contractpal.Message"];
        return { ok: false, error: (m && m.message) || "The server could not return that template." };
    }
    const [template] = parseTemplates(resp, { includeIcon: true });
    if (!template) return { ok: false, error: "The server returned no template for that token." };
    return { ok: true, template };
}

function formatTemplates(result) {
    if (!result.ok) return result.error;
    const { templates, search } = result;
    const head = templates.length + " template(s)" + (search ? " matching " + JSON.stringify(search) : "") + ".";
    if (!templates.length) return head;
    return head + "\n\n" + templates.map(t =>
        "- " + t.name + (t.version ? " v" + t.version : "") + " [" + (t.source || "?") + "] by " + (t.publisher || "?") +
        (t.description ? "\n    " + t.description : "") +
        (t.categories.length ? "\n    categories: " + t.categories.join(", ") : "") +
        (t.industries.length ? "\n    industries: " + t.industries.join(", ") : "") +
        "\n    token: " + t.token).join("\n");
}

module.exports = { searchTemplates, getTemplate, parseTemplates, toTemplate, formatTemplates, BOOKMARK_FIELDS };
