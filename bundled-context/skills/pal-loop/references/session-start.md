# Session start — mechanics, on demand

Open this when you need one of these procedures. Starting a session does not require running
any of them.

## CLI status-transition procedure

Transitions to `blocked`, `needs-human`, or `needs-frontier` require `--reason "<why>"`;
`blocked` and `needs-human` also require `--tried "<workaround>"`. Before either `blocked` or
`needs-human`, retry the failing step once, attempt one alternate path, and record the literal
failing command and error text in `--tried`; only then set the status. (`needs-frontier` is a
capability call and needs no `--tried`.)

## Git checkpoint mechanics

Not a git repo → `git init && git add -A && git commit -m "loop start"`. Commit after every
task. **git is a LOCAL checkpoint only** — the server is the source of truth; `git checkout`
does NOT undo a pushed change. Never push this repo.

Transient PalSync artifacts (`.agent-work-history/`, `.palsync/cache/`, usage tallies,
session-cost files/lock, Pi usage, tool evidence) are excluded from task commits by
harness-enforced `.gitignore` management and index migration — not by model discipline. Do not
manually `git add` those paths and do not ignore the whole `.palsync/` directory (baseline
snapshots, context manifests, `EXECUTION.md`, and `REVIEW.md` remain tracked).

## Environment doctor

`palsync doctor` is offline, non-interactive, and always exits 0. Run it when the environment
is in question — first-time setup, changed dependencies, broken-looking configuration, a
failure that smells environmental, or on request — not as a session ritual. Print only the
non-ok rows; a fail row that blocks the build becomes a Blockers entry.

## Reviewer dispatch

Only relevant when the `review` setting is `auto`, or when the user asks for a review. Confirm
the subagent/session mechanism and review provider credentials are available at that point; a
failure is a `HUMAN GATE: <exact failure>` entry, not a silent self-review.

## Just-in-time skill loading (§9 manifest)

Load exactly the skills SPEC.md §9 lists, when the first task requiring one starts — not all
before coding. `palbuilder-frontend` and `design-build` still load before the first UI task.
