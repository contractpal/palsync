# Completion handoff

Read at the end of the work, not between tasks.

## 1. Summarize

State, in plain language: what changed, what was checked, and what was deliberately not
checked and why (the shape is in `../../shared/references/verification.md`).

## 2. Regression — only when it earns something

Run `pal_regression` only if `baseline/baseline.json` exists AND the change was high risk
(shared fragment/workflow, auth, transactions, dataset schema, broad fan-out) or verification
is `thorough`. A change confined to what you edited does not get a regression sweep; say so
instead of running one.

`pal_regression` does the whole mechanical check: freshness gate (stale → `{stale}`; recapture
per `../../shared/references/regression-baseline.md`), validate/`pal_test`/page-`h1s` vs
`baseline.json`, `eyeball_only` viewports → `needs_human`, inherited (`known_issues`) vs caused
split. `caused` empty → pass; `inherited`/`needs_human` never block.

A `caused` failure → **bisect for the culprit** (the break may have ridden through several
commits): start at the last commit where this check passed, walk per-task commits forward
re-running the SAME failing check against each commit's file state (`git show <sha>:<path>` —
read-only), and the first failing commit names the culprit task. Reopen and `block` that task,
citing the baseline comparison and the commit.

## 3. Close out

1. Cost recording — IF harness is claude-code THEN skip `palsync cost record` (the agent cannot
   read its own spend); IF pi THEN run `palsync cost record --model <model> --phase <build|review>`
   using the user-supplied footer figures.
2. Run `palsync session-summary [--mode <full|lite>] [--next "<text>"]` to append the canonical
   session summary. If no single ready task is unambiguous, provide `--next`.
3. Run `palsync completion check`. It reports which review path applies.

## 4. Final review — per the `review` setting

- **off** — finish. Do not ask.
- **ask** (default) — say the implementation is complete and offer the review. The user decides.
  Completion is not blocked by declining it.
- **auto** — dispatch **one** `pal-review` in a fresh session/subagent, at the end, with
  `palsync review brief` output, SPEC.md, EXECUTION.md, DESIGN_SYSTEM.md/COMPONENTS.md,
  `baseline/` (if any), and the pal's identity so it can `pal_fetch`/`pal_screenshot`/`pal_test`
  the real artifacts. Report the verdict.

When a review does run:

- **PASS** → run `palsync completion check` yourself in the workspace.
- **CHANGES-NEEDED** → append each `## Fix tasks` item as a new EXECUTION.md task (next id,
  `spec ref` from the finding, `depends` per stated order, `todo`, tier `standard` unless it
  needs new structure) and resume the cycle on exactly those tasks. Re-review when they are
  `done`; every pass overwrites `REVIEW.md` with that pass's verdict, its own complete
  `palsync review check` output, and fresh evidence. Chat-only verdicts are invalid.
- **needs-human** (console eyeball gate) → routes like any other `needs-human` task.

After reviewer dispatch, the builder performs no source, `.palsync.json`, EXECUTION, or
evidence-producing action unless the verdict is CHANGES-NEEDED. "The exercises pass now" never
permits skipping an independent re-review that policy asked for.
