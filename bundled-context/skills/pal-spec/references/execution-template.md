# EXECUTION.md template

Copy the clean template at the bottom into `EXECUTION.md`. The notes below tell you how to fill it
— **do not copy the notes into the file.**

## How to fill

**Build plan** — write it before the task table. Dependency order is leaf-first: foundations before
things that use them. Name which tasks are parallel-safe (no shared files) and which are sequential
(task → task, and why). List the risks — e.g. pal_preview never renders console for the agent, so
pair every console VISUAL task with its human-eyeball fallback. If workflow JS is present, the plan
must verify the workflow compiles via pal_test after push (TestConsole.do returns fresh validation,
not a human builder gate). Note natural checkpoints; pal-loop also pauses per SPEC.md `review cadence`.

**Tasks** — one row per task. `spec ref` = which SPEC.md section(s) this task implements (e.g. §5,
§8a); every task names at least one, so pal-review and a resuming session can trace a task back to
its requirement. `success condition` must be behavioral AND tool-checkable. `status` is one of:
`todo | in_progress | done | blocked | needs-frontier | needs-human`.

**Task granularity** — one task = one verify cycle. A page is a task; a workflow action is a task; a
dataset is a task. "Build the site" is not. If the success condition can't be a tool output plus an
exact string/state, split the task. LITE allows coarser tasks but still one verify cycle each.

**Tier marks** — mark honestly:
- `cheap` = mechanical edits from exact copy; cloning an established page.
- `standard` = pages/fragments from copy + §6 layout; workflow actions from §5; schemas; SEO.
- `frontier` = the first composition page; routing; anything where the spec gives direction not
  structure; spec changes.

**Checkpoints** — append one line per completed task. **Blockers** — what needs the human, stated
exactly (this is also where pal-loop writes amendment proposals; see `amendment-path.md` (this directory)).

## Clean template

```markdown
# EXECUTION — <project name>
spec: SPEC.md (status: approved)   mode: full | lite

## Build plan
Dependency order (leaf-first — foundations before things that use them):
1. Foundation — a **standalone first task** that copies matching templates and canonical runtime
   files with bash `cp` (never read-then-write), authors a readable per-project `styles/styles.css`,
   registers the four runtime entries in `pal.json`, and (for console
   pals) establishes the `run()` skeleton from `palbuilder-workflow/references/console.md`, then
   STOPS. Existing pals without `styles.css` are not migrated.
2. FIRST page/screen — establishes composition (frontier tier).
3. Remaining pages — CLONE the first's structure (cheap/standard).
4. Datasets, then the workflows that read them (data before UI).
5. SEO heads, then final audit.
Parallel-safe: <tasks with no shared files>.  Sequential: <task → task, why>.
Risks: <e.g. pal_preview never renders console for the agent — pair every console VISUAL task with
  its human-eyeball fallback in case pal_screenshot can't capture (no Chromium / failed auth replay)>.
[if workflow JS present] verify the workflow compiles via pal_test after push.
Checkpoints: <natural human review points — pal-loop also pauses per SPEC.md `review cadence`>.

## Tasks
| id | task | tier | spec ref | depends | status | success condition (behavioral + tool-checkable) |
| T1 | copy/adapt shell, canonical runtime files, styles.css, and workflow foundation | cheap | §3, §6 | — | todo | Page shell and matching templates are copied with bash `cp`, the four canonical runtime files are present and registered in pal.json, readable `styles/styles.css` and (for console) the documented `run()` skeleton are present; `pal_validate` reports 0 errors and `pal_test` reports VALIDATED on the foundation |
| T2 | first page (composition) | frontier | §4, §6 | T1 | todo | validate 0; push OK; preview "<H1>" |
| T3 | <action with logic> | standard | §5 | T1 | todo | When <input>, <result>; pal_test VALIDATED |

## Checkpoints (append-only, one line per completed task)
## Blockers (what needs the human — be exact)
```
