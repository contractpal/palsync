---
name: pal-spec
description: "Load to plan a new pal or significant change and produce SPEC.md + EXECUTION.md. Not for bug fixes, small enhancements, or visual-system setup."
---

# pal-spec — interview → SPEC.md + EXECUTION.md

Produce the two files an autonomous build runs on. A complete spec lets a cheaper model build
correctly; a vague spec makes every model guess. The output is a **gated chain** — do not skip
a gate:

```
MINE → INTERVIEW → LOCK SUMMARY → SPEC.md draft → EXECUTION.md draft → JOINT REALITY CHECK → jointly approved
                        gate                                                gate                         gate
```

**Hard rules:**
- **REAL CONTENT ONLY.** Every copy field gets real approved words; every dataset field a real
  type; every workflow real behavior. Unknowns go in §2 Decisions & open questions — never
  `TBD`, never "placeholder", never "decide later" inline.
- **USER TASTE IS RECORDED, NOT INVENTED.** Capture what the user supplies — reference sites or
  screenshots, brand (logo, colors), and stated preferences — verbatim in the `look & feel`
  header; invent no palettes, fonts, or aesthetic direction beyond it. The spec
  carries per-page composition and UX flow (§6): primary path, hierarchy, and progressive
  disclosure; the builder styles against `palbuilder-frontend/references/ui-quality.md`. Every
  frontend spec follows `../shared/references/css-conventions.md` unless the project is a non-UI service-only pal.
- **Never invent facts** — no made-up stats, prices, or testimonials. Record the source of
  every claim; a claim with no source is an open question.

---

## 1. Choose the mode first

- **LITE** — prototype, MVP, spike, demo, "quick", internal tool for one or two people.
- **FULL** — production, client-facing, real users, real data, anything ContractPal ships.

Unsure → ask one question: *"Throwaway prototype, or something for real users?"* Record as `mode:`.

**LITE keeps (non-negotiable):** the one primary action; real copy on primary screen(s); the
sitemap; the required-skills +
PalBuilder-surface manifest; the global acceptance floor; the REALITY CHECK.
**LITE relaxes:** behavior is happy-path only (edges listed as "deferred (prototype)");
acceptance = global floor + one happy-path check per primary action; secondary-page copy may be
stubbed-but-marked; protected decisions optional; coarser tasks.

Sections tagged **[FULL]** are full-mode only.

**Length budget:** LITE ≤2,000 words, FULL ≤5,000. Over budget = scope too big: split or cut.
The spec is re-read on every build task, so every word costs tokens repeatedly.

---

## 2. Run the interview

Talk like a product engineer, not a form. Most users do not write code: ask what the Pal must do
and decide the engineering yourself from the palbuilder-* skills.

**Existing pal:** do NOT re-interview the whole pal, and do not map it up front. Inspect the
surface the change actually touches — `pal.json` for the inventory, the pages/fragments/workflows
and datasets the change names, and `pal_impact` on any existing page or fragment other files
reference. Scope the interview and the spec to the CHANGE. Four template places differ for an
existing pal (§6 layout, §8b consumed datasets, §11 NEVER, §12 acceptance). A `MAP.md` may be read
if one happens to exist, but nothing requires it and nothing generates one.

While inspecting the touched surface, ask: *what would make this change easy?* If the change
would otherwise duplicate an existing fragment/function, repeat the same switch/branch in a new
place, or scatter one logical edit across many files, record `DECISION: prefactor <what> —
rationale: <the friction>` in §2 and plan a behaviour-preserving prefactor task first. If the
latest `REVIEW.md` has a "Code health" note for the touched files, weigh it here. Skip the
prefactor when the friction is speculative. Most changes need none.

**Step 1 — Mine before you ask.** Turn what already exists (the pulled workspace, any live
site/doc the user points at, the first description) into PROPOSED answers.
Confirming a proposal costs seconds; an open question costs minutes. Never ask for something
the user already said. Record where each fact came from.

**Step 2 — Propose, then ask about decisions.** Open with a plausible version of the product
(users, main journey, screens) and invite corrections. Then ask, in batches of 3–4, only what
mining did not answer:

- **Purpose & people** — What is it, in one sentence? Who uses it, and what can each kind of
  user see and do? Throwaway prototype or real users (sets `mode:`)? Public web, logged-in
  console, or both (get the page split)?
- **Journeys** — For each main task: where the user starts, what they enter or choose, what
  happens next, who finds out. Propose the sitemap (each row web or console) and confirm it.
- **Business rules** — Raise only what applies: record states and who moves them; who may see,
  change, cancel, or undo whose records; conflicts and limits; destructive actions; privacy; what
  users see when something fails.
- **Information** — What the Pal records or changes, which existing data it uses, anything
  private. Translate the answers into §8 schemas yourself (`references/palbuilder-types.md`).
- **Words & facts** — Draft each page's H1/subhead/CTA/section copy yourself from mined
  material, present it, get it corrected. Ask for exact claims, stats, prices; never invent.
- **Scope** — What is explicitly out? What must never be touched? Any decision to protect?
- **Integration** *(most pals: none — skip)* — Does anything other than a browser call this
  Pal (another system → webservice `workflowType: 12`; another pal/cloud → tunnel
  `workflowType: 15`)? Which caller, what it sends, what it gets back. No sitemap row; capture
  as §5 behavior, list workflow + type in §9/§10.
- **Public pages** *(web only)* — Domain? Which pages should search engines find?

**Ask about business policy; decide engineering defaults.** Decide, and list under §2 DEFAULTS:
required-field validation, clear error states, duplicate-submit protection, enforcing the access
rules the user stated, `confirm` on destructive actions, push policy `free` (deploy stays
human-only), and every type, workflow, file, skill, primitive, and test seam. Ask: anything that
changes what a user sees, can do, or is told — e.g. overlapping requests, cancelling after
approval, who sees whose data. A business rule you cannot mine is an OPEN question, never a guess.

**Page layout** *(engineering — resolve it yourself, show the user only the page flow)* —
per page, propose a layout skeleton: section order + hierarchy/primary action/progressive
disclosure notes. Every new-pal page shell follows `../shared/references/css-conventions.md`.
Prefer inline SVG icons. No colors/fonts beyond the spec's `look & feel` line. Do not retrofit `styles.css` into an existing pal that lacks it. On a new pal,
always ask whether to use CloudPiston Resource (`../palbuilder-core/references/pal-chain.md`)
for what it already covers — modals, toasts, inline alerts, form validation, paging, image
upload — before designing bespoke versions; don't assume. Verification depth and final review
are user settings, not spec fields (`../shared/references/verification.md`).

**Step 3 — LOCK (gate).** Before writing, give a plain-English summary the user can correct
without reading any technical file. No dataset, workflow, or file names:
```
HERE'S WHAT I'LL BUILD — correct anything that's wrong:
1. What it does: employees request time off; managers approve or decline.
2. Who uses it: employees submit and track their own requests; managers decide on them.
3. How it works: employee picks dates + reason → request is Pending → manager approves or
   declines → employee sees the result on their list.
4. What it keeps: each request's employee, dates, reason, status, and who decided.
5. Already decided (say if wrong): required fields are checked; a double-click can't submit
   twice; only managers can approve or decline.
6. I need your answer on: Can two requests overlap? Can an approved request be cancelled?
   Do managers see only their team's requests, or everyone's?
```

**LOCK done when:** the user has confirmed the summary and answered or deferred each question
(deferred ones stay OPEN in §2 and block the tasks they affect).

**Step 4 — Write SPEC.md.** Read `references/spec-template.md` now and follow it. Set
`status: draft`. Walk the user through copy and behavior; apply corrections.

**Step 5 — Write EXECUTION.md.** Read `references/execution-template.md` now and follow it (Build Plan first, then Tasks). Draft it against the current SPEC.md; it is not approved independently.

The **first task is always a standalone foundation task**. Give it its own row, tier `cheap`, `depends: —`, and a success condition requiring the model to copy matching templates and canonical runtime files with bash `cp` (never read-then-write), author a readable per-project `styles/styles.css`, register the four runtime entries in `pal.json`, and — for console pals — establish the `run()` skeleton from the copied template.

**Step 6 — JOINT REALITY CHECK (gate).** Proves the specification and execution contract are buildable before anyone codes:
1. Run **`pal_spec_lint`** on SPEC.md with both files present. It checks the mechanical half deterministically
   (placeholders, dead §3 links, §8a types/keys/sizes/indexability, §5 dataset references,
   the §12 floor, execution task IDs/statuses/tiers/refs/dependencies/success conditions/version,
   and the brownfield REGRESSION criterion). Clear every `HARD_FLAG`.
2. Read `references/reality-check.md` and do the judgment half the linter cannot:
   capability→primitive mapping, §8b consumed fields
   verified against the live dataset, scope honesty.
   For any visually significant page, check §6 against `palbuilder-frontend/references/ui-quality.md`:
   user journey, hierarchy, grouping, target sizing, and progressive disclosure are explicit enough
   for a build agent to implement.
3. Write results into §13. Any hard flag → both artifacts remain draft/unapproved.
   All clear → if the check changed anything the user confirmed at LOCK, tell them in plain words
   and get a yes. Then set `status: approved`, `reality_check: pass`, and confirm EXECUTION.md's
   `spec version` matches SPEC.md. The pair is then jointly approved.

The foundation task must reach `ok:true`, `diagnosticCount:0` from both `pal_validate` and `pal_test` on that hand-built shell. Every task
that adapts the shell, fragments, or workflow depends on this foundation task (datasets are leaves
and may be created before or alongside it). Existing pals that lack `styles.css` are not migrated.

---

## Changes after approval

SPEC.md holds what the user approved; EXECUTION.md holds how it gets built. A change that keeps
every approved product statement and PROTECTED decision true is an implementation change: update
EXECUTION.md, no amendment. A change to what users can do, see, or are told — or to a data
contract or acceptance criterion — is a product change: `references/amendment-path.md` (propose,
human approves, apply, re-gate). **The agent never silently self-amends SPEC.md.**

## What this skill does NOT do
- Build anything — **pal-loop** executes EXECUTION.md.
- Specify visual design — the builder owns that; the spec carries §6 layout only.
- Re-teach platform rules — the palbuilder-* skills and palbuilder-seo own those;
  the spec REFERENCES them via §9/§10.
- Fix bugs or make small enhancements — **pal-fix** handles those without this ceremony.
