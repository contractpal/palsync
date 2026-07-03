---
name: design-system-init
description: "Establish a project's design system before any UI is built, from a short interview plus 2-3 references the user likes: produces DESIGN_SYSTEM.md + COMPONENTS.md, enforced later by design-build. Triggers: 'set up a design system', design references, 'make it look like X', brand direction, 'what aesthetic should we use', or a redesign."
---

# Design System Init

Build a project's source-of-truth design system from a short interview plus 2-3 references the user likes. Outputs: `DESIGN_SYSTEM.md` (visual language) and `COMPONENTS.md` (structural inventory), enforced later by `design-build`.

**Taste is not tokens.** Capture *intent* (why the user likes each reference) and persist the reference images alongside extracted values — because composition, density, and restraint don't survive a style-scrape, so a scrape alone hands an agent Linear's palette without Linear's restraint.

## Process

In order. Don't skip the interview to reach extraction faster.

1. **Interview** for intent and constraints.
2. **Ingest references**: save the 2-3 examples as images in the repo; pull computed style values if available.
3. **Cross-check** direction against known AI-slop fingerprints.
4. **Synthesize** tokens and a component inventory.
5. **Write** `DESIGN_SYSTEM.md` and `COMPONENTS.md`, plus a stack-mapping note.
6. **Confirm** with the user before declaring done.

## Vision routing

Steps 2-3 require *seeing* references (composition, density, restraint, slop fingerprints). If the executing model can't accept images, route visual work to a vision-capable model and consume findings as text — don't skip or fake from filenames. Protocol: **read `references/vision-routing.md`**.

## Mode: declare vs extract

- **Declare (default)** — new project, no existing pal. Runs as written: ask for 2-3 external references, interview for intent, synthesize new tokens.
- **Extract** — triggers when **a MAP.md is present** (brownfield handoff from pal-init) **and** no `DESIGN_SYSTEM.md`/`COMPONENTS.md` exists yet in the workspace. Either condition failing → declare mode. The pal itself is the reference: derive tokens and composition from what's built (MAP.md's Design reality section, the pulled `styles/*.css`, `pages/*.html`, `fragments/*.html`, the pal's rendered screens) instead of asking for sites. Every step below has an **"Extract mode:"** note where behavior diverges; unmarked steps run as written in both modes.

## Step 1 — Interview

Ask in small clusters, one per turn; adapt. Elicit *feeling* and *purpose*, not a form. On a flat adjective ("clean," "modern," "professional"), push once for what it means concretely — those words breed slop. Prefer interactive elicitation buttons for the multiple-choice clusters if available; else prose.

**Cluster A — Surface and purpose**
- What is being built? (marketing site, dense data app/dashboard, mobile app, docs, internal tool, ...)
- Who uses it, in what state of mind? (a stressed admin scanning for one number vs. a buyer being persuaded vs. a developer reading reference material)
- The one job the interface must do well above all else?

**Cluster B — References (the heart of it)**
- Ask for 2-3 sites or apps they like. For *each*, ask: "What specifically do you like here — name the feeling or the moment, not just 'it's clean.'" Capture their words verbatim; these become the rationale notes.
- Ask what they explicitly do NOT want it to feel like.

**Cluster C — Constraints**
- Existing brand assets to respect? (logo, locked colors, a voice doc)
- Density: airy/generous vs. compact/information-dense.
- Motion appetite: still and quiet, restrained and purposeful, or expressive.
- Light, dark, or both.
- Target stack(s), so the output includes a correct mapping note (CSS custom properties, Tailwind theme, React Native StyleSheet, Bootstrap/XHTML). The system stays stack-agnostic; only the mapping note is stack-specific.

Stop once you can describe the intended feel in 2-3 sentences and the user agrees. Read it back first.

**Extract mode:** skip Cluster B (sites you like) — the existing pal is the only reference, not optional. Keep Cluster A and Cluster C in full: motion appetite, density, and target stack are still real questions even when the palette is fixed.

## Step 2 — Ingest references

Treat references as durable project assets, not throwaway context.

- Create `design/refs/`. Save each image with a descriptive name (`ref-linear-sidebar.png`, not `image1.png`). Persist pasted screenshots; for URLs, capture or ask for a screenshot of the specific view meant.
- Record per-reference Cluster B rationale in `design/refs/NOTES.md` — one block each: what it is, what the user values, what to deliberately NOT copy.
- If a style-extraction tool is available (TypeUI extension, computed-style inspection), pull raw values — fonts, color stops, radius, shadow, spacing rhythm — into `design/refs/extracted.md` as *raw input*, labelled not-yet-curated: a starting point to edit, never the final tokens.
- If you can view images directly, study what extraction misses: spacing rhythm, how much empty space carries the layout, type scale contrast, where emphasis lands, border/shadow restraint, implied motion.

**Extract mode:** references ARE the pal's own rendered screens, not external sites.
- `design/refs/`: screenshots of the LIVE pal (`pal_screenshot`/`palsync screenshot`, or reuse MAP.md's baseline screenshots if fresh). Name like `ref-home-desktop.png`, not `ref-linear-sidebar.png` — no borrowed brand to credit.
- `design/refs/NOTES.md`: what each screen IS and which pal section it's from, not "what the user values" — description, not curation.
- `design/refs/extracted.md`: still raw input, but from the pal's OWN source, not a scrape tool: `:root` custom properties and hex/rgb values in `styles/*.css`, font families/weights from `c:resource`/Google Fonts `<link>` tags in `pages/*.html`, border-radius/box-shadow/transition values in use — labelled by source file, not "not-yet-curated guesses." **Never invent a token with no corresponding value in use** — that's extracting vs. declaring.
- Direct-viewing matters MORE here (see intro). Route the pal's screenshots through the Vision routing above (inline if vision-capable, else to a vision model) to capture spacing rhythm, hierarchy, restraint — CSS values alone populate Foundations but not Density & Layout or Do/Don't.

## Step 3 — Anti-slop cross-check

Before committing to tokens, check direction against generic-AI-output fingerprints — these catch choices that "feel safe" because every model defaults to them.

- Cross-reference proposed fonts, colors, and layout patterns against this safety net (the authority for this check): be suspicious of the default "AI editorial" fingerprint (a serif display like Fraunces paired with a cream/off-white background and a muted sage/green accent), all-purpose gradient-blob heroes, uniform pill-everything with identical border-radius, and evenly-spaced three-card feature rows as the only layout idea.
- When the user's direction collides with a known fingerprint, say so plainly and propose a specific, deliberate alternative rather than silently steering. The user decides; make the collision visible.

**Extract mode:** a fingerprint here is already LIVE, not a direction you're choosing. Don't silently avoid it — that breaks the observed-vs-declared honesty this mode depends on. Extract it faithfully, then flag it in Do/Don't as "known issue, not fixed here." Changing it is a scoped, human-approved, regression-checked decision made later (via pal-spec/pal-loop, per pal-spec's §12 REGRESSION criterion) — never an automatic side effect of this skill.

## Step 4 — Synthesize

Curate, don't transcribe. Resolve references and interview into one coherent system with deliberate choices; every token should trace to a stated intent or a reference.

- **Color**: define semantic roles (surface, surface-raised, text, text-muted, border, primary, primary-contrast, accent, success/warn/danger as needed) with concrete values. Avoid more accents than needed; restraint reads as intentional.
- **Type**: choose a primary and, if warranted, a display face; set a scale with real values and a *narrow* weight range. Note where weight vs. size vs. spacing carries hierarchy.
- **Spacing**: one base unit and a scale built from it.
- **Radius, border, shadow, motion**: each a small token set with stated intent (e.g. "shadows are near-flat; elevation is communicated by surface color, not blur").

**Extract mode:** every token cites a source file (e.g. "from styles/main.css :root"), not a rationale. Per category:
- **Color**: if `:root` custom properties exist, those ARE the semantic roles — use directly, don't rename or reorganize into a different role set. None → cluster repeated hex/rgb values in `styles/*.css` into roles.
- **Type**: families/weights actually loaded via `c:resource`/Google Fonts `<link>` tags — not a fresh pick, even if a "better" pairing suggests itself.
- **Spacing / Radius / Shadow / Motion**: actual values in `styles/*.css`. If inconsistent (e.g. three border-radius values, no evident pattern), flag as a Do/Don't candidate ("radius inconsistent: 4px/6px/8px in use, no clear rule — pick one going forward") rather than silently averaging or picking one as THE token.
- **Components**: cross-reference MAP.md's Fragments table for COMPONENTS.md, not a fresh inventory — a fragment used by 3+ pages is a Composite/Primitive candidate; used once, page-specific, not reusable.
- **Density & Layout / Do-Don't**: from Step 2's vision observations of the pal's screenshots, not CSS.

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
<!-- Extract mode: references are the pal's own screenshots + source files (styles/main.css,
     pages/main.html, MAP.md) — cite those instead of external sites; "what we take from it" /
     "do NOT take" become "extracted as-is" / "flagged in Do/Don't, not changed here" (Step 3). -->

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

Show the user the Intent paragraph and the Do/Don't list first — that's where misalignment hides. Adjust, then hand off: `design-build` enforces this system, and `design/refs/` stays in the repo because the build agent looks at the images, not just tokens.

**Extract mode:** the confirm question shifts from taste approval to factual accuracy — not a new direction the user signs off on, but a description of what's already live. Ask "does this match reality, or did I miss/misread something?" instead of "do you like this?" A correction means the extraction was wrong (re-check the source file), not that the user wants a different design.

## Acceptance checklist
- [ ] Intent is stated in 2-3 sentences the user endorsed.
- [ ] 2-3 references persisted as images in `design/refs/` with per-reference rationale.
- [ ] Direction cross-checked against anti-slop fingerprints; collisions surfaced to the user.
- [ ] Tokens are concrete, semantic, and each traceable to an intent or reference.
- [ ] COMPONENTS.md inventory exists with states enumerated per primitive.
- [ ] Stack Mapping section present for the target stack(s); rest stays stack-neutral.
- [ ] **Extract mode only:** every token cites a source file, not an intent/reference rationale;
      no token exists that isn't backed by an actual CSS value or loaded resource; inconsistent
      values are flagged in Do/Don't, not silently resolved.
