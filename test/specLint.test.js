"use strict";
// §3 pal_spec_lint: one valid spec passes clean; one spec carrying each lintable defect exactly
// once produces exactly one finding per defect at the right severity. Plus a drift guard binding
// the hardcoded type set to palbuilder-types.md (the brief's "validated against" requirement).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { lintSpec, STORED_TYPES } = require("../src/core/specLint");

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
