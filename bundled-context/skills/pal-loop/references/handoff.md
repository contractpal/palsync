# Handoff — completion-path detail

Procedural how-to for the build-completion handoff (pal-review dispatch,
completion check, and brownfield regression). Read this reference at build
completion, before dispatching pal-review.

## Review-cadence pause — counter mechanics

- `end`: no pauses — run to completion.
- `each-task`: after each done task, report it (what shipped + step-5
  evidence) and wait for the human's go-ahead — don't self-approve.
- `every-N`: track a counter on the checkpoint line
  (`since last review: 2/3`); at N, pause like `each-task` (report every
  task since the last pause), reset. Below N, continue.

This is independent of the push `checkpoint` gate (per-push) and the
pal-review handoff (always runs at completion).

## Brownfield regression re-check (only if `baseline/` exists)

Runs at each review-cadence pause and always at the build-completion
handoff — NOT per-task (step 5 already catches immediate breakage).

- **Run `pal_regression`** and act on its structured result. It does the
  whole mechanical check: freshness gate (stale → returns `{stale}`; set
  `needs-human`, re-run pal-init Step 3), validate/`pal_test`/page-`h1s`
  vs `baseline.json`, `eyeball_only` viewports → `needs_human`, inherited
  (`known_issues`) vs caused split. `caused` empty → pass.
  `inherited`/`needs_human` never block.

- **A `caused` failure → bisect for the culprit** (the break may have
  ridden through several committed tasks):
  1. Start at the last commit where this check passed.
  2. Walk per-task commits forward, re-running the SAME failing check
     against each commit's file state (`git show <sha>:<path>` — read-only
     inspection, never a rewrite).
  3. First failing commit → that commit's task is the culprit.
  4. Reopen and `block` THAT task, citing the baseline comparison and the
     culprit commit.

## Build complete → hand off to pal-review — dispatch procedure

1. `baseline/` exists → run the regression re-check above,
   unconditionally.
2. Cost recording — IF harness is claude-code THEN skip `palsync cost
   record` (agent cannot read its own spend); IF pi THEN run
   `palsync cost record --model <model> --phase <build|review>` using the
   user-supplied footer figures.
3. Write the final session summary/checkpoint now, before review. A
   proactive mid-build handoff also writes its summary normally but does
   not invoke review.
4. Run `palsync review brief`, then **dispatch pal-review in a fresh
   session/subagent** with its EVIDENCE LEDGER output, SPEC.md,
   EXECUTION.md, DESIGN_SYSTEM.md/COMPONENTS.md, `baseline/` (if any), and
   the pal's identity so it can `pal_fetch`/`pal_screenshot`/`pal_test`
   the real artifacts.
5. **Reviewer says PASS** → run `palsync completion check` yourself in the
   workspace. Missing or stale `REVIEW.md`, missing source-bound behavior
   evidence when §5/action/happy-path rows declare behavior, or any
   `result: FAIL` means the build is not complete. Claude blocks Stop, Pi
   queues a corrective follow-up, and other harnesses call this same CLI
   gate manually.
6. **CHANGES-NEEDED** → append each `## Fix tasks` item as a new
   EXECUTION.md task (next id, `spec ref` from the finding, `depends` per
   stated order, `todo`, tier `standard` unless it needs new structure);
   resume the task cycle on exactly those tasks.
7. **Re-review** when the fix tasks are `done`; repeat until PASS. Every
   review pass, including a re-review after fixes, overwrites `REVIEW.md`
   with that pass's new verdict, its own complete `palsync review check`
   output, and fresh evidence. Chat-only verdicts are invalid. A
   `needs-human` verdict (console eyeball gate) routes like any other
   `needs-human` task, not a failure.

The build-complete handoff is invalid unless REVIEW.md contains the pasted
`palsync review check` output, including its descriptive exercise summary
for the current pushed source and final result. After reviewer dispatch,
the builder performs no source, `.palsync.json`, EXECUTION, or
evidence-producing action unless the verdict is CHANGES-NEEDED. Then
update state, fix, push, and start a fresh review cycle. The reviewer runs
all evidence-producing tools before its final `REVIEW.md` write. "the
exercises pass now" never permits skipping independent re-review.
