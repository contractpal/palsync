---
name: pal-fix
description: "Load for an existing-pal bug fix or small, bounded enhancement (add a filter, column, field, or check). Escalate new pages, datasets, schema, or permission changes to pal-spec."
---

# pal-fix — bug fixes and small enhancements, minimal diff, prove it

Two lightweight paths for an existing pal, with no SPEC.md, build plan, or approval round:

- **Bug fix** — reproduce → root cause → minimal correction → prove it (the fix loop below).
- **Small enhancement** — inspect current behavior → one-line success condition → localized
  change → prove it (the enhancement loop below).

## Escalate FIRST — is this small?

Route to **pal-spec** when the change needs a new page or screen, a new dataset or schema change,
several connected workflows, a permission or security redesign, new destructive behavior, or would
contradict an approved SPEC.md requirement or PROTECTED decision. Judge by risk and scope, not
file count. A business rule the user has not decided is a question, not a guess.

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
3. **Minimal diff**, using the restraint ladder and prefactor rule in
   `../pal-loop/references/execute.md`. Reuse before building, platform before library, touch
   only the lines this fix needs. Don't "improve" adjacent code.
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
   - User asked to "test console/web/transaction" → `../shared/references/test-requests.md`.

   If the failure can be demonstrated and then shown fixed at a strong enough seam, that is
   enough. Do not add unrelated screenshots, exercises, or server tests to a fix that did not
   involve them.
5. **Regression — only when the fix reaches beyond itself.** A shared fragment/workflow, auth,
   transactions, destructive actions, or a dataset change gets regression coverage:
   `pal_regression` when `baseline/baseline.json` exists, otherwise `pal_fetch` the touched
   page(s) and confirm key content still renders. An isolated fix does not; say so instead.
6. **Report** in one paragraph: cause, change, evidence (before/after tool output), and
   anything you deliberately did not check. No spec file, no build plan.

## The enhancement loop

1. **Inspect current behavior** at the touched surface (`pal_fetch`/`pal_screenshot`/`pal_exercise`,
   or the code path) — a new feature has no failure to reproduce. Run `pal_impact` before editing a
   referenced page or fragment.
2. **State the success condition** in one line the user would recognize (e.g. "typing in Search
   narrows the employee table by name"). Ask only if it hides a business decision.
3. **Localized change** — fix-loop steps 2–3: the restraint ladder, reuse, and a prefactor only
   when the structure fights the change.
4. **Prove it** — `pal_push`, then check the success condition at the cheapest seam the
   verification policy allows; report as in step 6.

## Inherited rules

- **Verification is proportional, not optional.** `../shared/references/verification.md` is the
  policy; step 4 is its `pal-fix` shape. Failed or unrun verification is never a PASS.
- **Never deploy** — deployment is a human action in PalBuilder.
- **Respect push policy** — `checkpoint` means ask before `pal_push`.
- **Handle drift** — `pal_status` before the first push; server moved → `pal_pull`/`pal_merge`
  first.
- **Two attempts, then block** — still failing → stop; state what failed (exact tool output),
  what you tried, what you need. Never use force/bypass flags to bury a failure.
