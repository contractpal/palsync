# Execute — build-procedure detail

Procedural how-to for task cycle item 4 ("Execute exactly as specced").
Read this reference before executing the task's build procedure.

## Foundation task (T1) — template copy

Foundation task (T1): use bash `cp` to copy the matching pal-type template files and the
runtime shell/styles plus ONLY the behavior scripts with real consumers in current markup;
add a script later when a task introduces its consumer. Replace `{{PAL_NAME}}`/`YOUR-DOMAIN`
placeholders, then adapt; author `styles/styles.css` from selected design-system rules.
For console pals establish the `run()` skeleton from the copied template.

## Per-section build mapping

- Copy: **§4**, verbatim — these exact words ship.
- Layout: **§6** composition, styled via **design-build** (the spec carries no colors/fonts).
- SEO head values: **§7** (web only).
- Schemas: **§8a** (CREATE). **§8b** datasets are CONSUMED, read-only — never create or
  alter one.

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
