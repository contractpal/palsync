# PalSync — Ethos

> PalSync should be the **smallest, cheapest harness that reliably helps models produce correct Pals**.

Every engineering decision should improve at least one of three goals without unnecessarily harming the others:

**Simple. Efficient. Effective.**

## 1. Simple

PalSync should contain only what it needs.

Prefer, in order:

1. Delete unnecessary behavior.
2. Reuse an existing mechanism.
3. Simplify or generalize an existing mechanism.
4. Improve instructions or deterministic validation.
5. Add a new mechanism only when the simpler options are insufficient.

A feature is not free because it works. It adds code, maintenance, context, surface area, interactions, and future failure modes.

Complexity must earn its place through evidence.

Do not preserve a mechanism simply because an old model once failed without it. Fix the general failure class where possible, and periodically remove guardrails that no longer justify themselves.

## 2. Efficient

PalSync should reduce the total cost of getting from request to correct Pal.

Optimize for:

* model-visible context
* tool-schema size
* inference tokens and cost
* unnecessary tool calls
* retries and failed iterations
* latency
* duplicated work

Prefer deterministic computation over asking the model to reason about something PalSync can cheaply know.

Prefer progressive disclosure over always-on context.

Prefer concise, actionable tool results over explanations the model does not need.

Caching is useful, but **removing unnecessary context is better than making unnecessary context cheaper to cache**.

Measure efficiency alongside correctness.

## 3. Effective

PalSync's job is to make models reliably write correct, maintainable PalBuilder code.

The model's claim that something works is not evidence.

Use the cheapest reliable evidence available:

1. deterministic local checks
2. server validation
3. rendered/runtime verification when behavior requires it
4. independent review only when it provides demonstrated value

Keep feedback close to the mistake so errors do not compound.

Guardrails should be based on observed platform behavior, documentation, or reproducible failures. Unverified assumptions should not become blocking rules.

## Evals decide

We do not add architecture because it sounds useful.

A new tool, hook, rule, skill, abstraction, workflow, or agent-facing instruction should correspond to a demonstrated problem.

When evaluating a change, measure both benefit and cost:

* task completion / acceptance criteria
* correctness and regressions
* token usage and inference cost
* tool calls and retries
* model-visible context
* tool-schema size
* implementation complexity

Prefer the simpler design when outcomes are equivalent.

A change that improves one eval while making the entire harness permanently larger should face a high bar.

## Fix classes of failures, not incidents

Eval failures are evidence, not requirements.

When an agent behaves badly, ask:

* What actually caused the failure?
* Can an existing mechanism handle it?
* Can the failure be prevented deterministically?
* Can the instruction be made shorter or clearer?
* Is this specific to one model or a general PalBuilder problem?
* Would adding a mechanism create more complexity than the failure justifies?

Avoid accumulating permanent special cases for individual model mistakes.

## Context is a budget

Anything automatically shown to the model consumes a limited resource.

Always-on instructions should contain only rules that are broadly necessary. Detailed platform knowledge belongs in focused skills or on-demand context.

Tool descriptions and schemas should be as small as possible while remaining unambiguous.

Do not make the model repeatedly read information it does not need for the current task.

## Tools should earn their surface area

A model-facing tool should exist separately only when that separation materially helps the model perform the job.

Prefer a small, coherent interface over exposing every internal capability directly.

Internal implementation boundaries do not have to become agent-facing tools.

## Guardrails should earn their friction

Use deterministic enforcement when failure would be costly and evidence shows models actually need the protection.

Do not turn every best practice into a blocking gate.

A bad guardrail can be worse than no guardrail.

Warnings, validation, hard blocks, and independent review should each be used only at the level justified by the risk.

## Preserve what works

Simplification does not mean removing proven safety or correctness mechanisms merely to reduce line count.

PalSync's sync protections, deterministic validators, platform verification, and other mechanisms should remain when evidence shows they materially improve successful completion.

The goal is not minimal code at any cost.

The goal is **minimal necessary complexity**.

---

When uncertain, choose the design that best satisfies this sentence:

> **Build the simplest and most efficient PalSync that still reliably produces correct Pals.**
