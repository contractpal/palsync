# Amendment path — controlled spec changes mid-build

The single source of truth for changing an approved spec after the build has started. An approved
spec is the contract, but reality can contradict it mid-build (a type that won't create, a consumed
field that doesn't exist, a behavior the platform can't express). The spec must be able to change
**without ever being silently self-amended.** pal-loop and pal-spec both point here.

The invariant: **propose → human approve → re-gate → continue. The agent never silently self-amends.**

## What needs an amendment

**Product change → amendment.** Anything that would make an approved product statement false:
who can do or see what, a business rule or PROTECTED decision, §4 copy, a §8 data contract, an
added or removed feature, destructive or security behavior, a §11 constraint, a §12 criterion.

**Implementation change → no amendment, no version bump.** Every product statement stays true:
reuse existing code, a simpler supported primitive, different internal boundaries, a different §6
component for the same flow, a §9/§10 entry that proved wrong, splitting/merging/reordering/adding
unstarted tasks. Edit EXECUTION.md (never SPEC.md) and record one checkpoint line
`IMPL: <what changed> — <why>`. Never rewrite a `done` row or its evidence, and never make a
success condition weaker than the §12 criterion it proves. Unsure which kind → treat it as product.

1. **Propose (pal-loop).** pal-loop never edits SPEC.md to fix a problem. It STOPS the affected task,
   sets it `blocked`, and writes an **amendment proposal** in EXECUTION.md Blockers: which SPEC.md §
   is wrong, the exact build-time fact that forces it (paste the tool output / name the platform
   limit), and the **minimal** proposed change. It continues with the next independent task.
2. **Human approves.** A person reviews the proposal and approves it (or redirects). No approval → no
   change; the task stays blocked. This is the guardrail — the agent proposes, the human decides.
3. **Apply + audit (pal-spec).** On approval, apply the minimal edit to the affected §, **bump
   `spec version`**, and append a **§14 amendment-log** entry (version, date, approver, which §, what
   changed, the forcing fact). Append-only — never rewrite history.
4. **Reconcile EXECUTION.md.** The old execution version now deliberately mismatches SPEC.md and
   blocks continuation. Use task `spec ref`s to identify candidates, then include their downstream
   dependencies. Decide actual impact: update affected task descriptions/dependencies/success
   conditions; reopen completed tasks only when rework is needed, otherwise record targeted current
   re-verification evidence. Preserve unaffected completed tasks and their existing evidence. Do not
   reopen every candidate merely because it references the amended §.
5. **Re-gate the pair.** Re-run `pal_spec_lint` with both files present and the relevant reality
   checks (set `reality_check: blocked` while doing so). Only after it clears may `reality_check`
   return to `pass`, the SPEC be approved at its new version, and EXECUTION.md's `spec version` be
   updated to match. A failed reconciliation is not approved or ready.
6. **Continue (pal-loop).** Re-read the amended § (via the task's `spec ref`) and resume only after
the two versions match and the joint gate passes.
