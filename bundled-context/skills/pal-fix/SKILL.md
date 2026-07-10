---
name: pal-fix
description: "Fix a bug or small correction in an existing pal WITHOUT the full pal-spec ceremony: reproduce with tools, make a minimal diff, verify, regression-check. Escalates to pal-init/pal-spec the moment a change adds new pages, datasets, or behavior. Triggers: 'fix', 'broken', 'bug', 'stopped working', 'small change to X'."
---

# pal-fix — reproduce, minimal diff, verify

For bugs and small corrections that restore or adjust *intended* behavior. The discipline:
**reproduce with a tool before touching anything, change the least that works, prove the fix
with the same tool that showed the bug.**

## Escalate FIRST — is this actually a fix?

pal-fix restores existing behavior; it never ADDS behavior. Stop and route elsewhere if the
change would:
- add a new page, screen, dataset, or workflow, or change a dataset's schema → **pal-spec**
  (new pal) or **pal-init** (existing pal).
- touch a file MAP.md marks load-bearing / high-blast-radius → **pal-init** (map-scoped path
  with a regression baseline beats an ad-hoc patch).
- turn out to need real new logic once isolated.

When in doubt it's not a fix — escalate.

## The fix loop

1. **Reproduce with a tool** — never from the description alone: `pal_validate` (offline
   errors), `pal_test` (server compile), `pal_fetch`/`pal_preview` with `expect:` (web
   render), `pal_screenshot` (any render), `pal_exercise` (a behavior bug — trigger the
   action, assert the wrong result with `expect`/`absent`). State the failure in one line
   with the tool output that shows it. **Can't reproduce → ask the user for repro steps; do
   not guess.**
2. **Isolate.** Read only the failure path — the failing fragment/workflow, the files it
   calls, the dataset it reads. Don't survey the whole pal.
3. **Minimal diff, under pal-restraint.** Reuse before building, platform before library,
   touch only the lines this fix needs. Don't "improve" adjacent code.
4. **Verify** — the step-1 reproduction must now pass:
   - `pal_push` → 0 errors (push runs the full offline validation as its gate — no separate
     `pal_validate` first).
   - `pal_test` → VALIDATED, 0 notes, if a workflow changed.
   - Web fix: `pal_fetch`/`pal_preview` shows the corrected string/render.
   - Console render fix: `pal_screenshot` — `captured:true` with `renderError` null = fixed;
     `captured:false` → `HUMAN GATE:` eyeball entry, don't claim the render fixed.
     (Full rule: `../pal-review/references/console-render-verification.md`.)
   - Behavior fix: `pal_exercise` passes with `expect` for the new/correct value and `absent`
     for the old/wrong value when edit/delete/replace behavior is involved.
5. **Regression check** — a fix can break what worked:
   - `baseline/` exists → run `pal_regression`; act on `caused`; never verdict against a
     stale baseline (it returns `{stale}` → refresh via pal-init Step 3).
   - no `baseline/` → `pal_fetch` the touched page(s); confirm H1s/key content still render.
6. **Report** in one paragraph: cause, change, evidence (before/after tool output). No spec
   file, no build plan.

## Inherited rules
- **pal-fix is not gate-light** — it skips the full SPEC.md ceremony, not the proof ladder.
  Use the same gates as pal-loop for the touched behavior: `pal_push` (validates as its gate) →
  `pal_test` when workflow code changed → render proof (`pal_fetch`/`pal_preview` or
  `pal_screenshot`) → `pal_exercise` for actions/writes → `pal_regression` or the fallback
  touched-page regression check.
- **Never deploy** — deployment is a human action in PalBuilder.
- **Respect push policy** — `checkpoint` means ask before `pal_push`.
- **Handle drift** — `pal_status` before the first push; server moved → `pal_pull`/`pal_merge`
  first.
- **Two attempts, then block** — still failing → stop; state what failed (exact tool output),
  what you tried, what you need. Never skip verification; never use force/bypass flags to bury
  a failure.
