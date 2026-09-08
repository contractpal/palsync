# GUI Backlog

## Features

- **Per-workspace default pal project directory**
  Right now "Existing folder" (`AddPalPopover.jsx:12`) opens `pal:chooseFolder` (`gui/src/main/index.js:164`), an `openDirectory` dialog with no `defaultPath` — it just starts wherever the OS last left it, with no notion of "where this workspace's pal projects live." Add a per-workspace setting (stored alongside the workspace's other fields via `workspaceStore`) for a default pal project directory, and pass it as `defaultPath` on the folder-choose (and pal-create) dialogs so repeat adds don't require renavigating from scratch each time. Needs a place to set/edit it — likely a workspace settings panel — and a sane fallback when unset.

- **Detect a pal folder pinned to an outdated palsync CLI and offer to update it**
  When a pal project's hooks/skills (e.g. the completion `Stop` hook expecting `palsync review check` / `palsync completion check` / `palsync task`) were wired up against an old resolvable `palsync` (global install or local dependency), an agent working in that folder hits a hard mechanical gate it can't pass — subcommands the pinned CLI simply doesn't have. The GUI already resolves and runs `palsync` per pal folder (`palFolder.js`, `dependencyCheck.js`) and already has an update-check pattern for itself (`versionCheck.js`'s `compareVersions` + the notice banner in `LauncherView.jsx`). Extend `validatePalFolder` (`palFolder.js:14`) to also resolve/run the `palsync` that folder would actually invoke (e.g. `palsync --version` from that folder's context) and compare it against the latest published version; if it's behind, surface an "This pal's palsync is outdated (0.20.0 → 0.22.1) and may be missing subcommands its hooks expect — update it?" prompt when adding/opening the folder, with a one-click path to run the upgrade (`npm i -g palsync@latest`, or bump the local dependency if it's pinned in that project's `package.json`).

- **"Chip assistant" — multiple simultaneous Chip identities on one pal (ON HOLD, blocked on CloudPiston server-side work)**
  Idea: let two or more Chip instances act as their own team on the same pal (analogous to multiple human PalBuilder developers in Team Builder, but all driven by Chip). Blocked because CloudPiston's pal lock is currently "re-granted to whoever asks last" — no concept of multiple legitimate concurrent holders — and would need server-side support for each Chip instance/checkout to be recognized as a distinct team-member identity with its own non-conflicting lock/session. David is pursuing the CloudPiston-side piece himself, separately from the GUI. GUI-side foundation (multi-checkout folder naming/`resolveAvailableDir`, folder-based tab labeling, per-tab MCP registration) is already in place to plug into this once the server side exists. Check with David on status before resuming.

- **Codex agent support (ON HOLD)**
  Codex (OpenAI's coding-agent CLI) is known to palsync's agent registry (`src/launcher/agents.js`) but not surfaced in Chip's agent picker (`agentLaunch.js`'s `REGISTRARS` only lists `claude-code`/`opencode`). Blocker: Codex's MCP registration (`src/mcp/registerCodex.js`) writes to a single **global** `~/.codex/config.toml` (one shared `palsync` entry, last-registered-wins) rather than a per-project config — two Chip tabs both using Codex would silently redirect each other's MCP connection. Options discussed, no decision made: leave unsupported / support single-Codex-tab-only / support with a clear warning.

- **Team Builder multi-checkout awareness (deferred)**
  CloudPiston/PalBuilder's Team Builder feature (multiple devs/agents editing the same pal concurrently, file lock-gated) isn't yet MCP-aware. David: "we will hold off on this" until the MCP side supports it. When picked back up: tabs sharing a `cloudPalId` need a disambiguating label, and self-inflicted lock conflicts (two of the user's own tabs racing on the same file) should surface as a friendly in-console message rather than being prevented proactively.

- **Multi-workspace-at-once (decided against for now)**
  Single active workspace per window is the current design. Revisit only if real usage shows people need two workspaces open side by side.

- **"Set Up Dependencies" checklist screen — already partly built, worth extending**
  Help → "Check Dependencies…" exists with Agent Detected + Preview Browser (Chromium) checks. Could grow to cover more first-run setup in one place instead of scattered lazy prompts.

## Bugs

_None open right now._

## To verify / polish

- **"Open from cloud" adding a brand-new custom cloud URL — untested**
  Create/open wizards' cloud picker has only been verified against an already-known cloud; adding a new custom cloud URL from inside that flow hasn't been tried yet.

- **About screen copyright text not confirmed**
  `AboutModal.jsx` defaults to "© {current year} ContractPal. All rights reserved." — David hasn't confirmed this exact text/holder is correct.

- **Terminal scrollbar visual treatment is a placeholder**
  `.xterm-viewport` styling in `gui/src/renderer/styles.css` — sizing/reflow bug is fixed, but the scrollbar's look is left as a placeholder pending feedback from David's team.

## Build / Infra

- **macOS `.dmg` build target intermittently fails**
  `hdiutil resize ... error 35 (Resource temporarily unavailable)` on the Mac build machine (`benjamins`). Confirmed not a disk-space issue (295GB free) — known `hdiutil` flakiness. Signed+notarized `.zip` is a fully valid distributable in the meantime (Gatekeeper treats it identically to a `.dmg`), so this is deprioritized. Next attempt: either retry the build (may just work) or drop `dmg` from `gui/package.json`'s mac target list if it keeps failing.

- **Linux build machine blocked on git auth to clone the repo**
  VM `ubuntu-palsync-build` (VirtualBox, Ubuntu Server 24.04.3 LTS, host `192.168.1.59`-reachable via port 2222→22 forward) has the full toolchain installed (build-essential, git, curl, python3, Node 20.20.2) but cloning `contractpal/palsync` is blocked — the GitHub PAT approach that worked on the Mac build got flagged by the Claude Code auto-mode permission classifier as needing explicit approval on this machine/session. Options to try next: (a) have David paste the git-credential-setup command himself so the token never passes through the sandboxed tool, (b) switch to an SSH deploy key for this VM instead of a PAT (cleaner long-term for a non-interactive build box), or (c) approve the specific blocked action if permission settings allow a rule for it. Once cloned: `npm install` (root + `gui/`), verify `node-pty` native rebuild under Ubuntu's toolchain, then `electron-builder --linux` (AppImage first — simplest, no signing/notarization needed on Linux at all).

## Fixed

- **Windows build ballooned from ~193MB to 1.3GB+ after repeated rebuilds** — fixed
  Root cause: `gui/node_modules/palsync` (from `"palsync": "file:.."` in `gui/package.json`) is a Windows junction pointing at the entire repo root — `gui/node_modules/palsync/gui` **is** `gui/` itself, junction and all. Since `electron-builder`'s `files` allowlist doesn't restrict `node_modules/**`, every rebuild packaged the *previous* build's own output (a full `electron.exe` + Chromium, ~200MB+) sitting inside `gui/dist`, which was itself already packaged inside `gui/node_modules/palsync/gui/dist` — compounding on every rebuild. Fixed by adding `"!node_modules/palsync/gui/**"` and `"!node_modules/palsync/.git/**"` to `build.files` in `gui/package.json`. Confirmed fixed: installer back to 198MB, real `palsync` runtime code (`src/`, `bin/`, `bundled-context/`) still present in the asar. This almost certainly affects the Mac build the same way (same `file:..` mechanism) — make sure this fix is pulled before rebuilding there.

- **Version-check banner sends raw `process.platform` as `os=`** — confirmed no change needed
  `versionCheck.js` sends Node's raw values (`win32`/`darwin`/`linux`) to `getVersionInfo.do?ide=chip&os=<platform>`. David confirmed the endpoint is fine with these tokens as-is.

- **Claude Code hook commands written from inside the GUI relaunch the GUI instead of running palsync** — fixed (needs more real-world testing)
  Hooks written via `contextInject.js`/`claudeHooks.js` used `process.execPath` for the command's Node binary, which inside Electron's main process is `electron.exe`, not plain Node — same root cause `agentLaunch.js` already patched for MCP config, but that patch never covered hook commands. Fixed by a new `ensureElectronRunAsNodeForHooks(workspaceDir)` in `gui/src/main/agentLaunch.js`, which finds palsync-owned hook commands in `.claude/settings.json` and prefixes them with `set ELECTRON_RUN_AS_NODE=1 &&` (Windows) / `ELECTRON_RUN_AS_NODE=1 ` (POSIX), relying on the shell Claude Code already runs the command through. Wired into `ensureMcpRegistered()` (self-healing on every console launch) and `cloudWizard.js`'s `materialize()` (create-new/open-from-cloud path). Marked done per David; not yet confirmed against a live repeated-Stop-hook scenario — flag if it resurfaces.

- **Low-contrast text in Claude Code output** — fixed (GUI-side mitigation)
  Some chunks of Claude-generated code/text rendered as black-on-near-black, illegible — Claude Code's own ANSI color output likely assumes a light-background terminal theme, upstream of palsync's control. Mitigated in `ConsoleTab.jsx` by setting xterm.js's `minimumContrastRatio: 4.5`, which auto-adjusts a cell's foreground color to meet that contrast ratio against the terminal's background regardless of the color the CLI requested. Confirmed fixed by David.

- **Can't paste into the agent console input with Ctrl+V/Cmd+V** — fixed
  Confirmed: right-click paste worked, but keyboard paste didn't — xterm.js doesn't bind plain `Ctrl+V` to paste by default (it's a raw control byte a real terminal would send to the shell). Fixed in `ConsoleTab.jsx` by adding `term.attachCustomKeyEventHandler` to intercept Ctrl+V/Cmd+V, read `navigator.clipboard.readText()`, and call `term.paste(text)`.

- **Stale docs still tell the agent it can't create/edit a `datalist`** — fixed
  `bundled-context/skills/palbuilder-core/references/pal-json.md:127-130` said `data`/`datalists`/`dataviews` are "PalBuilder-provisioned... does not provision new ones via push... Create a new object in PalBuilder first" — stale for `data`/`datalists`, which are agent-editable via `pal_data_set`/`pal_data_delete` and `pal_datalist_set`/`pal_datalist_delete` (`src/mcp/tools.js:1836`, `:1873`; `src/core/dataObjects.js:120`, `:134`). Only `datasets`/`dataviews` still require PalBuilder. Reworded the summary paragraph to match what the detailed `data`/`datalists` sections already documented correctly.

- **New Workspace dialog closes when selecting the pre-filled name via mouse drag** — fixed
  In `LauncherView.jsx`, the "New Workspace" modal backdrop closed the dialog `onClick` (`gui/src/renderer/components/LauncherView.jsx:91`), so dragging to select the pre-filled name in the `<input>` (`:94`) and releasing outside the modal fired a `click` on the backdrop and closed the dialog. Fixed by closing on backdrop `onMouseDown` only when the mousedown target is the backdrop itself, so a drag that starts inside the modal no longer counts.

- **"Install" for Dependencies > Preview Browser (Chromium) launches a second GUI instance instead of just downloading** — fixed
  `installChromium()` in `gui/src/main/dependencyCheck.js:48` ran `spawn(process.execPath, [cli, "install", "chromium"])`. Under Electron, `process.execPath` is the Electron/app binary itself, not plain Node, so spawning it without `ELECTRON_RUN_AS_NODE=1` booted a second Electron app instance instead of running the Playwright CLI as Node. Fixed by passing `env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }` to the `spawn()` call.
