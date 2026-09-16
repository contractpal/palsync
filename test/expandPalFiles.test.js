"use strict";
// Regression: CloudPiston can wrap a leaf value as a { _text, _class } node (the same shape
// resolve.js's timestampText exists to unwrap for lastModifiedDate) instead of a plain string.
// expandPalFiles previously assumed entry[key].content was always a plain base64 string, so a
// wrapped content node reached Buffer.from() as a raw object and crashed the whole pull with
// "The first argument must be of type string ... Received an instance of Object" — surfaced in
// the GUI's checkout wizard as a "Pull the pal's files" failure. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { tmpWorkspace } = require("./helpers");
const { expandPalFiles } = require("../src/core/pull");

test("expandPalFiles unwraps a { _text } base64 content node instead of crashing", async () => {
    const dir = tmpWorkspace();
    try {
        const base64 = Buffer.from("hello world").toString("base64");
        const pal = { path: dir, allPages: [{ string: "home.html", Page: { content: { _text: base64, _class: "string" } } }] };
        for (const getter of ["allAttachments", "allDocuments", "allEmails", "allFragments", "allImages",
            "allScripts", "allStyles", "allWorkflows", "allWizards"]) pal[getter] = [];
        for (const getter of ["allData", "allDatalists", "allDatasets", "allDataviews"]) pal[getter] = [];

        const written = await expandPalFiles(pal);

        assert.deepEqual(written.base64, [path.join("pages", "home.html")]);
        assert.equal(fs.readFileSync(path.join(dir, "pages", "home.html"), "utf8"), "hello world");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("expandPalFiles still handles an ordinary plain-string base64 content field", async () => {
    const dir = tmpWorkspace();
    try {
        const base64 = Buffer.from("plain string content").toString("base64");
        const pal = { path: dir, allPages: [{ string: "home.html", Page: { content: base64 } }] };
        for (const getter of ["allAttachments", "allDocuments", "allEmails", "allFragments", "allImages",
            "allScripts", "allStyles", "allWorkflows", "allWizards"]) pal[getter] = [];
        for (const getter of ["allData", "allDatalists", "allDatasets", "allDataviews"]) pal[getter] = [];

        await expandPalFiles(pal);

        assert.equal(fs.readFileSync(path.join(dir, "pages", "home.html"), "utf8"), "plain string content");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
