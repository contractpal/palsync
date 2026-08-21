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

Before writing, trace the touched flow and stop at the first rung that holds: (1) YAGNI — do not build it; (2) reuse an existing fragment/function/dataset/class; (3) use a supported `c:` tag or platform API; (4) use an already sanctioned capability; (5) write the minimum readable ES3-compatible solution. Touch only named files.

Ladder adapted from Dietrich Gebert's ponytail; assumption discipline from Andrej Karpathy's LLM-coding-pitfalls guidance.

## Multi-block edit re-read

After a multi-block edit call, re-read the changed region before pushing when the harness does not report expected-vs-actual replacement counts. On non-Claude harnesses, keep one logical change per edit call.
