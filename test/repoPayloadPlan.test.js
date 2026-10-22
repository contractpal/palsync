"use strict";
// Turning a baseline diff into the precise per-file repository edit: which files become INSERT /
// UPDATE / DELETE, which are deliberately left alone, and which keep their bytes in the request.
const { test } = require("node:test");
const assert = require("node:assert");
const { ACTION, planRepositoryPush, stripUnchangedContent, relToItem } = require("../src/core/repoPayload");

test("relToItem maps workspace paths to payload types and ignores non-repository files", () => {
    assert.deepEqual(relToItem("fragments/a/b.html"), { type: "fragment", name: "a/b.html" });
    assert.deepEqual(relToItem("attachments/form.docx"), { type: "attachment", name: "form.docx" });
    assert.equal(relToItem("datasets/x.json"), null);
    assert.equal(relToItem("pal.json"), null);
});

test("plan: added -> INSERT, changed -> UPDATE, deleted+unlisted -> DELETE; content only for insert/update", () => {
    const manifest = new Set(["pages/new.html", "pages/edited.html", "attachments/untouched.docx"]);
    const plan = planRepositoryPush({
        added: ["pages/new.html"],
        changed: ["pages/edited.html"],
        deleted: ["images/gone.png"]
    }, manifest);
    assert.deepEqual(plan.items, [
        { action: ACTION.INSERT, type: "page", name: "new.html" },
        { action: ACTION.UPDATE, type: "page", name: "edited.html" },
        { action: ACTION.DELETE, type: "image", name: "gone.png" }
    ]);
    assert.deepEqual([...plan.contentRels].sort(), ["pages/edited.html", "pages/new.html"]);
    assert.deepEqual(plan.skipped, []);
});

test("plan: a file new to the baseline that the SERVER already has is UPDATE, never INSERT (INSERT would duplicate the row)", () => {
    const manifest = new Set(["pages/existing.html", "pages/brand-new.html"]);
    const plan = planRepositoryPush({ added: ["pages/existing.html", "pages/brand-new.html"], changed: [], deleted: [] },
        manifest, new Set(["pages/existing.html"]));
    assert.deepEqual(plan.items, [
        { action: ACTION.UPDATE, type: "page", name: "existing.html" },
        { action: ACTION.INSERT, type: "page", name: "brand-new.html" }
    ]);
});

test("plan: a file missing locally but still listed is NOT a delete; an unlisted new/edited file is not pushed", () => {
    const plan = planRepositoryPush({
        added: ["pages/stray.html"],
        changed: ["pages/unlisted.html"],
        deleted: ["attachments/never-downloaded.docx"]
    }, new Set(["attachments/never-downloaded.docx"]));
    assert.deepEqual(plan.items, []);
    assert.equal(plan.skipped.length, 3);
    assert.match(plan.skipped.find(s => s.rel === "attachments/never-downloaded.docx").reason, /not downloaded, not deleted/);
});

test("plan: data/dataset and pal.json changes are not repository items", () => {
    const plan = planRepositoryPush({ added: ["datasets/t.json"], changed: ["pal.json"], deleted: ["datalists/x.json"] }, new Set());
    assert.deepEqual(plan.items, []);
    assert.deepEqual(plan.skipped, []);
});

test("stripUnchangedContent keeps bytes only for the pushed files", () => {
    const e = (string, key) => ({ string, [key]: { filename: string, content: "AAAA" } });
    const pal = {
        pages: { entry: [e("edit.html", "Page"), e("same.html", "Page")] },
        attachments: { entry: e("one.docx", "Attachment") },       // a single entry is not an array
        workflows: { entry: [e("w.js", "Workflow")] }
    };
    stripUnchangedContent(pal, new Set(["pages/edit.html"]));
    assert.equal(pal.pages.entry[0].Page.content, "AAAA");
    assert.ok(!("content" in pal.pages.entry[1].Page));
    assert.ok(!("content" in pal.attachments.entry.Attachment));
    assert.ok(!("content" in pal.workflows.entry[0].Workflow));
    assert.equal(pal.pages.entry[1].Page.filename, "same.html", "the entry itself stays in the pal");
});
