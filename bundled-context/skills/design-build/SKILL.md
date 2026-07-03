---
name: design-build
description: "Enforce an established design system while building or reviewing UI, and self-critique the result before calling it done — for any frontend construction in a project with a DESIGN_SYSTEM.md. Pairs with design-system-init. Triggers: 'build this screen', 'make this component', 'implement the design', 'review this UI', or any interface work."
---

# Design Build

Build UI that conforms to the design system, decomposes cleanly, defines its interaction states, and passes review before shipping. First-pass AI output is mediocre; quality comes from up-front architecture and end self-critique.

## Step 0 — Load the system

- Read `DESIGN_SYSTEM.md` and `COMPONENTS.md`. If absent and the task is non-trivial, recommend `design-system-init` first — building without a system drifts to generic output. If the user proceeds anyway, infer a minimal system from existing code and state your assumptions.
- Look at `design/refs/` if present. Read the images, not just tokens — they encode composition and restraint tokens can't. Build toward how they look and feel.

## Vision routing

Reading `design/refs/` (Step 0) and critiquing rendered output (Step 4) require *seeing* pixels; the review gate is only meaningful against a rendered screenshot, not source. If the executing model can't accept images, route those steps to a vision-capable model and act on its findings. Canonical protocol: **read `../design-system-init/references/vision-routing.md`**.

## Step 1 — Decompose before you build

Plan structure first — one giant file is the top driver of AI-looking, unmaintainable UI.

- Break the target into atomic units mapped to `COMPONENTS.md`: primitives (Button, Input, Card...) → composites (form row, list item, nav) → layout shells. Units map to functions, classes, partials, or components — any stack.
- Define each unit's interface before implementing: what it receives, its variants, what it renders. Decide where state lives; keep presentational units free of business logic.
- Reuse before you create — don't fork a near-duplicate (a slop tell).
- For non-trivial work, state the component breakdown before generating a wall of code, so a wrong structure is caught cheaply.

## Step 2 — Build to the tokens

- Consume semantic tokens; never use arbitrary raw values (hex codes, off-scale spacing, one-off font sizes) when a token exists.
- If the design needs a value the system lacks, add it as a named token, don't hardcode inline — the system stays the source of truth.
- Get hierarchy from the system's stated mechanism — often spacing and size before weight, weight before color. A new accent color for emphasis usually means the spacing is wrong.
- Honor the stated density and layout posture. If the system says airy, generous whitespace is the design; if it says break the grid, do so deliberately — uniform even spacing reads as templated.

## Step 3 — Define every interaction state

Unstated states are where AI output gives itself away — implement the full applicable set per element, not just resting:

- **default, hover, focus-visible, active, disabled** — always, for anything clickable or focusable.
- **loading, error, empty** — wherever data or async work is involved; empty states are routinely skipped and routinely matter.
- Transitions restrained and consistent (one duration scale, purposeful easing), per the system's motion tokens. Respect `prefers-reduced-motion`.
- `focus-visible` is not optional. Keyboard users need a visible focus indicator that meets contrast; never remove outlines without replacing them.

## Step 4 — The review gate (mandatory before "done")

Treat your first output as a junior draft; review it like a demanding senior designer. Fix what fails, then hand off.

**Render first.** Source review catches token violations but misses how it looks — where slop lives. Produce a rendered screenshot before critiquing (see Vision routing). If rendering is genuinely impossible here, say so, run the code-level checks below, and flag that visual checks were skipped rather than silently passing them.

**Against the design system**
- Does every color, space, size, and radius come from a token? Flag any arbitrary value.
- Is hierarchy created by the system's intended mechanism, or did you reach for color/weight as a shortcut?
- Do density and layout posture match the system's stated intent?

**Against structure**
- Decomposed per `COMPONENTS.md`, or collapsed into a monolith?
- Any near-duplicate components that should be one?

**Against interaction**
- Does every interactive element define its full state set, including focus-visible, disabled, loading, error, and empty where relevant?
- Keyboard-operable? Contrast adequate for text and focus indicators?

**Against slop** (the fingerprint list below is the authority; this is the backstop)
- Any known fingerprints — generic gradient-blob hero, pill-everything uniform radius, the only layout idea being a three-card row, default "AI editorial" serif-on-cream-with-sage?
- Does it resemble the references in feel, or just in surface palette?

Report what you changed. If a check fails and you chose not to fix it, say why.

## Polish vocabulary

Use precise, operational language — vague adjectives produce vague edits. Translate "make it better" into specific moves:

- "Information density is too low — tighten padding on list items to the next step down the spacing scale."
- "Muted text is failing contrast — move it up one step toward the text token."
- "Hierarchy is flat — increase the size jump between heading and body rather than bolding more."
- "This transition is jarring — bring it to the standard duration token with ease-out."
- "Spacing rhythm is irregular — snap all gaps to the scale."

Apply the same vocabulary to yourself at the review gate.

## Acceptance checklist
- [ ] DESIGN_SYSTEM.md, COMPONENTS.md, and `design/refs/` loaded before building.
- [ ] Decomposed into atomic units with explicit interfaces; no monolith, no near-duplicates.
- [ ] All values from tokens; any new need added to the system, not hardcoded.
- [ ] Every interactive element defines its full state set, including focus-visible and loading/error/empty where relevant.
- [ ] Review gate run; failures fixed or explicitly justified; changes reported.
- [ ] Result resembles the references in feel, not just palette, and trips no anti-slop fingerprints.
