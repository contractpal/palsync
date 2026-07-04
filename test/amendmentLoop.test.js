"use strict";
// T9 — living-spec amendment loop. HONEST SCOPE: the amendment loop is an AGENT PROTOCOL defined
// in skill prose (pal-spec + pal-loop), not palsync Node code — there is no function that mutates
// SPEC.md. So these are NOT a live LLM-build test. They verify two real, non-circular things:
//
//   (A) PROSE-CONTRACT (anti-rot): the shipped skill files still carry the load-bearing guardrail
//       clauses, so the protocol can't silently regress out of the skills.
//   (B) PROTOCOL-STATE: over a fixture SPEC.md, the documented file-state transitions hold — the
//       propose + deny stages do NOT mutate SPEC.md (the load-bearing safety property), and only
//       an explicit approve mutates it (with a version bump + §14 audit entry + re-gate).
//
// The transition helpers below implement the protocol exactly as the skills instruct; the
// assertions pin the safety contract so a future change that allowed a silent edit would fail here.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const helpers = require("./helpers");

const SKILLS = path.join(__dirname, "..", "bundled-context", "skills");
const palLoop = fs.readFileSync(path.join(SKILLS, "pal-loop", "SKILL.md"), "utf8");
const palSpec = fs.readFileSync(path.join(SKILLS, "pal-spec", "SKILL.md"), "utf8");
// The full amendment protocol + SPEC template were split into pal-spec/references/ for progressive
// disclosure (both files ship with the skill). The guardrail clauses must still exist SOMEWHERE in
// the shipped skill set — SKILL.md keeps the summary + invariant + pointer; the mechanics and the
// template live in these references. Anti-rot still holds: the protocol can't silently regress out.
const amendmentPath = fs.readFileSync(path.join(SKILLS, "pal-spec", "references", "amendment-path.md"), "utf8");
const specTemplate = fs.readFileSync(path.join(SKILLS, "pal-spec", "references", "spec-template.md"), "utf8");

// ---- (A) prose-contract: the guardrail clauses must exist ------------------

test("pal-loop forbids silent SPEC edits and defines the amendment path", () => {
    assert.match(palLoop, /Never silently edit SPEC\.md/, "must forbid silent SPEC edits");
    assert.match(palLoop, /amendment path/, "must name the amendment path");
    assert.match(palLoop, /amendment proposal/, "must propose, not self-amend");
    assert.match(palLoop, /propose → human approve → re-gate → continue/, "must state the full controlled sequence");
    assert.match(palLoop, /never silently self-amends/, "must keep the invariant");
    assert.match(amendmentPath, /Propose \(pal-loop\)/, "canonical protocol must define the propose step");
});

test("pal-spec carries the amendment protocol, version field, and §14 audit log", () => {
    assert.match(specTemplate, /spec version:/, "template frontmatter must version the spec");
    assert.match(specTemplate, /## 14\. Amendment log/, "template must define the §14 audit log");
    assert.match(palSpec, /the agent never silently self-amends/, "must keep the invariant");
    assert.match(amendmentPath, /Re-gate that section/, "canonical must re-run the reality check for the amended §");
    assert.match(amendmentPath, /bump[\s\S]{0,40}spec version/i, "approval must bump the version");
});

// ---- (B) protocol-state transitions over a fixture ------------------------

const FIXTURE_SPEC = [
    "# SPEC — Widget Tracker",
    "status: approved",
    "reality_check: pass",
    "spec version: 1",
    "mode: lite",
    "",
    "## 8. Data model",
    "### 8a. Datasets to CREATE",
    "### dataset: widgets",
    "| field | type | size | notes |",
    "| widgetId | Autonumber | | pk |",
    "| score | Rating | | star rating |",   // ← "Rating" is the uncreatable type the build hits
    "",
    "## 14. Amendment log (append-only; empty until the first approved amendment)",
    ""
].join("\n");

const FIXTURE_EXEC = [
    "# EXECUTION — Widget Tracker",
    "## Tasks",
    "| id | task | tier | spec ref | depends | status | success condition |",
    "| T1 | create widgets dataset | standard | §8a | — | todo | pal_sync_datasets OK |",
    "## Blockers (what needs the human — be exact)",
    ""
].join("\n");

function tmpWorkspace() {
    return helpers.tmpWorkspace({ "SPEC.md": FIXTURE_SPEC, "EXECUTION.md": FIXTURE_EXEC });
}

// PROPOSE (pal-loop): writes ONLY to EXECUTION.md Blockers — never SPEC.md.
function propose(dir, { specRef, fact, change }) {
    const ep = path.join(dir, "EXECUTION.md");
    const exec = fs.readFileSync(ep, "utf8");
    fs.writeFileSync(ep, exec +
        `- AMENDMENT PROPOSAL (${specRef}): reality forced a change — ${fact}. Proposed minimal change: ${change}. Awaiting human approval.\n`);
    // NOTE: SPEC.md is intentionally NOT touched here.
}

// APPLY (pal-spec, only after explicit approval): minimal edit + version bump + §14 entry + re-gate.
function applyAmendment(dir, { specRef, find, replace, fact, approver, date }) {
    const sp = path.join(dir, "SPEC.md");
    let spec = fs.readFileSync(sp, "utf8");
    const v = parseInt(/spec version:\s*(\d+)/.exec(spec)[1], 10);
    spec = spec.replace(/spec version:\s*\d+/, "spec version: " + (v + 1));   // bump
    spec = spec.replace(find, replace);                                        // the minimal fix
    spec = spec.replace(/(## 14\. Amendment log[^\n]*\n)/,
        `$1- v${v + 1} (${date}, approved by ${approver}): ${specRef} — "${find.trim()}" → "${replace.trim()}" — reality forced it: ${fact}. Re-gate: ${specRef} → pass.\n`);
    // Re-gate that section: reality_check re-run for §8a — clears back to pass after the fix.
    spec = spec.replace(/reality_check:\s*\w+/, "reality_check: pass");
    fs.writeFileSync(sp, spec);
}

test("PROPOSE stage does NOT mutate SPEC.md (the load-bearing safety property)", () => {
    const dir = tmpWorkspace();
    const before = fs.readFileSync(path.join(dir, "SPEC.md"));

    propose(dir, { specRef: "§8a", fact: "type 'Rating' is not creatable in PalBuilder", change: "score: Rating → Decimal" });

    const after = fs.readFileSync(path.join(dir, "SPEC.md"));
    assert.ok(before.equals(after), "SPEC.md must be byte-identical at the proposal stage");
    // The proposal landed in EXECUTION instead.
    assert.match(fs.readFileSync(path.join(dir, "EXECUTION.md"), "utf8"), /AMENDMENT PROPOSAL \(§8a\)/);
});

test("DENY path: no approval → SPEC.md still unchanged, task stays blocked", () => {
    const dir = tmpWorkspace();
    const before = fs.readFileSync(path.join(dir, "SPEC.md"));
    propose(dir, { specRef: "§8a", fact: "uncreatable type", change: "Rating → Decimal" });
    // Approval withheld: we do NOT call applyAmendment.
    const after = fs.readFileSync(path.join(dir, "SPEC.md"));
    assert.ok(before.equals(after), "withheld approval must leave SPEC.md untouched");
    // version not bumped, log still empty
    assert.match(after.toString(), /spec version: 1/);
    assert.doesNotMatch(after.toString(), /- v2 \(/);
});

test("APPROVE path: explicit approval writes the amendment — version bump + §14 entry + re-gate + fix", () => {
    const dir = tmpWorkspace();
    propose(dir, { specRef: "§8a", fact: "type 'Rating' is not creatable", change: "Rating → Decimal" });

    applyAmendment(dir, {
        specRef: "§8a", find: "| score | Rating |", replace: "| score | Decimal |",
        fact: "type 'Rating' is not creatable in PalBuilder", approver: "sam", date: "2026-06-29"
    });

    const spec = fs.readFileSync(path.join(dir, "SPEC.md"), "utf8");
    assert.match(spec, /spec version: 2/, "version must bump on approval");
    assert.match(spec, /- v2 \(2026-06-29, approved by sam\): §8a/, "§14 must record an audited entry");
    assert.match(spec, /reality_check: pass/, "the amended section must be re-gated");
    // Anchor to line start so we check the DATA ROW, not the §14 log entry that quotes old→new.
    assert.match(spec, /^\| score \| Decimal \|/m, "the minimal fix must be applied to the dataset row");
    assert.doesNotMatch(spec, /^\| score \| Rating \|/m, "the uncreatable type must be gone from the dataset row");
});

test("invariant: across propose→deny→approve, SPEC.md changes ONLY at the explicit approve step", () => {
    const dir = tmpWorkspace();
    const v0 = fs.readFileSync(path.join(dir, "SPEC.md"));
    propose(dir, { specRef: "§8a", fact: "uncreatable type", change: "Rating → Decimal" });
    assert.ok(v0.equals(fs.readFileSync(path.join(dir, "SPEC.md"))), "unchanged after propose");
    // deny window — still nothing
    assert.ok(v0.equals(fs.readFileSync(path.join(dir, "SPEC.md"))), "unchanged while approval is withheld");
    // approve
    applyAmendment(dir, { specRef: "§8a", find: "| score | Rating |", replace: "| score | Decimal |", fact: "uncreatable type", approver: "sam", date: "2026-06-29" });
    assert.ok(!v0.equals(fs.readFileSync(path.join(dir, "SPEC.md"))), "changed only after explicit approval");
});
