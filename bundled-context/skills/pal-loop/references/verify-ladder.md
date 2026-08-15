# Verify ladder branches

## UI by task type

UI-only: one desktop `pal_screenshot`. Behavior-only: one `pal_exercise`. Both: one of each. Merge same-page assertions into one flow. Mobile is final-review-only — but final review is refused without it (`palsync review check` requires clean desktop+mobile captures per reviewed route), so budget the mobile pass into the review phase, ahead of writing REVIEW.md. A clean capture has `renderError:null`, loaded CSS, zero pal-content audit errors, and pixel critique. Apply `../../shared/references/console-chrome-exception.md` only with quoted sample evidence.

## Console render

Read `../../pal-review/references/console-render-verification.md`. A render error fails even after a clean compile. If capture is unavailable, record a `HUMAN GATE` naming what must be checked.

## Exercise authoring

Full rules: `../../shared/references/exercise-authoring.md`.

### Exercise failures

A blocked/failed `pal_exercise` is NOT a PASS — do not mark the pal done. The run persists failure-only
artifacts in a returned `.agent-work-history/` run directory (`steps.json`, `browser-events.json`,
`aria-snapshot.txt` or `screen-hints.json`, `failure.jpg` when captured, `metadata.json`, `notes.md`) and
returns a compact evidence summary with the path. Inspect those artifacts (browser events, accessibility
snapshot, failure screenshot) instead of probing selectors by trial and error, and only re-run after
reading them. Passing runs write no failure artifacts.
