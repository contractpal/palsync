# Chip Pal Builder (Electron GUI)

A friendlier wrapper around palsync: a launcher for saved workspaces, tabs per pal, and a
real terminal (not a restricted console) running whatever agent CLI you choose, wired up with
that pal's MCP tools automatically.

## Status

In scope right now:
- Open/create a workspace, saved as plain JSON (`workspaces.json` registry + one JSON per
  workspace, both plain files — no database). Creating one prompts for a name via an in-app
  modal (not `window.prompt()` — Electron's renderer doesn't implement that).
- Add a pal three ways:
  - **Existing folder on disk** (must already have been `palsync pull`-ed, i.e. contains
    `pal.json` + `.palsync.json`).
  - **Create new pal** — a multi-panel wizard (cloud → login if needed → profile → groups →
    name/description/category) that creates the pal on CloudPiston and pulls it down via
    palsync's own `workspace.setup()` orchestration (pull, lock, inject, write
    `.palsync.json`, register MCP — no reimplementation of any of that).
  - **Open from cloud** — same cloud/login/profile flow, then a single group and a pal list to
    pick from, pulling an existing pal down locally.
  - Both cloud-backed flows land in `~/PalBuilder/<pal name>` by default; if that folder is
    already an open tab or already exists on disk, a prompt offers a new folder name
    (`Fred (2)`, etc.) instead of silently colliding or reusing it — every local checkout gets
    its own folder, even for the same pal.
- One tab per pal, each a real `xterm.js` + `node-pty` terminal running your chosen agent CLI
  (Claude Code / OpenCode for now — whichever is detected on PATH; palsync never bundles or
  assumes a vendor).
- MCP wiring reuses the exact mechanism the CLI already uses: a project-scoped `.mcp.json` /
  `opencode.json` is written into the pal's folder if it isn't already there, then the agent
  CLI itself spawns the MCP server as its own child process — the GUI does not spawn or track
  MCP processes directly.
- **File → PalSync Settings…** edits the same two preferences as `palsync settings` (verification
  and final review), through palsync's own policy module into `~/.palsync/config.json` — no GUI
  copy of the policy, no second config file.
- Credentials are reused from the OS keychain the CLI already wrote to for the "existing
  folder" flow — no separate login UI there. The cloud-backed flows *do* have their own login
  form (cloud picker + username/password, or silent auto-login if exactly one cached account
  resolves), since a brand-new pal has no existing folder to read credentials from.
- Closing a workspace or the app cleanly kills every running agent + its MCP child process —
  verified via live process-tree inspection, including multiple simultaneous tabs and both
  existing-folder and cloud-opened pals. Leaving a workspace with agents still running shows a
  confirmation warning first.

Windows-only, unsigned dev build for now (`electron-builder --dir`, no installer/signing yet).

## Repo layout

`gui/` depends on the root `palsync` package via `"palsync": "file:.."` — a one-way
dependency (the CLI never imports from `gui/`). Nothing in `bin/`, `src/`, or `lib/` is
changed by this package.

```
gui/
  src/main/       Electron main process (Node) — workspace state, pty spawning, MCP registration
  src/renderer/   React + Vite UI
```

## Running in development

**See `gui/BUILD.md` first** — a fresh machine needs a native C++ toolchain installed before
`npm install` will even succeed (Visual Studio Build Tools on Windows, Xcode Command Line
Tools on Mac), plus a couple of one-time steps this project needed on top of that (a
`patch-package` fix for a `node-pty` build bug, approving npm's `allow-scripts` gate for a
few dependencies). All one-time, all documented there with exact commands and symptoms.

```
cd gui
npm install
npm run dev
```

`npm run dev` runs the Vite dev server and `electron .` together. The app window loads from
the Vite dev server (hot-reload for renderer changes); main-process changes need an app
restart.

`node-pty` is a native module — `npm install`'s `postinstall` runs `@electron/rebuild` to
rebuild it against Electron's Node ABI. If that step fails, `node-pty` won't load and console
tabs will error on first launch.

### IntelliJ

- **Main process debugging**: Node.js run configuration with the interpreter pointed at
  `gui/node_modules/.bin/electron` and the entry point `gui/src/main/index.js` (or use
  IntelliJ's Electron plugin, which wires this up for you).
- **Renderer debugging**: open Chrome DevTools in the running app window (it opens
  automatically in dev via `webContents.openDevTools()`), or attach IntelliJ's JS debugger to
  the renderer's remote-debugging port.

## Building an unsigned Windows build

```
npm run build:win
```

Produces an unpacked, runnable app under `gui/dist/` via `electron-builder --dir` — no
installer, no signing. Signing (with the existing FIPS thumb-drive cert) and a real installer
are a later step, not part of this MVP.

## Known gaps

- Agent choice per tab isn't persisted back to the workspace JSON yet (picked fresh each
  session if more than one agent is detected).
- Codex isn't in the agent list yet — its MCP registration is a global (not per-project)
  singleton in the CLI today, which needs more thought before wiring it into a multi-tab GUI.
- No live progress log while a create/open-from-cloud pull is running — just a spinner, even
  though `workspace.setup()` takes a `log` callback that isn't streamed to the renderer yet.
- Custom clouds can't be renamed independently of their URL, or deleted (with their stored
  credential) — backlog item, not yet built.
- Playwright/Chromium (needed for the browser-audit feature) isn't wired up at all yet — no
  lazy-download trigger exists in the GUI.
- Terminal scrollback scrollbar styling is a placeholder pending team feedback.
- Windows-only; no Mac/Linux build or code-signing pipeline yet.
