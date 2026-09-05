# Verify ladder branches

## Push diagnosis

Use standalone `pal_validate` between edits for diagnosis, and never twice without an edit in between — same input, same output. Do not run standalone `pal_validate` immediately before `pal_push` merely to duplicate the changed-file checkpoint; the mandatory whole-workspace pre-`done` validation (step 7) is a separate completion checkpoint, not a redundant pre-push call. `pal_push` gates changed files plus narrow cross-file contracts; it blocks errors and surfaces advisory warnings.

## WEB page verification

`pal_fetch`/`pal_preview` with `expect:[...]` returns per-string
found/missing, not the HTML — use `selector`/`maxChars` only when you
truly need markup. WEB checks: `pal_fetch` or `pal_preview` with
`expect:[the exact strings the success condition names]` → all found,
then `pal_seo_audit` → `ok:true`, `diagnosticCount:0` (public pages).

## UI by task type

Browser evidence is a completion requirement for rendered UI, not a debugging option. UI-only: one
desktop `pal_screenshot`. Behavior-only: one `pal_exercise`. Both: one of each. A WEB pal whose
change is markup/CSS/JS/responsive/interactive needs real browser evidence too — `pal_fetch` proves
server-rendered text only; use `pal_screenshot`, or `pal_exercise` with `browser:true` when the
behavior is JS/DOM/async. Keep `pal_fetch` for plain server-rendered text assertions. Merge same-page assertions into one exercise flow. Mobile screenshots are final-review-only — but final review is refused without it (`palsync review check` requires clean desktop+mobile captures per reviewed route), so budget the mobile pass into the review phase, ahead of writing REVIEW.md. A clean capture has `renderError:null`, loaded CSS, zero pal-content audit errors, and pixel critique. Apply `../../shared/references/console-chrome-exception.md` only with quoted sample evidence.

## UI screenshot rubric and fast re-check

Inspect the desktop image against design-build's archetype rubric; if
the audit/image exposes a failure, fix the three highest-impact issues,
push, and re-capture. Re-run the task's behavior check after the last
visual edit. After a single-class/attribute fix, `pal_push`; if its
server notes are clean, skip duplicate `pal_test` and re-check with
`pal_screenshot imageless:true`.

## Console render

Read `../../pal-review/references/console-render-verification.md`. A render error fails even after a clean compile. If capture is unavailable, record a `HUMAN GATE` naming what must be checked.

Branch recovery (from `pal_screenshot`):
- `captured:false` + `category:"targeting"` → you screenshotted the wrong screen. Fix the `action`/`params`/`expect`, re-capture; it counts for nothing.
- `captured:true` + `stateVerified:null` → the image is not proven to be the screen you targeted; re-run with `expect:[...]`.
- `captured:true` + `renderError` non-null → the workflow compiled but threw while rendering — fix, push, screenshot again; `pal_test` passing does NOT clear it.
- `captured:true` + `renderError` null → judge the image against §12 VISUAL → `done`.
- `captured:false` → do NOT guess from HTML: run `palsync task <id> needs-human --reason "HUMAN GATE: <what the human must confirm>" --tried "<command + error>"`, naming exactly what to eyeball. Continue with independent tasks. (Full rule: `../../pal-review/references/console-render-verification.md`.)

## Exercise authoring

Full rules: `../../shared/references/exercise-authoring.md`.

### Console targeting

A console/transaction pal reaches its FIRST screen through `initial:{action, params, expect}` — the
action takes the `c:a` form (`"openClientSetup"` or `"openClientSetup?id=9"`). Every later screen is
reached by clicking the rendered link text. A step-level `action`/`page` is rejected on a console pal
(it has no dispatch mechanism there), never accepted and ignored. No step runs until `initial.expect`
is actually visible; if it is not, the result is `category:"targeting"` with zero steps run and
nothing mutated.

### Exercise failures

A blocked/failed `pal_exercise` is NOT a PASS — do not mark the pal done. The run persists failure-only
artifacts in a returned `.agent-work-history/` run directory (`steps.json`, `browser-events.json`,
`aria-snapshot.txt` or `screen-hints.json`, `failure.jpg` when captured, `metadata.json`, `notes.md`) and
returns a compact evidence summary with the path. Inspect those artifacts (browser events, accessibility
snapshot, failure screenshot) instead of probing selectors by trial and error, and only re-run after
reading them. Passing runs write no failure artifacts.

## Datasets

`pal_sync_datasets` after pushing a **§8a** definition (never §8b).
Never provision §8b consumed datasets.

## Warning waiver mechanics

Fix warnings too, or checkpoint why each warning is safe for this task
before marking it `done`; warnings are allowed to push but never
silently ignored. Before marking any UI-touching task `done`, whole-
workspace `pal_validate` must show 0 diagnostics, or every remaining
warning must be individually waived in EXECUTION.md with its
`file:line` and a concrete reason. Errors cannot be waived. **Done
when:** every success-condition clause has current pushed-version
evidence and every warning is fixed or explicitly waived.
