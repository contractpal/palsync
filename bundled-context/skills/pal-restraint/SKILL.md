---
name: pal-restraint
description: "Default coding discipline for ALL PalBuilder work — write the least code that fully solves the task, surface assumptions instead of guessing, and touch only what the task needs. Apply this BY DEFAULT whenever writing, editing, or reviewing pal code (pages, fragments, workflows, styles); the user shouldn't have to ask, and pal-loop invokes it on every task in the cycle, not just on request. Also triggers on 'simplify this', 'this is over-engineered', 'do it the lazy way', 'less code', 'de-slop the logic', 'is this the right approach', 'what should I do here'. It governs HOW MUCH code exists, what gets touched, and when to ask instead of guess; it does not relax correctness — PalBuilder's golden rules and the palbuilder-* skills always win a conflict, and it never cuts validation, security, accessibility, or the pal-loop verification gates. Adapted from ponytail (MIT, github.com/DietrichGebert/ponytail) and Andrej Karpathy's LLM-coding-pitfalls guidance, remapped to the PalBuilder dialect."
---

# pal-restraint — the least code that works, in PalBuilder's dialect

Think like the laziest senior dev on the team: the best code is the code you never wrote, the
best diff is the smallest one that's correct, and the best guess is the one you asked about
instead of making. Most AI over-builds — a custom widget where a tag exists, a hand-rolled list
where `c:list` does it, a new library where one is already loaded — and over-edits, touching
adjacent code nobody asked it to touch. This skill stops both. It governs *how much* code exists
and *what gets touched*. It does **not** touch correctness: the PalBuilder golden rules
(`bundled-context/CLAUDE.md`) and the palbuilder-frontend/backend skills are law, and they win
any conflict with a "shorter" or "smaller-diff" idea.

The one rule: **write only what the task needs, touch only what the task needs, and never cut
validation, security, accessibility, or verification to get there.** Code ends up small because
it's necessary, not because it's golfed. This is the default posture for every task in the
pal-loop cycle — not a mode you opt into per request.

---

## Surface assumptions, don't guess

Laziness about code is not laziness about thinking. Before writing anything non-trivial:

- **State assumptions explicitly** rather than silently picking one and building on it. If the
  spec or request is genuinely ambiguous, say which reading you're using.
- **If multiple reasonable interpretations exist, name them** — don't silently commit to one and
  hope. In pal-loop terms this is usually a **blocker**, not a judgment call to make alone (see
  pal-loop's "When the spec is wrong" amendment path) — but for in-task micro-decisions (which
  existing fragment to clone, which lib function applies) a one-line stated assumption is enough.
- **If a simpler approach exists than the one implied by the request, say so before building the
  complicated one.** Push back when warranted; the spec is WHAT, not necessarily the most direct
  HOW.
- **If something is genuinely unclear, stop and name what's confusing** rather than guessing and
  shipping. A guess that turns out wrong costs more than the question would have.

This is the same discipline as "read first, then climb the ladder" below, aimed one step
earlier: read and understand *before* assuming, not just before coding.

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

## Surgical changes — touch only what the task needs

The ladder above governs how much code you write; this governs how much of the diff is yours.
Both axes matter — a minimal-looking change that also reformats an unrelated fragment is not
restraint, it's a bigger diff wearing a smaller hat.

- **Don't "improve" adjacent code, comments, or formatting** while you're in a file for an
  unrelated reason. Resist the urge to fix a typo two lines up from your change.
- **Don't refactor things that aren't broken** as a side effect of the task you were given.
- **Match existing style**, even where you'd structure it differently — consistency with the
  surrounding pal beats your personal preference.
- **If you notice unrelated dead code, mention it — don't delete it.** (Exception: PalBuilder's
  own golden rules require removing *your own* debug calls, commented-out code, and unused files
  before finishing a task — that cleanup is always required, see `bundled-context/CLAUDE.md`
  "Before you finish a task." The restraint here is about *pre-existing* mess you didn't create.)
- **Remove only the orphans your own change created** — an import, variable, or fragment that is
  now unused *because of this edit*. Leave pre-existing dead code alone unless asked to remove it.

The test: every changed line should trace directly to the task at hand — either the spec's `spec
ref`, or cleanup that your own edit made necessary. If a line doesn't trace to either, it
shouldn't be in the diff.

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
  other skill, active by default during pal work and on every pal-loop task cycle. (That's the
  part of ponytail palsync already solves; rebuilding it would be the exact over-engineering this
  skill forbids.)
- It is not a correctness reference. HOW to write PalBuilder lives in the golden rules and the
  palbuilder-* skills; this skill decides how MUCH to write, what to touch, and when to ask
  instead of guess — and defers to them on conflict.
- It does not golf. The goal is necessary code, not the fewest characters — readability and the
  dialect's constraints both outrank brevity.
- It does not replace pal-loop's verification gates. Stating success criteria and looping to a
  tool-verified pass is pal-loop's job (`pal_validate` / `pal_test` / `pal_preview`, the task
  cycle's "Verify" step); pal-restraint only makes sure what reaches that gate isn't bloated, isn't
  off-task, and isn't a silent guess.

---

*Ladder and "lazy, not negligent" guardrails adapted from ponytail by Dietrich Gebert (MIT) —
github.com/DietrichGebert/ponytail. "Surface assumptions" and "surgical changes" sections adapted
from Andrej Karpathy's LLM-coding-pitfalls guidance
(x.com/karpathy/status/2015883857489522876) — both remapped to the PalBuilder dialect.*
