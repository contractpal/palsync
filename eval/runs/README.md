# eval/runs/ — benchmark workspaces (ephemeral, gitignored)

**This whole directory is gitignored** except this README. It is regenerated from the frozen
specs by [`../setup-runs.sh`](../setup-runs.sh). Build artifacts and pulled pal state live here and
are throwaway — never commit them. The source of truth is [`../specs/`](../specs/) (frozen); the
protocol is [`../run.md`](../run.md); scoring is [`../scoring.md`](../scoring.md).

## Layout after staging

```
eval/runs/
  DESIGN_SYSTEM.md      # shared — specs reference ../DESIGN_SYSTEM.md
  COMPONENTS.md         # shared
  01_crud_frontier/     SPEC.md  EXECUTION.md  (+ pulled pal files after --setup)
  01_crud_cheap/        ...
  02_dirstruct_frontier/  02_dirstruct_cheap/
  03_console_frontier/    03_console_cheap/
```

6 workspaces = 3 scenarios × {frontier, cheap}. A workspace is dirtied by its build and cannot be
reused, so each model tier gets its own empty pal.

## How to run a test

1. **Stage** (offline): `./eval/setup-runs.sh` — creates the 6 folders with specs + design files.
2. **Create empty pals**: in PalBuilder, make one empty pal per row in [`../runs.map`](../runs.map).
3. **Setup** (pulls + injects skills): `CP_USER=you@x.com CP_PASS=... ./eval/setup-runs.sh --setup`.
4. **Set the `pal:` URL** in each folder's `SPEC.md` (replace the `<WORKSPACE …>` placeholder).
5. **Launch** the folder in your harness, on the tier's model, **auto mode, zero intervention**:
   - frontier folders → a frontier model (`claude-sonnet-5` / `claude-opus-4-8`)
   - cheap folders → a cheap model (`claude-haiku-4-5` / `deepseek` / `glm`)
   - MCP: `PALSYNC_WORKSPACE=<abs path to folder> palsync-mcp` (see ../../HEADLESS.md §3).
6. **Score** with `../scoring.md`; **log** the row (incl. the cost block) to `../RESULTS.md`.

Baseline runs use current-branch (main) skills — the orch-skills version is whatever
`setup-runs.sh --setup` injected. Record it per `../run.md` §1.
