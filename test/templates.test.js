"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { CloudPistonAPIManager } = require("../lib/apiManager");
const { searchTemplates, parseTemplates, formatTemplates } = require("../src/core/templates");

// Shape captured live from SearchTemplates.do on test-vm1 (2026-10-06), icon trimmed.
function bm(texts) { return { Bookmark: texts.map((text, i) => ({ line: i + 1, text, type: "BOOKMARK", mnemonic: "" })) }; }
const GLOBAL = {
    content: "iVBOR\nw0KGgo=", contentType: "image/png", filename: "Template", palType: "global-PAL-LL-1A10D06AFD6-43ACB69B",
    bookmarks: bm(["Test Lab", "info@contractpal.com", "801-494-1861", "This is a modified template, Bob.", "Test Lab",
        "0.0.0.8", "Mon Oct 05 16:20:37 MDT 2026", "Global", "Accounting, Human Resources, Sales", "Education, Manufacturing, Health Care"])
};

test("parseTemplates maps the ten fixed bookmark lines to named fields", () => {
    const [t] = parseTemplates({ files: { Image: [GLOBAL] } });
    assert.equal(t.name, "Template");
    assert.equal(t.token, "global-PAL-LL-1A10D06AFD6-43ACB69B");
    assert.equal(t.publisher, "Test Lab");
    assert.equal(t.publisherEmail, "info@contractpal.com");
    assert.equal(t.description, "This is a modified template, Bob.");
    assert.equal(t.version, "0.0.0.8");
    assert.equal(t.source, "Global");
    assert.deepEqual(t.categories, ["Accounting", "Human Resources", "Sales"]);
    assert.deepEqual(t.industries, ["Education", "Manufacturing", "Health Care"]);
    assert.equal(t.icon, undefined, "the base64 icon is opt-in");
});

test("icon is returned only on request, with whitespace stripped", () => {
    const [t] = parseTemplates({ files: { Image: [GLOBAL] } }, { includeIcon: true });
    assert.deepEqual(t.icon, { contentType: "image/png", base64: "iVBORw0KGgo=" });
});

test("parser quirks: one template collapses to a bare object, none to an empty string", () => {
    assert.equal(parseTemplates({ files: { Image: GLOBAL } }).length, 1);
    assert.deepEqual(parseTemplates({ files: "" }), []);
    assert.deepEqual(parseTemplates({}), []);
    assert.deepEqual(parseTemplates(undefined), []);
});

test("a template with a single bookmark or none still yields every field", () => {
    const one = parseTemplates({ files: { Image: { filename: "x", palType: "t", bookmarks: { Bookmark: { line: 4, text: "only desc" } } } } })[0];
    assert.equal(one.description, "only desc");
    assert.equal(one.publisher, "");
    assert.deepEqual(one.categories, []);
    const none = parseTemplates({ files: { Image: { filename: "y", palType: "u", bookmarks: "" } } })[0];
    assert.equal(none.description, "");
});

test("searchTemplates passes the trimmed term and reports transport failures", async () => {
    const real = CloudPistonAPIManager.searchTemplates;
    const seen = [];
    try {
        CloudPistonAPIManager.searchTemplates = async (s, term) => { seen.push(term); return { success: true, files: { Image: [GLOBAL] } }; };
        const ok = await searchTemplates({}, { search: "  template " });
        assert.equal(ok.ok, true);
        assert.equal(ok.templates.length, 1);
        await searchTemplates({}, {});
        assert.deepEqual(seen, ["template", ""]);

        CloudPistonAPIManager.searchTemplates = async () => undefined;
        const bad = await searchTemplates({ lastTransport: { status: 404, ok: false } });
        assert.equal(bad.ok, false);
        assert.match(bad.error, /HTTP 404/);
        assert.equal(formatTemplates(bad), bad.error);
    } finally {
        CloudPistonAPIManager.searchTemplates = real;
    }
});

test("apiManager encodes the search term onto the endpoint", async () => {
    const real = CloudPistonAPIManager.fetchAPI;
    let endpoint;
    try {
        CloudPistonAPIManager.fetchAPI = async (s, e) => { endpoint = e; return {}; };
        await CloudPistonAPIManager.searchTemplates({}, "health care & more");
        assert.equal(endpoint, "SearchTemplates.do?search=health%20care%20%26%20more");
        await CloudPistonAPIManager.searchTemplates({}, "");
        assert.equal(endpoint, "SearchTemplates.do");
    } finally {
        CloudPistonAPIManager.fetchAPI = real;
    }
});

test("buildPalInfoEx carries templateId in the body only when given", () => {
    const { buildPalInfoEx } = require("../src/core/createPal");
    const base = { name: "n", groupIds: ["g"], activationKeyId: "k" };
    assert.equal(buildPalInfoEx(base).templateId, undefined);
    assert.equal(buildPalInfoEx({ ...base, templateId: "global-PAL-1" }).templateId, "global-PAL-1");
});

test("getTemplate returns the image, and surfaces the server's own message on failure", async () => {
    const { getTemplate } = require("../src/core/templates");
    const real = CloudPistonAPIManager.getTemplate;
    try {
        CloudPistonAPIManager.getTemplate = async () => ({ success: true, files: { Image: GLOBAL } });
        const ok = await getTemplate({}, "tok");
        assert.equal(ok.ok, true);
        assert.equal(ok.template.name, "Template");
        assert.equal(ok.template.icon.contentType, "image/png");

        CloudPistonAPIManager.getTemplate = async () => ({ success: false, messages: { "com.contractpal.Message": { message: "Error decrypting Secure ID", type: "error" } } });
        const bad = await getTemplate({}, "bogus");
        assert.deepEqual(bad, { ok: false, error: "Error decrypting Secure ID" });

        assert.equal((await getTemplate({}, "")).ok, false);
    } finally {
        CloudPistonAPIManager.getTemplate = real;
    }
});
