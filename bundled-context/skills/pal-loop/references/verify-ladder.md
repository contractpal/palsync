# Verify ladder branches

## UI by task type

UI-only: one desktop `pal_screenshot`. Behavior-only: one `pal_exercise`. Both: one of each. Merge same-page assertions into one flow. Mobile is final-review-only. A clean capture has `renderError:null`, loaded CSS, zero pal-content audit errors, and pixel critique. Apply `../../shared/references/console-chrome-exception.md` only with quoted sample evidence.

## Console render

Read `../../pal-review/references/console-render-verification.md`. A render error fails even after a clean compile. If capture is unavailable, record a `HUMAN GATE` naming what must be checked.

## Exercise authoring

Batch create → edit → delete into one `steps` call. Use unique `{{runId}}` values. Scope repeated row/card actions through the identifying cell with `within: 'tr:has([data-label="Name"]:has-text("{{runId}}"))'` (or the equivalent unique card selector); a shared-name `:has-text()` scope is ambiguous. Use full unique edit values such as `'Old {{runId}}'` and `'New {{runId}}'`: expect the complete new value and mark the complete old value absent, with neither value a substring of the other. Delete marks the unique deleted value absent. Never use global `absent` for a state word such as “available” on a multi-row list, and never use global empty-state copy such as “No equipment yet” as proof; assert absence of the unique `{{runId}}` value instead. Never use list order as proof.
