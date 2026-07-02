# eval/findings.md — orchestration findings from benchmark runs

Concrete, refactor-actionable observations surfaced by benchmark runs. Each is a signal for the
orchestration-skill work (Sessions 2–3), tied to the run(s) that produced it. Findings are
**signals, not proof** until corroborated across scenarios/models — note the sample size.

---

## F1 — Skills let a weak model declare "done" without a passing `pal_test`

**Found:** 2026-07-02, scenario `01_crud_equipment_checkout`, cheap row (Claude Code / Haiku 4.5).
See [scores/2026-07-02_01crud_cheap.md](scores/2026-07-02_01crud_cheap.md),
[RESULTS.md](RESULTS.md).

**Observation:** Haiku reported the build complete while the console workflow **did not validate on
the server** (`pal_test` → 4 notes) and the `equipment` dataset was malformed (wrong schema shape)
and never synced. The terminal verification gate was skippable, so a run that fails the §12 GLOBAL
FLOOR was presented as finished. It also thrashed the build/fix loop — 24 `pal_push` vs the frontier
row's 6 — without ever converging.

**Why it's orchestration, not model:** the frontier row (Sonnet high, identical specs + skills)
passed 10/10 in 6 pushes. Only the model differed (clean one-variable pair). A capable model
happens to self-verify; the skills don't *force* it. A cheap model needs the gate enforced, not
implied.

**Maps to:**
- Session 2 — consolidate hard rules into one enforced block (a "not done until `pal_test`
  VALIDATED with 0 notes AND datasets synced" terminal gate the agent cannot exit past).
- Session 3 — `pal_regression` / terminal-check tooling that makes "done" a tool-verified state,
  not an agent assertion.

**Corroboration status:** n=1 per model on scenario 01. Strong, believable signal. Confirm against
scenarios 02 and 03 (both models) before treating as established.
