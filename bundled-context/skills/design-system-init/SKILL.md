---
name: design-system-init
description: Establish a project's design system before any UI is built. Use this at the start of a new project, a redesign, or whenever the user wants to define a visual direction, "set up a design system," capture the look of reference sites/apps they like, or produce a DESIGN_SYSTEM.md. Trigger this whenever the user mentions design references, "make it look like X," brand direction, or "what aesthetic should we use" — even if they don't say the words "design system." This is the setup phase; the companion design-build skill enforces the result during construction.
---

# Design System Init

Generate a project's source-of-truth design system from a short interview plus 2-3 references the user actually likes. The output is a `DESIGN_SYSTEM.md` (visual language) and a `COMPONENTS.md` (structural inventory) that the `design-build` skill later enforces.

The core problem this solves: **taste is not tokens.** Extracting colors and fonts from a reference site is easy and nearly worthless on its own — it hands an agent Linear's palette without Linear's restraint. What makes a reference feel the way it does is composition, hierarchy, density, and motion, none of which survive a style-scrape. So this skill captures *intent* (why the user likes each reference) and *persists the actual reference images* alongside the extracted values, so the build agent can look at them directly.

## Process

Run these in order. Don't skip the interview to get to extraction faster — the interview is where the value is.

1. **Interview** the user for intent and constraints.
2. **Ingest references**: save the user's 2-3 examples as images into the repo, and pull computed style values if available.
3. **Cross-check** the emerging direction against known AI-slop fingerprints.
4. **Synthesize** the tokens and a component inventory.
5. **Write** `DESIGN_SYSTEM.md` and `COMPONENTS.md`, plus a stack-mapping note.
6. **Confirm** with the user before declaring done.

## Vision routing

Steps 2 and 3 depend on *seeing* the references — studying composition, density, and restraint, and spotting visual slop fingerprints. If the model executing this skill cannot accept image input, do not skip these steps and do not fake them from filenames. Instead, route the visual work to a vision-capable model and pass its findings back as text:

- Hand each image in `design/refs/` to a vision-capable model and ask for a concrete description: spacing rhythm, type scale contrast, where emphasis lands, border/shadow restraint, how empty space is used, and implied motion. Capture that text in `design/refs/extracted.md` under a "visual observations" heading.
- For the anti-slop cross-check, have the vision model also report whether any known fingerprints appear in the references.
- The text-only model then synthesizes tokens from those written observations plus the interview. The references still get persisted as images regardless, because the downstream `design-build` agent may have its own vision routing and will want to look at them directly.

If this skill is being run in a vision-capable environment (e.g. a chat interface with image upload), do the visual work inline — no routing needed.

## Step 1 — Interview

Ask in small clusters, one cluster per turn, and adapt to answers. The goal is to get the user to articulate *feeling* and *purpose*, not to fill a form. When a user gives a flat adjective ("clean," "modern," "professional"), push once for what it means to them concretely — those words are where slop comes from because every agent interprets them the same generic way.

If interactive elicitation buttons are available in this environment, prefer them for the multiple-choice clusters; otherwise ask in prose.

**Cluster A — Surface and purpose**
- What is being built? (marketing site, dense data app/dashboard, mobile app, docs, internal tool, ...) Density and information hierarchy follow directly from this.
- Who uses it, and in what state of mind? (a stressed admin scanning for one number vs. a buyer being persuaded vs. a developer reading reference material)
- What is the one job the interface must do well above all else?

**Cluster B — References (the heart of it)**
- Ask for 2-3 sites or apps they like. For *each one*, ask: "What specifically do you like here — name the feeling or the moment, not just 'it's clean.'" Capture their words verbatim; these become the rationale notes.
- Ask what they explicitly do NOT want it to feel like. Negative space is as defining as positive.

**Cluster C — Constraints**
- Existing brand assets to respect? (logo, locked colors, an established voice doc)
- Density preference: airy/generous vs. compact/information-dense.
- Motion appetite: still and quiet, restrained and purposeful, or expressive.
- Light, dark, or both.
- Target stack(s), so the output can include a correct mapping note (e.g. CSS custom properties, Tailwind theme, React Native StyleSheet, Bootstrap/XHTML). The system itself stays stack-agnostic; only the mapping note is stack-specific.

Stop interviewing once you can describe the intended feel in two or three sentences and the user agrees with that description. Read that summary back before moving on.

## Step 2 — Ingest references

References are the highest-bandwidth input you have. Treat them as durable project assets, not throwaway prompt context.

- Create `design/refs/` in the repo. Save each reference image there with a descriptive name (`ref-linear-sidebar.png`, not `image1.png`). If the user pasted screenshots, persist them; if they gave URLs, capture or ask them to attach a screenshot of the specific view they mean.
- Alongside the images, record the per-reference rationale from Cluster B in `design/refs/NOTES.md` — one short block per reference: what it is, what the user values, and what to deliberately NOT copy from it.
- If a style-extraction tool is available (e.g. the TypeUI browser extension, or computed-style inspection), pull raw values — fonts, color stops, radius, shadow, spacing rhythm — and drop them in `design/refs/extracted.md` as *raw input*, clearly labelled as not-yet-curated. Extracted values are a starting point you will edit, never the final tokens.
- If you can view images directly, study them for the things extraction misses: spacing rhythm, how much empty space carries the layout, type scale contrast, where emphasis lands, border/shadow restraint, and motion implied by the design. Note these observations — they matter more than the hex codes.

## Step 3 — Anti-slop cross-check

Before committing to tokens, check the direction against generic-AI-output fingerprints. This is the step that catches choices which "feel safe" precisely because every model defaults to them.

- Cross-reference the proposed fonts, colors, and layout patterns against this safety net, the authority for this check: be suspicious of the default "AI editorial" fingerprint (a serif display like Fraunces paired with a cream/off-white background and a muted sage/green accent), of all-purpose gradient-blob heroes, of uniform pill-everything with identical border-radius, and of evenly-spaced three-card feature rows as the only layout idea.
- When the user's stated direction collides with a known fingerprint, say so plainly and propose a specific, deliberate alternative rather than silently steering. The user decides; your job is to make the collision visible.

## Step 4 — Synthesize

Curate, don't transcribe. Resolve the references and the interview into one coherent system with deliberate, defensible choices. Every token should be traceable to either a stated intent or a reference, and you should be able to say why it's there.

- **Color**: define semantic roles (surface, surface-raised, text, text-muted, border, primary, primary-contrast, accent, success/warn/danger as needed) with concrete values. Avoid more accent colors than the design needs; restraint reads as intentional.
- **Type**: choose a primary and, if warranted, a display face; set a scale with real values and a *narrow* weight range. Note where weight vs. size vs. spacing should carry hierarchy.
- **Spacing**: one base unit and a scale built from it. Spacing is what makes whitespace look intentional instead of accidental.
- **Radius, border, shadow, motion**: define each as a small token set with stated intent (e.g. "shadows are near-flat; elevation is communicated by surface color, not blur").

## Step 5 — Write the outputs

### DESIGN_SYSTEM.md

Use this exact structure:

```markdown
# Design System — [project]

## Intent
[2-3 sentences: the feeling, the user, the one job. This is the north star;
every later decision serves it.]

## References
[Per reference: name, link to design/refs/<file>, what we take from it,
what we deliberately do NOT take. Mirror design/refs/NOTES.md.]

## Foundations
### Color  [semantic role → value, with light/dark if applicable]
### Type   [families, scale with values, weight range, hierarchy rules]
### Spacing [base unit + scale]
### Radius / Border / Shadow / Motion [token sets + stated intent]

## Density & Layout
[Airy vs dense; default page rhythm; how empty space is used; grid posture
and when it is acceptable to break it on purpose.]

## Do / Don't
[Concrete, testable rules specific to THIS system. Include the anti-slop
collisions found in Step 3 as explicit "don't"s.]

## Stack Mapping
[How these semantic tokens map to the target stack(s): CSS custom properties,
Tailwind theme keys, RN StyleSheet, Bootstrap/XHTML variables, etc. Tokens
stay semantic; this is the only stack-specific section.]
```

### COMPONENTS.md

The visual system is not enough — without a structural plan, agents produce one monolithic file. Capture the atomic inventory so `design-build` can enforce decomposition:

```markdown
# Component Inventory — [project]

## Primitives
[The smallest reusable units this product needs: Button, Input, Card,
Badge, etc. For each: variants, the states it must define
(default/hover/focus-visible/active/disabled/loading/error as applicable),
and which design tokens it consumes.]

## Composites
[Units built from primitives: form rows, list items, nav, modal shell, etc.
For each: which primitives it composes and its responsibility.]

## Layout shells
[Page-level structures: app frame, marketing section rhythm, etc.]

## Conventions
[Naming, where state lives, what stays presentational vs. stateful —
expressed so it maps to functions, classes, partials, or components
regardless of stack.]
```

Keep both files framework-neutral in the body; concrete framework details live only in the Stack Mapping section.

## Step 6 — Confirm

Show the user the Intent paragraph and the Do/Don't list first — those are where misalignment hides. Adjust, then hand off: tell them `design-build` will enforce this system, and that `design/refs/` should stay in the repo because the build agent will look at the images, not just the tokens.

## Acceptance checklist
- [ ] Intent is stated in 2-3 sentences the user endorsed.
- [ ] 2-3 references persisted as images in `design/refs/` with per-reference rationale.
- [ ] Direction cross-checked against anti-slop fingerprints; collisions surfaced to the user.
- [ ] Tokens are concrete, semantic, and each traceable to an intent or reference.
- [ ] COMPONENTS.md inventory exists with states enumerated per primitive.
- [ ] Stack Mapping section present for the target stack(s); rest stays stack-neutral.
