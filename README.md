# palsync

**One command to edit your CloudPiston PalBuilder pal with an AI coding agent.**

palsync logs you into CloudPiston, pulls your pal to disk, **locks it**, injects PalBuilder coding
skills, and opens **Claude Code** (or Codex / Pi / OpenCode) already wired to push and pull through
an MCP server. You talk to the agent; it writes valid PalBuilder code and syncs your changes — with
auto-locking and drift protection so you never silently clobber someone else's work.

- 🔐 **Login once** — credentials in your OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service), never in env vars, config, or git.
- ⬇️ **Pull + lock automatically** — the lock releases on exit or idle, and is reclaimed after a crash.
- 🧠 **PalBuilder skills auto-injected** — the agent writes correct `c:` tags, fragments, and workflows.
- ⬆️ **Push from the conversation** — validation runs first; a drift guard refuses to overwrite newer server changes.
- 🤖 **Any agent, any model** — Claude Code, Codex, Pi, OpenCode, or any MCP client; runs headless for autonomous agents (see [HEADLESS.md](./HEADLESS.md)).
- 🖥️ **Cross-platform** — macOS, Windows, Linux.

> palsync is a **substrate, not an agent runtime**: it gives any agent correct PalBuilder behavior
> and safe sync. You pick the runtime and the model.

## Quick start

**Prerequisites:** [Node.js 18+](https://nodejs.org/) and a CloudPiston login. Claude Code is
auto-installed on a yes/no prompt if missing.

```sh
npm install -g https://codeload.github.com/contractpal/palsync/tar.gz/refs/heads/main --ignore-scripts --include=optional
node "$(npm root -g)/palsync/src/install/playwrightChromium.js"   # fetch Chromium (screenshots/exercise)
```

<details>
<summary>On Windows Command Prompt (cmd.exe)? Use this second line instead</summary>

```cmd
for /f %i in ('npm root -g') do node "%i\palsync\src\install\playwrightChromium.js"
```
</details>

Then run it:

```sh
palsync
```

1. **Pick your cloud** (or enter a custom URL).
2. **Log in** — saved to your OS keychain; next run skips the prompt.
3. **Pick your pal** — profile → group → pal.
4. palsync **pulls + locks** the pal, injects the skills, and **opens the agent** in the workspace.

Now just talk to the agent. Ask for a change, then say *"push it."*

**Updating:**

```sh
palsync upgrade          # reinstall from the latest commit (no-op if current)
palsync upgrade --check  # report whether an update exists
palsync --version        # confirm the build
```

Install trouble? See [Troubleshooting](#troubleshooting).

The setup wizard also asks which coding agent to launch — Claude Code (default), Codex, Pi, or
OpenCode. You can skip the question with `--agent <name>`. A workspace carries files for exactly
one agent at a time; switching agents swaps the palsync-owned files cleanly (your own notes in
`CLAUDE.md`/`AGENTS.md` survive).

| Flag | What it does |
|------|--------------|
| `--version`, `-v` | Print the build version and exit. |
| `--agent <name>` | Coding agent: `claude` (default), `codex`, `pi`, or `opencode`. |
| `--eval [spec]` | Benchmark-harness mode (non-interactive eval runs). |
| `--help`, `-h` | Usage help. |

## What the agent can do (MCP tools)

The agent calls these for you — you never run them by hand:

| Tool | What it does |
|------|--------------|
| `pal_validate` | Offline code check — PalBuilder breakers + cross-file contract mismatches, with file:line and the exact fix. Runs automatically inside `pal_push`. |
| `pal_push` | Validate, then push. Refuses if the server advanced since your last pull (drift) unless forced. |
| `pal_pull` | Sync from the server. Preserves new un-pushed local files; refuses (naming files) rather than overwrite un-pushed edits. |
| `pal_merge` | 3-way merge of local + server changes. Keeps both where they don't collide; conflicts stay yours with theirs saved as `<file>.server`. |
| `pal_test` | The server's own fresh workflow compile check (the save API's result is cached and can lie). Browser preview is opt-in (`preview:true`) for human review only. |
| `pal_testing` | Toggle automated runtime/self-tests for the session (validation stays on). |
| `pal_tunnel_test` | Call a tunnel workflow as a real web service and return its JSON; short-lived credentials minted and refreshed automatically. |
| `pal_debug` | Retrieve server-side `c.debug(...)` output. Debugs are also attached automatically to tunnel/fetch/preview/screenshot results. |
| `pal_preview` | Render the pal back to the agent — server-rendered HTML for web pals; `open:true` only at a human-review stop. |
| `pal_fetch` | Fetch a rendered page/endpoint for the agent to read. |
| `pal_screenshot` | Screenshot the rendered pal (Chromium) so the agent can see its own UI. |
| `pal_exercise` | Drive the rendered pal in a browser to exercise a user flow. |
| `pal_seo_audit` | On-page SEO audit of a web pal — title/description, canonical, `og:` tags, JSON-LD, H1, img alt, … Every finding carries the exact fix. |
| `pal_sync_datasets` | Create/update dataset tables from `pal.json`. Never deletes data by default; destructive `recreate` requires an exact typed confirmation. |
| `pal_regression` | Capture / compare a regression baseline. |
| `pal_spec_lint` | Lint a `SPEC.md` for the spec-to-ship workflow. |
| `pal_status` | Server drift + un-pushed local changes + lock holder. |
| `pal_lock` / `pal_unlock` | Acquire / release the pal lock. Auto-reclaims your own stale lock; never breaks another user's. |

## Headless CLI (no MCP server, no agent)

The same sync engine is available directly — it reads `.palsync.json` from the workspace and
authenticates from your OS keychain. Full reference and autonomous-agent setups:
**[HEADLESS.md](./HEADLESS.md)**.

```sh
palsync validate        # offline code check — no login needed
palsync push            # validate, then push; releases the lock (--keep-lock to hold)
palsync pull            # sync from server (refuses to overwrite un-pushed edits; --force overrides)
palsync merge           # 3-way merge local + server changes
palsync status          # server drift + un-pushed changes + lock holder
palsync test            # server-side workflow validation (--preview for human review)
palsync preview         # render the pal (web: prints HTML; console: interactive terminal)
palsync open            # open the rendered pal in a real browser
palsync fetch           # fetch a rendered page/endpoint
palsync screenshot      # screenshot the rendered pal
palsync exercise        # drive a user flow in a browser
palsync seo-audit       # on-page SEO audit of a web pal
palsync sync-datasets   # provision dataset tables from pal.json (safe by default)
palsync regression      # capture/compare a regression baseline
palsync spec-lint       # lint SPEC.md
palsync task            # spec-to-ship task operations
palsync checkpoint      # spec-to-ship checkpointing
palsync cost            # palsync's own context footprint (offline; see below)
palsync ctx inspect     # stable-prefix sizes and largest generated sections
palsync ctx diff        # first section changed since the previous generation
palsync setup           # non-interactive workspace creation
palsync upgrade         # self-update from the latest commit
```

All take `--dir <workspace>` (default: current directory). Semantics are identical to the MCP tools
— same drift guards, same preserve-on-pull.

### `palsync cost` — context observability

palsync can't see provider cache state or model billing, so `palsync cost` reports local facts:
raw/returned response bytes, condensation ratio, largest response, duration, lint-cache hit rate,
and the generated context manifest. `palsync ctx inspect|diff` explains the locally stable
prefix and its first changed section. Provider-reported cached tokens from a harness sidecar stay
separate from local estimates. Set `PALSYNC_NO_CACHE=1` to bypass the content-addressed per-file
lint cache; push-gate decisions, server state, drift, locks, and runtime results are never cached.

## Sync safety

- **Pull is a sync, not a wipe.** New un-pushed files are preserved with their `pal.json` entries; a local file is deleted only when the server actually deleted it.
- **Pull refuses rather than overwrites.** Un-pushed local edits to server-tracked files make pull refuse and name the files.
- **The launcher checks too.** Re-running `palsync` into a workspace with un-pushed changes prompts: push first (recommended), merge, pull anyway, skip, or quit — never a silent overwrite.
- **The MCP server never exits on its own.** Idle releases only the pal lock (a courtesy to teammates); the next tool call re-locks.

## Bundled skills

Every skill is injected on every setup — they cost no context until the agent opens one.

**PalBuilder coding:** `palbuilder-core`, `palbuilder-frontend`, `palbuilder-workflow`,
`palbuilder-data`, `palbuilder-realtime`, `palbuilder-email`, `palbuilder-seo` — markup, workflow
JS, data access, background jobs, WebSockets, email, and SEO done right.

**Design:** `design-system-init` (interview + reference images → `DESIGN_SYSTEM.md` +
`COMPONENTS.md`) and `design-build` (enforce that system while building UI, with a
render-and-critique review gate).

**Spec-to-ship (autonomous builds):**

1. **`pal-spec`** interviews you and writes `SPEC.md` (real copy, real schemas, tool-checkable acceptance criteria) plus `EXECUTION.md`, a task list with per-task model tiers.
2. **`pal-loop`** executes it: one task → verify with the palsync tools → checkpoint → git commit → next. Any new session resumes from `EXECUTION.md`; blocked tasks escalate with the exact decision needed. Write-the-least-code restraint applies by default.
3. **`pal-init`** onboards an *existing* pal first — maps it into `MAP.md`, captures a regression baseline — then hands off to `pal-spec`.
4. **`pal-review`** checks the finished build against the spec in a fresh context and returns a verdict + fix tasks.
5. **`pal-fix`** handles bugs without the full spec ceremony: reproduce → minimal diff → verify → regression-check.

Say *"spec out \<what you want\>"* to start, *"run the loop"* to execute, *"fix \<what's broken\>"*
for a correction. Deep detail lives in each skill's `references/*.md`, loaded on demand.

## Limitations

The agent can **edit any existing file of any type**, and **create** pages, fragments, scripts,
workflows, emails, images, styles, attachments, wizards, and datasets (via `pal_sync_datasets`).
The only things it can't create — the server rejects them on push — are **documents, fonts, and
dataviews/data/datalists**: make those in PalBuilder first, then palsync edits them normally.

## Troubleshooting

<details>
<summary><code>palsync --version</code> shows an old version after install</summary>

You have more than one Node installation (e.g. Homebrew node *and* nvm), each with its own global
npm prefix. `npm install -g` writes to the prefix of whichever `npm` ran, but your PATH may resolve
`palsync` from a different prefix. Diagnose:

```sh
which -a palsync                  # any line OTHER than the first is shadowed
grep version "$(npm root -g)/palsync/package.json"   # what npm just wrote
```

Fix: run the install command with the npm that owns the winning bin, e.g.
`/opt/homebrew/bin/npm install -g https://codeload.github.com/contractpal/palsync/tar.gz/refs/heads/main --ignore-scripts --include=optional`
— or uninstall the stale copy first.
</details>

<details>
<summary>Install fails with <code>ESTRICTALLOWSCRIPTS</code> (npm 11 allow-scripts)</summary>

npm 11's `strict-allow-scripts` can abort installs that run lifecycle scripts. The Quick-start
command already avoids this (installs with scripts off, then fetches Chromium separately), and so
does `palsync upgrade` on 0.27.0+. Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` before the Chromium
step to skip the download.
</details>

<details>
<summary>Why the tarball URL instead of <code>npm install -g github:contractpal/palsync</code>?</summary>

The git shorthand makes npm clone into a temporary prep directory and run the postinstall *there*,
which can fail (unsettled module resolution, Windows file locking, npm 11 script gates) and abort
the whole install with `git dep preparation failed`. The tarball URL writes the package straight to
its final location. `palsync upgrade` uses the same mechanism, pinned to an immutable commit SHA.
Force a clean reinstall by adding `--force` to the install command.
</details>

<details>
<summary>Headless Linux credential storage</summary>

A Secret Service provider (e.g. <code>gnome-keyring</code>) must be available for keychain storage —
see <a href="./HEADLESS.md">HEADLESS.md</a>.
</details>

## License

MIT — see [LICENSE](./LICENSE).
