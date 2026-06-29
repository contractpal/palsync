---
name: pal-restraint
description: "Write the least PalBuilder code that fully solves the task — reuse before building, use the platform before reaching for a library, and never over-build. Apply this BY DEFAULT whenever writing or editing pal code (pages, fragments, workflows, styles); the user shouldn't have to ask. Also triggers on 'simplify this', 'this is over-engineered', 'do it the lazy way', 'less code', 'de-slop the logic'. It governs HOW MUCH code exists; it does not relax correctness — PalBuilder's golden rules and the palbuilder-* skills always win a conflict, and it never cuts validation, security, accessibility, or the pal-loop verification gates. Adapted from ponytail (MIT, github.com/DietrichGebert/ponytail), remapped to the PalBuilder dialect."
---

# pal-restraint — the least code that works, in PalBuilder's dialect

Think like the laziest senior dev on the team: the best code is the code you never wrote. Most
AI over-builds — a custom widget where a tag exists, a hand-rolled list where `c:list` does it,
a new library where one is already loaded. This skill stops that. It governs *how much* code
exists. It does **not** touch correctness: the PalBuilder golden rules
(`bundled-context/CLAUDE.md`) and the palbuilder-frontend/backend skills are law, and they win
any conflict with a "shorter" idea.

The one rule: **write only what the task needs — and never cut validation, security,
accessibility, or verification to get there.** Code ends up small because it's necessary, not
because it's golfed.

---

## Read first, then climb the ladder

Laziness is about the *solution*, never about *reading*. Before writing anything, understand the
task and trace the real flow: read the fragment/workflow you're about to touch, the files it
calls, the dataset it reads. A shortcut chosen without reading the code is a guess, not restraint.

Then stop at the **first rung that holds**:

1. **Does this need to exist at all?** → No: don't build it. (YAGNI.) The cheapest code is none.
2. **Is it already in this pal?** → Reuse it. An existing fragment, a `lib/*.js` function, a
   dataview, a dataset, a CSS class. palsync gives you the whole workspace — search it before you
   write. Do not rewrite what's already there, and never invent a CSS class that already exists.
3. **Is there a `c:` tag or a ConsoleController/API method for it?** → Use the platform. This is
   PalBuilder's "standard library." A `c:` tag or a `pal.*` / `c.*` method beats hand-rolled
   markup or JS almost every time, and it's the supported path.
4. **Is the capability already provided?** → Use it before adding anything. Check what the
   project already loads via `c:resource` and what the design system sanctions
   (DESIGN_SYSTEM.md / COMPONENTS.md). Use those, rather than pulling in a new library or
   hand-building an equivalent. Follow the design system's choices — don't introduce a new
   UI-framework dependency on your own; the project may be standardizing away from one.
5. **Then: the minimum that works** — within the dialect's limits. "One line" only if the engine
   allows it; workflow JS is a restricted ES3-style engine, so a clever one-liner that uses an
   object literal or an arrow function is a *hard error*, not a win. Minimum-that-works there
   means a plain, correct `var`/`function` form, not the shortest characters.

The ladder runs *after* you understand the problem, not instead of it.

---

## Never on the chopping block

Lazy, not negligent. These are never removed in the name of less code:

- **Trust-boundary validation** — server-side checks via the `validator`; never trust client input.
- **Data-loss handling** — confirm before destructive dataset writes; don't silently drop records.
- **Security** — server actions go through encrypted `c:` tags (`c:a`, `c:upload`, `c:download`),
  never `fetch`/ClientPal. (This is also a golden rule — restraint and correctness agree here.)
- **Accessibility** — alt text on images, labels on inputs, one meaningful H1.
- **The pal-loop gates** — `pal_validate` / `pal_test` / preview verification are not "extra
  effort" to skip. Less code never means less verification.

If a shorter path would cut any of these, it's not restraint — it's a defect. Climb to the next
rung instead.

## PalBuilder correctness always wins

When a rung would collide with the dialect, the dialect wins — drop that rung, don't bend the
rules to keep it:

- A "one-line" object literal `{ k: v }` in workflow JS → use `c.createData()` /
  `c.createDataList()`. The literal throws; brevity is no excuse.
- An undocumented `c:` attribute that looks like it'd save a step → not allowed; look it up, use
  the supported attribute, even if it's more typing.
- A terse `fetch` instead of a `c:a` → never; the encrypted tag is the only correct path.

Restraint subordinate to correctness, every time. A shorter build that fails `pal_validate` is
slower than the longer one that passes.

## Composes with anti-slop-code

Different axes, both apply where available. anti-slop-code (if your setup loads it — note it is
not currently bundled in palsync) governs how the code *reads* (naming, comments, structure that
looks machine-generated); pal-restraint governs how much code *exists*. When both are present,
run both: write less, and what you do write shouldn't look auto-generated.

---

## In practice (PalBuilder before / after)

- **Date input.** Don't add a JS date library or build a picker widget → `<input type="date" />`
  (self-closed for XHTML). The browser has one.
- **A filtered, sortable record list.** Don't hand-write pagination + sort JS → `c:list`
  (`name` + `id`) or a DataView already does it.
- **A key-value structure in a workflow.** Don't hand-roll one, and don't write an object literal
  (it throws) → `c.createData()`.
- **A chart.** Don't `npm install` or hand-draw SVG → use the charting library the project
  already loads via `c:resource`.
- **Calling the server from a fragment.** Don't write a `fetch` wrapper → `c:a action="..."`.
- **A modal.** Don't build a modal shell → the platform's outer shell already provides the
  wrapper; the fragment holds inner content only.

Each is the same move: climb the ladder, land on the platform rung, write almost nothing.

---

## What this skill does NOT do

- It is not a delivery mechanism. No modes, commands, or statusline — palsync injects it like any
  other skill, active by default during pal work. (That's the part of ponytail palsync already
  solves; rebuilding it would be the exact over-engineering this skill forbids.)
- It is not a correctness reference. HOW to write PalBuilder lives in the golden rules and the
  palbuilder-* skills; this skill only decides how MUCH to write, and defers to them on conflict.
- It does not golf. The goal is necessary code, not the fewest characters — readability and the
  dialect's constraints both outrank brevity.

---

*Ladder and "lazy, not negligent" guardrails adapted from ponytail by Dietrich Gebert (MIT) —
github.com/DietrichGebert/ponytail — remapped to the PalBuilder dialect.*
