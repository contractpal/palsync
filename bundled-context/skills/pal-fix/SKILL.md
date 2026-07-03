---
name: pal-fix
description: "Fix a bug or small correction in an existing pal WITHOUT the full pal-spec ceremony: reproduce with tools, make a minimal diff, verify, regression-check. Escalates to pal-init/pal-spec the moment a change adds new pages, datasets, or behavior. Triggers: 'fix', 'broken', 'bug', 'stopped working', 'small change to X'."
---

# pal-fix — reproduce, minimal diff, verify

For bugs and small corrections that restore or adjust *intended* behavior. It skips the spec chain
because a well-scoped fix doesn't need an interview — but that only holds while the change stays
small. The discipline: **reproduce with a tool before touching anything, change the least that
works, and prove the fix with the same tool that showed the bug.**

## Escalate FIRST — is this actually a fix?

Before anything else, check scope. **pal-fix restores or adjusts existing behavior; it never adds
behavior.** Stop and route elsewhere if the change would:
- add a new page, screen, dataset, or workflow, or change a dataset's schema → **pal-spec** (new
  pal) or **pal-init** (change to an existing pal) — new behavior needs a spec and a reality check.
- touch a file the MAP.md marks load-bearing / high-blast-radius → **pal-init**, because the safe
  path there is map-scoped with a regression baseline, not an ad-hoc patch.
- turn out to need real new logic once you isolate it (below) rather than a correction.

When in doubt it's not a fix — escalate. A "small change" that quietly grows scope is how a patch
breaks a pal.

## The fix loop

1. **Reproduce with a tool** — never from the description alone. Use `pal_validate` (offline errors),
   `pal_test` (server compile of a workflow), `pal_fetch`/`pal_preview` (web render + exact strings),
   or `pal_screenshot` (a render). State the failure in one line with the tool output that shows it.
   **Can't reproduce → ask the user for repro steps; do not guess** at a fix for a bug you can't see.
2. **Isolate.** Read only the failure path — the fragment/workflow that fails, the files it calls,
   the dataset it reads. Don't survey the whole pal; find the one place the behavior diverges.
3. **Minimal diff, under pal-restraint.** Change the least that fixes it: reuse before building, the
   platform before a library, touch only the lines this fix needs. Don't "improve" adjacent code.
4. **Verify with the reproduction check** — the same tool from step 1 must now pass:
   - the step-1 reproduction no longer reproduces;
   - `pal_validate` → 0 errors;
   - `pal_test` → VALIDATED, 0 notes, **if a workflow changed** (the real server compile);
   - a web fix: `pal_fetch`/`pal_preview` shows the corrected string/render; a console render fix:
     verify per `../pal-review/references/console-render-verification.md` (`captured:false` →
     `HUMAN GATE:` eyeball, don't claim the render fixed).
5. **Regression check** — a fix can break what worked:
   - `baseline/` exists → run the baseline-freshness rule then the regression comparison
     (canonical: `../pal-init/SKILL.md` Step 3); never verdict against a stale baseline.
   - no `baseline/` → `pal_fetch` the touched page(s) and confirm their H1s/key content still render.
6. **Report** in one paragraph: the cause, the change you made, and the evidence (the before/after
   tool output). No spec file, no build plan — just cause → change → proof.

## Inherited rules (same as the rest of the pipeline)
- **Never deploy** — deployment is a human action in PalBuilder.
- **Respect push policy** — `checkpoint` means ask before `pal_push`; `pal_validate` offline first.
- **Handle drift** — `pal_status` before the first push; a moved server → `pal_pull`/`pal_merge`
  before pushing.
- **Two attempts, then block** — fix and re-verify up to twice; still failing → stop, state what
  failed (exact tool output), what you tried, and what you need. Never skip verification, and never
  use skipValidation/force to bury a failure.
