# palsync

**One command to edit your CloudPiston PalBuilder pal with Claude Code.**

`palsync` is a terminal launcher that logs you into CloudPiston, lets you pick a pal, pulls it to
disk, **locks it**, injects the PalBuilder coding skills, and opens **Claude Code** already wired to
push and pull your pal through an MCP server. Then you just talk to Claude — it writes valid
PalBuilder code and syncs your changes, with **auto-locking** and **drift protection** so you never
silently clobber someone else's work.

- 🔐 **Login once** — credentials in your OS keychain on desktop; `CP_PASS` env var on headless boxes.
- ⬇️ **Pull + lock** your pal automatically; the lock is released on exit, idle, or reclaimed after a crash.
- 🧠 **PalBuilder skills auto-injected** so Claude writes correct `c:` tags, fragments, and workflows.
- ⬆️ **Push from the conversation** — with a drift guard that refuses to overwrite newer server changes.
- 🤖 **Works with any agent** — Claude Code, Codex, OpenCode, Hermes, or any MCP client; runs headless for autonomous agents. See **[HEADLESS.md](./HEADLESS.md)**.
- 🖥️ **Cross-platform** — macOS, Windows, Linux.

> **palsync is a substrate, not an agent runtime.** It gives any agent correct PalBuilder behavior
> and safe sync; you pick the runtime and the model (Claude, gpt-5.5, DeepSeek, Qwen, local). It
> builds no model router — model-agnostic and cheap-model support come from your harness. For
> headless/autonomous setups (e.g. an always-on agent box) and connecting non-Claude harnesses, see
> **[HEADLESS.md](./HEADLESS.md)**.

## Install / Update

```sh
npm install -g github:contractpal/palsync
```

That command installs the global `palsync` command (plus `palsync-mcp`, which the agent launches
automatically, and `palpush`, a headless deploy CLI). **No build step** — the OS-keychain dependency
ships prebuilt.

**To update, run `palsync upgrade`** — it checks the tip of the repo's default branch and, if your
build differs, reinstalls from that exact commit:

```sh
palsync upgrade          # update to the latest commit (no-op if already current)
palsync upgrade --check  # report whether an update exists, without installing
```

Why a subcommand and not a plain reinstall: `npm install -g github:<repo>` re-uses npm's **cached**
resolution of the default branch, so a plain reinstall often silently keeps the old build. `palsync
upgrade` installs the immutable commit SHA (`github:…#<sha>`) — a ref npm hasn't cached — so the
update always lands, and it always tracks the latest code (no release tagging required). Confirm the
build you ended up with:

```sh
palsync --version
```

If you ever need to force a clean reinstall by hand, `--force` bypasses npm's cache:

```sh
npm install -g github:contractpal/palsync --force
```

### `palsync --version` shows an old version after install

You have **more than one Node installation** (e.g. Homebrew node *and* nvm/Hermes node), each with
its own global `npm` prefix. `npm install -g` writes to *the prefix of whichever `npm` ran* — but
your shell's PATH may resolve the `palsync` shim from a **different** prefix, so it keeps running an
older copy. Diagnose:

```sh
which -a palsync                  # any line OTHER than the first is shadowed
cat "$(npm root -g)/palsync/package.json" | grep version   # what npm just wrote
```

Fix by installing with the npm tied to the bin that actually wins:

```sh
"$(dirname "$(which palsync)")/../lib/node_modules/.bin/npm" install -g github:contractpal/palsync
# or, plainly: invoke the matching npm directly, e.g.
/opt/homebrew/bin/npm install -g github:contractpal/palsync   # for Homebrew node
```

Or uninstall the stale copy first (run the *winning* npm), then reinstall normally.

## Prerequisites

- **Node.js 18 or newer is required up front** — install it first from https://nodejs.org/ (or your version manager). palsync runs on Node, so it can't install or upgrade Node for you: if your Node is too old it shows the exact upgrade command for your setup (nvm/fnm/volta/Homebrew) but **never changes your Node version automatically** — that's yours to run, since it can affect your other projects.
- **Claude Code** — if it's not installed, palsync offers to install it for you (`npm install -g @anthropic-ai/claude-code`) on a yes/no prompt; or install it yourself (docs: https://docs.claude.com/en/docs/claude-code).
- **A CloudPiston login** (username + password) for your cloud.

palsync checks both at startup: it guides you to upgrade Node if needed, and offers to auto-install Claude Code.

## First run

```sh
palsync
```

1. **Pick your cloud** (e.g. Cloudpiston) — or enter a custom URL.
2. **Log in** — validated against the server and saved to your OS keychain; the next run skips the prompt.
3. **Pick your pal** — navigate **profile → group → pal**.
4. palsync **pulls + locks** the pal, injects `CLAUDE.md` + the PalBuilder skills, and **opens Claude Code** in the workspace.

Now talk to Claude. Ask for a change, then say *"push it."*

## Flags

| Flag | Alias | What it does |
|------|-------|--------------|
| `--version` | `-v` | Print the palsync build version and exit. |
| `--agent <name>` | | Choose the coding agent: `claude` (default), `codex`, `pi`, or `opencode`. |

Every bundled skill (including **`seo-core`** — the page-head recipe, the absolute-og-URL and non-ASCII-attribute traps, JSON-LD, and the `pal_seo_audit` verify loop) is injected on every setup. Skills cost no context until the agent opens one, so there is no flag to gate them.

## Headless subcommands (no MCP server, no agent)

If a session ends before a push (or you just prefer the terminal), the same sync engine is
available directly — it reads `.palsync.json` from the workspace and authenticates from your
OS keychain:

```sh
palsync validate # offline code check — no login needed (workflow JS + markup rules)
palsync push     # validate, then push; releases the lock after (--keep-lock to hold it)
palsync pull     # sync from the server (refuses to overwrite un-pushed edits; --force overrides)
palsync merge    # 3-way merge local + server changes (keeps both where they don't collide)
palsync status   # server drift + un-pushed local changes (per file) + lock holder
palsync test     # server-side workflow validation + live preview in your browser
palsync seo-audit # on-page SEO audit of a WEB pal's rendered page
palsync preview  # render the pal (web: prints the HTML; console: opens a browser)
palsync sync-datasets  # provision dataset tables from pal.json (safe by default)
palsync scaffold --template <name>  # apply a starter template (offline; --list shows them)
palsync cost     # palsync's own context contribution (offline) — see below
```

All take `--dir <workspace>` (default: current directory). Semantics are identical to the MCP
tools — same drift guards, same preserve-on-pull, same uncreatable-type backstop.

### `palsync cost` — context contribution (observability)

palsync can't see the model's token billing, so `palsync cost` reports the **honest proxy**: its
own footprint. Two parts:

- **Tool calls this session** — how many MCP tools ran and how many bytes their results returned to
  the agent's context, per tool. The MCP server records this live in `.palsync.usage.json` (keyed by
  the server PID, so each session starts a fresh count). It's also printed to stderr at session end.
- **Injected context block** — the size of what palsync loads up front every session:
  `CLAUDE.palsync.md` + the always-on skill **descriptions** (the only always-loaded part — skill
  *bodies* and `references/*.md` load on demand and are **not** counted) + the tool definitions.

These are **measured bytes, not estimated tokens, and not model spend** — they're palsync's own
contribution to context, the number to watch when trimming skills or tool descriptions.

The injected block also prints a **soft-threshold flag** (40 KB) — `within soft threshold` or
`ABOVE SOFT THRESHOLD`. It's not a hard limit (palsync still can't see the model's actual context
window); it's a tripwire sized off the current real total (~30 KB) that says "this has grown,
go trim a skill or tool description" once it's crossed.

## Sync safety (what protects your work)

- **Pull is a sync, not a wipe.** New un-pushed files inside the manifest folders are
  **preserved** and their `pal.json` entries carried forward, so the next push still ships them.
  A local file is deleted only when the server actually deleted it.
- **Pull refuses rather than overwrites.** If server-tracked files have un-pushed local edits,
  pull refuses and names the files (push first, or force to discard).
- **The launcher checks too.** Re-running `palsync` into a workspace with un-pushed changes
  prompts: push first (recommended), **merge** (combine both sides), pull anyway, skip, or quit —
  never a silent overwrite. If local *and* server both changed, merge keeps both wherever they
  don't collide and flags the rest.
- **The MCP server never exits on its own.** Idle releases only the pal lock (a courtesy to
  teammates); the next tool call re-locks. The server lives exactly as long as Claude Code does.

The PalBuilder coding skills (`palbuilder-frontend`, `palbuilder-backend`, and `palbuilder-jobs-http`
— background Jobs, server-side HTTP, JSON parsing and long-running work, with a self-polling progress
UI) are **always** injected, and so are the **design skills**: `design-system-init` (interview the user + reference images into a
project `DESIGN_SYSTEM.md` + `COMPONENTS.md`) and `design-build` (enforce that system while building
UI, with a render-and-critique review gate). They cost no context until the agent opens them, so they
ride along every session — reach for them on any UI work.

## Spec-to-ship workflow (autonomous builds)

Always-injected skills turn a description into a built pal:

1. **`pal-spec`** interviews you (10–15 questions, proposes answers from existing material) and
   writes `SPEC.md` — real copy, real tokens, real schemas, tool-checkable acceptance criteria —
   plus `EXECUTION.md`, a task list with per-task model tiers and success conditions.
2. **`pal-loop`** executes it: one task → verify with the palsync tools (validate → push →
   preview → seo-audit) → checkpoint to disk → git commit → next. Blocked tasks escalate with
   the exact decision needed. Any new session resumes from `EXECUTION.md` — state never lives
   only in context. The loop never deploys (standing policy), never invents content, and treats a
   build as done only once every touched workflow is `pal_test` VALIDATED and pal-review returns PASS.
3. **`pal-init`** onboards an *existing* pal first — maps it into `MAP.md`, captures a regression
   baseline, scopes the change — then hands off to `pal-spec`.
4. **`pal-review`** checks the finished build against the spec in a **fresh context** (never the
   session that wrote it) and returns a verdict + fix tasks.
5. **`pal-fix`** handles bugs and small corrections *without* the full spec ceremony — reproduce
   with a tool → minimal diff → verify → regression-check — and escalates to pal-init/pal-spec the
   moment a change adds new pages, datasets, or behavior.

`pal-restraint` (write the least code that works) applies by default on every pal-coding task.
Say "spec out <what you want>" to start, "run the loop" / "resume the build" to execute, "fix
<what's broken>" for a correction.

Each skill's deep detail lives in its own `references/*.md`, loaded on demand. Rules several skills
share live **once** in the owning skill's `references/` and are pointed at by relative path — e.g.
console-render verification under `pal-review/references/`, the amendment protocol and the spec /
execution / reality-check material under `pal-spec/references/`, vision routing under
`design-system-init/references/` (there is no separate `shared/` skill dir — a skill dir must carry
a `SKILL.md` to be injected).

## Template starters

Start a new pal from a correct, designed, SEO-sound skeleton instead of a blank page:

```sh
palsync scaffold --list                              # see the available templates
palsync setup --pal "My New Pal" --template web-marketing
palsync scaffold --template console-app --dir <ws>   # or apply to an existing workspace
```

- **`web-marketing`** (web pal) — SEO-complete page shell (the audited head recipe), navbar/hero/
  footer fragments, Editorial Warmth design tokens, scroll-reveal, `web.js` routing skeleton.
- **`console-app`** (console pal) — console shell (`cp-root` + navbar + swappable `${frag}` slot),
  dashboard fragment with stat cards and a designed empty state, `run()` workflow skeleton.

Starters never overwrite existing files, substitute the pal's name into the placeholders, and pass
`palsync validate` with zero findings out of the box. **Workflows** are created like any other file —
the starter ships a `run()` skeleton with the right `workflowType` (derived from the pal type), and
push provisions it.

### Choosing an agent

palsync defaults to **Claude Code**. Pass `--agent codex`, `--agent pi`, or `--agent opencode` to use
**Codex**, **Pi**, or **OpenCode** instead:

```sh
palsync                    # Claude Code (default): skills → .claude/skills/, instructions → CLAUDE.md
palsync --agent codex      # Codex: skills → .agents/skills/ + AGENTS.md, MCP via `codex mcp add`, launches codex
palsync --agent pi         # Pi: skills → .agents/skills/ + AGENTS.md (CLI flavor — no MCP), launches pi
palsync --agent opencode   # OpenCode: skills → .agents/skills/ + AGENTS.md, MCP via opencode.json, launches opencode
```

A workspace carries files for exactly ONE agent at a time — the one it was last launched with.
Switching `--agent` on an existing workspace prunes the previous agent's palsync-owned files
(`.claude/skills/` + `CLAUDE.palsync.md` vs `.agents/skills/` + `AGENTS.md`) and writes the new
agent's, so nothing stale lingers; any of your own notes in `CLAUDE.md`/`AGENTS.md` outside the
managed block always survive.

With `--agent codex` or `--agent opencode`, palsync writes the skills to the cross-agent **Agent
Skills** open standard (`.agents/skills/<name>/SKILL.md` + companion assets) and an `AGENTS.md`
instruction file in the **MCP flavor** (both agents get a real MCP server registered). Codex is
registered via `codex mcp add` (Codex owns its `~/.codex/config.toml`); OpenCode is registered by
writing a project-scoped `opencode.json` (which OpenCode auto-discovers, the same way Claude Code
auto-discovers `.mcp.json`). If the agent's CLI isn't installed, palsync still prepares the
workspace and prints the exact manual registration + launch commands rather than failing.

With `--agent pi`, palsync writes the same `.agents/skills/` + `AGENTS.md`, but in the **CLI
flavor** (it tells Pi to drive sync through `palsync push|pull|validate|…`) because Pi has **no
MCP server** — there's nothing to register, and `pi` is launched in the workspace.

## MCP tools (Claude calls these for you)

| Tool | What it does |
|------|--------------|
| `pal_validate` | **Offline code check** — flags the PalBuilder breakers (object literals/`let`/`const` in workflows, unclosed void tags, undocumented `c:` attributes, `${}` in inline scripts, …) with file:line and the exact fix. Runs automatically inside `pal_push`. |
| `pal_push` | **Validates first** (refuses on errors unless `skipValidation`), then pushes. Refuses if the server advanced since your last pull (drift) unless forced. |
| `pal_pull` | Sync the pal from the server. Preserves new un-pushed local files; refuses (naming files) if it would overwrite un-pushed edits. |
| `pal_merge` | **3-way merge** of your un-pushed local changes with the server's changes. Keeps both wherever they don't collide; a file changed on both sides stays yours with theirs saved as `<file>.server`. Never overwrites your work silently. |
| `pal_test` | Run the server's own workflow validation and open a **live preview** in your browser (the agent never sees the credential-bearing URL). |
| `pal_preview` | **Render the pal and return it to the agent.** For a **web** pal, fetches the server-rendered HTML so Claude can read its own output; for a **console** pal, opens it in your browser (the agent can't see it). |
| `pal_seo_audit` | **On-page SEO audit of a web pal's rendered page** — title/description lengths, canonical, the 5 `og:` tags with absolute `og:image`/`og:url`, twitter:card, one H1, viewport, JSON-LD, img alt, non-ASCII attribute values. Every finding carries the exact fix; passing checks are listed too. |
| `pal_sync_datasets` | **Create/update dataset tables** from `pal.json` definitions. Safe by default (never deletes data); the destructive `recreate` path requires an exact typed confirmation. |
| `pal_status` | Is the server newer than your last pull? Any un-pushed local changes? Who holds the lock? |
| `pal_lock` | Acquire the lock (auto-reclaims your own stale lock). |
| `pal_unlock` | Release the lock (never breaks another user's). |

### `pal_test` — validation + live preview

PalBuilder's save API returns **cached** workflow validation, so a workflow can push
"successfully" yet fail to compile in the builder. `pal_test` runs the builder's real
`Test<Console|Web|Pal>.do` and returns the **fresh** compile result to the agent, then opens a
live preview of the pal in your default browser. The preview URL carries your credentials, so
it is opened **locally and never shown** to the agent or written to any log. (A console pal
renders inside the CloudPiston console shell; a web pal renders directly.) Available headless
too: `palsync test [--workflow console|web|transaction] [--no-preview]`.

## Limitations

palsync syncs a pal's **code files**. **palsync can EDIT any existing file of any type** — the limits
below are about **creating** new ones. (All confirmed by testing against a live pal.)

**Create from Claude Code** (Claude writes the file + adds the manifest entry):

| Type | Notes |
|------|-------|
| Pages, Fragments, Scripts | you'll be asked **console or web** (sets `palType`) |
| Workflows | you'll be asked the **type** (sets `workflowType`: web=9, console=7, library=4, transaction=2, …) |
| Emails, Images, Styles, Attachments | no extra metadata needed |

**Create in PalBuilder first** — these are **PalBuilder-only** to create (the server rejects creating
them via push, and the rejection fails the whole push). **Once they exist, palsync edits them normally:**

| Type | Why |
|------|-----|
| Documents | require a description and valid XML content; a plain file is rejected |
| Fonts | font creation is rejected |
| Dataviews, data, datalists | provisioned in PalBuilder; palsync preserves them on pull/push but never creates or deletes them |

If Claude is asked to create one of the PalBuilder-only types, it will tell you to make it in PalBuilder first.
A safety guard in push also excludes any stray new file of an uncreatable type (and any new workflow
missing its `workflowType`) so it can't sink a push.

**Datasets are the exception — palsync CAN create and update them** via `pal_sync_datasets`: define the
schema in `datasets/<name>.json` + a `pal.json` entry, then sync to provision the table. A normal sync
never deletes data; the destructive `recreate` (drop + rebuild) requires an exact typed confirmation.

## Notes

- **Credentials** live only in your OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service) — never in env vars, config, git, or pal files.
- On headless Linux, a Secret Service provider (e.g. `gnome-keyring`) must be available for credential storage.

## License

MIT — see [LICENSE](./LICENSE).
