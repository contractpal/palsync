"use strict";
// §3 pal_spec_lint: one valid spec passes clean; one spec carrying each lintable defect exactly
// once produces exactly one finding per defect at the right severity. Plus a drift guard binding
// the hardcoded type set to palbuilder-types.md (the brief's "validated against" requirement).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { lintSpec, parseSpec, bodyText, normalizeSpecRefToken, resolveSpecSection, resolveSpecRefs, STORED_TYPES } = require("../src/core/specLint");
const os = require("os");

const VALID = `# SPEC — demo
status: approved

## 3. Sitemap & routing
| page | type | file | workflow action | nav label | purpose |
|---|---|---|---|---|---|
| Home | web | index.html | (default) / home | Home | landing |
| About | web | about.html | showAbout | About | about us |

## 4. Copy
### Home
- H1: \`Welcome\`
- Primary CTA: \`Learn more\` -> about.html

## 5. Behavior
### home
- Effect: read widgets; insert widgets row.

## 8. Data model
### 8a. Datasets to CREATE
### dataset: widgets
| field | type | size | notes |
|---|---|---|---|
| widgetId | Primary key | — | |
| name | String | 50 | notNull |
| count | Number | — | |

### 8b. Datasets CONSUMED — none.

## 12. Acceptance criteria
- [ ] pal_validate: 0 errors  - [ ] pal_test: workflow VALIDATED, 0 notes
- [ ] every §3 nav link routes (no dead links)
`;

const DEFECTS = `# SPEC — defects
status: draft

## 2. Decisions & open questions
- OPEN: pricing model TBD

## 3. Sitemap & routing
| page | type | file | workflow action | nav label | purpose |
|---|---|---|---|---|---|
| Home | web | index.html | home | Home | landing |

## 4. Copy
### Home
- Primary CTA: \`Go\` -> ghostPage

## 5. Behavior
### home
- Effect: insert orphans row.

## 8. Data model
### 8a. Datasets to CREATE
### dataset: nokeys
| field | type | size | notes |
|---|---|---|---|
| foo | String | 50 | |
### dataset: pickers
| field | type | size | notes |
|---|---|---|---|
| pickersId | Primary key | — | |
| bar | Varchar | 50 | |
### dataset: unknowns
| field | type | size | notes |
|---|---|---|---|
| unknownsId | Primary key | — | |
| baz | FluxCapacitor | — | |
### dataset: indexed
| field | type | size | notes |
|---|---|---|---|
| indexedId | Primary key | — | |
| body | Text | — | filtered on |
### dataset: sized
| field | type | size | notes |
|---|---|---|---|
| sizedId | Primary key | — | |
| flag | Boolean | 10 | |
### dataset: strs
| field | type | size | notes |
|---|---|---|---|
| strsId | Primary key | — | |
| title | String | — | |

### 8b. Datasets CONSUMED — none.

## 12. Acceptance criteria
- [ ] pal_validate: 0 errors
- [ ] every §3 nav link routes (no dead links)
`;

test("valid spec: no findings", () => {
    const r = lintSpec(VALID, { hasMap: false });
    assert.deepEqual(r.findings, [], "expected zero findings, got:\n" + r.findings.map(f => f.severity + " " + f.summary).join("\n"));
});

test("defect spec: exactly one finding per lintable defect, correct severity", () => {
    const r = lintSpec(DEFECTS, { hasMap: true }); // MAP present -> REGRESSION criterion required
    const has = (sev, re) => r.findings.filter(f => f.severity === sev && re.test(f.summary)).length;

    assert.equal(has("HARD_FLAG", /Placeholder text "TBD"/), 1, "placeholder");
    assert.equal(has("HARD_FLAG", /Dead link.*ghostPage/), 1, "dead link");
    assert.equal(has("FLAG", /no `<name>Id` primary key/), 1, "missing key");
    assert.equal(has("HARD_FLAG", /picker label "Varchar"/), 1, "picker label");
    assert.equal(has("HARD_FLAG", /FluxCapacitor.*not a verified/), 1, "unknown type");
    assert.equal(has("HARD_FLAG", /queried on.*NOT indexable/), 1, "non-indexable query key");
    assert.equal(has("FLAG", /size applies only to String\/Char\/Decimal/), 1, "size on non-size type");
    assert.equal(has("FLAG", /String with no size/), 1, "String needs size");
    assert.equal(has("FLAG", /references dataset "orphans"/), 1, "undeclared §5 dataset");
    assert.equal(has("FLAG", /missing the pal_test criterion/), 1, "§12 missing floor line");
    assert.equal(has("HARD_FLAG", /no REGRESSION criterion/), 1, "§12 regression (brownfield)");

    // and nothing extra crept in
    assert.equal(r.counts.HARD_FLAG, 6, "HARD_FLAG total");
    assert.equal(r.counts.FLAG, 5, "FLAG total");
});

test("REGRESSION criterion only required when a MAP.md is present", () => {
    const noMap = lintSpec(DEFECTS, { hasMap: false });
    assert.equal(noMap.findings.filter(f => /REGRESSION/.test(f.summary)).length, 0);
});

test("drift guard: STORED_TYPES matches palbuilder-types.md exactly", () => {
    const ref = fs.readFileSync(path.join(__dirname, "..", "bundled-context", "skills", "pal-spec", "references", "palbuilder-types.md"), "utf8");
    const parsed = new Set();
    for (const m of ref.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)) parsed.add(m[1]);
    // Every parsed stored type is known to the linter, and vice versa (no silent divergence).
    for (const t of parsed) assert.ok(STORED_TYPES.has(t), "reference type missing from STORED_TYPES: " + t);
    for (const t of STORED_TYPES) assert.ok(parsed.has(t), "STORED_TYPES has a type not in the reference: " + t);
});

// --- slice 01: subsection addressing and ref resolver ---
const SPEC_SUB = `# SPEC — sub
status: draft

## 4. Copy
copy body line

## 8. Data model
### 8a. Datasets to CREATE
create block A
### dataset: foo
| field | type | size | notes |
|---|---|---|---|
| fooId | Primary key | — | |

### 8b. Datasets CONSUMED — none.
consumed block B

## 12. Acceptance criteria
- [ ] pal_validate: 0 errors - [ ] pal_test: ok - [ ] every nav link routes
`;

test("subsection addressing: parent body unchanged, 8a/8b resolve to own bodies", () => {
    const parsed = parseSpec(SPEC_SUB);
    const full8 = bodyText(parsed.sections[8]);
    const subA = bodyText(parsed.sections["8a"]);
    const subB = bodyText(parsed.sections["8b"]);
    // parent keeps full body byte-identical to what current parser would return
    assert.ok(full8.includes("8a. Datasets to CREATE"));
    assert.ok(full8.includes("create block A"));
    assert.ok(full8.includes("8b. Datasets CONSUMED"));
    assert.ok(full8.includes("consumed block B"));
    // subsections resolve to only their own block
    assert.ok(subA.includes("create block A"));
    assert.equal(subA.includes("consumed block B"), false, "8a must not contain 8b");
    assert.equal(subA.includes("8b."), false, "8a must not contain 8b heading");
    assert.ok(subB.includes("consumed block B"));
    assert.equal(subB.includes("create block A"), false, "8b must not contain 8a");
    // numeric lookup unchanged
    const sec4 = bodyText(parsed.sections[4]);
    assert.ok(sec4.includes("copy body line"));
    assert.equal(parsed.sections["8a"].parent, 8);
    assert.equal(parsed.sections["8b"].parent, 8);
});

test("numeric section body byte-identical to pre-subsection parser", () => {
    const parsed = parseSpec(VALID);
    // VALID has no letter subsections, so numeric sections should behave exactly as before
    const sec4 = bodyText(parsed.sections[4]);
    assert.ok(sec4.includes("Welcome"));
    assert.equal(parsed.sections["4a"], undefined, "no spurious subsection");
});

test("ref-token parsing: accepts \u00A74, 4, \u00A78b, comma lists, whitespace tolerant", () => {
    const parsed = parseSpec(SPEC_SUB);
    const r1 = resolveSpecRefs(parsed, "\u00A74");
    assert.equal(r1.ok, true);
    assert.equal(r1.sections[0].num, 4);
    const r2 = resolveSpecRefs(parsed, "4");
    assert.equal(r2.ok, true);
    assert.equal(r2.sections[0].num, 4);
    const r3 = resolveSpecRefs(parsed, "\u00A78b");
    assert.equal(r3.ok, true);
    assert.equal(r3.sections[0].num, "8b");
    const r4 = resolveSpecRefs(parsed, "\u00A74, \u00A78b");
    assert.equal(r4.ok, true);
    assert.deepEqual(r4.sections.map(s => String(s.num)), ["4", "8b"]);
    const r5 = resolveSpecRefs(parsed, "  \u00A74 ,  8a  ");
    assert.equal(r5.ok, true);
    assert.deepEqual(r5.sections.map(s => String(s.num)), ["4", "8a"]);
    assert.equal(resolveSpecSection(parsed, "\u00A74").num, 4);
    assert.equal(resolveSpecSection(parsed, "8B").num, "8b", "case-insensitive letter");
    assert.equal(normalizeSpecRefToken("\u00A78b"), "8b");
    assert.equal(normalizeSpecRefToken(" 8A "), "8a");
});

test("ref-token parsing: unknown and malformed tokens fail naming the token", () => {
    const parsed = parseSpec(SPEC_SUB);
    const bad1 = resolveSpecRefs(parsed, "\u00A799");
    assert.equal(bad1.ok, false);
    assert.equal(bad1.token, "\u00A799");
    const bad2 = resolveSpecRefs(parsed, "\u00A78c");
    assert.equal(bad2.ok, false);
    assert.equal(bad2.token, "\u00A78c");
    const bad3 = resolveSpecRefs(parsed, "\u00A74, \u00A799");
    assert.equal(bad3.ok, false);
    assert.equal(bad3.token, "\u00A799", "reports offending token in list");
    const bad4 = resolveSpecRefs(parsed, "abc");
    assert.equal(bad4.ok, false);
    assert.equal(bad4.token, "abc");
    assert.equal(resolveSpecSection(parsed, "\u00A7"), null);
    assert.equal(resolveSpecSection(parsed, "8ab"), null);
    assert.equal(normalizeSpecRefToken(""), null);
    assert.equal(normalizeSpecRefToken("\u00A7"), null);
});

test("empty component in ref list is a failure naming the raw ref string, and a ref yielding no sections fails too", () => {
    const parsed = parseSpec(SPEC_SUB);
    const emptyMid = resolveSpecRefs(parsed, "\u00A74,,\u00A76");
    assert.equal(emptyMid.ok, false);
    assert.match(emptyMid.error, /\u00A74,,\u00A76/);
    assert.equal(emptyMid.token, "\u00A74,,\u00A76");
    const justComma = resolveSpecRefs(parsed, ",");
    assert.equal(justComma.ok, false);
    assert.match(justComma.error, /,/);
    assert.equal(justComma.token, ",");
    const trailingComma = resolveSpecRefs(parsed, "\u00A74,");
    assert.equal(trailingComma.ok, false);
    assert.match(trailingComma.error, /\u00A74,/);
    // blank/— is handled by the caller (renderReadyTicket / lintSpec), not the resolver directly,
    // but a direct call with no resolvable sections must still fail
    const noSections = resolveSpecRefs(parsed, ",");
    assert.equal(noSections.ok, false);
});

test("blank and — spec ref cells are skipped, not errors, in lint and renderReadyTicket", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specLint-"));
    try {
        const specPath = path.join(tmp, "SPEC.md");
        fs.writeFileSync(specPath, SPEC_SUB, "utf8");
        for (const raw of ["", "   ", "\u2014", "-", "\u2014 \u2014"]) {
            const exec = `# EXECUTION\n\n## Tasks\n| id | task | spec ref | status |\n| T1 | do a | ${raw} | todo |\n\n## Checkpoints\n`;
            fs.writeFileSync(path.join(tmp, "EXECUTION.md"), exec, "utf8");
            const r = lintSpec(SPEC_SUB, { workspaceDir: tmp, hasMap: false });
            assert.equal(r.findings.filter(f => f.section === "EXECUTION.md").length, 0, `blank/— raw "${raw}" must not flag`);
        }
        // renderReadyTicket with blank/— spec ref still succeeds (no badRef), §11 still required
        const { renderReadyTicket } = require("../src/core/taskState");
        const execBlank = `# EXECUTION \u2014 demo\n\n## Tasks\n| id | task | tier | spec ref | depends | status | success condition |\n| T1 | blank ref | cheap |   | \u2014 | todo | ok |\n\n## Checkpoints\n`;
        const specWith11 = SPEC_SUB.replace("status: draft", "status: approved");
        // ensure spec has §11
        const spec11 = specWith11.includes("## 11.") ? specWith11 : specWith11 + "\n## 11. Guardrails\nnever\n";
        // Use SPEC_READY equivalent that has §11; reuse SPEC_SUB plus §11 if missing
        const fullSpec = parseSpec(spec11).sections[11] ? spec11 : spec11 + "\n## 11. Guardrails\nnever body\n";
        const okBlank = renderReadyTicket(execBlank, fullSpec);
        assert.equal(okBlank.ok, true, "blank spec ref cell must not be a badRef");
        const execDash = execBlank.replace("|   |", "| \u2014 |");
        const okDash = renderReadyTicket(execDash, fullSpec);
        assert.equal(okDash.ok, true, "— spec ref cell must not be a badRef");
        // empty component inside a non-blank cell must still fail via renderReadyTicket
        const execEmpty = execBlank.replace("|   |", "| \u00A74,,\u00A76 |");
        const badEmpty = renderReadyTicket(execEmpty, fullSpec);
        assert.equal(badEmpty.ok, false);
        assert.match(badEmpty.error, /\u00A74,,\u00A76/);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test("resolver is exported for external callers", () => {
    const mod = require("../src/core/specLint");
    assert.equal(typeof mod.resolveSpecRefs, "function");
    assert.equal(typeof mod.resolveSpecSection, "function");
    assert.equal(typeof mod.normalizeSpecRefToken, "function");
    assert.equal(typeof mod.parseSpec, "function");
    assert.equal(typeof mod.bodyText, "function");
});

test("EXECUTION.md spec ref check: hard flag for unresolvable token, absent is no finding", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specLint-"));
    try {
        const specPath = path.join(tmp, "SPEC.md");
        fs.writeFileSync(specPath, SPEC_SUB, "utf8");
        // absent EXECUTION.md -> no finding
        const rAbsent = lintSpec(SPEC_SUB, { workspaceDir: tmp, hasMap: false });
        const badAbsent = rAbsent.findings.filter(f => f.section === "EXECUTION.md");
        assert.equal(badAbsent.length, 0, "absent EXECUTION.md must produce no finding");
        // valid EXECUTION.md -> no finding
        const execOk = `# EXECUTION\n\n## Tasks\n| id | task | spec ref | status |\n| T1 | do a | \u00A74 | todo |\n| T2 | do b | \u00A78a, \u00A78b | todo |\n\n## Checkpoints\n`;
        fs.writeFileSync(path.join(tmp, "EXECUTION.md"), execOk, "utf8");
        const rOk = lintSpec(SPEC_SUB, { workspaceDir: tmp, hasMap: false });
        assert.equal(rOk.findings.filter(f => f.section === "EXECUTION.md").length, 0, "valid refs must not flag");
        // one bad token -> hard flag naming task and token
        const execBad = `# EXECUTION\n\n## Tasks\n| id | task | spec ref | status |\n| T1 | do a | \u00A74 | todo |\n| T2 | do b | \u00A799 | todo |\n\n## Checkpoints\n`;
        fs.writeFileSync(path.join(tmp, "EXECUTION.md"), execBad, "utf8");
        const rBad = lintSpec(SPEC_SUB, { workspaceDir: tmp, hasMap: false });
        const bad = rBad.findings.filter(f => f.severity === "HARD_FLAG" && f.section === "EXECUTION.md");
        assert.equal(bad.length, 1, "exactly one hard flag");
        assert.match(bad[0].summary, /T2/);
        assert.match(bad[0].summary, /\u00A799/);
        // malformed token also flags
        const execMal = `# EXECUTION\n\n## Tasks\n| id | task | spec ref | status |\n| T9 | bad | abc | todo |\n\n## Checkpoints\n`;
        fs.writeFileSync(path.join(tmp, "EXECUTION.md"), execMal, "utf8");
        const rMal = lintSpec(SPEC_SUB, { workspaceDir: tmp, hasMap: false });
        const mal = rMal.findings.filter(f => f.severity === "HARD_FLAG" && f.section === "EXECUTION.md");
        assert.equal(mal.length, 1);
        assert.match(mal[0].summary, /T9/);
        assert.match(mal[0].summary, /abc/);
        // comma list with one bad entry flags that entry
        const execList = `# EXECUTION\n\n## Tasks\n| id | task | spec ref | status |\n| T3 | mix | \u00A74, \u00A799, \u00A78b | todo |\n\n## Checkpoints\n`;
        fs.writeFileSync(path.join(tmp, "EXECUTION.md"), execList, "utf8");
        const rList = lintSpec(SPEC_SUB, { workspaceDir: tmp, hasMap: false });
        const listBad = rList.findings.filter(f => f.section === "EXECUTION.md");
        assert.equal(listBad.length, 1);
        assert.match(listBad[0].summary, /\u00A799/);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
