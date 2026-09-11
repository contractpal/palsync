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

### Linux (build VM)

The standard `build-essential` (Debian/Ubuntu) or equivalent C/C++ toolchain package, same
underlying reason (compiling `node-pty` for Linux).

```
sudo apt install -y build-essential git curl python3
```

(plus Node itself — see NodeSource's setup script for the current LTS).

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

`build:win` also runs `gui/scripts/bumpVersion.js` first (same auto-bump as Mac — see below) and
`gui/scripts/afterWinBuild.js` last, which copies the freshly built, still-unsigned installer to
a fixed staging path (`C:\build\ChipPalBuilder.exe`) and prints an explicit "MANUAL SIGNING
NEEDED" notice, so it's never left sitting unsigned in `gui/dist` without a clear next step.

### After signing: publishing to the download bucket

Same bucket, same convention as Mac (see below) — sign the staged `.exe`, then upload it and a
matching `windows-versions.txt` yourself (there's no automated upload step for Windows, since the
signing machine and wherever you run the upload from aren't assumed to be this build machine):

```
aws s3 cp C:\build\ChipPalBuilder.exe s3://contractpal-cloudpiston-downloads/ChipPalBuilder.exe
```

`windows-versions.txt` is the same flat format as Mac's — version on line 1, one filename per
line after (just `ChipPalBuilder.exe` today; Windows only ever ships one installer, no arch
split):

```
0.4.0
ChipPalBuilder.exe
```

`versionCheck.js`'s "new version available" check for Windows reads this file directly (not
`getVersionInfo.do` — same server-side "not actually OS-aware" gap as Mac, outside this repo) and
won't pick up a new release until it's updated to match.

## Producing a real installer (Mac) — signing, notarizing, and publishing

```
cd gui
npx electron-builder --mac --x64 --arm64 --config.directories.output=<path outside this repo>
```

Route `directories.output` outside the repo, not `npm run build:mac`'s default `gui/dist` —
`gui/node_modules/palsync` is a real symlink to the repo root (`"palsync": "file:.."`), which
makes `gui/node_modules/palsync/gui` **be** `gui/` itself. Anything sitting in `gui/dist/` during
packaging (a previous build's installers, another arch's output mid-build) is reachable through
that symlink and can get bundled straight into the new `app.asar`, ballooning it from ~140MB to
1-2GB+. `gui/scripts/afterPack.js` prunes any leak that gets through anyway as a safety net, but
it can't save an archive that's already past ~2GB (an `@electron/asar` limitation) — the output
redirect is what actually prevents the bloat. Move the finished `.dmg`/`.zip`/`.blockmap` files
into `gui/dist/` afterward.

Signing (Developer ID Application cert) and notarization (Apple ID + app-specific password +
team ID) both happen automatically as long as a valid "Developer ID Application" identity is in
the build machine's keychain and `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` are set
in the environment — electron-builder picks both up with no extra config. Verify before
publishing: `spctl -a -vv --type execute "<App>.app"` (should say "accepted... Notarized Developer
ID"), `codesign --verify --deep --strict "<App>.app"`, and `xcrun stapler validate "<App>.app"`
(confirms the notarization ticket is actually stapled — works offline, no network check needed by
the end user's Mac).

### Publishing to the download bucket

The four installer files (arm64 `.dmg`/`.zip`, x64 `.dmg`/`.zip`) get uploaded by hand to
`s3://contractpal-cloudpiston-downloads/` at the bucket root, with the version stripped from the
filename so each upload replaces the previous release at a fixed URL
(`https://downloads.cloudpiston.com/ChipPalBuilder.dmg`, etc. — no `.blockmap` files, they're
electron-updater delta-patch metadata and this app doesn't use an auto-updater). **A Mac release
is not complete until `mac-versions.txt` is re-uploaded too** — plain text, version on line 1,
one filename per line below it, also at the bucket root. `versionCheck.js`'s "new version
available" check for macOS reads this file directly (not `getVersionInfo.do` — that endpoint
isn't OS-aware, a server-side gap outside this repo; Windows now reads its own equivalent
`windows-versions.txt` the same way, see above) and won't pick up a new release until it's
updated to match.

## Producing a real installer (Linux)

```
cd gui
npm run build:linux
```

Produces an AppImage — always named `gui/dist/ChipPalBuilder.AppImage` (fixed filename, no
version number, same convention as Windows — set via `package.json`'s `build.linux.artifactName`).
`npm run build:linux:dir` produces the old unpacked `dist/linux-unpacked/` folder instead, for
quickly running/inspecting the packaged app without going through the AppImage step.

Unlike Windows and Mac, **no signing step is needed at all** — AppImage has no code-signing
convention comparable to Authenticode or Apple's Developer ID, so there's no cert, no thumb
drive, and no manual pass. `build:linux` runs `gui/scripts/bumpVersion.js` first (same auto-bump
as Mac/Windows), then `gui/scripts/afterLinuxBuild.js` last, which confirms the AppImage exists
**and writes `gui/dist/linux-versions.txt` itself** (from the just-bumped `package.json` version —
see below), so the manifest can never drift from what was actually built.

### Publishing to the download bucket — always part of finishing a Linux build

David's standing instruction (2026-09-11): a Linux build session isn't done at "AppImage built" —
**always** finish it by uploading to S3 and shutting down the build VM, every time, not just when
asked. The build VM (`ubuntu-palsync-build`) is normally reached over SSH from a Windows dev
machine that already has AWS CLI + the `cloudpiston-downloads` IAM user's credentials configured
(the VM itself doesn't need AWS credentials at all — copy the two files off it first):

```
# From the Windows machine, after `npm run build:linux` succeeded on the VM over SSH:
pscp -P 2222 -pw <vm password> david@localhost:/home/david/palsync/gui/dist/ChipPalBuilder.AppImage .
pscp -P 2222 -pw <vm password> david@localhost:/home/david/palsync/gui/dist/linux-versions.txt .

aws s3 cp ChipPalBuilder.AppImage s3://contractpal-cloudpiston-downloads/ChipPalBuilder.AppImage
aws s3 cp linux-versions.txt s3://contractpal-cloudpiston-downloads/linux-versions.txt

# Then shut the VM down (it's only ever started on demand for a build):
VBoxManage controlvm ubuntu-palsync-build acpipowerbutton
```

`linux-versions.txt` is the same flat format as Mac/Windows — version on line 1, one filename per
line after (just `ChipPalBuilder.AppImage` today; Linux only ever ships one installer, no arch
split, matching Windows):

```
0.8.0
ChipPalBuilder.AppImage
```

`versionCheck.js`'s "new version available" check for Linux reads this file directly (not
`getVersionInfo.do` — same server-side "not actually OS-aware" gap as Mac/Windows, outside this
repo) and won't pick up a new release until it's updated to match.

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
