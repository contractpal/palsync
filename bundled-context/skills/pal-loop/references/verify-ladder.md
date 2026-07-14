# Verify ladder branches

## UI by task type

UI-only: one desktop `pal_screenshot`. Behavior-only: one `pal_exercise`. Both: one of each. Merge same-page assertions into one flow. Mobile is final-review-only. A clean capture has `renderError:null`, loaded CSS, zero pal-content audit errors, and pixel critique. Apply `../../shared/references/console-chrome-exception.md` only with quoted sample evidence.

## Console render

Read `../../pal-review/references/console-render-verification.md`. A render error fails even after a clean compile. If capture is unavailable, record a `HUMAN GATE` naming what must be checked.

## Exercise authoring

Batch create → edit → delete into one `steps` call. Use unique `{{runId}}` values. Scope repeated row/card actions with `within:`. Never use global `absent` for a state word such as “available” on a multi-row list; scope it to the row. Edit expects the new value and marks the old value absent; delete marks the unique deleted value absent. Never use list order or empty-state copy as proof.
