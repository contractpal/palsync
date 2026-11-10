# Fresh-context check review

The agent that interviewed the user reads GOAL.md with the conversation in mind, so gaps the
conversation filled look closed. The builder and the verifier get only the file. A reviewer with
only the file finds the checks that would pass on a wrong build or fail on a right one.
Goal eval (2026-11): fixed scripts gave false failures whenever they assumed a UI shape that the
goal did not fix — check that every label a script uses is in the goal.

## Route

- `spec_consensus` tool available (Pi) → load the `spec-consensus` skill instead; it is this step.
- Can spawn a subagent with no conversation history → run the review below. Prefer a different
  model when the harness lets you pick one.
- Neither → note `check review: unavailable (<why>)` under `## Notes` and continue. Never review
  your own draft "as if" fresh — that is not independent.

## Reviewer brief (pass verbatim, fill the path)

```
Review the acceptance checks of a PalBuilder pal before it is built. You have no prior context;
that is the point. Read <ws>/GOAL.md and <ws>/.claude/skills/shared/references/exercise-authoring.md.
Do not edit files.

For each check, compare its json script (pal_exercise arguments) with its sentence. Report:
- a script that would pass when the behavior in the sentence is missing (no expect/absent for
  the end state, unscoped text that matches elsewhere, no unique {{runId}} data)
- a script that would fail on a correct build (a label, input name, or screen order that GOAL.md
  does not fix; a step the sentence does not need)
- a sentence that is not observable, or two checks that contradict each other or the outcome
- a user flow in the outcome that no check covers
Do not report style preferences or wording polish.

Return exactly:
FINDINGS
- id: R<n> | check: <id> | quote: "<exact text>" | problem: <why> | fix: <smallest change> | owner: planner|user
NOTES
- <non-defect observations, or "none">
```

## Resolve

- Answer every finding: **fix** or **reject** with a technical reason. Reviewers are wrong
  sometimes; do not agree just to finish.
- `owner: user` findings (business rules, scope) go to the user as plain questions.
- Re-run `pal_goal_lint` after fixes. One round; re-review only if fixes changed a sentence.
