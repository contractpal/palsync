# Pal Console — Build Requirements

Prerequisites for any machine that will run `npm install` in `gui/` — a developer's laptop,
the Jenkins Windows build server, or a Mac doing a manual build. These are separate from (and
in addition to) whatever the root `palsync` package already requires (Node >= 18).

## Why this exists

Electron itself is cross-platform — the JS/React/HTML/CSS UI code runs unmodified on Windows,
Mac, and Linux. But this app's terminal console uses **`node-pty`**, which is not pure
JavaScript: it's a native C++ addon wrapping OS-specific terminal APIs (Windows ConPTY, Unix
pseudo-terminals). Native addons must be **compiled** for the exact OS, CPU architecture, and
Node/Electron ABI of the machine running them — there's no single portable build.

This means `npm install` in `gui/` will fail on any machine missing a working native
build toolchain, whether that machine is doing local dev, packaging a release, or anything in
between. It has nothing to do with producing a signed installer (that's `electron-builder` /
NSIS / notarization, a separate later step) — it blocks even running the app in dev mode.

## Per-platform requirements

### Windows (developer machines + the Jenkins Windows build server)

Visual Studio Build Tools with the **"Desktop development with C++"** workload.

```
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Run this in an elevated (Administrator) terminal — it installs machine-wide and can take a
while (multi-GB download). This is a one-time setup per machine; it is **not** carried by the
repo or by `npm install` itself. Every Windows machine that will build or run this app —
including the Jenkins build server — needs it installed independently.

### Mac (manual builds for now)

Xcode Command Line Tools:

```
xcode-select --install
```

Same underlying reason (compiling `node-pty` for macOS), different toolchain.

### Linux

Not yet in scope for this project (Windows-first per MVP), but would need the standard
`build-essential` (Debian/Ubuntu) or equivalent C/C++ toolchain package when it is.

## Additional one-time fixes needed on Windows (beyond Build Tools)

Hit these getting `npm install` working the first time on a real Windows machine — all now
handled automatically by this package's own tooling, documented here so the *next* clean
machine (Jenkins, another dev's laptop) isn't a surprise:

1. **Spectre-mitigated libraries.** `node-pty`'s Windows build enables Spectre mitigation,
   which needs an extra VS component beyond the base C++ workload:
   ```
   "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe" modify --installPath "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools" --add Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre --quiet --norestart
   ```
   Symptom without it: `MSB8040 Spectre-mitigated libraries are required for this project`.

2. **`node-pty`'s bundled `winpty` build script bug under hardened Windows machines.**
   If the machine has the (fairly common, security-hardening) registry setting
   `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\NoDefaultCurrentDirectoryInPath = 1`
   (disables `cmd.exe`'s implicit "search the current directory for a bare command name"
   behavior — a real security control, don't disable it), `node-pty`'s vendored `winpty` gyp
   build breaks: it invokes `GetCommitHash.bat` / `UpdateGenVersion.bat` by bare name instead
   of `.\GetCommitHash.bat`. Symptom: `'GetCommitHash.bat' is not recognized as an internal or
   external command`. **Already fixed** — `gui/patches/node-pty+1.1.0.patch` (applied
   automatically via `patch-package`, wired into `postinstall`) corrects both invocations to
   use an explicit relative path. Nothing to do here unless `node-pty` is upgraded to a new
   version, in which case the patch needs regenerating (`npx patch-package node-pty --exclude
   'build|GenVersion|\.node$'`).

3. **npm's built-in `allow-scripts` lifecycle-script gate.** Recent npm blocks postinstall
   scripts from new dependencies until explicitly approved (a real, useful supply-chain
   protection, not something to blanket-disable). First `npm install` in `gui/` will report
   several pending packages. Approve the ones the GUI actually needs to function
   (`electron`, `esbuild`, `node-pty`, `@ast-grep/cli`); **deny** `palsync` itself — its
   postinstall downloads Playwright's Chromium, which the GUI deliberately does *not* want
   eagerly (see the Playwright/Chromium design decision — lazy download only, on first
   browser-audit use):
   ```
   npm approve-scripts electron esbuild node-pty "@ast-grep/cli"
   npm deny-scripts palsync
   ```
   `gui/package.json`'s `allowScripts` block records this once approved — it's committed
   config, so this step is only needed the very first time on a fresh machine (or if new
   dependencies with install scripts are added later).

4. **Electron's own binary download can silently no-op.** On at least one machine here,
   `node_modules/electron`'s `install.js` (which downloads and unzips the actual Electron
   binary via `@electron/get` + `extract-zip`) resolved the download fine but the `extract-zip`
   step silently vanished — no error, process just exited as if nothing were pending, leaving
   `node_modules/electron/dist` without `electron.exe`. Root cause not fully identified
   (suspected AV/EDR interference with the JS-based unzip stream). Workaround if `npm run dev`
   fails to find an Electron binary: extract it yourself with PowerShell's native unzip
   instead of relying on the package's own installer:
   ```powershell
   $zip = (Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter "electron-v*-win32-x64.zip").FullName
   Expand-Archive -Path $zip -DestinationPath "gui\node_modules\electron\dist" -Force
   Set-Content "gui\node_modules\electron\path.txt" -Value "electron.exe" -NoNewline -Encoding ascii
   Set-Content "gui\node_modules\electron\dist\version" -Value "v32.3.3" -NoNewline -Encoding ascii
   ```
   (Adjust the version string in the last line to match the `electron` version actually in
   `gui/package.json`.) This only needs doing once per machine — once `dist/electron.exe`,
   `path.txt`, and `dist/version` exist and agree, `install.js`'s own `isInstalled()` check
   short-circuits cleanly on every future `npm install`.

5. **`electron-builder` fails downloading/extracting `winCodeSign`** (a helper package it fetches
   for every Windows build, even unsigned ones — it bundles cross-signing tooling that includes
   symlinked Mac library files). Windows blocks symlink creation for standard user accounts by
   default, so extraction fails with:
   ```
   ERROR: Cannot create symbolic link : A required privilege is not held by the client.
   ```
   Fix: enable **Windows Developer Mode** (Settings → Privacy & Security → For developers →
   Developer Mode). On a managed/corporate machine where that Settings page is hidden by policy,
   try jumping straight to it via Win+R → `ms-settings:developers`; if that's also blocked, an
   admin can grant the same effect via registry:
   ```powershell
   New-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name "AllowDevelopmentWithoutDevLicense" -PropertyType DWord -Value 1 -Force
   ```
   (sign out/in afterward). One-time per machine, same as the other fixes above.

## Producing a real installer (Windows)

```
cd gui
npm run build:win
```

Produces an actual NSIS installer — always named `gui/dist/ChipPalBuilder.exe` (fixed filename,
no version number — set via `package.json`'s `build.nsis.artifactName`) — confirmed
unsigned (electron-builder logs "no signing info identified, signing is skipped" for every file
it touches, since no certificate is configured here — signing is a deliberate separate step, done
manually with David's own signing script since the code-signing cert lives on a thumb drive that
never touches the build machine). `npm run build:win:dir` still produces the old unpacked,
non-installer `dist/win-unpacked/` folder if you just want to quickly run/inspect the packaged
app without going through the installer.

## Symptom if this is missing

`npm install` in `gui/` fails during the `postinstall` native rebuild step
(`@electron/rebuild`), with node-gyp reporting something like:

```
gyp ERR! find VS Could not find any Visual Studio installation to use
```

on Windows, or an equivalent "no C compiler found" error on Mac/Linux.

## Everything else

See `gui/README.md` for the actual dev-run and build commands once prerequisites are in
place.
