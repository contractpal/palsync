---
name: pal-review
description: >
  Independently review a completed (or partial) pal build against its SPEC.md — in a FRESH
  context, not the session that built it. Use this when the user says "review the build",
  "check it against the spec", "QA this pal", or when pal-loop reaches build completion. Judges
  spec-conformance and quality (the eval layer), not compilation (that is pal-loop's verify/
  tests layer, which this skill consumes rather than repeats). If a screenshot capability and a
  vision-capable model are available, it also reviews the visual render; if not, it routes visual
  checks to the human eyeball gate. Produces a verdict file and a list of fix tasks — it never
  edits code or the spec itself.
---

# pal-review — fresh-eyes evaluation against the spec

The session that built the pal is biased toward its own output. This skill is the separation:
**open cold, read the spec and the artifacts, judge whether the build actually meets the
contract.** Run it in a fresh session or a dedicated subagent — never as the same context that
wrote the code. That bias separation is the entire point; sharing context defeats it.

This is the **eval** layer, distinct from pal-loop's **tests** layer. Tests answer "does it
compile / validate / contain the string" (pal_validate, pal_test, pal_fetch — deterministic).
Evals answer "is it correct and good against the spec" (judgment, often visual). This skill does
the second and *consumes* the first; it does not re-run deterministic tools as its job.

## Inputs (read all, first)
- `SPEC.md` (must be `status: approved`) — the contract: §3 sitemap, §4 copy, §5 behavior,
  §6 layout, §11 constraints, §12 acceptance criteria. This is what "correct" means.
- `EXECUTION.md` — what was built and in what state.
- `DESIGN_SYSTEM.md` / `COMPONENTS.md` — what "on-brand / good" means visually.
- The built artifacts: `pal_fetch` each web page (server-rendered HTML); the workflow/fragment
  files on disk.

## The three review arms

### 1. Conformance (text — always runs)
Check the build against the contract, criterion by criterion:
- Every §4 copy string shipped **verbatim** in the fetched HTML (grep the real output, not the
  source you hope shipped).
- Every §3 nav link routes to a real page — no dead links.
- Every §12 acceptance criterion **actually met** — the full set, not just the global floor.
  This is where same-session verification usually cheats: the floor passes, the per-feature
  criteria go unchecked.
- §11 NEVER list not violated; §8b consumed datasets not altered.
- Every EXECUTION.md task marked `done` traces to its `spec ref` section(s), and that requirement
  is actually satisfied — use the column to walk task → SPEC.md §, so a `done` task with an unmet
  requirement is caught (not just the §12 criteria).
Output: a per-criterion PASS / FAIL with the evidence (the string found or missing, the tool
result, the line) — cite the `spec ref` § for each finding.

### 2. Quality / behavior (judgment — always runs)
Beyond "it compiled":
- Does each §5 behavior do the **right** thing? `pal_test` confirms a workflow *compiles*, not
  that its logic is correct — read the workflow against the spec's input → validation → effect →
  output and judge whether it matches. Logic that compiles and does the wrong thing is the gap
  tests can't see.
- Is the copy on-brand per BRAND_VOICE / DESIGN_SYSTEM intent, not just present?
- Does the §6 layout match the composition the spec described?

### 3. Visual / UX (capability-gated)
- The screenshot capability can come from EITHER the `pal_screenshot` MCP tool (Claude Code) OR
  the `palsync screenshot` CLI subcommand (Pi / headless harnesses with no MCP) — same core, same
  args (page, viewport, fullPage); the CLI writes a PNG and prints its path. Don't assume MCP.
- **If a screenshot tool (e.g. `pal_screenshot`) AND a vision-capable model are available:**
  capture each screen and judge it against DESIGN_SYSTEM.md and a short UX rubric — visual
  hierarchy, spacing rhythm, legibility, responsive behavior if testable, and the known AI
  fingerprints the design skills flag (gradient-blob hero, pill-everything uniform radius,
  three-card-row-as-only-idea, serif-on-cream-with-sage). Report each issue with the screenshot
  and a specific fix.
- **Console screens are capturable too.** `pal_screenshot`'s console path replays the cp-auth
  redirect chain (Playwright navigates the same authenticated preview URL `pal_test` opens for a
  human) — live-verified against a real authenticated console pal. Treat a console render exactly
  like a web one when it returns `captured:true`: screenshot it, judge it.
- **If no screenshot tool, no vision model, or the console capture returns `captured:false`** (no
  Chromium installed, or the auth replay failed/timed out): do NOT guess from HTML. Emit a
  `needs-human` eyeball gate naming each screen to look at and what to confirm. This is the
  fallback path now, not the default for every console screen.

## Output — a verdict, not a fix
Write `REVIEW.md` (or a `## Review` block):
```
# REVIEW — <project> — <date> — reviewer: fresh session
verdict: PASS | CHANGES-NEEDED
## Conformance
| criterion (§) | result | evidence |
## Quality / behavior
- <finding> — <spec ref> — <why it misses>
## Visual / UX
- <finding> — <screenshot ref or "eyeball gate: screen X"> — <fix>
## Fix tasks (for pal-loop)
- [ ] <task> — addresses <finding> — success condition: <tool + check>
```
Rules:
- **Never edit code or the spec.** Findings become fix tasks routed back to pal-loop; a *spec*
  problem (missing/contradictory requirement) is a blocker for the human, not a self-edit.
- Judge only against the spec and design system. "I'd have done it differently" is not a finding;
  "violates §12 criterion 4" is.
- A criterion you can't verify (`pal_screenshot` unavailable, or `captured:false` on a console
  render) is `needs-human`, never an assumed pass.

## How it fits the loop
pal-loop runs the **tests** as it builds; at build completion it hands off to pal-review in a
**fresh context** (new session or subagent) with the inputs above. pal-review returns the verdict;
pal-loop turns CHANGES-NEEDED items into tasks, fixes, and re-reviews until PASS. The writer and
the reviewer are never the same context.

## What this skill does NOT do
- It does not compile or validate — that's pal-loop's verify step; this consumes those results.
- It does not fix anything — it produces a verdict and fix tasks.
- It does not see, on its own — visual review depends on a screenshot capability; without one it
  defers to the human eyeball gate rather than judging blind.
