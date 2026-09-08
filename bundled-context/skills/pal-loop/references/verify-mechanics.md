# Verify mechanics — how to run and read a check

*How much* to check is decided in `../../shared/references/verification.md`. This file is only
the mechanics of the individual checks.

## Push / validate

`pal_push` gates changed files plus narrow cross-file contracts; it blocks errors and surfaces
advisory warnings. Use standalone `pal_validate` between edits for diagnosis, never twice
without an edit in between, and never immediately before a push (push runs the same validation).

## WEB page checks

`pal_fetch`/`pal_preview` with `expect:[...]` returns per-string found/missing, not the HTML —
use `selector`/`maxChars` only when you truly need markup. `pal_fetch` proves server-rendered
text only: markup/CSS/JS/responsive/interactive changes need real browser evidence
(`pal_screenshot`, or `pal_exercise` with `browser:true` for JS/DOM/async behavior).
`pal_seo_audit` (`ok:true`, `diagnosticCount:0`) applies to public web pages.

## Screenshots

A clean capture has `renderError:null`, loaded CSS, zero pal-content audit errors, and a pixel
critique against design-build's archetype rubric. Fix the highest-impact failures, push,
re-capture. After a single-class/attribute fix, `pal_push`; if its server notes are clean, skip
a duplicate `pal_test` and re-check with `pal_screenshot imageless:true`. Apply
`../../shared/references/console-chrome-exception.md` only with quoted sample evidence.

Branch recovery (from `pal_screenshot`):

- `captured:false` + `category:"targeting"` → you screenshotted the wrong screen. Fix the
  `action`/`params`/`expect` and re-capture; it counts for nothing.
- `captured:true` + `stateVerified:null` → the image is not proven to be the screen you
  targeted; re-run with `expect:[...]`.
- `captured:true` + `renderError` non-null → the workflow compiled but threw while rendering —
  fix, push, screenshot again; `pal_test` passing does NOT clear it.
- `captured:true` + `renderError` null → judge the image against §12 VISUAL → `done`.
- `captured:false` → do NOT guess from HTML: run `palsync task <id> needs-human --reason
  "HUMAN GATE: <what the human must confirm>" --tried "<command + error>"`, naming exactly what
  to eyeball, and continue with independent tasks.

A render error fails even after a clean compile — full rule:
`../../pal-review/references/console-render-verification.md`.

## Exercises

Full authoring rules: `../../shared/references/exercise-authoring.md`.

**Console targeting.** A console/transaction pal reaches its FIRST screen through
`initial:{action, params, expect}` — the action takes the `c:a` form (`"openClientSetup"` or
`"openClientSetup?id=9"`). Every later screen is reached by clicking the rendered link text. A
step-level `action`/`page` is rejected on a console pal. No step runs until `initial.expect` is
visible; otherwise the result is `category:"targeting"` with zero steps run and nothing mutated.

**Failures.** A blocked/failed `pal_exercise` is NOT a PASS. The run persists failure-only
artifacts in a returned `.agent-work-history/` run directory (`steps.json`,
`browser-events.json`, `aria-snapshot.txt` or `screen-hints.json`, `failure.jpg` when captured,
`metadata.json`, `notes.md`). Read those artifacts instead of probing selectors by trial and
error, then re-run. Passing runs write no failure artifacts.

## Datasets

`pal_sync_datasets` after pushing a **§8a** definition (never §8b). Never provision §8b
consumed datasets.

## Warnings

Fix warnings, or checkpoint why each one is safe for this task before marking it `done`;
warnings may push but are never silently ignored. Errors cannot be waived.
