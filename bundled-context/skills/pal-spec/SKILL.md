---
name: pal-spec
description: "Load to plan a new pal or significant change: interview the user until you agree on GOAL.md (outcome + approved acceptance checks). Not for bug fixes, small enhancements, or visual-system setup."
---

# pal-spec — interview → approved GOAL.md

The user owns the goal; you own the spec. Your job here is to reach agreement with the user on
**what done means**, written as `GOAL.md` in the workspace root. After approval, `pal-loop`
builds and verifies it without the user. Plan the engineering yourself — any plan, notes, or
design file is yours to shape and is never gated.

```
MINE → INTERVIEW → LOCK SUMMARY → GOAL.md draft (checks + scripts) → CHECK REVIEW → user approves
```

**Hard rules:**
- **Never invent facts** — no made-up stats, prices, testimonials, or business rules. A rule
  you cannot mine is a question for the user, never a guess.
- **User taste is recorded, not invented.** Capture reference sites, brand, and stated
  preferences verbatim under `## Constraints`.
- **Every acceptance check is a user flow the user can read.** One sentence, the user's words,
  observable end state. A check you cannot state that way is not a check yet.

## 1. Interview

Talk like a product engineer. Most users do not write code: ask what the Pal must do and decide
the engineering yourself from the palbuilder-* skills.

**Existing pal:** do not re-interview the whole pal or map it up front. Inspect only what the
change touches (`pal.json`, the named pages/fragments/workflows/datasets, `pal_impact` on shared
fragments) and scope the goal to the change. Add one check that the existing behavior the user
cares about still works.

**Mine before you ask.** Turn the workspace, any site/doc the user points at, and the first
description into proposed answers. Confirming a proposal costs seconds; an open question costs
minutes. Never ask for something the user already said.

Then ask, in batches of 3–4, only what mining did not answer:
- **Purpose & people** — what it is, who uses it, what each kind of user can see and do;
  prototype or real users; public web, console, transaction, or a mix (get the page split).
- **Journeys** — for each main task: where the user starts, what they enter, what happens next,
  who finds out. These become the acceptance checks.
- **Business rules** — only what applies: record states and who moves them; who may see, change,
  cancel, or undo whose records; limits; destructive actions; privacy; what users see on failure.
- **Words & facts** — draft the visible copy yourself, present it, get it corrected.
- **Scope** — what is out, what must never be touched.
- **Integration** *(most pals: none)* — does anything other than a browser call this Pal?

**Ask about business policy; decide engineering defaults** (required-field checks, error states,
duplicate-submit protection, `confirm` on destructive actions, types, files, skills, workflow
shape). On a new pal, ask whether to use CloudPiston Resource
(`../palbuilder-core/references/pal-chain.md`) for modals, toasts, validation, and paging.

**LOCK (gate).** Before you write GOAL.md, give a plain summary with no dataset, workflow, or
file names, and invite corrections:
```
HERE'S WHAT I'LL BUILD — correct anything that's wrong:
1. What it does: …   2. Who uses it: …   3. How it works: …   4. What it keeps: …
5. Already decided (say if wrong): …
6. I need your answer on: …
```
LOCK is done when the user confirmed the summary and answered every question.

## 2. Write GOAL.md

Format (`pal_goal_lint` and the completion gate parse it — keep the headings exact):

````markdown
# GOAL — <pal name>

status: draft

## Outcome
2–5 sentences in the user's words: who, what, why.

## Acceptance checks

### A1 — Create a request
Staff create a request with a valid email and description; it appears in the list as Open.

```json
{ "workflow": "console", "steps": [
  { "click": "New request", "expect": ["Customer email"] },
  { "fill": { "customerEmail": "c{{runId}}@example.com", "description": "Leak {{runId}}" },
    "click": "Create request", "expect": ["c{{runId}}@example.com", "Open"] }
] }
```

### A9 — Looks professional
The console looks like a clean, professional tool on desktop and mobile.

## Fixed contracts
Names and words the user requires (dataset/field names, exact copy). Omit if none.

## Constraints
Must-keep rules, taste, platform limits.

## Non-goals
What is out of scope.
````

**Checks:**
- One check per user flow, including each important rejection path (invalid input, forbidden
  action) and, for existing pals, one regression flow. A prototype needs only the happy paths.
- A check with a ```json block is **script-verified**: the block is the exact `pal_exercise`
  arguments (`steps`, optional `workflow`, `initial`, `viewport`, `browser`). Read
  `../shared/references/exercise-authoring.md` before you write steps. The completion gate
  requires each script to pass on the final pushed version. Script every flow you can.
- A check without a block is **review-only** (look and feel, wording quality). Keep these few.
- Each script must prove its sentence: assert the end state the sentence names (`expect`) and
  the absence it implies (`absent`), with unique `{{runId}}` data scoped by `within`. A script
  that passes when the feature is missing is a defect.
- Write scripts against the words and input names in GOAL.md, so the build can satisfy them.
  Put every label a script clicks or fills in `## Fixed contracts` or in the check sentence.

Run **`pal_goal_lint`** and clear every error.

## 3. Check review (gate)

Read `references/spec-review.md` and run the fresh-context review: a reviewer with only GOAL.md
compares each script with its sentence and the outcome. Fix or reject each finding with a reason.

Then show the user the outcome and the check sentences (not the JSON), plus any decision the
review changed. When the user approves, set `status: approved`. That approval is the contract:
from here, `pal-loop` builds and verifies with no more questions.

## Changes after approval

The builder may fix a script's mechanics (a selector, a wait, a scope) when the build needs it,
but must keep every assertion its sentence needs, and records the change and reason under
`## Notes`. A change to a check sentence, the outcome, or a fixed contract is the user's: ask,
then edit GOAL.md. Never weaken or delete a check to finish.

## What this skill does NOT do
- Build — **pal-loop** builds and verifies GOAL.md.
- Specify visual design — the builder styles against `palbuilder-frontend/references/ui-quality.md`.
- Fix bugs or make small enhancements — **pal-fix** does those without a goal file.
