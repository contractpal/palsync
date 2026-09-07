"use strict";
// Unit tests for the documents/fonts push-creatability guard. Documents (both HTML and PDF
// content types) are creatable via push exactly like pages/fragments; fonts remain the one
// PalBuilder-only exception the server rejects outright and fails the whole transactional save.
// Also covers the non-array `entry` edge case (pal.json/getPal collapse a lone entry to a bare
// object, not a one-element array) via findStrayCreatable, and confirms field/signature
// sub-objects round-trip untouched. Pure, no network. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { guardUncreatableTypes, findStrayCreatable } = require("../src/core/push");
const { tmpWorkspace } = require("./helpers");

function htmlDoc(string, fields, signatures) {
    return {
        string,
        Document: {
            contentType: "text/html",
            filename: string,
            ...(fields ? { fields: { Field: fields } } : {}),
            ...(signatures ? { signatures: { Signature: signatures } } : {})
        }
    };
}
function pdfDoc(string, fields, signatures) {
    return {
        string,
        Document: {
            contentType: "application/pdf",
            filename: string,
            ...(fields ? { fields: { Field: fields } } : {}),
            ...(signatures ? { signatures: { Signature: signatures } } : {})
        }
    };
}
function font(string) { return { string, Font: { filename: string } }; }

test("a brand-new HTML document is NOT stripped — documents are creatable like pages/fragments", () => {
    const pal = { documents: { entry: [htmlDoc("htmlDoc.html")] } };
    const skipped = guardUncreatableTypes(pal, "/no/such/dir", { fonts: new Set() });
    assert.equal(skipped.length, 0);
    assert.deepEqual(pal.documents.entry.map(e => e.string), ["htmlDoc.html"]);
});

test("a brand-new PDF document is NOT stripped", () => {
    const pal = { documents: { entry: [pdfDoc("pdfDoc.pdf")] } };
    const skipped = guardUncreatableTypes(pal, "/no/such/dir", { fonts: new Set() });
    assert.equal(skipped.length, 0);
    assert.deepEqual(pal.documents.entry.map(e => e.string), ["pdfDoc.pdf"]);
});

test("a single new document (bare object, not array) is left alone — documents aren't in UNCREATABLE at all", () => {
    // pal.json / a getPal response collapse a lone repeated entry to a bare object.
    const pal = { documents: { entry: htmlDoc("onlyDoc.html") } };
    const skipped = guardUncreatableTypes(pal, "/no/such/dir", { fonts: new Set() });
    assert.equal(skipped.length, 0);
    assert.equal(pal.documents.entry.string, "onlyDoc.html");
});

test("HTML document field and signature definitions round-trip untouched", () => {
    const fields = [{ id: "name", x: 0, y: 0, width: 0, height: 0, page: 0, palDefined: false }];
    const signatures = [{ id: "sig1", type: "click", target: "", role: "signer", required: false, page: 0, x: 0, y: 0 }];
    const pal = { documents: { entry: [htmlDoc("htmlDoc.html", fields, signatures)] } };
    guardUncreatableTypes(pal, "/no/such/dir", { fonts: new Set() });
    assert.deepEqual(pal.documents.entry[0].Document.fields.Field, fields);
    assert.deepEqual(pal.documents.entry[0].Document.signatures.Signature, signatures);
});

test("PDF document field and signature coordinates round-trip untouched", () => {
    const fields = [{ id: "name", type: "TEXT", x: 332, y: 308, width: 200, height: 20, page: 1, palDefined: true }];
    const signatures = [{ id: "sig1", type: "click", target: "cp-root", role: "signer", required: false, page: 1, x: 378, y: 725 }];
    const pal = { documents: { entry: [pdfDoc("pdfDoc.pdf", fields, signatures)] } };
    guardUncreatableTypes(pal, "/no/such/dir", { fonts: new Set() });
    assert.deepEqual(pal.documents.entry[0].Document.fields.Field, fields);
    assert.deepEqual(pal.documents.entry[0].Document.signatures.Signature, signatures);
});

test("a brand-new font IS still stripped and reported — fonts remain PalBuilder-only", () => {
    const pal = { fonts: { entry: [font("brand.ttf")] } };
    const skipped = guardUncreatableTypes(pal, "/no/such/dir", { fonts: new Set() });
    assert.equal(pal.fonts.entry.length, 0);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].type, "fonts");
    assert.match(skipped[0].reason, /not creatable via push/);
});

test("an existing font (known to the server) is kept — editing is fine", () => {
    const pal = { fonts: { entry: [font("brand.ttf")] } };
    const skipped = guardUncreatableTypes(pal, "/no/such/dir", { fonts: new Set(["brand.ttf"]) });
    assert.equal(skipped.length, 0);
    assert.deepEqual(pal.fonts.entry.map(e => e.string), ["brand.ttf"]);
});

test("a single new font (bare object, not array) is still caught and stripped", () => {
    const pal = { fonts: { entry: font("onlyFont.ttf") } };
    const skipped = guardUncreatableTypes(pal, "/no/such/dir", { fonts: new Set() });
    assert.equal(pal.fonts.entry.length, 0);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].file, "onlyFont.ttf");
});

test("no baseline (serverKnown null) -> fonts are left untouched, let the server arbitrate", () => {
    const pal = { fonts: { entry: [font("brand.ttf")] } };
    const skipped = guardUncreatableTypes(pal, "/no/such/dir", null);
    assert.equal(skipped.length, 0);
    assert.equal(pal.fonts.entry.length, 1);
});

test("findStrayCreatable: HTML and PDF document files with a matching manifest entry are not flagged", () => {
    const dir = tmpWorkspace({
        "documents/htmlDoc.html": "<div>hi</div>",
        "documents/pdfDoc.pdf": "%PDF-1.4 fake"
    });
    try {
        const pal = { documents: { entry: [htmlDoc("htmlDoc.html"), pdfDoc("pdfDoc.pdf")] } };
        const stray = findStrayCreatable(pal, dir);
        assert.deepEqual(stray, []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("findStrayCreatable: a document file with NO manifest entry is reported (informational)", () => {
    const dir = tmpWorkspace({ "documents/orphan.pdf": "%PDF-1.4 fake" });
    try {
        const pal = { documents: { entry: [] } };
        const stray = findStrayCreatable(pal, dir);
        assert.deepEqual(stray, ["documents/orphan.pdf"]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("findStrayCreatable: a single document manifest entry (bare object) still matches its file", () => {
    const dir = tmpWorkspace({ "documents/onlyDoc.html": "<div>hi</div>" });
    try {
        const pal = { documents: { entry: htmlDoc("onlyDoc.html") } };
        const stray = findStrayCreatable(pal, dir);
        assert.deepEqual(stray, []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});