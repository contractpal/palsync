# Execute — build-procedure detail

Procedural how-to for the build step of `pal-loop`. The builder reads this before it edits.

## New pal — template copy

First build step of a new pal: use bash `cp` to copy the matching pal-type template files and the
runtime shell/styles plus ONLY the behavior scripts with real consumers in current markup;
add a script later when new markup needs it. Replace `{{PAL_NAME}}`/`YOUR-DOMAIN`
placeholders, then adapt; author `styles/styles.css` per the CSS rule in `palbuilder-frontend`.
For console pals establish the `run()` skeleton from the copied template.

## GOAL.md build mapping

- Copy: the words in `## Fixed contracts` and the check sentences ship verbatim; write the rest.
- Layout and styling: per `palbuilder-frontend/references/ui-quality.md` and the taste under
  `## Constraints` (invent no brand colors or fonts the user did not give).
- Datasets: create the ones the goal needs; a dataset the goal says the pal only consumes is
  read-only — never create or alter it.

## Restraint ladder

Before writing, trace the touched flow: which code already owns this behavior, and would the change
copy it? Stop at the first rung that holds: (1) YAGNI — do not build it; (2) reuse an existing
fragment/function/dataset/class; (3) use a supported `c:` tag or platform API; (4) use an already
sanctioned capability; (5) write the minimum readable ES3-compatible solution. Touch only the files
the change needs. Smallest is not always fewest lines: a self-contained block beats a generic
helper with one caller.

## Keep it easy to change

- **Prefactor when the structure fights the change.** If the change would copy existing logic,
  repeat the same branch in another place, or scatter one rule across files, first make a small
  behavior-preserving refactor of the touched area (consolidate the duplicate, drop a needless
  wrapper, rename what confuses), push, and confirm the existing behavior still holds with the
  cheapest check that shows it. Then make the behavior change. Never refactor unrelated code.
- **Before push, reread your diff** for new duplication, an abstraction with one caller,
  coupling that makes one change touch many files, dead code, and comments that narrate code.
  Fix what you find; this is part of the edit, not a separate review.

Ladder adapted from Dietrich Gebert's ponytail; assumption discipline from Andrej Karpathy's LLM-coding-pitfalls guidance.

## Multi-block edit re-read

After a multi-block edit call, re-read the changed region before pushing when the harness does not report expected-vs-actual replacement counts. On non-Claude harnesses, keep one logical change per edit call.
