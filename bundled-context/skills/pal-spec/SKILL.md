---
name: pal-spec
description: "Interview the user and produce SPEC.md + EXECUTION.md, the two files that drive an autonomous pal build. Modes: FULL (production), LITE (prototype/MVP). Triggers: 'spec out', 'plan this pal', 'interview me', 'create a spec', or starting a new pal from a description. Not for bug fixes (pal-fix) or visual design (design-system-init)."
---

# pal-spec — interview → SPEC.md + EXECUTION.md

Produce the two files an autonomous build runs on. A complete spec lets a cheaper model build
correctly; a vague spec makes every model guess. The output is a **gated chain** — do not skip
a gate:

```
MINE → INTERVIEW → LOCK ASSUMPTIONS → SPEC.md draft → REALITY CHECK → approved → EXECUTION.md
                        gate                             gate                        gate
```

**Hard rules:**
- **REAL CONTENT ONLY.** Every copy field gets real approved words; every dataset field a real
  type; every workflow real behavior. Unknowns go in §2 Decisions & open questions — never
  `TBD`, never "placeholder", never "decide later" inline.
- **DESIGN IS A HANDOFF, NOT A SECTION.** No palettes, fonts, or aesthetic direction in the
  spec — those live in `DESIGN_SYSTEM.md` / `COMPONENTS.md` (from **design-system-init**).
  The spec carries only per-page composition and UX flow (§6): primary path, hierarchy, and
  progressive disclosure. No DESIGN_SYSTEM.md → stop, run design-system-init first. Every
  frontend specs follow `../shared/references/css-conventions.md` unless the project is a non-UI service-only pal.
- **Never invent facts** — no made-up stats, prices, or testimonials. Record the source of
  every claim; a claim with no source is an open question.

---

## 1. Choose the mode first

- **LITE** — prototype, MVP, spike, demo, "quick", internal tool for one or two people.
- **FULL** — production, client-facing, real users, real data, anything ContractPal ships.

Unsure → ask one question: *"Throwaway prototype, or something for real users?"* Record as `mode:`.

**LITE keeps (non-negotiable):** the one primary action; real copy on primary screen(s); the
sitemap; the design handoff (a minimal DESIGN_SYSTEM.md must exist); the required-skills +
PalBuilder-surface manifest; the global acceptance floor; the REALITY CHECK.
**LITE relaxes:** behavior is happy-path only (edges listed as "deferred (prototype)");
acceptance = global floor + one happy-path check per primary action; secondary-page copy may be
stubbed-but-marked; protected decisions optional; coarser tasks.

Sections tagged **[FULL]** are full-mode only.

**Length budget:** LITE ≤2,000 words, FULL ≤5,000. Over budget = scope too big: split or cut.
The spec is re-read on every build task, so every word costs tokens repeatedly.

---

## 2. Run the interview

**Brownfield (MAP.md present — handoff from pal-init):** do NOT re-interview the whole pal.
MAP.md is ground truth for what exists; scope the interview and spec to the CHANGE pal-init
scoped. Four template places change (§6 layout, §8b consumed datasets, §11 NEVER, §12
acceptance — each marked "Brownfield" inline in the template) plus one added REALITY CHECK
item. No MAP.md → greenfield.

**Step 1 — Mine before you ask.** Turn what already exists (the pulled workspace, any live
site/doc the user points at, DESIGN_SYSTEM.md, the first description) into PROPOSED answers.
Confirming a proposal costs seconds; an open question costs minutes. Record where each fact
came from.

**Step 2 — Ask in batches of 3–4** (skip what mining answered):

- **Product & audience** — Q1 What is this (one sentence)? Q2 Who for? Q3 The ONE primary
  action? Q4 What state is the user in (rushed, careful, comparing, approving, anxious)?
  Q5 Web (public), console (logged-in), or both? If both, get the page split now.
- **Primary journey** — Q6 For the main screen, what is the entry point → first decision →
  primary action → feedback → next step? What friction must the UI remove?
- **Integration surface** *(most pals: none — skip)* — Q7 Does anything OTHER than a browser
  call this pal? **webservice** (`workflowType: 12`) = external REST/SOAP caller; **tunnel**
  (`workflowType: 15`) = pal-to-pal / cross-cloud. If either: which caller, which action(s),
  request/response shape. Non-page-serving — no sitemap row; capture as §5 behavior, list the
  workflow + type in §9/§10.
- **Scope & structure** — Q8 Pages/screens? (propose a sitemap; tag each row web or console)
  Q9 Explicitly OUT of scope?
- **Copy** — Q10 Per page: draft H1/subhead/CTA/section copy YOURSELF from mined material,
  present it, get it corrected — page by page. Q11 Claims/stats/pricing that must be exact?
  (ask; never invent; record source)
- **Behavior** *(console/app pals, any page with logic, any Q7 action)* — Q12 Per action:
  trigger, INPUT, VALIDATION, STATE change (which dataset/field), OUTPUT, and the fewest high-level test seams that prove it (`pal_exercise` flow, `pal_test`, or exact expect). Q13 **[FULL]**
  Edge & error cases: empty, invalid, not-found, duplicate, auth-fail. *(LITE: note as deferred.)*
- **Data** — Q14 Entities, fields, exact PalBuilder types? (propose schemas; confirm — types
  come from `references/palbuilder-types.md`)
- **Design handoff** — Q15 DESIGN_SYSTEM.md + COMPONENTS.md present? No → run
  design-system-init, then return here. Yes → per page, propose a layout skeleton: section
  order + which named component fills each slot + hierarchy/primary action/progressive disclosure
  notes. Confirm every new-pal page shell follows `../shared/references/css-conventions.md`; `pb-charts.js` is optional when charts are used. Use the approved inline SVG icon guidance in
  `design-system-init/references/component-library.md`. No colors/fonts. Do not
  retrofit `styles.css` into an existing pal that lacks it.
- **SEO** *(usually web; a publicly indexed console landing/login page can qualify; never a
  webservice/tunnel action)* — Q16 Domain? Per §3 page: publicly indexable? Target phrase for
  each page that is (propose from approved copy).
- **Constraints & ops** — Q17 Push policy: free or checkpoint? Q18 Review cadence: each-task,
  every-N (pick N), or end (default)? Q19 What must the agent NEVER touch? Non-negotiable
  decisions to protect, with rationale?

**Step 3 — LOCK ASSUMPTIONS (gate).** Before writing, list every assumption and open question
in one block and ask the user to correct it now:
```
ASSUMPTIONS (correct me now or I build on these):
1. Console pal, single profile, no multi-tenant.
2. "Submit" creates a new record; never edits.
OPEN QUESTIONS (I will not invent answers):
- Exact Pro-tier price — needs a real number.
```

**LOCK done when:** the user has confirmed assumptions, open questions, and every proposed behavior seam.

**Step 4 — Write SPEC.md.** Read `references/spec-template.md` now and follow it. Set
`status: draft`. Walk the user through copy and behavior; apply corrections.

**Step 5 — REALITY CHECK (gate).** Proves the spec is buildable on PalBuilder before anyone codes:
1. Run **`pal_spec_lint`** on SPEC.md. It checks the mechanical half deterministically
   (placeholders, dead §3 links, §8a types/keys/sizes/indexability, §5 dataset references,
   the §12 floor, the brownfield REGRESSION criterion). Clear every `HARD_FLAG`.
2. Read `references/reality-check.md` and do the judgment half the linter cannot:
   capability→primitive mapping, §6 components exist in COMPONENTS.md, §8b consumed fields
   verified against the live dataset, scope honesty.
   For any visually significant page, check §6 against the design-principles reference:
   user journey, hierarchy, grouping, target sizing, and progressive disclosure are explicit enough
   for a build agent to implement.
3. Write results into §13. Any hard flag → stay `status: draft`, `reality_check: blocked`.
   All clear → `status: approved`, `reality_check: pass`.

**Step 6 — Write EXECUTION.md.** Read `references/execution-template.md` now and follow it
(Build Plan first, then Tasks).

The **first task is always a standalone foundation task**. Give it its own row, tier `cheap`,
`depends: —`, and a success condition requiring the model to copy matching templates and canonical
runtime files with bash `cp` (never read-then-write), author a readable per-project
`styles/styles.css`, register the four runtime entries in `pal.json`, and — for console pals —
establish the `run()` skeleton from the copied template.
The task must reach `pal_validate 0` and `pal_test` VALIDATED on that hand-built shell. Every task
that adapts the shell, fragments, or workflow depends on this foundation task (datasets are leaves
and may be created before or alongside it). Existing pals that lack `styles.css` are not migrated.

---

## Amendments — controlled spec changes mid-build

An approved spec is the contract, but reality can contradict it after the build starts
(a type that won't create, a missing consumed field). The invariant: **the agent never silently self-amends.**
The flow: pal-loop STOPS the affected task and writes an amendment
proposal in Blockers → the human approves → pal-spec applies the minimal edit, bumps
`spec version`, appends a §14 log entry, re-runs the reality check for the amended § only →
pal-loop resumes. Full protocol: `references/amendment-path.md`.

## What this skill does NOT do
- Build anything — **pal-loop** executes EXECUTION.md.
- Specify visual design — DESIGN_SYSTEM.md / COMPONENTS.md own that; the spec carries §6
  layout only.
- Re-teach platform rules — the palbuilder-* skills, design-build, and seo-core own those;
  the spec REFERENCES them via §9/§10.
- Fix bugs — **pal-fix** handles small corrections without this ceremony.
