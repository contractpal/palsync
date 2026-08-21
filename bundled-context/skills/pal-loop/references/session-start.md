# Session start — one-time mechanics

Procedural how-to for the session-start sequence and the CLI
status-transition procedure. Read this reference at session start,
before the first task.

## CLI status-transition procedure

Transitions to `blocked`, `needs-human`, or `needs-frontier` require
`--reason "<why>"`; `blocked` and `needs-human` also require
`--tried "<workaround>"`. Before either `blocked` or `needs-human`
status, retry the failing step once, attempt one alternate path, and
record the literal failing command and error text in `--tried`; only
then set the status. (`needs-frontier` is a capability call and needs
no `--tried`.)

## Reviewer-dispatch preflight at Build Plan time

Before starting any task, perform a lightweight fresh-context reviewer
dispatch preflight. Confirm the subagent/session mechanism is available
and the review provider credentials are present. If either check fails,
add a Blockers entry prefixed `HUMAN GATE:` with the exact failure and
surface it now; do not burn the full build before discovering that
independent review cannot run.

## Environment doctor

Run `palsync doctor` from your shell — it is offline, non-interactive,
and always exits 0, so it is safe to call unconditionally. Print only
the non-ok rows (warn/fail) in your session-start note; skip the ok rows
entirely. A fail row that blocks the build (e.g. Node below the minimum)
becomes a Blockers entry.

## Git init / commit mechanics

Not a git repo → `git init && git add -A && git commit -m "loop start"`.
Commit after every task. **git is a LOCAL checkpoint only** — the server
is the source of truth; `git checkout` does NOT undo a pushed change
(recovery: "On fail" below). Never push this repo.

## Just-in-time skill loading (§9 manifest)

Load exactly the skills SPEC.md §9 lists, just in time. §9 is the
manifest — don't guess it (it may include palbuilder-workflow,
palbuilder-data, or palbuilder-realtime). Load a listed skill when the
first task requiring it starts, not all before coding.
palbuilder-frontend and design-build still load before the first UI task.
The restraint ladder below is the default discipline on every task.

## `pal_status` / `pal_pull`

`pal_status`. Server newer than your last pull → `pal_pull` first.

## Smoke-test before picking work

`pal_validate`, plus `pal_test` on the workflow the Checkpoints show as
last touched — a prior session can leave the workspace broken despite
what EXECUTION.md says. Either fails → fix that first.
