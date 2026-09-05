"use strict";

// Regression contracts distilled from the company_directory improvement report and the
// equipment_checkout friction report. These tests intentionally check durable guidance and
// examples rather than prose layout, so the skills can still be edited and reorganized.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const BUNDLED = path.join(ROOT, "bundled-context");

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function mustMatch(text, pattern, message) {
    assert.match(text, pattern, message);
}

test("design-system.css stays a reference; pals selectively author styles.css", () => {
    const init = read("bundled-context/skills/design-system-init/SKILL.md");
    const build = read("bundled-context/skills/design-build/SKILL.md");
    const components = read("bundled-context/skills/design-system-init/references/component-library.md");
    const marketing = read("bundled-context/skills/design-system-init/references/marketing-library.md");
    const designSpec = read("eval/specs/DESIGN_SYSTEM.md");
    const componentSpec = read("eval/specs/COMPONENTS.md");

    for (const [label, text] of [["design-system-init", init], ["design-build", build]]) {
        mustMatch(text, /design-system\.css[^\n]*(?:reference[- ]only|reference file)|(?:reference[- ]only|reference file)[^\n]*design-system\.css/i,
            label + " must call design-system.css a reference, not a pal asset");
        mustMatch(text, /styles\/styles\.css/i, label + " must name the pal-owned stylesheet");
        mustMatch(text, /(?:copy|extract|take|include)[^\n]*(?:only|just)[^\n]*(?:needed|used|required)|(?:only|just)[^\n]*(?:needed|used|required)[^\n]*(?:rules|components|pieces|styles)/i,
            label + " must require selective extraction of only needed CSS");
        mustMatch(text, /(?:never|do not|must not)[\s\S]{0,140}(?:copy|register|link|load|ship)[\s\S]{0,140}design-system\.css|design-system\.css[\s\S]{0,140}(?:must not|never|do not)[\s\S]{0,140}(?:copy|register|link|load|ship)/i,
            label + " must explicitly forbid loading the reference into a pal");
    }

    for (const [label, text] of [["component library", components], ["marketing library", marketing]]) {
        mustMatch(text, /references?\/design-system\.css|design-system\.css[^\n]*reference/i,
            label + " must route CSS lookup to the reference stylesheet");
        mustMatch(text, /styles\/styles\.css/i, label + " must route selected rules to styles.css");
        assert.doesNotMatch(text, /(?:ships?|shipped)\s+verbatim|base styling ships in [`\s]*styles\/design-system\.css/i,
            label + " must not describe the reference stylesheet as shipped pal code");
    }

    for (const [label, text] of [["DESIGN_SYSTEM benchmark", designSpec], ["COMPONENTS benchmark", componentSpec]]) {
        mustMatch(text, /styles\/styles\.css/i, label + " must score the authored pal stylesheet");
        assert.doesNotMatch(text, /(?:load|link|register|ship|copy)[^\n]*styles\/design-system\.css/i,
            label + " must not direct eval agents to load the reference stylesheet");
    }

    assert.ok(fs.existsSync(path.join(BUNDLED, "skills", "design-system-init", "references", "design-system.css")),
        "the full design-system.css must remain available as a skill reference");
});

test("console workflow guidance distinguishes reserved globals from handler locals", () => {
    const consoleGuide = read("bundled-context/skills/palbuilder-workflow/references/console.md");
    const workflow = read("bundled-context/skills/palbuilder-workflow/SKILL.md");
    const es3 = read("bundled-context/skills/palbuilder-core/references/es3-cheatsheet.md");

    mustMatch(consoleGuide, /var[^;\n]*\bpal\b[^;]*;/, "canonical console skeleton must declare pal");
    mustMatch(consoleGuide, /pal\s*=\s*c\.getPal\(\)\s*;/, "canonical console skeleton must assign pal");
    for (const [label, text] of [["console guide", consoleGuide], ["workflow skill", workflow], ["ES3 cheatsheet", es3]]) {
        mustMatch(text, /(?:locals?|local variables?|function[- ]scope|inside (?:that|the|a) (?:handler|function))/i,
            label + " must explain function-local variables");
    }
    mustMatch(es3, /(?:global\s+vs\.?\s+local|reserved globals?[^\n]*local)/i,
        "ES3 cheatsheet must explicitly contrast global and local declarations");
    mustMatch(es3, /empty\s*\([^)]*\)[^\n]*(?:EL|template)|(?:EL|template)[^\n]*empty\s*\(/i,
        "ES3 cheatsheet must say empty() belongs to EL, not workflow JS");
    mustMatch(es3, /\.trim\(\)[\s\S]{0,140}(?:unavailable|not available|unsupported|do not use)|(?:unavailable|not available|unsupported|do not use)[\s\S]{0,140}\.trim\(\)/i,
        "ES3 cheatsheet must call out unavailable String.prototype.trim");
    mustMatch(es3, /\.includes\([^)]*\)[^\n]*indexOf|indexOf[^\n]*\.includes\([^)]*\)/i,
        "ES3 cheatsheet must give indexOf as the includes replacement");
});

test("dataset write examples preserve the asymmetric update/delete signatures", () => {
    const datasets = read("bundled-context/skills/palbuilder-data/references/datasets.md");
    const dataSkill = read("bundled-context/skills/palbuilder-data/SKILL.md");

    mustMatch(datasets, /deleteRecord(?:\s*\([^)]*(?:id|Id)[^)]*\))?[\s\S]{0,100}(?:not|NOT)[^\n]*(?:record object|record)|(?:not|NOT)[^\n]*(?:record object|record)[\s\S]{0,100}deleteRecord(?:\s*\([^)]*(?:id|Id))?/i,
        "deleteRecord guidance must say it takes the primary-key id, not a record");
    mustMatch(datasets, /updateRecord\s*\(\s*record\s*\)/,
        "the contrast must retain updateRecord(record)");
    mustMatch(dataSkill, /c\.getDateUtil\(\)\.createDate\(\)|var\s+dateUtil\s*;[\s\S]{0,500}dateUtil\s*=\s*c\.getDateUtil\(\)/,
        "date examples must obtain dateUtil instead of implying a magic global");
});

test("pal_exercise guidance uses precise row scope and teaches the full CRUD flow", () => {
    const loop = read("bundled-context/skills/pal-loop/SKILL.md");
    const exercise = read("bundled-context/skills/shared/references/exercise-authoring.md");

    // Exercise authoring moved to shared reference in pal-loop trim — body now carries mandatory read; verify detail in the reference.
    mustMatch(exercise, /tr:has\(\[data-label=["']Name["']\]:has-text\(/,
        "row-action example must scope through the identifying data-label cell");
    mustMatch(exercise, /(?:first load|initial (?:screen|view)|opens? on[^\n]*list|loads? the list)[\s\S]{0,180}(?:Add|Create)|(?:Add|Create)[\s\S]{0,180}(?:before[^\n]*fill|navigate[^\n]*form)/i,
        "console create exercise must navigate from the initial list to the form");
    mustMatch(exercise, /After an EDIT[\s\S]{0,260}new value[\s\S]{0,160}absence/i,
        "edit verification must require the new value and reject the old value");
    mustMatch(exercise, /After a DELETE[\s\S]{0,180}absent/i,
        "delete verification must assert the deleted value is absent");
    mustMatch(loop, /mandatory and non-skippable[\s\S]{0,80}exercise-authoring\.md/i,
        "pal-loop body must still route agents to the exercise-authoring reference");
});

test("pal authoring guidance routes fragment and JEXL details to frontend", () => {
    const contract = read("bundled-context/CLAUDE.md");
    const frontend = read("bundled-context/skills/palbuilder-frontend/SKILL.md");

    mustMatch(contract, /Markup\/browser UI → `palbuilder-frontend`/,
        "the injected contract must route markup work to the frontend skill");
    mustMatch(contract, /Use only documented `c:` attributes[^\n]*`palbuilder-frontend`/,
        "the injected contract must direct unfamiliar tags to the owning skill");
    mustMatch(frontend, /Apache Commons JEXL[^\n]*platform extensions/i,
        "frontend guidance must identify the actual expression engine");
    mustMatch(frontend, /data\.set\(["']first-name["'][\s\S]{0,240}\$\{info\.get\(["']first-name["']\)\}/i,
        "frontend guidance must show the required accessor for non-JEXL-friendly keys");
});

test("pal-level manifest guidance no longer dead-ends on data and datalists", () => {
    const manifest = read("bundled-context/skills/palbuilder-core/references/pal-json.md");
    const payloads = read("bundled-context/skills/palbuilder-data/references/payloads.md");
    const contract = read("bundled-context/CLAUDE.md") + "\n" + read("src/launcher/contextInject.js");

    mustMatch(manifest, /^##+\s+`?data`?\b/im, "pal.json reference must document the data section");
    mustMatch(manifest, /"fields"\s*:\s*\{\s*"DatasetField"\s*:\s*\[[\s\S]{0,500}"fieldName"\s*:\s*"equipmentId"[\s\S]{0,100}"fieldType"\s*:\s*"Primary key"/,
        "pal.json reference must show the serialized fields.DatasetField shape");
    mustMatch(manifest, /fieldName[\s\S]{0,100}fieldType[\s\S]{0,160}(?:not|NOT)[^\n]*name[^\n]*type/,
        "pal.json reference must reject name/type aliases for dataset fields");
    mustMatch(manifest, /bare `?fields:\s*\[\]`?[\s\S]{0,80}(?:wrong|invalid)/i,
        "pal.json reference must warn against a bare fields array");
    mustMatch(manifest, /"Fragment"[\s\S]{0,260}"palType"\s*:\s*"palTypeConsole"[\s\S]{0,100}"parseable"\s*:\s*false/,
        "pal.json reference must show the typed console Fragment manifest shape");
    mustMatch(read("bundled-context/skills/pal-loop/SKILL.md"), /mandatory and non-skippable[\s\S]{0,500}"Fragment"[\s\S]{0,500}"Dataset"/i,
        "pal-loop must eagerly carry fragment and dataset entry shapes");
    mustMatch(manifest, /^##+\s+`?datalists`?\b/im, "pal.json reference must document the datalists section");
    mustMatch(manifest, /pal\.getData\s*\(/, "data section must connect manifest shape to runtime read API");
    mustMatch(manifest, /pal\.getDataList\s*\(/, "datalists section must connect manifest shape to runtime read API");
    mustMatch(payloads, /(?:data|`data`)[\s\S]{0,80}(?:datalists|`datalists`)[\s\S]{0,120}pal-json\.md|pal-json\.md[\s\S]{0,120}(?:data|`data`)[\s\S]{0,80}(?:datalists|`datalists`)/i,
        "payload guidance must point to the specific data/datalists manifest sections");
    mustMatch(payloads, /ConsolePacket[\s\S]{0,180}(?:not pal configuration|shared mutable state|not[^\n]*persistent)/i,
        "payload guidance must prevent using ConsolePacket as pal-level static configuration");
    mustMatch(manifest, /DesktopBinding[\s\S]{0,420}name[^\n]*(?:tile label|field)[\s\S]{0,180}icon/i,
        "desktopBindings guidance must identify the name and icon fields");
    mustMatch(manifest, /desktopBindings[\s\S]{0,300}(?:omit|skip)[^\n]*(?:unless|if)[^\n]*(?:spec|tile)/i,
        "desktopBindings guidance must keep the optional tile out of unrelated pals");
    mustMatch(contract, /createDataViewBuilder\(\)/,
        "injected guidance must distinguish runtime DataViewBuilder from manifest provisioning");
    mustMatch(contract, /createDataViewBuilder\(\)[^\n]*(?:runtime|workflow)|(?:runtime|workflow)[^\n]*createDataViewBuilder\(\)/i,
        "runtime DataView creation must be stated explicitly");
});

test("platform chrome and screenshot auth failures are classified as tool evidence", () => {
    const build = read("bundled-context/skills/design-build/SKILL.md");
    const loop = read("bundled-context/skills/pal-loop/SKILL.md");
    const review = read("bundled-context/skills/pal-review/SKILL.md");
    const renderRule = read("bundled-context/skills/pal-review/references/console-render-verification.md");

    for (const [label, text] of [["design-build", build], ["pal-loop", loop], ["pal-review", review]]) {
        mustMatch(text, /platform(?:-| )chrome|platform-injected/i,
            label + " must distinguish platform chrome from pal-owned DOM");
    }
    mustMatch(renderRule, /(?:login|auth)[^\n]*(?:redirect|expired|wrong page)|(?:redirect|wrong page)[^\n]*(?:login|auth)/i,
        "render verification must classify login/auth redirects as failed evidence");
    mustMatch(renderRule, /(?:captured|final)\s+(?:URL|url)|URL[^\n]*(?:captured|final)/,
        "render verification must require checking the final captured URL");
});
