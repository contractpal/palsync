# palsync headless & multi-harness guide

palsync is a **substrate, not an agent runtime.** It does not run a model or orchestrate a loop —
it's an MCP server + curated skills + deterministic tools (`pal_validate`, `pal_push`, `pal_test`,
`pal_preview`, `pal_sync_datasets`, …) that *any* agent runtime drives. You pick the runtime and the
model; palsync gives it correct PalBuilder behavior and safe sync.

That means **model-agnostic and cheap-model support come for free at the harness layer**: run
OpenCode, Codex, Claude Code, or Hermes configured with whatever model you want (Claude, gpt-5.5,
DeepSeek V4, Qwen, a local Ollama model) and point it at the palsync MCP server. palsync builds no
model router — it doesn't need one.

This guide covers running palsync on a headless box (no GUI, no OS keychain) and connecting it to
non-Claude harnesses.

---

## 1. Headless authentication (no OS keychain)

On a desktop, `palsync` stores your password in the OS keychain. On a headless box (an
autonomous-agent host, CI, a container) there is no keychain, so supply the password via an
environment variable. palsync checks, in order:

1. `PALSYNC_PASSWORD_<HOST_USER>` — account-scoped, for a box serving multiple accounts.
   The suffix is the cloud host + username, uppercased, non-alphanumerics → `_`. Example:
   `PALSYNC_PASSWORD_SECURE_CLOUDPISTON_COM_SAM_X_COM`.
2. `CP_PASS` — the single-account convention (same as the `palpush` deploy CLI). Use this unless
   one box needs several accounts.
3. OS keychain — the desktop path.

```sh
export CP_USER='you@example.com'          # the account (or pass --user)
export CP_PASS='your-cloudpiston-password'
export CP_URL='https://secure.cloudpiston.com'   # optional; this is the default
```

The password is read only to authenticate. It is never written to disk, never logged, and never
returned to the agent. (`pal_test --preview` and `pal_preview --open` browser URLs that embed
credentials are opened locally and likewise never surfaced to the agent.)

---

## 2. Create a workspace without prompts

The interactive `palsync` launcher needs a TTY and ends by opening an agent. For a headless box use
`palsync setup`, which pulls the pal, injects the skills, and writes `.palsync.json` + the MCP
config — with **no prompts** — then exits (releasing the lock; the MCP server re-acquires it on the
agent's first tool call).

```sh
# By name (preferred — never hardcode GUIDs):
palsync setup --pal "ISR SEO Dashboard" --dir ~/pals/isr

# Disambiguate a duplicate name, or pin by GUID:
palsync setup --pal "Quote Game" --profile Gamgee --group Default --dir ~/pals/quote
palsync setup --guid PAL-SE-19E8572748C-69DF234 --dir ~/pals/isr

# Machine-readable result for a calling agent:
palsync setup --pal "V2 OE Website" --dir ~/pals/oe --json
```

`setup` resolves the account from `--user` / `CP_USER` / the single cached keychain account, and the
password from the env vars above. If the workspace already has un-pushed local edits, setup refuses
(safe) unless you pass `--overwrite-local`.

---

## 3. Drive palsync from your harness

Two ways: connect a harness's **MCP client** to the palsync server (the tools appear automatically),
or **shell out** to the headless CLI subcommands. Both reuse the exact same tool logic.

### MCP server (any MCP-capable harness)

The server is a standard stdio MCP server. Launch it with `PALSYNC_WORKSPACE` pointing at the
workspace `setup` created:

```
command: palsync-mcp        (or: node /abs/path/to/palsync/bin/palsync-mcp.js)
env:     PALSYNC_WORKSPACE=/home/you/pals/isr
         CP_USER=you@example.com
         CP_PASS=your-password
```

It exposes: `pal_status`, `pal_validate`, `pal_testing`, `pal_test`, `pal_tunnel_test`, `pal_debug`,
`pal_preview`, `pal_fetch`, `pal_screenshot`, `pal_exercise`, `pal_seo_audit`, `pal_context`,
`pal_spec_lint`, `pal_regression`, `pal_sync_datasets`, `pal_data_set`, `pal_data_delete`,
`pal_datalist_set`, `pal_datalist_delete`, `pal_pull`, `pal_merge`, `pal_push`, `pal_lock`,
`pal_unlock` (24 tools — a modest context cost; keep other heavy MCP servers off the same session if
context is tight).

**OpenCode** — palsync registers itself when you run `palsync setup --agent opencode`, or add it
manually to a project `opencode.json` (or the global `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "palsync": {
      "type": "local",
      "command": ["node", "/abs/path/to/palsync/bin/palsync-mcp.js"],
      "enabled": true,
      "environment": {
        "PALSYNC_WORKSPACE": "/home/you/pals/isr",
        "CP_USER": "you@example.com",
        "CP_PASS": "your-password"
      }
    }
  }
}
```

(`command: ["palsync-mcp"]` also works if the `palsync-mcp` bin is on PATH; palsync's own
auto-registration uses the full node + script-path form so it never depends on PATH.)

**Codex** — palsync registers itself when you run `palsync setup --agent codex`, or add it manually:

```sh
codex mcp add palsync --env PALSYNC_WORKSPACE=/home/you/pals/isr --env CP_USER=you@example.com --env CP_PASS=your-password -- palsync-mcp
```

**Claude Code** — `setup` writes `.mcp.json` in the workspace; Claude Code auto-discovers it. Set
`CP_PASS`/`CP_USER` in the environment Claude Code runs in (headless boxes).

**Hermes Agent (Nous Research) / any other MCP client** — add a local stdio MCP server with the
command + env above. Hermes connects to any MCP server; it owns the model (OpenRouter / Anthropic /
DeepSeek / local) and the human-approval gateway (Telegram, etc.).

**Pi** — `palsync setup --agent pi` (or `palsync --agent pi`) prepares the workspace with the
`.agents/skills/` + `AGENTS.md` open standard and launches `pi`. Users do not register a Pi MCP
server manually: the native extension privately spawns `palsync-mcp` with the `pi-minimal` profile
and activates tools lazily. Shell-out subcommands remain available for direct CLI use.

### Shell-out (no MCP)

Every operation is also a headless CLI subcommand against a workspace dir — useful for scripts and
for harnesses without MCP:

```sh
palsync validate --dir ~/pals/isr            # offline lint (no login needed)
palsync status   --dir ~/pals/isr
palsync pull     --dir ~/pals/isr
palsync merge    --dir ~/pals/isr            # 3-way merge local + server changes
palsync push     --dir ~/pals/isr            # validates first; refuses on new errors
palsync test     --dir ~/pals/isr
palsync preview  --dir ~/pals/isr            # web HTML to stdout; console opens only in a TTY, or with --open
palsync fetch about.html --expect "About us" --dir ~/pals/isr   # verify a page WITHOUT dumping HTML
palsync seo-audit --dir ~/pals/isr
palsync sync-datasets --dir ~/pals/isr
palsync regression --dir ~/pals/isr          # brownfield: check against baseline/baseline.json
palsync spec-lint SPEC.md --dir ~/pals/isr   # offline mechanical reality-check of a spec
palsync task list --ready --dir ~/pals/isr   # next runnable EXECUTION.md task (deps satisfied)
palsync task T3 done --dir ~/pals/isr        # set exactly one task's status
palsync task T4 blocked --reason "provider unavailable" --dir ~/pals/isr
palsync checkpoint "T3 done: preview OK" --dir ~/pals/isr
palsync completion check --dir ~/pals/isr    # all-done review / reasoned-handoff gate
palsync ctx inspect --dir ~/pals/isr          # inspect stable generated-context sections
palsync ctx diff --dir ~/pals/isr             # compare the last two context generations
```

These exit non-zero on failure/refusal, so an orchestrator can branch on the exit code.

---

## 4. Safety for autonomous use

The agent decides *when* to call a tool; palsync makes the destructive ones impossible to trigger
by accident:

- **`pal_push`** validates first and refuses on errors your change introduced; drift (someone saved
  on the server since your last pull) refuses unless `force`.
- **`pal_sync_datasets --recreate`** (DROPS data) requires an exact typed confirmation phrase.
- **Lock override** requires an exact typed phrase echoing the pal name.

Human-in-the-loop approval (e.g. "Hermes wants to push 5 files — approve?" via Telegram) lives in
your harness, which already owns the human gateway. palsync's job is to be safe-by-default and
loud about what each refusal means, in full sentences a small model can act on.

---

## 5. What palsync does NOT do (by design)

- **No model provider router / agent loop.** Use your harness (OpenCode/Codex/Hermes/Claude Code)
  with any model. Split execution (a frontier planner + a cheap coder + `pal_validate` as the free
  deterministic reviewer) is a *harness/orchestrator* pattern; palsync supplies the substrate.
- **No bundled web UI** (yet — a lean internal one is planned, built on this same headless surface).
- **No auto-generated skills.** The skills are hand-curated; palsync delivers them, never dilutes
  them.
