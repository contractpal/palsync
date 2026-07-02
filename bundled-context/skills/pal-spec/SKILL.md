---
name: pal-spec
description: "Interview the user and produce SPEC.md + EXECUTION.md, the two files that drive an autonomous pal build. Trigger phrases: 'spec out', 'plan this pal', 'interview me', 'create a spec', or starting a new pal from a description. Modes: FULL (production) and LITE (prototype/MVP). Not for bug fixes (use pal-fix) or visual design (design-system-init)."
---

# pal-spec — interview → SPEC.md + EXECUTION.md

Produces the two files an autonomous build runs on. Thesis: **the spec is the only artifact that
earns its tokens** — a complete spec lets a cheaper model build correctly; a vague spec makes every
model guess. Remove every guess in the right place (copy and behavior here, visual design in
DESIGN_SYSTEM.md, nowhere twice), then **prove the spec is buildable on PalBuilder before anyone
codes.**

The output is a **gated chain** with a human gate at each step, because each gate is a cheap place
to catch an error that is expensive later:

```
MINE → INTERVIEW → LOCK ASSUMPTIONS → SPEC.md (draft) → REALITY CHECK → approved → BUILD PLAN + TASKS
                         gate                              gate                          gate
```

Do not skip a gate.

**Hard rule — REAL CONTENT ONLY**, because a placeholder is a guess the build will get wrong. Every
copy field gets real approved words; every dataset field a real type; every workflow real behavior.
Unknowns go in §2 Decisions & open questions — never TBD, never "placeholder", never "decide later"
inline.

**Hard rule — DESIGN IS A HANDOFF, NOT A SECTION**, because visual design has its own artifact and
duplicating it drifts. No palettes, fonts, or aesthetic direction here — those live in
`DESIGN_SYSTEM.md` / `COMPONENTS.md` (from **design-system-init**). The spec carries only per-page
composition (§6). No DESIGN_SYSTEM.md → stop and run design-system-init first.

---

## 1. Choose the mode first

Ask, or infer from the user's words, before interviewing:

- **LITE** — prototype, MVP, spike, demo, "quick", throwaway, internal tool for one or two people.
  Optimizes for speed to a working thing.
- **FULL** — production, client-facing, real users, anything storing real data, anything ContractPal
  ships. Optimizes for correctness and verifiability.

Unsure → ask one question: *"Throwaway prototype, or something for real users?"* Record as `mode:`.

**LITE keeps (non-negotiable):** the one primary action; real copy on primary screen(s); the
sitemap; the design handoff (a minimal DESIGN_SYSTEM.md is fine but must exist); the required-skills
+ PalBuilder-surface manifest; the global acceptance floor; and the REALITY CHECK — a prototype that
isn't buildable is the worst prototype.

**LITE relaxes:** behavior is happy-path only (edges listed as "deferred (prototype)"); acceptance is
the global floor + one happy-path check per primary action; secondary-page copy may be
stubbed-but-marked; protected decisions optional; coarser task granularity.

Sections tagged **[FULL]** are full-mode only. Everything else applies to both.

**Spec length budget** — LITE ≤2,000 words, FULL ≤5,000. Over budget = scope too big: split or cut.
The spec is re-read throughout the build, so every word costs tokens on every task.

---

## 2. Run the interview

**Brownfield (a MAP.md is present — handoff from pal-init):** don't re-interview the whole pal.
Consume MAP.md as ground truth for what exists and scope the interview + spec to the CHANGE pal-init
scoped. This modifies four template places (§6 layout, §8b consumed datasets, §11 NEVER, §12
acceptance — each marked "Brownfield" inline) plus one added REALITY CHECK item. No MAP.md → proceed
greenfield.

1. **Mine before you ask** — turn what exists into PROPOSED answers, because confirming a proposal
   costs seconds and an open question costs minutes. Mine the pulled workspace, any live site/doc the
   user points at, the project DESIGN_SYSTEM.md, and the first description. **Record where each fact
   came from** — a claim with no source is an open question, not a spec line. Never invent stats,
   prices, or testimonials.

2. **Ask in batches of 3–4** (skip what mining answered):

   **Product & audience** — Q1 What is this (one sentence)? Q2 Who for (role, industry)? Q3 The ONE
   primary action? Q4 Web (public), console (logged-in), or both? A pal can mix — if both, get the
   split now: which pages are web, which are console.

   **Integration surface** *(most pals: none — skip)* — Q5 Does anything OTHER than a browser call
   this pal? Two workflow types cover it, either addable alongside web/console pages: **webservice**
   (`workflowType: 12`) — a REST/SOAP endpoint an external system calls in; **tunnel**
   (`workflowType: 15`) — pal-to-pal / enterprise / cross-cloud. If either applies: which caller,
   which action(s), request/response shape. These are non-page-serving — no sitemap row, no layout;
   capture as §5 Behavior and list the workflow + type in §9/§10.

   **Scope & structure** — Q6 Pages/screens? (propose a sitemap, tag each row web or console) Q7
   Explicitly OUT of scope?

   **Copy** — Q8 Per page, draft H1/subhead/CTA/section copy YOURSELF from mined material, present,
   get it corrected — page by page. Q9 Claims/stats/pricing that must be exact? (ask; never invent;
   record source)

   **Behavior** *(console/app pals, any page with logic, any Q5 action)* — Q10 Per action: trigger,
   INPUT, VALIDATION, STATE change (which dataset/field), OUTPUT. Q11 **[FULL]** Edge & error cases:
   empty, invalid, not-found, duplicate, auth-fail. *(LITE: note as deferred.)*

   **Data** — Q12 Entities, fields, exact PalBuilder types? (propose schemas; confirm)

   **Design handoff** *(not design itself)* — Q13 DESIGN_SYSTEM.md + COMPONENTS.md present? No → run
   design-system-init, return. Yes → per page, propose a layout skeleton: section order + which named
   component fills each slot. No colors/fonts.

   **SEO** *(usually web; a console page can qualify — e.g. a logged-out landing/login screen that's
   publicly indexed; never a webservice/tunnel action)* — Q14 Domain? Per §3 page, is it publicly
   indexable? Target phrase for each one that is (propose from approved copy). Don't gate purely on
   the web/console tag — ask.

   **Constraints & ops** — Q15 Push policy: free or checkpoint? Q16 Review cadence: after each task,
   every N tasks (pick N), or end (default — full-auto, review once done)? Q17 What must the agent
   NEVER touch? Any non-negotiable decisions to protect, with rationale?

3. **LOCK ASSUMPTIONS (gate).** Before writing, list every assumption and open question in one block
   and ask the user to correct it now:
   ```
   ASSUMPTIONS (correct me now or I build on these):
   1. Console pal, single profile, no multi-tenant.
   2. "Submit" creates a new record; never edits.
   OPEN QUESTIONS (I will not invent answers):
   - Exact Pro-tier price — needs a real number.
   ```

4. **Write SPEC.md** → **read `references/spec-template.md` now** and follow it. Set `status: draft`.
   Walk the user through copy and behavior; apply corrections.

5. **Run the REALITY CHECK (gate)** → **read `references/reality-check.md` now** and run it. Resolve
   every hard flag; a hard flag keeps `status: draft`. Only when all clear → `status: approved`.

6. **Write EXECUTION.md** → **read `references/execution-template.md` now** and follow it (Build Plan
   first, then Tasks). Types for §8 datasets are in `references/palbuilder-types.md`.

---

## Amendments — controlled spec changes mid-build

An approved spec is the contract, but reality can contradict it after the build starts. The spec
must be able to change **without ever being silently self-amended.** Full canonical protocol:
**read `../shared/amendment-path.md`**. In short: pal-loop STOPS the affected task and writes an
amendment proposal in Blockers → the human approves → pal-spec applies the minimal edit, bumps
`spec version`, appends a §14 log entry, and re-runs the reality check for the amended § only →
pal-loop resumes. The invariant: **the agent never silently self-amends.**

---

## What this skill does NOT do
- It does not build anything — **pal-loop** executes EXECUTION.md.
- It does not specify visual design — DESIGN_SYSTEM.md / COMPONENTS.md (design-system-init) own that;
  the spec carries §6 layout only.
- It does not re-teach platform rules — the palbuilder-* skills, design-build, and seo-core own
  those; the spec REFERENCES them via §9/§10.
- It does not fix bugs — **pal-fix** handles small corrections without this ceremony.
- It never invents facts: no made-up stats, prices, testimonials, or PalBuilder primitives.
