---
name: pal-fix
description: "Load for a small existing-pal bug/correction with no new pages, data, or behavior. Escalate broader changes to pal-spec."
---

# pal-fix — reproduce, minimal diff, prove it

For bugs and small corrections that restore or adjust *intended* behavior. The discipline:
**reproduce with a tool before touching anything, change the least that works, prove the fix
with the same tool that showed the bug.**

## Escalate FIRST — is this actually a fix?

pal-fix restores existing behavior; it never ADDS behavior. Route to **pal-spec** if the change
would add a new page, screen, dataset, or workflow, change a dataset's schema, or turn out to
need real new logic once isolated.

A fix to a widely-used fragment or workflow is still a fix — it just gets wider verification.

## The fix loop

1. **Reproduce with a tool** — never from the description alone: `pal_validate` (offline
   errors), `pal_test` (server compile), `pal_fetch`/`pal_preview` with `expect:` (web
   render), `pal_screenshot` (any render), `pal_exercise` (a behavior bug — trigger the
   action, assert the wrong result with `expect`/`absent`). State the failure in one line
   with the tool output that shows it. **Can't reproduce → set `needs-info`, ask the user for
   repro steps, and do not guess.** Before fixing, check `git log` and available prior decision
   notes for evidence that the change is already implemented or was previously rejected;
   report that state instead of overwriting it.
2. **Isolate.** Read only the failure path — the failing fragment/workflow, the files it
   calls, the dataset it reads. Don't survey the whole pal. `pal_impact` is mandatory before
   editing an existing page or fragment that other files reference; silent for new files.
3. **Minimal diff, using the pal-loop restraint ladder.** Reuse before building, platform
   before library, touch only the lines this fix needs. Don't "improve" adjacent code.
4. **Prove the original failure is fixed.** `pal_push` first (it runs the full offline
   validation as its gate — no separate `pal_validate`), then re-run the step-1 reproduction
   at the highest seam that showed the bug:
   - CSS/layout bug → render the affected area (`pal_screenshot`, or `pal_fetch` for
     server-rendered text).
   - Workflow bug → `pal_test`, then re-run the behavior that was wrong.
   - Behavior bug → re-run the failing `pal_exercise` flow with `expect` for the new value and
     `absent` for the old one when edit/delete/replace behavior is involved.
   - Console render fix → `pal_screenshot`: `captured:true` with `renderError` null = fixed;
     `captured:false` → `HUMAN GATE:` eyeball entry, don't claim the render fixed.
     (Full rule: `../pal-review/references/console-render-verification.md`.)

   If the failure can be demonstrated and then shown fixed at a strong enough seam, that is
   enough. Do not add unrelated screenshots, exercises, or server tests to a fix that did not
   involve them.
5. **Regression — only when the fix reaches beyond itself.** A shared fragment/workflow, auth,
   transactions, destructive actions, or a dataset change gets regression coverage:
   `pal_regression` when `baseline/baseline.json` exists, otherwise `pal_fetch` the touched
   page(s) and confirm key content still renders. An isolated fix does not; say so instead.
6. **Report** in one paragraph: cause, change, evidence (before/after tool output), and
   anything you deliberately did not check. No spec file, no build plan.

## Inherited rules

- **Verification is proportional, not optional.** `../shared/references/verification.md` is the
  policy; step 4 is its `pal-fix` shape. Failed or unrun verification is never a PASS.
- **Never deploy** — deployment is a human action in PalBuilder.
- **Respect push policy** — `checkpoint` means ask before `pal_push`.
- **Handle drift** — `pal_status` before the first push; server moved → `pal_pull`/`pal_merge`
  first.
- **Two attempts, then block** — still failing → stop; state what failed (exact tool output),
  what you tried, what you need. Never use force/bypass flags to bury a failure.
