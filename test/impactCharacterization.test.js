"use strict";
// Slice 1A — freeze current validator behavior BEFORE the scanner-primitive extraction
// (lineAt/scanTags/attr/hasAttr moving from contracts.js to markupFacts.js) and before the
// impact-safe snapshot work. These tests pin the FULL finding objects and final order for a
// combined fixture; asserting only counts/messages would let a refactor drift silently.
//
// Fixture elements (each maps to one pinned finding or its deliberate absence):
//   pages/console.html      — page with a LITERAL nested fragment reference (c:fragment
//                             name="nested"; nested.html itself references "leaf") → no finding
//   pages/dynamic.html      — page with a ${frag} dynamic fragment reference → fragmentBinding
//   pages/missing.html      — page referencing a static fragment that is not shipped
//                             (fragments/nope.html absent) → missingFragment
//   pal.json pages.entry    — console.html registered EXACTLY (negative case → no finding);
//                             entry[3] is a flat malformed entry → malformedManifestEntry
//   pal.json fragments      — entry[2] has no Fragment.filename → missingManifestFilename;
//                             entry[3] filename prefixed "fragments/" → bannedFilenamePrefix
// Every page/fragment also deterministically triggers the structural warnings (pbMain/pbSection).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { lintContracts } = require("../src/core/validate/contracts");
const { lintPalJson } = require("../src/core/validate/palJson");
const { tmpWorkspace } = require("./helpers");

const FIXTURE = {
    "pages/console.html": [
        '<html><body><div id="content">',
        '  <c:fragment name="nested"/>',
        '</div></body></html>',
    ].join("\n"),
    "pages/dynamic.html": [
        '<html><body><div id="content">',
        '  <c:fragment name="${main}"/>',
        '</div></body></html>',
    ].join("\n"),
    "pages/missing.html": [
        '<html><body><div id="content">',
        '  <c:fragment name="nope"/>',
        '</div></body></html>',
    ].join("\n"),
    "fragments/nested.html": [
        '<html><body><div>',
        '  <c:fragment name="leaf"/>',
        '</div></body></html>',
    ].join("\n"),
    "fragments/leaf.html": '<html><body><div><p>leaf</p></div></body></html>',
    "workflows/console.js": "function run(controller) {}",
    "pal.json": JSON.stringify({
        pages: { entry: [
            { string: "console.html", Page: { name: "console", filename: "console.html" } },
            { string: "dynamic.html", Page: { name: "dynamic", filename: "dynamic.html" } },
            { string: "missing.html", Page: { name: "missing", filename: "missing.html" } },
            { string: "squashed.html", filename: "squashed.html" },
        ]},
        fragments: { entry: [
            { string: "nested.html", Fragment: { name: "nested", filename: "nested.html" } },
            { string: "leaf.html", Fragment: { name: "leaf", filename: "leaf.html" } },
            { string: "orphan.html", Fragment: { name: "orphan" } },
            { string: "prefixed.html", Fragment: { name: "prefixed", filename: "fragments/prefixed.html" } },
        ]},
        workflows: { entry: [
            { string: "console.js", Workflow: { name: "console", filename: "console.js" } },
        ]},
        styles: { entry: [] }, scripts: { entry: [] }, images: { entry: [] },
        emails: { entry: [] }, attachments: { entry: [] }, datasets: { entry: [] },
        wizards: { entry: [] },
        layout: { name: "console" },
    }, null, 4),
};

// Pinned from a pre-refactor run (2026-08-03): identical outputs on every run since. Final
// order = lintContracts' own sort (file asc, then line asc).
const EXPECTED_CONTRACTS = [
    {
        file: "fragments/leaf.html",
        line: 1,
        column: 0,
        severity: "warn",
        rule: "pbSection",
        message: "Fragment root is missing pb-section; every fragment root must include class pb-section.",
    },
    {
        file: "fragments/nested.html",
        line: 1,
        column: 0,
        severity: "warn",
        rule: "pbSection",
        message: "Fragment root is missing pb-section; every fragment root must include class pb-section.",
    },
    {
        file: "pages/console.html",
        line: 1,
        column: 0,
        severity: "warn",
        rule: "pbMain",
        message: "Page shell is missing pb-main; the shell must own the pb-main content region.",
    },
    {
        file: "pages/dynamic.html",
        line: 1,
        column: 0,
        severity: "warn",
        rule: "pbMain",
        message: "Page shell is missing pb-main; the shell must own the pb-main content region.",
    },
    {
        file: "pages/dynamic.html",
        line: 2,
        column: 0,
        severity: "error",
        rule: "fragmentBinding",
        message: "<c:fragment name=\"${main}\"> — no workflow ever sets payload key \"main\" (keys that are set: (no workflow sets any payload key)). The EL variable resolves empty, so the fragment placeholder renders NOTHING and the page is blank on full page load. Fix: in the workflow's non-AJAX path, payload.set(\"main\", <fragmentName>) before page.addPayload(payload). See the palbuilder-frontend skill tag reference, \"c:fragment\".",
    },
    {
        file: "pages/missing.html",
        line: 1,
        column: 0,
        severity: "warn",
        rule: "pbMain",
        message: "Page shell is missing pb-main; the shell must own the pb-main content region.",
    },
    {
        file: "pages/missing.html",
        line: 2,
        column: 0,
        severity: "error",
        rule: "missingFragment",
        message: "<c:fragment name=\"nope\"/> references fragments/nope.html, but that static fragment is not shipped. Fix: add fragments/nope.html (or change name= to an existing fragment path). See the palbuilder-frontend skill, \"c:fragment\".",
    },
];

const EXPECTED_PAL_JSON = [
    {
        file: "pal.json",
        line: 26,
        column: 0,
        severity: "error",
        rule: "malformedManifestEntry",
        message: "pal.json pages.entry[3] (\"string\": \"squashed.html\") has no \"Page\" object — push injects file content only through the \"Page\" wrapper, so this entry ships NOTHING and the server never receives the file (a flat top-level \"filename\" key is ignored). Replace it with this complete entry:\n{\n  \"string\": \"squashed.html\",\n  \"Page\": { \"name\": \"squashed\", \"filename\": \"squashed.html\" }\n}\nCopy any category-specific optional fields from pal-json.md only when needed.",
    },
    {
        file: "pal.json",
        line: 47,
        column: 0,
        severity: "error",
        rule: "missingManifestFilename",
        message: "pal.json fragments.entry[2].Fragment.filename is missing — the server REJECTS the whole save when a fragment entry has no filename, even when local lint is clean. Fix: set Fragment.filename to the category-relative file, e.g. { \"string\": \"orphan.html\", \"Fragment\": { \"name\": \"orphan.html\", \"filename\": \"orphan.html\" } }.",
    },
    {
        file: "pal.json",
        line: 57,
        column: 0,
        severity: "error",
        rule: "bannedFilenamePrefix",
        message: "pal.json fragments.entry[3].Fragment.filename \"fragments/prefixed.html\" repeats its own category folder — fragments are resolved by internal name lookup, so this pushes fine but BREAKS at runtime (the fragment silently renders nothing). Fix: use the category-relative value \"prefixed.html\".",
    },
];

test("characterization: lintContracts findings are exactly the pinned objects, in order", () => {
    const dir = tmpWorkspace(FIXTURE);
    try {
        assert.deepStrictEqual(lintContracts(dir), EXPECTED_CONTRACTS);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("characterization: lintPalJson findings are exactly the pinned objects, in order", () => {
    const dir = tmpWorkspace(FIXTURE);
    try {
        assert.deepStrictEqual(lintPalJson(dir), EXPECTED_PAL_JSON);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
