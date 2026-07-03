---
name: design-build
description: "Enforce an established design system while building or reviewing UI, and self-critique the result before calling it done — for any frontend construction in a project with a DESIGN_SYSTEM.md. Pairs with design-system-init. Triggers: 'build this screen', 'make this component', 'implement the design', 'review this UI', or any interface work."
---

# Design Build

Build UI that conforms to the project's design system, decomposes cleanly, defines its interaction states, and survives a critical review before it ships. First-pass AI design output is reliably mediocre — the quality comes from architecture discipline up front and structured self-critique at the end. This skill supplies both.

## Step 0 — Load the system

Before writing anything:

- Read `DESIGN_SYSTEM.md` and `COMPONENTS.md` if they exist. If they don't, and the task is more than trivial, recommend running `design-system-init` first — building without a system is how projects drift into generic output. If the user wants to proceed anyway, infer a minimal system from any existing code and state your assumptions.
- Look at `design/refs/` if present. Read the images, not just the tokens — the references encode composition and restraint that the token list can't. Build toward how those look and feel.

## Vision routing

Two phases require *seeing* pixels: reading `design/refs/` in Step 0, and critiquing rendered output
at the Step 4 review gate. If the executing model can't accept image input, route those to a
vision-capable model and act on its text findings — the review gate is only meaningful against a
*rendered* screenshot, not source code. Canonical protocol: **read
`../design-system-init/references/vision-routing.md`**.

## Step 1 — Decompose before you build

The single biggest driver of AI-looking, unmaintainable UI is generating one giant file. Plan the structure first.

- Break the target into atomic units mapped to `COMPONENTS.md`: primitives (Button, Input, Card...) composed into composites (form row, list item, nav) composed into layout shells. This holds regardless of stack — the units map to functions, classes, partials, or components.
- Define each unit's interface explicitly before implementing it: what it receives, what variants it has, what it renders. Decide where state lives; keep presentational units free of business logic.
- Reuse before you create. If a primitive already exists, use it; don't fork a near-duplicate. Divergent one-off components are a slop tell.
- For anything non-trivial, state the component breakdown to the user before generating a wall of code, so a wrong structure gets caught cheaply.

## Step 2 — Build to the tokens

- Consume semantic tokens from the design system. Do not introduce arbitrary raw values (hex codes, off-scale pixel spacing, one-off font sizes) when a token exists. Arbitrary values are both a maintenance problem and a visible inconsistency.
- If the design genuinely needs a value the system lacks, stop and add it to the system as a named token rather than hardcoding it inline. The system stays the source of truth.
- Let hierarchy come from the system's stated mechanism — often spacing and size before weight, and weight before color. Reaching for a new accent color to create emphasis usually means the spacing is wrong.
- Honor the stated density and layout posture. If the system says airy, generous whitespace is the design, not wasted space. If it says break the grid intentionally in places, do so deliberately — uniform evenly-spaced everything is what makes layouts read as templated.

## Step 3 — Define every interaction state

Unstated states are where polish dies and where AI output gives itself away. For every interactive element, implement the full applicable set, not just the resting state:

- **default, hover, focus-visible, active, disabled** — always for anything clickable or focusable.
- **loading, error, empty** — wherever data or async work is involved; empty states especially are routinely skipped and routinely matter.
- Transitions should be present but restrained and consistent (one duration scale, purposeful easing), per the system's motion tokens. Respect `prefers-reduced-motion`.
- `focus-visible` is not optional. Keyboard users need a visible focus indicator that meets contrast; never remove outlines without replacing them.

## Step 4 — The review gate (mandatory before "done")

Do not present UI as finished until it has passed this self-critique. Treat your own first output as a junior draft and review it like a demanding senior designer would. Go through each check, fix what fails, and only then hand off.

**Render first.** A review against source code catches token violations but misses how the thing actually looks — which is where slop lives. Produce a rendered screenshot before critiquing (see Vision routing). If rendering is genuinely impossible in this environment, say so, run the code-level checks below, and flag that the visual checks were not performed rather than silently passing them.

**Against the design system**
- Does every color, space, size, and radius come from a token? Flag any arbitrary value.
- Is hierarchy created by the system's intended mechanism, or did you reach for color/weight as a shortcut?
- Does density and layout posture match the system's stated intent?

**Against structure**
- Is this decomposed per `COMPONENTS.md`, or did it collapse into a monolith?
- Are there near-duplicate components that should be one?

**Against interaction**
- Does every interactive element define its full state set, including focus-visible, disabled, loading, error, and empty where relevant?
- Keyboard-operable? Contrast adequate for text and focus indicators?

**Against slop** (the fingerprint list below is the authority; this is the backstop)
- Any known fingerprints present — generic gradient-blob hero, pill-everything uniform radius, the only layout idea being a three-card row, default "AI editorial" serif-on-cream-with-sage?
- Does it actually resemble the references in feel, or just in surface palette?

Report what you changed as a result of the review. If something fails a check and you chose not to fix it, say why.

## Polish vocabulary

When the user gives feedback, or when you critique your own work, use precise, operational design language — vague adjectives produce vague edits. Translate "make it better" into specific moves:

- "Information density is too low — tighten padding on list items to the next step down the spacing scale."
- "Muted text is failing contrast — move it up one step toward the text token."
- "Hierarchy is flat — increase the size jump between heading and body rather than bolding more."
- "This transition is jarring — bring it to the standard duration token with ease-out."
- "Spacing rhythm is irregular — snap all gaps to the scale."

Apply the same vocabulary to yourself at the review gate; it's what turns a generic draft into something deliberate.

## Acceptance checklist
- [ ] DESIGN_SYSTEM.md, COMPONENTS.md, and `design/refs/` loaded before building.
- [ ] Output decomposed into atomic units with explicit interfaces; no monolith, no near-duplicates.
- [ ] All values come from tokens; any new need was added to the system, not hardcoded.
- [ ] Every interactive element defines its full state set, including focus-visible and loading/error/empty where relevant.
- [ ] Review gate run; failures fixed or explicitly justified; changes reported.
- [ ] Result resembles the references in feel, not just palette, and trips no anti-slop fingerprints.
