# Fresh-context spec review

The agent that interviewed the user reads its own draft with the conversation in mind, so gaps the
conversation filled look closed. A build agent gets only the files. One reviewer with only the files
finds what the build agent would trip on. First real run (2026-09-21): 4 build-blocking defects the
linter passed — §12 contradicting §4 copy, an unpassable diagnostic floor, an unreachable live arm.

## Route

- `spec_consensus` tool available (Pi) → load the `spec-consensus` skill instead; it is this step.
- Can spawn a subagent with no conversation history → run the review below. Prefer a different
  model when the harness lets you pick one.
- Neither → write `fresh review: unavailable (<why>)` in §13 and continue. Never review your own
  draft "as if" fresh — that is not independent.

## Reviewer brief (pass verbatim, fill the paths)

```
Review a PalBuilder pal specification before it is built. You have no prior context; that is the
point. Read: <ws>/SPEC.md, <ws>/EXECUTION.md, and the skill references SPEC.md §9 lists.
Do not edit files.

Report only defects a build agent would hit:
- sections that contradict each other (e.g. §4 copy vs §12 criteria, §5 behavior vs §8 schema)
- success conditions or acceptance criteria that cannot pass as written
- business rules, states, or edge cases a builder would have to guess
- artifacts a task needs that no task produces
Do not report PalBuilder syntax claims, style preferences, or wording polish.

A defect with a section/task reference and evidence is a finding — never a note.
Return exactly:
FINDINGS
- id: R<n> | ref: <§ or task id> | quote: "<exact text>" | problem: <why a builder fails> | fix: <smallest change> | owner: planner|user
NOTES
- <non-defect observations, or "none">
```

## Resolve

- Answer every finding: **fix** (edit only the named section and its directly related tasks) or
  **reject** with a technical reason. Reviewers are wrong sometimes; do not agree just to finish.
- `owner: user` findings (business rules) go to the user as plain questions before approval.
- Re-run `pal_spec_lint` after fixes. One review round; re-review only if fixes touched §2
  decisions, §11 constraints, or more than three sections.
- Record in §13: reviewer model, finding count, each id → fixed/rejected (reason)/asked.
