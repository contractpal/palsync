# PalSync — ethos & mission

> Read this at the start of every session. It is the *why* behind the rules in
> `CLAUDE.md`. When a decision isn't covered by a rule, decide the way this document
> would.

## Mission

**Make a weak or lazy model ship a correct Pal.** PalSync is the harness that closes
the gap between what a model does by default and what "correct" actually requires. We
optimize the harness, not the model.

## The thesis: the harness is the product

Most agent failures are **configuration failures, not model failures** — a missing
tool, a rule written too loosely, a gate the agent was trusted to run by hand and
skipped, a skill doc that reads like an essay instead of a checklist. When Haiku
produces a bad Pal, suspect the harness first.

This is confirmed empirically by our own eval reports: every recurring failure was a
**lifecycle transition the agent was trusted to perform manually and didn't** —
declaring "Build complete" with no review, marking a task `done` after six *failed*
verification attempts. The fix is never "hope the model tries harder." The fix is to
make the transition non-optional.

## PalSync follows the SDLC

A Pal build is a software development lifecycle, not a single `push`. PalSync must
support **and enforce the transition between every phase** — not just the final
deploy. Today we are strong in the middle (implement → validate → push) and weak at
the boundaries the model is trusted to cross on its own.

| SDLC phase | PalSync surface | Gate that must hold before advancing |
|---|---|---|
| **Requirements** | `pal-spec` skill, `SPEC.md`, prior reports for the same spec | spec is complete; known prior lessons surfaced |
| **Design** | `design-build`, `design-system-init`, the design-brief checkpoint | design brief recorded before any markup |
| **Implementation** | MCP write tools, `palbuilder-*` skills | `pal_validate` clean *per write*, not only at push |
| **Testing** | `pal_test`, `pal_exercise`, `pal_screenshot`, `pal-review` | a **successful** exercise + captured evidence per behavior-touching task |
| **Deployment** | `pal_push`, `palsync review check` | fresh independent `REVIEW.md` with `result: PASS` |
| **Maintenance** | `drift`, `regression`, `reports/` mining | real-run lessons fed back into the harness |

The failure mode is always the same: a phase declared done without the evidence the
next phase depends on. Gates convert "the model said it's done" into "a tool proved
it's done."

## Hooks are how we enforce the lifecycle

A rule in a skill doc is advice the model can rationalize around. A **hook** is
mechanism — it fires whether or not the model remembers to. Hooks are how the SDLC
gates above stop being suggestions. We target **Claude Code and Pi** (both support
hooks); other entrypoints get the same rule as a documented contract until they do.

- **PreToolUse** — gate *before* a costly or irreversible action. E.g. block a
  `pal_push` whose workspace hasn't passed `pal_validate`; block writes to protected
  files. A deny-before-run rule, mechanically verifiable (path/shape match) — never an
  LLM judgment call.
- **PostToolUse** — validate *immediately after* a write, before the mistake
  compounds. This is our answer to feedback latency: the console-page script rejection
  that today only surfaces one tool-call later at `pal_test` should fail the instant
  the file is written.
- **Stop** — refuse to end the turn / narrate "Build complete" while the deployment
  gate is unmet (no fresh `REVIEW.md`, a task marked `done` with no successful
  exercise). This single hook would have caught the top finding in every eval report.

Hooks are the automation of two principles below (shorten the feedback loop; writer ≠
checker). They earn their place the same way validators do — evidence first.

## Principles

1. **The harness is the product.** Optimize tools, gates, docs, and evals so a weak
   model still succeeds. Blame config before capability.

2. **Terminate in server-verified evidence, never "looks right."** A tool call turns a
   guess into a fact. `done` requires a passing tool result, not a self-assessment.

3. **Guardrails must earn their place.** A wrong blocking rule is worse than a missing
   one. Evidence first (cite the server source, a live repro, or a bundled doc).
   Cheapest deterministic layer first (AST/regex); LLM judgment only for what that
   can't catch. Unverified rules ship as `warn`, promoted to `error` only after a live
   verification. (See `CLAUDE.md` → Validator rule policy.)

4. **Shorten the feedback loop.** Validate close to the mistake, not only at the end.
   Weak models compound wrong assumptions across steps. Prefer per-write validation
   (a PostToolUse hook) over a single end-of-build gate.

5. **Writer ≠ checker.** Verification must not share context with generation — the same
   context inherits the blind spots that produced the bug. Review runs fresh and
   verifies claims structurally (via tools), not by re-reading its own diff.

6. **Docs are workflows, not essays.** Agents follow checklists with exit criteria and
   skim prose. One concrete correct example beats a paragraph. Attach an
   anti-rationalization rebuttal to each top failure mode. Load only the
   phase-relevant skill (progressive disclosure).

7. **Build the simplest thing that passes evals.** Add a rule, skill, tool, or hook
   only *after* an eval or report demonstrates the specific gap it closes. This is the
   brake on everything above. Don't overbuild.

8. **Measure the harness in layers.** Score capability (can the model use the tools at
   all), trajectory (did it take the right steps — coverage, not call count), and
   final response (does the shipped Pal work). North star: goal-completion rate per
   model. Ask not just "did the model pass" but "is routing this task to this model
   the right call."

## What we do NOT build (until an eval proves the need)

- Cross-session autonomy loops (Ralph-style), self-reported confidence scores.
- LLM-based guardrail layers where a deterministic check would do.
- RAG / fine-tuning / multi-agent orchestration as a first move.

Prove the simpler prompting / skill-doc / hook fix is insufficient first.

---

*Sources folded into this ethos: Martin Fowler (guardrail cost/benefit, evals as
thresholds, simplest-architecture-first); Addy Osmani (config-not-model failures,
workflows-over-essays, writer≠checker, spec-driven); Google/Kaggle Agents +
Agent Companion whitepapers (model/tools/orchestration split, layered agent
evaluation); coleam00/harness-engineering-demo (the plan→implement→validate→review
lifecycle enforced by Pre/Post/Stop hooks). Grounded against PalSync's own eval
reports and validator-rule policy.*
