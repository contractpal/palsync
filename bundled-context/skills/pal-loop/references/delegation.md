# Delegation protocol (orchestrator → subagents, any harness)

Use this whenever one orchestrator farms tasks out to subagents. It is written against
**capabilities, not tool names**, so it holds on Claude Code, OpenCode / Pi.dev, Cursor, or any
harness that can spawn a subagent. Goal: the same handoff produces the same result every time,
whichever harness or model is underneath. (The palsync `pal_*` tools are the same everywhere —
they are the substrate, not a harness feature.)

## 0. Preconditions — check once before delegating
- **Subagents available?** If the harness cannot spawn one, do NOT simulate it — run the task
  inline via the normal task cycle. Delegation is an optimization, never a requirement.
- **Per-subagent model selectable?** If yes, map tier→model (cheap→small, standard→mid; frontier
  you handle yourself). If no, spawn the default and rely on the task-cycle tier check.
- **Parallel or serial?** Dispatch in parallel ONLY tasks the build plan marked parallel-safe
  AND that share no files. Anything touching a shared file (a fragment, `pal.json`, a dataset) is
  serialized. If two subagents might push at once, `pal_lock` before / `pal_unlock` after, or
  serialize the pushes. Concurrency on shared files is the #1 way a delegated build corrupts
  itself — when in doubt, serialize.

## 1. Governing principles
- **The subagent starts blind.** Assume zero shared context and zero memory of the spec. Every
  thing it needs is in the brief or at an absolute path you tell it to read. A reference it can't
  resolve is a guess you didn't want.
- **One task, bounded.** One EXECUTION.md task per subagent, one verify cycle. It does not pick
  its own work, read other tasks, or expand scope.
- **The orchestrator owns truth.** The subagent's report is a hypothesis you verify with tools.
  A subagent is never the thing that marks a task `done`.

## 2. The handoff brief — fill EVERY slot (same template, every harness)
A brief with an empty slot is invalid. Do not dispatch it.

1. **TASK** — the single task id + one-line goal. Nothing beyond it.
2. **MANDATORY READS (absolute paths, in order)** — SPEC.md; DESIGN_SYSTEM.md + COMPONENTS.md;
   then the sibling file(s) to clone from. Read before writing anything.
3. **COPY IS LAW** — approved copy from SPEC.md §4, quoted verbatim or pointed at by exact
   section. Ships verbatim: no paraphrase, no "improvement."
4. **CLONE TARGET** — the exact existing file whose markup/structure to copy. Point, don't
   describe. No clone target usually means the task is frontier — reconsider delegating it.
5. **HARD RULES** (verbatim, every time):
   - XHTML: all void tags self-closed
   - ASCII only — no named entities except `&amp;` `&lt;` `&gt;` `&quot;` `&apos;`
   - No `<script>` inside fragments
   - `pal.json` entry required for every new file
   - Existing CSS classes only — never invent class names
   - Touch ONLY the files this task names — never the §11 NEVER-list, never a §8b consumed dataset
   - **pal-restraint, every line:** reuse before building, a `c:`/platform tag before hand-rolled
     markup or JS, the minimum that works within the dialect's limits. No object literals in
     workflow JS. Don't touch, reformat, or "improve" anything outside this task's files — if a
     decision is genuinely ambiguous, say so in the return report instead of guessing.
6. **DONE =** — the task's exact success condition (tool output + exact string/state). The
   subagent self-checks against this before returning.
7. **RETURN CONTRACT** — the subagent returns this and only this, CONDENSED to roughly 1–2K
   tokens:
   - files changed (absolute paths)
   - traceability table: spec item | shipped value | match (y/n)
   - deviations line: "Deviations: none" or each deviation + reason
   - the success-condition self-check it ran, with the key tool-output line(s) — not the raw
     tool output or a file dump. A verbose return repollutes the orchestrator's context with the
     subagent's own working detail instead of the result it was asked for.

## 3. After the subagent returns — every time, no exceptions
1. **Re-verify independently** — never trust the report. Run the task's tools yourself
   (`pal_validate`, `pal_test`; web → `pal_fetch` + grep the served HTML for the expected
   strings; console → `pal_screenshot` if it captures, else the §12 human-eyeball gate). See
   "Verify independently" below.
2. **Pass** → mark `done`, checkpoint, commit. **Fail or over-claim** → restore the good state:
   `git checkout` the subagent's local changes (clean slate beats half-applied). If the subagent
   had already pushed, re-push the restored local to overwrite the server (`pal_pull`/`pal_merge`
   first if drift-refused) — git checkout fixes only local; see "git here is a LOCAL
   checkpoint" under On fail in SKILL.md for the full recovery path. Then either re-dispatch ONCE
   with the failure named in the brief, or escalate (`needs-frontier`, `blocked`, or
   `needs-human`). Two failed dispatches on one task = stop delegating it; do it yourself or
   block it.
3. **Never** let a subagent's "done" stand without your tool verification. That one rule is what
   makes delegation safe across every harness.

---

## Verify independently (non-negotiable)

Never accept a subagent's self-report as truth. After every push:

- `pal_fetch` each touched **web** page and grep the served HTML for the expected H1, heading,
  or CSS class. Not in the fetched HTML = it didn't ship. (Console renders aren't fetchable this
  way — try `pal_screenshot` instead; only fall back to the §12 human-eyeball gate if it returns
  `captured:false`.)
- `pal_validate` before push; read push output for the stray-file warning.
- Open the preview for the human at every pause regardless — `pal_screenshot` gives the agent a
  real check, but final design taste/sign-off on the live product is still the human's call.

**Why:** subagents have over-claimed in practice — reporting elements absent from the served
HTML, misreading pages, marking tasks done when verification wasn't run. The orchestrator owns
truth; the subagent's self-report is a hypothesis, not a result.
