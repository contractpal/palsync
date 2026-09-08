# Verification policy — the single source of truth

Every skill defers to this file for *how much* to check and *when* to review. Do not restate a
proof ladder anywhere else.

Two saved user settings (`palsync settings`, stored in `~/.palsync/config.json`):

```
verification: fast | standard | thorough      (default: standard)
review:       off  | ask      | auto          (default: ask)
```

Say the current setting once, in one line, when work starts:
`PalSync: Standard checks · Final review: Ask`.

## The governing rule

**Use the cheapest verification that gives reasonable confidence for the change being made.**
An expensive step needs a reason you can say in one plain sentence. If you cannot, skip it.

## Always, at every level

- Offline/static validation. `pal_push` runs the full validation as its gate — never run
  `pal_validate` immediately before a push, and never twice without an edit in between.
- Push before any runtime check: runtime tools only see the pushed version.
- Never report page content, saved data, or a completed click/submit as fact unless a tool
  showed it to you.
- Failed or unrun verification is never a PASS, at any level.

## Fast

Static checks and the push gate only. No live tests, screenshots, exercises, regression, SEO
audit, or review unless the user asks for them by name.

## Standard (default)

Static checks and the push gate, plus targeted live proof **for what actually changed**.
Classify the change from facts, not vibes — `palsync verify` prints this classification and the
resulting plan for the current local diff, and `pal_impact` answers dependency questions:

| Risk | What it looks like | What Standard does |
| --- | --- | --- |
| **Low** | CSS, colors, type, static copy, simple markup, an isolated leaf component, no known dependents | push, then **one** targeted render/screenshot if seeing it materially helps. Nothing else. |
| **Medium** | one interaction, one form, one action handler, page-specific dynamic behavior, a file with 1–2 dependents | push, then prove **the behavior that changed** (`pal_exercise`, or `pal_fetch`/`pal_screenshot` with `expect`). `pal_exercise` starts with a fresh server compile, so do not call `pal_test` first. |
| **High** | shared fragment/workflow with 3+ consumers, auth, transactions, destructive actions, dataset schema, tunnels/webservices, 8+ files at once | `pal_impact` first, then targeted tests plus the affected regression coverage (`pal_regression` when `baseline/baseline.json` exists). |

Do NOT automatically run, in Standard: broad workflow smoke tests, `pal_exercise` for a
presentation-only edit, full regression, desktop+mobile screenshot suites, or `pal-review`.

## Thorough

The full relevant set: compile proof, render proof on desktop and mobile, behavior exercises,
regression when a baseline exists, SEO audit for public web pages, and the final review the
`review` setting asks for. Still do not repeat work an authoritative gate already did: push
already validated, and an exercise already starts with a fresh server compile.

## Final review

`pal-review` is a real, independent, fresh-context review — it is powerful and unchanged. It
runs **at the end of the work, once, or never**. Never between tasks.

- **off** — do not run it, and do not ask.
- **ask** (default) — finish, then offer: *"Implementation complete. Run a final review?"*
- **auto** — run it once at the end and summarize the verdict.

All tasks done is a complete implementation. Completion is not blocked by a review that policy
did not ask for; `palsync completion check` enforces review evidence only when `review: auto`.

## Say what you're doing

Before an expensive or surprising step, one short sentence, no jargon:

- "Testing the save action because its behavior changed."
- "Checking related pages because this shared component is used in 6 places."
- "Taking a screenshot to confirm the layout change."

Not: "Executing regression strategy level 2 due dependency fanout." No running narration.

## Completion summary

```
Done

Changed
• Updated profile card spacing
• Fixed mobile button alignment

Checked
✓ Static checks passed
✓ Affected page rendered
– Full regression not needed for this isolated change
– Final review not run (your setting is Ask)

Run a final review? (yes / finish)
```

Say what you did NOT check and why, in the same plain language. For `review: off`, don't ask.
