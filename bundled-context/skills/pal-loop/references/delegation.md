# Delegation protocol (orchestrator → subagents, any harness)

Use this whenever one orchestrator farms EXECUTION.md tasks out to subagents. Written against
capabilities, not tool names, so it holds on Claude Code, OpenCode / Pi.dev, Cursor, or any
harness that can spawn a subagent. The `pal_*` tools are the same everywhere — they are the
substrate, not a harness feature.

## 0. Preconditions — check once before delegating
- **Subagents available?** No → do NOT simulate; run the task inline via the normal task
  cycle. Delegation is an optimization, never a requirement.
- **Per-subagent model selectable?** Yes → map tier→model (cheap→small, standard→mid;
  frontier you handle yourself). No → spawn the default and rely on the task-cycle tier check.
- **Parallel or serial?** Parallel ONLY for tasks the build plan marked parallel-safe AND that
  share no files. Anything touching a shared file (a fragment, `pal.json`, a dataset) is
  serialized. Two subagents that might push at once → `pal_lock` before / `pal_unlock` after,
  or serialize the pushes. Concurrency on shared files is the #1 way a delegated build
  corrupts itself — when in doubt, serialize.

## 1. Governing principles
- **The subagent starts blind.** Zero shared context, zero memory of the spec. Everything it
  needs is in the brief or at an absolute path you tell it to read.
- **One task, bounded.** One EXECUTION.md task per subagent, one verify cycle. It does not
  pick its own work, read other tasks, or expand scope.
- **The orchestrator owns truth.** The subagent's report is a hypothesis you verify with
  tools. A subagent never marks a task `done`.

## 2. The handoff brief — fill EVERY slot
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
   - **pal-restraint, every line:** reuse before building, a `c:`/platform tag before
     hand-rolled markup or JS, the minimum that works within the dialect's limits. No object
     literals in workflow JS. Don't touch, reformat, or "improve" anything outside this task's
     files — a genuinely ambiguous decision goes in the return report, not a guess.
6. **DONE =** — the task's exact success condition (tool output + exact string/state). The
   subagent self-checks against this before returning.
7. **RETURN CONTRACT** — the subagent returns this and only this, condensed to ~1–2K tokens:
   - files changed (absolute paths)
   - traceability table: spec item | shipped value | match (y/n)
   - deviations line: "Deviations: none" or each deviation + reason
   - the success-condition self-check it ran, with the key tool-output line(s) — never raw
     tool dumps or file dumps.

## 3. After the subagent returns — every time, no exceptions
1. **Re-verify independently — never trust the report.** Run the task's tools yourself:
   - `pal_validate` before push; read push output for the stray-file warning.
   - Web → `pal_fetch` each touched page with `expect:[the promised strings/H1/CSS class]`.
     Not found in served HTML = it didn't ship.
   - Console → `pal_screenshot` (check `renderError`); `captured:false` → the human-eyeball
     gate, never an assumed pass.
2. **Pass** → mark `done`, checkpoint, commit. **Fail or over-claim** → restore the good
   state: `git checkout` the subagent's local changes. Already pushed? Re-push the restored
   local to overwrite the server (`pal_pull`/`pal_merge` first if drift-refused) — git fixes
   only local. Then re-dispatch ONCE with the failure named in the brief, or escalate
   (`needs-frontier`, `blocked`, `needs-human`). Two failed dispatches on one task = stop
   delegating it; do it yourself or block it.
3. **Never let a subagent's "done" stand without your tool verification.** Subagents have
   over-claimed in practice — reporting elements absent from the served HTML, marking tasks
   done with verification unrun. That one rule makes delegation safe on every harness.
