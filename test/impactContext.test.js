"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const {
    buildStructuralImpact,
    resolveImpactTarget,
    formatImpactResult,
    validateImpactTarget,
    cmpText,
} = require("../src/core/impactContext");

function hash(content) {
    return crypto.createHash("sha256").update(content).digest("hex");
}

function snapshot(files, { skippedInputs = [], palJson = null } = {}) {
    const markup = Object.entries(files).map(([rel, content]) => ({ rel, content }));
    const contentHashByRel = Object.fromEntries(markup.map(file => [file.rel, hash(file.content)]));
    if (palJson !== null) contentHashByRel["pal.json"] = hash(palJson);
    let parsed = null;
    try { if (palJson !== null) parsed = JSON.parse(palJson); } catch (e) { /* malformed fixture */ }
    return {
        workspaceDir: "/unused",
        markup,
        workflows: [],
        stylesheets: [],
        datasets: [],
        palJson: { raw: palJson, parsed },
        contentHashByRel,
        allFiles: [...Object.keys(files), ...(palJson === null ? [] : ["pal.json"])],
        skippedInputs,
    };
}

function query(files, target, options) {
    const analysis = buildStructuralImpact(snapshot(files, options), options && options.record);
    return resolveImpactTarget(analysis, target);
}

function exactSource(file, line, value) {
    return { file, line, field: "name", value };
}

function assertEnvelope(result) {
    const envelope = formatImpactResult(result);
    assert.deepStrictEqual(JSON.parse(envelope.message), envelope.ran ? envelope.impact : envelope.error);
    assert.ok(Buffer.byteLength(envelope.message, "utf8") <= 4096);
    return envelope;
}

test("1. page has an exact nested fragment dependency with the final schema", () => {
    const files = {
        "pages/home.html": "<main>\n<c:fragment name=\"/shared/Nav\"/>\n</main>",
        "fragments/shared/Nav.HTML": "<nav/>",
    };
    const impact = query(files, "pages/home.html", { record: { lastModifiedDate: "2026-08-03 01:02:03" } });
    assert.deepStrictEqual(impact, {
        schema: "palsync/impact/1",
        target: "pages/home.html",
        source: "localWorkspaceSnapshot",
        freshness: {
            analysisFingerprint: impact.freshness.analysisFingerprint,
            targetHash: "sha256:" + hash(files["pages/home.html"]),
            lastKnownServerModifiedDate: "2026-08-03 01:02:03",
            serverChecked: false,
        },
        coverage: {
            analyzed: [
                "local pal.json page/fragment registration rules listed in registration.checksApplied",
                "literal c:fragment references in pages/ and fragments/",
            ],
            notAnalyzed: [
                "emails",
                "workflow text/runtime fragment selection",
                "store settings",
                "server-only state",
                "transitive relationships",
            ],
            possibleDynamicIncoming: 0,
            possibleDynamicIncomingMeaning: "Unattributed dynamic references elsewhere may or may not resolve to this target.",
        },
        directDependencies: [{
            class: "exactReference",
            kind: "static-fragment-reference",
            source: exactSource("pages/home.html", 2, "/shared/Nav"),
            target: { file: "fragments/shared/Nav.HTML", identity: "fragments/shared/Nav" },
        }],
        directDependents: [],
        registration: {
            status: "absent",
            section: "pages",
            pointer: null,
            checksApplied: [],
            checksNotApplied: ["server-save-validation"],
            reasons: ["manifest-absent"],
            evidencePointers: [],
            evidenceOmitted: 0,
        },
        candidateMatches: [],
        unresolvedDynamic: [],
        omitted: {
            directDependencies: 0,
            directDependents: 0,
            candidateMatches: 0,
            unresolvedDynamic: 0,
        },
    });
    assert.match(impact.freshness.analysisFingerprint, /^sha256:[0-9a-f]{64}$/);
    const envelope = assertEnvelope(impact);
    assert.strictEqual(envelope.ran, true);
});

test("2. queried fragment reports literal dependents from two files", () => {
    const impact = query({
        "pages/a.html": '<c:fragment name="shared/nav"/>',
        "fragments/b.html": '\n<c:fragment name="shared/nav"/>',
        "fragments/shared/nav.html": "<nav/>",
    }, "fragments/shared/nav.html");
    assert.deepStrictEqual(impact.directDependents.map(record => record.source), [
        exactSource("fragments/b.html", 2, "shared/nav"),
        exactSource("pages/a.html", 1, "shared/nav"),
    ]);
});

test("3. nested fragment has an exact nested fragment dependency", () => {
    const impact = query({
        "fragments/shell.html": '<c:fragment name="shared/leaf"/>',
        "fragments/shared/leaf.xhtml": "leaf",
    }, "fragments/shell.html");
    assert.deepStrictEqual(impact.directDependencies[0].target, {
        file: "fragments/shared/leaf.xhtml",
        identity: "fragments/shared/leaf",
    });
});

test("4. pages are never fragment targets", () => {
    const impact = query({
        "pages/home.html": "home",
        "pages/consumer.html": '<c:fragment name="home"/>',
    }, "pages/home.html");
    assert.deepStrictEqual(impact.directDependents, []);
    assert.strictEqual(impact.candidateMatches.length, 0);
});

test("5. target-local ${frag} appears only as unresolved dynamic", () => {
    const impact = query({
        "pages/home.html": '<c:fragment name="${frag}"/>',
        "fragments/frag.html": "frag",
    }, "pages/home.html");
    assert.deepStrictEqual(impact.directDependencies, []);
    assert.deepStrictEqual(impact.candidateMatches, []);
    assert.deepStrictEqual(impact.unresolvedDynamic, [{
        class: "unresolvedDynamic",
        kind: "dynamic-fragment-reference",
        source: exactSource("pages/home.html", 1, "${frag}"),
        reason: "Fragment name is computed at runtime; no target was inferred.",
    }]);
});

test("6. mixed literal/expression fragment names are dynamic", () => {
    const impact = query({
        "pages/home.html": '<c:fragment name="prefix-${frag}"/>',
        "fragments/prefix-x.html": "x",
    }, "pages/home.html");
    assert.strictEqual(impact.unresolvedDynamic[0].source.value, "prefix-${frag}");
    assert.deepStrictEqual(impact.directDependencies, []);
});

test("7. dynamics in other files count as possible incoming only", () => {
    const impact = query({
        "pages/home.html": "home",
        "pages/a.html": '<c:fragment name="${one}"/>',
        "fragments/b.html": '<c:fragment name="prefix-${two}"/>',
    }, "pages/home.html");
    assert.strictEqual(impact.coverage.possibleDynamicIncoming, 2);
    assert.deepStrictEqual(impact.unresolvedDynamic, []);
    assert.deepStrictEqual(impact.directDependents, []);
});

test("8. missing and empty literal names are candidates with distinct values", () => {
    const impact = query({
        "pages/home.html": "<c:fragment/>\n<c:fragment name=\"\"/>\n<c:fragment name=\"missing\"/>",
    }, "pages/home.html");
    assert.deepStrictEqual(impact.candidateMatches.map(record => [record.kind, record.source.value]), [
        ["invalid-static-name", null],
        ["invalid-static-name", ""],
        ["missing-static-target", "missing"],
    ]);
    assert.strictEqual(impact.candidateMatches[2].reason,
        "No local fragment file has this exact runtime identity.");
});

test("9. extension-bearing names are invalid-static-name candidates", () => {
    const impact = query({
        "pages/home.html": '<c:fragment name="nav.HTML"/>',
        "fragments/nav.html": "nav",
    }, "pages/home.html");
    assert.deepStrictEqual(impact.directDependencies, []);
    assert.deepStrictEqual(impact.candidateMatches[0], {
        class: "candidateMatch",
        kind: "invalid-static-name",
        source: exactSource("pages/home.html", 1, "nav.HTML"),
        candidateIdentity: "fragments/nav.HTML",
        reason: "Fragment name must be a non-empty extensionless literal.",
    });
});

test("10. duplicate terminal extensions make an ambiguous candidate without an edge", () => {
    const files = {
        "pages/home.html": '<c:fragment name="nav"/>',
        "fragments/nav.html": "html",
        "fragments/nav.htm": "htm",
    };
    const page = query(files, "pages/home.html");
    assert.deepStrictEqual(page.directDependencies, []);
    assert.strictEqual(page.candidateMatches[0].kind, "ambiguous-static-target");

    const duplicateTarget = query(files, "fragments/nav.html");
    assert.strictEqual(duplicateTarget.schema, "palsync/impact/1");
    assert.deepStrictEqual(duplicateTarget.directDependents, []);
    assert.strictEqual(duplicateTarget.candidateMatches[0].candidateIdentity, "fragments/nav");
});

test("11. a self-reference is emitted once per applicable direct view without recursion", () => {
    const impact = query({
        "fragments/self.html": '<c:fragment name="self"/>',
    }, "fragments/self.html");
    assert.strictEqual(impact.directDependencies.length, 1);
    assert.strictEqual(impact.directDependents.length, 1);
    assert.deepStrictEqual(impact.directDependencies[0], impact.directDependents[0]);
});

test("12. comment, script, and style fake tags are ignored", () => {
    const impact = query({
        "pages/home.html": [
            '<!-- <c:fragment name="comment"/> -->',
            '<script>const fake = `<c:fragment name="script"/>`;</script>',
            '<style>x { content: "<c:fragment name=\\"style\\"/>"; }</style>',
            '<c:fragment name="real"/>',
        ].join("\n"),
        "fragments/real.html": "real",
    }, "pages/home.html");
    assert.strictEqual(impact.directDependencies.length, 1);
    assert.strictEqual(impact.directDependencies[0].source.value, "real");
    assert.deepStrictEqual(impact.candidateMatches, []);
});

test("13. quoted greater-than signs are parsed as attribute content", () => {
    const impact = query({
        "pages/home.html": '<c:fragment name="nav>wide" data-x="a>b"/>',
        "fragments/nav>wide.html": "wide",
    }, "pages/home.html");
    assert.strictEqual(impact.directDependencies[0].source.value, "nav>wide");
    assert.strictEqual(impact.directDependencies[0].target.file, "fragments/nav>wide.html");
});

test("14. target validation and skipped-target precedence follow the exact path matrix", () => {
    const malformed = [
        "", " pages/a.html", "pages/a.html ", "pages\\a.html", "C:pages/a.html",
        "//server/a.html", "/pages/a.html", "pages/./a.html", "pages/x/../a.html",
        "pages//a.html", "pages/a.html/", "assets/a.html", "pages/a.txt", "Pages/a.html",
    ];
    for (const target of malformed) {
        const error = validateImpactTarget(target);
        assert.strictEqual(error.error.code, "invalid-target", target);
        assert.strictEqual(error.target, target, target);
        assert.strictEqual(error.serverChecked, false);
        assertEnvelope(error);
    }
    const nul = validateImpactTarget("pages/a\0.html");
    assert.strictEqual(nul.target, null);
    assertEnvelope(nul);
    const overlong = validateImpactTarget("pages/" + "a".repeat(502) + ".html");
    assert.strictEqual(overlong.target, null);
    assertEnvelope(overlong);
    assert.strictEqual(validateImpactTarget("pages/" + "a".repeat(501) + ".html"), null);
    assert.strictEqual(validateImpactTarget("fragments/a.XHTML"), null);

    const unsafeAnalysis = buildStructuralImpact(snapshot({}, {
        skippedInputs: [{ rel: "fragments/shared", reason: "symlink" }],
    }), null);
    const unsafe = resolveImpactTarget(unsafeAnalysis, "fragments/shared/nav.html");
    assert.strictEqual(unsafe.error.code, "unsafe-target");
    assert.strictEqual(unsafe.target, null);
    assertEnvelope(unsafe);

    for (const reason of ["notRegular", "invalidUtf8", "unreadable"]) {
        const analysis = buildStructuralImpact(snapshot({}, {
            skippedInputs: [{ rel: "pages/a.html", reason }],
        }), null);
        const error = resolveImpactTarget(analysis, "pages/a.html");
        assert.strictEqual(error.error.code, "unreadable-target", reason);
        assert.strictEqual(error.target, "pages/a.html");
        assertEnvelope(error);
    }
    const absent = query({}, "pages/a.html");
    assert.strictEqual(absent.error.code, "target-not-found");
    assert.strictEqual(absent.target, "pages/a.html");
    assertEnvelope(absent);
});

test("15. sorting and fingerprinting are code-point deterministic across input order", () => {
    const files = {
        "pages/ä.html": '<c:fragment name="missing-z"/>',
        "pages/z.html": '<c:fragment name="missing-a"/>',
        "pages/A.html": '<c:fragment name="missing-m"/>',
    };
    const firstSnapshot = snapshot(files, {
        skippedInputs: [
            { rel: "fragments/Ω.html", reason: "invalidUtf8" },
            { rel: "fragments/B.html", reason: "unreadable" },
        ],
    });
    const secondSnapshot = {
        ...firstSnapshot,
        markup: firstSnapshot.markup.slice().reverse(),
        skippedInputs: firstSnapshot.skippedInputs.slice().reverse(),
    };
    const first = buildStructuralImpact(firstSnapshot, null);
    const second = buildStructuralImpact(secondSnapshot, null);
    assert.strictEqual(first.analysisFingerprint, second.analysisFingerprint);
    assert.deepStrictEqual(first.candidates, second.candidates);
    assert.deepStrictEqual(first.candidates.map(record => record.source.file), [
        "pages/A.html", "pages/z.html", "pages/ä.html",
    ]);
    assert.deepStrictEqual(["ä", "z", "A"].sort(cmpText), ["A", "z", "ä"]);
});

test("17. Slice 1C registration classification follows current local rules", async t => {
    const pageFile = { "pages/home.html": "home" };
    const fragmentFile = { "fragments/nav.html": "nav" };
    const manifest = value => ({ palJson: JSON.stringify(value) });
    const base = (section, overrides = {}) => ({
        status: "absent",
        section,
        pointer: null,
        checksApplied: [],
        checksNotApplied: ["server-save-validation"],
        reasons: [],
        evidencePointers: [],
        evidenceOmitted: 0,
        ...overrides,
    });

    await t.test("1. canonical exact Page is locally valid with honest omissions", () => {
        const impact = query(pageFile, "pages/home.html", manifest({ pages: { entry: [
            { string: "home.html", Page: { name: "home", filename: "home.html" } },
        ] } }));
        assert.deepStrictEqual(impact.registration, base("pages", {
            status: "locallyValid",
            pointer: "/pages/entry/0",
            checksApplied: ["manifest-json", "section-entry-array", "entry-string-identity",
                "entry-shape", "local-file-present", "unique-file-identity"],
            checksNotApplied: ["server-save-validation", "body-name-identity", "page-wrapper-filename"],
            evidencePointers: ["/pages/entry/0"],
        }));
    });

    await t.test("2. lowercase page wrapper remains locally valid", () => {
        const impact = query(pageFile, "pages/home.html", manifest({ pages: { entry: [
            { string: "home.html", page: { name: "anything", filename: "elsewhere.html" } },
        ] } }));
        assert.strictEqual(impact.registration.status, "locallyValid");
        assert.deepStrictEqual(impact.registration.checksNotApplied,
            ["server-save-validation", "body-name-identity", "page-wrapper-filename"]);
    });

    await t.test("3. canonical exact Fragment with filename is locally valid", () => {
        const impact = query(fragmentFile, "fragments/nav.html", manifest({ fragments: { entry: [
            { string: "nav.html", Fragment: { name: "nav", filename: "nav.html" } },
        ] } }));
        assert.deepStrictEqual(impact.registration, base("fragments", {
            status: "locallyValid",
            pointer: "/fragments/entry/0",
            checksApplied: ["manifest-json", "section-entry-array", "entry-string-identity",
                "entry-shape", "fragment-filename-present", "category-prefix-absent",
                "local-file-present", "unique-file-identity"],
            checksNotApplied: ["server-save-validation", "body-name-identity",
                "fragment-filename-equals-entry"],
            evidencePointers: ["/fragments/entry/0"],
        }));
    });

    await t.test("4. canonical Fragment missing filename is locally invalid", () => {
        const impact = query(fragmentFile, "fragments/nav.html", manifest({ fragments: { entry: [
            { string: "nav.html", Fragment: { name: "nav" } },
        ] } }));
        assert.strictEqual(impact.registration.status, "locallyInvalid");
        assert.deepStrictEqual(impact.registration.reasons, ["fragment-filename-missing"]);
        assert.ok(impact.registration.checksApplied.includes("fragment-filename-present"));
        assert.ok(!impact.registration.checksApplied.includes("category-prefix-absent"));
    });

    await t.test("5. canonical Fragment category prefix is locally invalid", () => {
        const impact = query(fragmentFile, "fragments/nav.html", manifest({ fragments: { entry: [
            { string: "nav.html", Fragment: { name: "nav", filename: "fragments/nav.html" } },
        ] } }));
        assert.strictEqual(impact.registration.status, "locallyInvalid");
        assert.deepStrictEqual(impact.registration.reasons, ["fragment-filename-prefixed"]);
        assert.ok(impact.registration.checksApplied.includes("category-prefix-absent"));
    });

    await t.test("6. lowercase fragment wrapper is a candidate", () => {
        const impact = query(fragmentFile, "fragments/nav.html", manifest({ fragments: { entry: [
            { string: "nav.html", fragment: { name: "nav", filename: "nav.html" } },
        ] } }));
        assert.strictEqual(impact.registration.status, "candidate");
        assert.deepStrictEqual(impact.registration.reasons, ["lowercase-fragment-wrapper"]);
        assert.deepStrictEqual(impact.registration.checksNotApplied, ["server-save-validation",
            "body-name-identity", "fragment-filename-equals-entry", "lowercase-fragment-filename-rules"]);
    });

    await t.test("7. flat exact entry is locally invalid", () => {
        const impact = query(pageFile, "pages/home.html", manifest({ pages: { entry: [
            { string: "home.html", filename: "home.html" },
        ] } }));
        assert.strictEqual(impact.registration.status, "locallyInvalid");
        assert.deepStrictEqual(impact.registration.reasons, ["entry-shape-invalid"]);
    });

    await t.test("8. Fragment filename mismatch stays locally valid with an omission", () => {
        const impact = query(fragmentFile, "fragments/nav.html", manifest({ fragments: { entry: [
            { string: "nav.html", Fragment: { name: "other", filename: "other.html" } },
        ] } }));
        assert.strictEqual(impact.registration.status, "locallyValid");
        assert.ok(impact.registration.checksNotApplied.includes("fragment-filename-equals-entry"));
        assert.deepStrictEqual(impact.registration.reasons, []);
    });

    await t.test("9. absent manifest is absent", () => {
        const impact = query(pageFile, "pages/home.html");
        assert.deepStrictEqual(impact.registration, base("pages", { reasons: ["manifest-absent"] }));
    });

    await t.test("10. malformed manifest JSON is a candidate and never throws", () => {
        const impact = query(pageFile, "pages/home.html", { palJson: "{ nope" });
        assert.deepStrictEqual(impact.registration, base("pages", {
            status: "candidate",
            checksApplied: ["manifest-json"],
            reasons: ["manifest-unparseable"],
        }));
    });

    await t.test("11. malformed section is a candidate", () => {
        const impact = query(pageFile, "pages/home.html", manifest({ pages: [] }));
        assert.deepStrictEqual(impact.registration, base("pages", {
            status: "candidate",
            checksApplied: ["manifest-json", "section-entry-array"],
            reasons: ["section-malformed"],
        }));
    });

    await t.test("12. well-shaped section with no entry is absent", () => {
        const impact = query(pageFile, "pages/home.html", manifest({ pages: { entry: [] } }));
        assert.deepStrictEqual(impact.registration, base("pages", {
            checksApplied: ["manifest-json", "section-entry-array", "entry-string-identity"],
            reasons: ["entry-absent"],
        }));
    });

    await t.test("13. every current near-match shape is a candidate only", () => {
        const variants = [
            { entry: { string: "home" }, pointer: "/pages/entry/0/string" },
            { entry: { filename: "home.html" }, pointer: "/pages/entry/0/filename" },
        ];
        for (const key of ["Page", "page", "Fragment", "fragment"]) {
            variants.push({
                entry: { [key]: { filename: "home.html" } },
                pointer: `/pages/entry/0/${key}/filename`,
            });
            for (const name of ["home.html", "home"]) {
                variants.push({
                    entry: { [key]: { name } },
                    pointer: `/pages/entry/0/${key}/name`,
                });
            }
        }
        for (const variant of variants) {
            const impact = query(pageFile, "pages/home.html", manifest({ pages: { entry: [variant.entry] } }));
            assert.strictEqual(impact.registration.status, "candidate", variant.pointer);
            assert.deepStrictEqual(impact.registration.reasons, ["near-match"], variant.pointer);
            assert.deepStrictEqual(impact.registration.evidencePointers, [variant.pointer], variant.pointer);
            assert.deepStrictEqual(impact.candidateMatches, [], variant.pointer);
        }
    });

    await t.test("14. duplicate exact entries are a capped pointer-only candidate", () => {
        const entries = Array.from({ length: 10 }, () => ({
            string: "home.html", Page: { name: "home", filename: "home.html" },
        }));
        const impact = query(pageFile, "pages/home.html", manifest({ pages: { entry: entries } }));
        assert.strictEqual(impact.registration.status, "candidate");
        assert.strictEqual(impact.registration.pointer, null);
        assert.deepStrictEqual(impact.registration.reasons, ["duplicate-entry-string"]);
        assert.deepStrictEqual(impact.registration.evidencePointers,
            Array.from({ length: 8 }, (_, i) => `/pages/entry/${i}`));
        assert.strictEqual(impact.registration.evidenceOmitted, 2);
        assert.deepStrictEqual(impact.candidateMatches, []);
    });

    await t.test("15. duplicate runtime file identity is a candidate", () => {
        const files = { "fragments/nav.html": "html", "fragments/nav.htm": "htm" };
        const impact = query(files, "fragments/nav.html", manifest({ fragments: { entry: [
            { string: "nav.html", Fragment: { name: "nav", filename: "nav.html" } },
        ] } }));
        assert.strictEqual(impact.registration.status, "candidate");
        assert.deepStrictEqual(impact.registration.reasons, ["duplicate-file-identity"]);
        assert.deepStrictEqual(impact.candidateMatches, []);
    });

    // Case 16 is the byte/deep-equal lintPalJson characterization in impactCharacterization.test.js.
});

test("16. marker provenance, envelopes, and 4096-byte budgeting stay exact", () => {
    const files = {
        "pages/home.html": '<c:fragment name="nav"/>',
        "fragments/nav.html": "nav",
    };
    const fromRecord = query(files, "pages/home.html", {
        record: { lastModifiedDate: "record-marker" },
    });
    assert.strictEqual(fromRecord.freshness.lastKnownServerModifiedDate, "record-marker");
    assert.strictEqual(fromRecord.freshness.serverChecked, false);
    const withoutRecord = query(files, "pages/home.html");
    assert.strictEqual(withoutRecord.freshness.lastKnownServerModifiedDate, null);

    const errorEnvelope = assertEnvelope(validateImpactTarget("bad"));
    assert.strictEqual(errorEnvelope.ran, false);
    assert.strictEqual(errorEnvelope.error.serverChecked, false);

    const large = structuredClone(fromRecord);
    const longValue = "x".repeat(350);
    const makeExact = (prefix, index) => ({
        class: "exactReference",
        kind: "static-fragment-reference",
        source: exactSource(`pages/${prefix}-${index}.html`, index + 1, longValue + index),
        target: { file: `fragments/${prefix}-${index}.html`, identity: `fragments/${prefix}-${index}` },
    });
    const makeDynamic = index => ({
        class: "unresolvedDynamic",
        kind: "dynamic-fragment-reference",
        source: exactSource(`pages/dynamic-${index}.html`, index + 1, "${" + longValue + index + "}"),
        reason: "Fragment name is computed at runtime; no target was inferred.",
    });
    const makeCandidate = index => ({
        class: "candidateMatch",
        kind: "missing-static-target",
        source: exactSource(`pages/candidate-${index}.html`, index + 1, longValue + index),
        candidateIdentity: `fragments/${longValue}${index}`,
        reason: "No local fragment file has this exact runtime identity.",
    });
    large.directDependencies = Array.from({ length: 4 }, (_, i) => makeExact("dep", i));
    large.directDependents = Array.from({ length: 4 }, (_, i) => makeExact("incoming", i));
    large.unresolvedDynamic = Array.from({ length: 4 }, (_, i) => makeDynamic(i));
    large.candidateMatches = Array.from({ length: 4 }, (_, i) => makeCandidate(i));

    const budgeted = assertEnvelope(large);
    assert.strictEqual(budgeted.ran, true);
    assert.deepStrictEqual(budgeted.impact.directDependencies, large.directDependencies.slice(0, 2));
    assert.deepStrictEqual(budgeted.impact.directDependents, large.directDependents.slice(0, 2));
    assert.deepStrictEqual(budgeted.impact.unresolvedDynamic, large.unresolvedDynamic.slice(0, 1));
    assert.deepStrictEqual(budgeted.impact.candidateMatches, []);
    for (const field of ["directDependencies", "directDependents", "unresolvedDynamic", "candidateMatches"]) {
        assert.strictEqual(
            budgeted.impact[field].length + budgeted.impact.omitted[field],
            large[field].length,
            field
        );
        assert.ok(budgeted.impact.omitted[field] > 0, field + " must force omission");
    }

    const candidateHeavy = structuredClone(fromRecord);
    const shortValue = "c".repeat(80);
    candidateHeavy.candidateMatches = Array.from({ length: 20 }, (_, i) => ({
        class: "candidateMatch",
        kind: "missing-static-target",
        source: exactSource(`pages/candidate-short-${i}.html`, i + 1, shortValue + i),
        candidateIdentity: `fragments/${shortValue}${i}`,
        reason: "No local fragment file has this exact runtime identity.",
    }));
    const candidateBudgeted = assertEnvelope(candidateHeavy);
    assert.ok(candidateBudgeted.impact.candidateMatches.length > 0);
    assert.ok(candidateBudgeted.impact.omitted.candidateMatches > 0);
    assert.deepStrictEqual(
        candidateBudgeted.impact.candidateMatches,
        candidateHeavy.candidateMatches.slice(0, candidateBudgeted.impact.candidateMatches.length)
    );
    assert.strictEqual(
        candidateBudgeted.impact.candidateMatches.length + candidateBudgeted.impact.omitted.candidateMatches,
        candidateHeavy.candidateMatches.length
    );

    const mandatoryTooLarge = structuredClone(fromRecord);
    mandatoryTooLarge.freshness.lastKnownServerModifiedDate = "m".repeat(5000);
    const budgetError = assertEnvelope(mandatoryTooLarge);
    assert.strictEqual(budgetError.ran, false);
    assert.strictEqual(budgetError.error.error.code, "response-budget");
    assert.strictEqual(budgetError.error.target, null);
});
