# GUI Backlog

## Features

- **Per-workspace default pal project directory**
  Right now "Existing folder" (`AddPalPopover.jsx:12`) opens `pal:chooseFolder` (`gui/src/main/index.js:164`), an `openDirectory` dialog with no `defaultPath` — it just starts wherever the OS last left it, with no notion of "where this workspace's pal projects live." Add a per-workspace setting (stored alongside the workspace's other fields via `workspaceStore`) for a default pal project directory, and pass it as `defaultPath` on the folder-choose (and pal-create) dialogs so repeat adds don't require renavigating from scratch each time. Needs a place to set/edit it — likely a workspace settings panel — and a sane fallback when unset.

- **Detect a pal folder pinned to an outdated palsync CLI and offer to update it**
  When a pal project's hooks/skills (e.g. the completion `Stop` hook expecting `palsync review check` / `palsync completion check` / `palsync task`) were wired up against an old resolvable `palsync` (global install or local dependency), an agent working in that folder hits a hard mechanical gate it can't pass — subcommands the pinned CLI simply doesn't have. The GUI already resolves and runs `palsync` per pal folder (`palFolder.js`, `dependencyCheck.js`) and already has an update-check pattern for itself (`versionCheck.js`'s `compareVersions` + the notice banner in `LauncherView.jsx`). Extend `validatePalFolder` (`palFolder.js:14`) to also resolve/run the `palsync` that folder would actually invoke (e.g. `palsync --version` from that folder's context) and compare it against the latest published version; if it's behind, surface an "This pal's palsync is outdated (0.20.0 → 0.22.1) and may be missing subcommands its hooks expect — update it?" prompt when adding/opening the folder, with a one-click path to run the upgrade (`npm i -g palsync@latest`, or bump the local dependency if it's pinned in that project's `package.json`).

## Bugs

- **Can't paste into the agent console input (unconfirmed)**
  Reported that pasting doesn't work in the agent input field — not yet confirmed which input or whether it reproduces on another machine. Best guess: the agent console (`ConsoleTab.jsx`) is an `@xterm/xterm` terminal (`renderer/components/ConsoleTab.jsx:27`), and xterm.js doesn't bind plain `Ctrl+V` to paste by default (it's a raw control byte a real terminal would send to the shell) — paste normally needs `Ctrl+Shift+V`, a middle-click, or a custom keybinding via `attachCustomKeyEventHandler`, none of which are wired up here. Needs reproduction/confirmation before fixing.

- **Low-contrast text in Claude Code output (upstream, not a palsync bug)**
  Some chunks of Claude-generated code/text render as black-on-near-black, illegible. Reproduces in IntelliJ's terminal and in the GUI's embedded console (`ConsoleTab.jsx`) alike, so it's Claude Code's own ANSI color output (likely assuming a light-background terminal theme) rather than anything palsync's GUI controls. Nothing to fix here directly — flagged as feedback to Anthropic; if it persists, check whether Claude Code has a theme/no-color setting to force high-contrast output.

## Fixed

- **New Workspace dialog closes when selecting the pre-filled name via mouse drag** — fixed
  In `LauncherView.jsx`, the "New Workspace" modal backdrop closed the dialog `onClick` (`gui/src/renderer/components/LauncherView.jsx:91`), so dragging to select the pre-filled name in the `<input>` (`:94`) and releasing outside the modal fired a `click` on the backdrop and closed the dialog. Fixed by closing on backdrop `onMouseDown` only when the mousedown target is the backdrop itself, so a drag that starts inside the modal no longer counts.

- **"Install" for Dependencies > Preview Browser (Chromium) launches a second GUI instance instead of just downloading** — fixed
  `installChromium()` in `gui/src/main/dependencyCheck.js:48` ran `spawn(process.execPath, [cli, "install", "chromium"])`. Under Electron, `process.execPath` is the Electron/app binary itself, not plain Node, so spawning it without `ELECTRON_RUN_AS_NODE=1` booted a second Electron app instance instead of running the Playwright CLI as Node. Fixed by passing `env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }` to the `spawn()` call.
