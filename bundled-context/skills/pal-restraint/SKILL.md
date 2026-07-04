---
name: pal-restraint
description: "Default coding discipline for ALL PalBuilder work: least code that solves the task, surface assumptions not guesses, touch only what's needed. Never cuts correctness, validation, security, or accessibility; pal-loop runs it every task. Triggers: 'simplify this', 'this is over-engineered', 'do it the lazy way', 'less code', 'de-slop the logic', 'is this the right approach', 'what should I do here'."
---

# pal-restraint — the least code that works, in PalBuilder's dialect

The best code is the code you never wrote; the best diff is the smallest correct one; the best
guess is the one you asked about instead of making. This skill governs *how much* code exists
and *what gets touched*. It never touches correctness: the golden rules
(`bundled-context/CLAUDE.md`) and the palbuilder-* skills are law and win any conflict with a
"shorter" idea. Default posture for every pal-loop task — not a mode you opt into.

## Surface assumptions, don't guess

Before writing anything non-trivial:
- **State assumptions explicitly** — name which reading you're using when the spec or request
  is ambiguous.
- **Name multiple reasonable interpretations** rather than committing to one and hoping. In
  pal-loop that's usually a **blocker** (amendment path); for in-task micro-decisions (which
  fragment to clone, which lib function) a one-line stated assumption is enough.
- **If a simpler approach exists than the request implies, say so before building the
  complicated one.** The spec is WHAT, not necessarily the most direct HOW.
- **Genuinely unclear → stop and name what's confusing.** A wrong guess costs more than the
  question.

## Read first, then climb the ladder

Laziness is about the *solution*, never about *reading*. Before writing, trace the real flow:
the fragment/workflow you're touching, the files it calls, the dataset it reads. Then stop at
the **first rung that holds**:

1. **Does this need to exist at all?** No → don't build it (YAGNI).
2. **Already in this pal?** Reuse it — an existing fragment, `lib/*.js` function, dataview,
   dataset, CSS class. Search the workspace before writing. Never invent a CSS class that
   already exists.
3. **A `c:` tag or ConsoleController/API method does it?** Use the platform. A `c:` tag or
   `pal.*`/`c.*` method beats hand-rolled markup or JS almost every time.
4. **Capability already provided?** Use what `c:resource` loads and what
   DESIGN_SYSTEM.md/COMPONENTS.md sanction. Never introduce a new UI-framework dependency on
   your own.
5. **Then: the minimum that works** — within the dialect. Workflow JS is restricted ES3: a
   clever one-liner with an object literal or arrow function is a *hard error*, not a win.

## Never on the chopping block

Lazy, not negligent. Never removed in the name of less code:
- **Trust-boundary validation** — server-side checks via the `validator`; never trust client input.
- **Data-loss handling** — confirm before destructive dataset writes.
- **Security** — server actions via encrypted `c:` tags (`c:a`, `c:upload`, `c:download`),
  never `fetch`/ClientPal.
- **Accessibility** — alt text on images, labels on inputs, one meaningful H1.
- **The pal-loop gates** — `pal_validate`/`pal_test`/render verification are never "extra
  effort" to skip. Less code never means less verification.

## PalBuilder correctness always wins

When a rung collides with the dialect, the dialect wins:
- A "one-line" object literal `{ k: v }` in workflow JS → `c.createData()`/`c.createDataList()`.
- An undocumented `c:` attribute that looks like a shortcut → look up the supported attribute.
- A terse `fetch` instead of `c:a` → never.

A shorter build that fails `pal_validate` is slower than the longer one that passes.

## Surgical changes — touch only what the task needs

- **Don't "improve" adjacent code, comments, or formatting** while in a file for another reason.
- **Don't refactor things that aren't broken** as a side effect.
- **Match existing style**, even where you'd structure it differently.
- **Unrelated dead code: mention it, don't delete it.** (Exception: remove *your own* debug
  calls, commented-out code, and unused files before finishing — golden rules.)
- **Remove only the orphans your own change created.**

The test: every changed line traces to the task (its `spec ref`) or to cleanup your own edit
made necessary. Traces to neither → it doesn't belong in the diff.

## In practice (PalBuilder before / after)

| Situation | Wrong move | Right move |
|---|---|---|
| Date input | a JS date library or picker widget | `<input type="date" />` (self-closed for XHTML) |
| Filtered, sortable record list | hand-written pagination + sort JS | `c:list` (`name`+`id`) or a DataView |
| Key-value structure in a workflow | an object literal (throws) | `c.createData()` |
| A chart | `npm install` or hand-drawn SVG | the charting lib the project already loads via `c:resource` |
| Call the server from a fragment | a `fetch` wrapper | `c:a action="..."` |
| A modal | build a modal shell | the platform shell provides the wrapper; the fragment holds inner content only |

## What this skill does NOT do
- **Not a correctness reference** — HOW to write PalBuilder lives in the golden rules and
  palbuilder-* skills; this decides how MUCH to write and when to ask, and defers to them.
- **Does not golf** — the goal is necessary code, not the fewest characters; readability and
  the dialect's constraints outrank brevity.
- **Does not replace pal-loop's verification gates** — it only keeps what reaches those gates
  from being bloated, off-task, or a silent guess.

---

*Ladder and "lazy, not negligent" guardrails adapted from ponytail by Dietrich Gebert (MIT,
github.com/DietrichGebert/ponytail); "surface assumptions" and "surgical changes" from Andrej
Karpathy's LLM-coding-pitfalls guidance — both remapped to the PalBuilder dialect.*
