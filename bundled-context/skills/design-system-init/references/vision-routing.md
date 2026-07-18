# Vision routing — seeing pixels when the model can't

The single source of truth for how a text-only model handles work that requires *seeing* images
(reference study, rendered-output critique). design-system-init and design-build both point here and
name their own vision-dependent steps.

The principle: if the executing model can't accept image input, these steps **don't get skipped and
don't get faked from filenames** — they get routed to a vision-capable model whose findings come
back as text. This is the difference between an agent that drifts toward generic output and one that
self-corrects. If the skill runs in a vision-capable environment (e.g. a chat interface with image
upload), do the visual work inline — no routing needed.

## How to route
- Hand each image (`design/refs/*`, or a rendered screenshot of built UI) to a vision-capable model
  and ask for a **concrete** description: spacing rhythm, type-scale contrast, where emphasis lands,
  border/shadow restraint, how empty space is used, implied motion. Capture that text where the
  calling step says (e.g. `design/refs/extracted.md` under a "visual observations" heading).
- For the anti-slop fingerprints cross-check, report gradient-blob hero, pill-everything uniform
  radius, and serif-on-cream-with-sage; see `../../shared/references/anti-slop.md` for the full list.
- The text-only model then synthesizes/acts on those written observations. References are persisted
  as images regardless, because the downstream agent may have its own vision routing and will want to
  look at them directly.
- **Orchestrator note:** keep code generation on the strongest coding model and route only the
  visual phases to a vision-capable model. Don't move the whole build — only the seeing.
- If `design/refs/extracted.md` already contains visual observations from a prior step, read it first
  — it may be sufficient without re-routing.
