---
name: pal-restraint
description: "Default coding discipline for ALL PalBuilder work: least code that solves the task, surface assumptions not guesses, touch only what's needed. Never cuts correctness, validation, security, or accessibility; pal-loop runs it every task. Triggers: 'simplify this', 'this is over-engineered', 'do it the lazy way', 'less code', 'de-slop the logic', 'is this the right approach', 'what should I do here'."
---

# pal-restraint — the least code that works, in PalBuilder's dialect

Think like the laziest senior dev on the team: the best code is the code you never wrote, the best
diff is the smallest correct one, and the best guess is the one you asked about instead of making.
Most AI over-builds (a custom widget where a tag exists, a hand-rolled list where `c:list` does it)
and over-edits (touching adjacent code nobody asked about). This skill stops both — it governs *how
much* code exists and *what gets touched*. It does not touch correctness: the golden rules
(`bundled-context/CLAUDE.md`) and the palbuilder-* skills are law and win any conflict with a
"shorter" idea.

**The one rule:** write only what the task needs, touch only what the task needs, and never cut
validation, security, accessibility, or verification to get there. Code ends up small because it's
necessary, not golfed. This is the default posture for every pal-loop task, not a mode you opt into.

---

## Surface assumptions, don't guess

Laziness about code is not laziness about thinking. Before writing anything non-trivial:

- **State assumptions explicitly** instead of silently picking one — name which reading you're using
  when the spec or request is ambiguous.
- **Name multiple reasonable interpretations** rather than committing to one and hoping. In pal-loop
  this is usually a **blocker** (see its amendment path), not a call to make alone — but for in-task
  micro-decisions (which fragment to clone, which lib function applies) a one-line stated assumption
  is enough.
- **If a simpler approach exists than the request implies, say so before building the complicated
  one.** The spec is WHAT, not necessarily the most direct HOW.
- **If something is genuinely unclear, stop and name what's confusing** — a wrong guess costs more
  than the question would have.

Same discipline as the ladder below, one step earlier: understand *before* assuming, not just before coding.

## Read first, then climb the ladder

Laziness is about the *solution*, never about *reading*. Before writing, trace the real flow: read
the fragment/workflow you're about to touch, the files it calls, the dataset it reads. A shortcut
chosen without reading is a guess, not restraint.

Then stop at the **first rung that holds**:

1. **Does this need to exist at all?** → No: don't build it (YAGNI). The cheapest code is none.
2. **Is it already in this pal?** → Reuse it — an existing fragment, a `lib/*.js` function, a
   dataview, a dataset, a CSS class. palsync gives you the whole workspace; search it before writing.
   Never rewrite what's there, never invent a CSS class that already exists.
3. **Is there a `c:` tag or a ConsoleController/API method for it?** → Use the platform (PalBuilder's
   "standard library"). A `c:` tag or a `pal.*`/`c.*` method beats hand-rolled markup or JS almost
   every time, and it's the supported path.
4. **Is the capability already provided?** → Use what the project loads via `c:resource` and what the
   design system sanctions (DESIGN_SYSTEM.md / COMPONENTS.md) before adding anything. Don't introduce
   a new UI-framework dependency on your own — the project may be standardizing away from one.
5. **Then: the minimum that works** — within the dialect's limits. Workflow JS is a restricted
   ES3-style engine, so a clever one-liner using an object literal or arrow function is a *hard
   error*, not a win; minimum-that-works there is a plain, correct `var`/`function` form.

The ladder runs *after* you understand the problem, not instead of it.

---

## Never on the chopping block

Lazy, not negligent. These are never removed in the name of less code:

- **Trust-boundary validation** — server-side checks via the `validator`; never trust client input.
- **Data-loss handling** — confirm before destructive dataset writes; don't silently drop records.
- **Security** — server actions go through encrypted `c:` tags (`c:a`, `c:upload`, `c:download`),
  never `fetch`/ClientPal. (Also a golden rule — restraint and correctness agree here.)
- **Accessibility** — alt text on images, labels on inputs, one meaningful H1.
- **The pal-loop gates** — `pal_validate` / `pal_test` / preview verification are not "extra effort"
  to skip. Less code never means less verification.

If a shorter path would cut any of these, it's a defect, not restraint — climb to the next rung.

## PalBuilder correctness always wins

When a rung collides with the dialect, the dialect wins — drop the rung, don't bend the rules:

- A "one-line" object literal `{ k: v }` in workflow JS → use `c.createData()`/`c.createDataList()`; the literal throws.
- An undocumented `c:` attribute that looks like a shortcut → not allowed; look up the supported attribute.
- A terse `fetch` instead of `c:a` → never; the encrypted tag is the only correct path.

A shorter build that fails `pal_validate` is slower than the longer one that passes.

## Surgical changes — touch only what the task needs

The ladder governs how much code you write; this governs how much of the diff is yours. A
minimal-looking change that also reformats an unrelated fragment is a bigger diff wearing a smaller hat.

- **Don't "improve" adjacent code, comments, or formatting** while in a file for another reason —
  resist fixing a typo two lines up.
- **Don't refactor things that aren't broken** as a side effect of the task.
- **Match existing style**, even where you'd structure it differently — consistency with the pal beats personal preference.
- **If you notice unrelated dead code, mention it — don't delete it.** (Exception: the golden rules
  require removing *your own* debug calls, commented-out code, and unused files before finishing —
  see `bundled-context/CLAUDE.md`. This restraint is about *pre-existing* mess you didn't create.)
- **Remove only the orphans your own change created** — an import/variable/fragment now unused
  because of this edit. Leave pre-existing dead code alone unless asked.

The test: every changed line traces directly to the task — the spec's `spec ref`, or cleanup your own
edit made necessary. If a line traces to neither, it shouldn't be in the diff.

## Composes with anti-slop-code

Different axes, both apply where available. anti-slop-code (if your setup loads it — not currently
bundled in palsync) governs how the code *reads* (naming, comments, machine-generated structure);
pal-restraint governs how much code *exists*. When both are present, run both.

---

## In practice (PalBuilder before / after)

Each row is the same move: climb the ladder, land on the platform rung, write almost nothing.

| Situation | Wrong move | Right move |
|---|---|---|
| Date input | a JS date library or picker widget | `<input type="date" />` (self-closed for XHTML) |
| Filtered, sortable record list | hand-written pagination + sort JS | `c:list` (`name`+`id`) or a DataView |
| Key-value structure in a workflow | hand-roll it / an object literal (throws) | `c.createData()` |
| A chart | `npm install` or hand-drawn SVG | the charting lib the project already loads via `c:resource` |
| Call the server from a fragment | a `fetch` wrapper | `c:a action="..."` |
| A modal | build a modal shell | the platform shell provides the wrapper; the fragment holds inner content only |

---

## What this skill does NOT do

- **Not a delivery mechanism** — no modes, commands, or statusline; palsync injects it like any skill,
  active by default on every pal-loop task cycle. (Rebuilding that would be the exact over-engineering this skill forbids.)
- **Not a correctness reference** — HOW to write PalBuilder lives in the golden rules and palbuilder-*
  skills; this skill decides how MUCH to write, what to touch, and when to ask, and defers to them on conflict.
- **Does not golf** — the goal is necessary code, not the fewest characters; readability and the dialect's constraints outrank brevity.
- **Does not replace pal-loop's verification gates** — stating success criteria and looping to a
  tool-verified pass is pal-loop's job; pal-restraint only keeps what reaches that gate from being bloated, off-task, or a silent guess.

---

*Ladder and "lazy, not negligent" guardrails adapted from ponytail by Dietrich Gebert (MIT,
github.com/DietrichGebert/ponytail); "surface assumptions" and "surgical changes" from Andrej
Karpathy's LLM-coding-pitfalls guidance — both remapped to the PalBuilder dialect.*
