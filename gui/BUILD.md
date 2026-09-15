# Pal Console — Build Requirements

Prerequisites for any machine that will run `npm install` in `gui/` — a developer's laptop,
the Jenkins Windows build server, the Linux build VM, or the Mac build machine (as of
2026-09-14, all three release builds are driven from one Windows machine over SSH to the Linux
VM and the Mac — see "Producing a real installer" below for each). These are separate from (and
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

### Mac (real machine over SSH — see "Producing a real installer (Mac)" below)

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

**Correction, 2026-09-14, same day this was first written: the build/package steps genuinely
work over SSH from the Windows machine to the real Mac (`ssh davidmartineau@benjamins.local`),
but the codesigning step does not** — discovered live when it failed on every single file
(tested by signing a completely unrelated binary, `/bin/cat`, in isolation, no relation to the
app at all) with `errSecInternalComponent`, and `security show-keychain-info` returned "User
interaction is not allowed." Root cause: an SSH session runs in its own macOS security/audit
session, separate from the console GUI login session — even a second interactive SSH session
run purely to `security unlock-keychain` didn't help, because that unlock doesn't carry over to
a different SSH session either. The Developer ID private key requires interactive authorization
to use for signing, and nothing running over SSH can display that prompt. **So: `git pull` /
`npm install` / the build itself can be driven over SSH exactly as below, but the actual
`electron-builder --mac` invocation (which signs and notarizes) needs to be run from a real,
locally-logged-in Terminal.app session on the Mac** until a dedicated, always-unlocked build
keychain is set up (the standard CI approach — import the Developer ID cert into a separate
keychain created and unlocked with no auto-lock timeout, so it doesn't depend on the console
session at all; not set up as of this writing).

Get the checkout current over SSH exactly as planned, then run the actual build command
yourself, locally, at the Mac:

```
# From the Windows machine, over SSH — fine for these steps, just not the actual build:
ssh davidmartineau@benjamins.local "cd ~/palsync && git pull"
ssh davidmartineau@benjamins.local "cd ~/palsync && npm install"          # picks up any new root deps
ssh davidmartineau@benjamins.local "cd ~/palsync/gui && npm install"      # picks up any new gui deps
```
```
# Then, in Terminal.app locally on the Mac itself (not over SSH):
cd ~/palsync/gui
node scripts/bumpVersion.js
npm run build:renderer
node scripts/writeBuildInfo.js
npx electron-builder --mac --x64 --arm64 --config.directories.output="$HOME/chip-mac-build"
```

**Do NOT write `--config.directories.output=~/chip-mac-build`** (a mistake made live
2026-09-14) — zsh (and bash) only expand a leading `~` at the very start of a word, or right
after `=` in a real variable assignment (`FOO=~/bar`). `--config.directories.output=~/...` is
neither (the left side isn't a valid identifier), so the `~` is passed through **literally**.
electron-builder then creates an actual directory named `~` wherever the command's cwd was
(`gui/`, in this flow) — `gui/~/chip-mac-build/...` — not under the real home directory, and
both `ls ~/chip-mac-build` and Finder correctly report nothing there. Nothing is lost, it's just
in the wrong place (`find ~ -iname '*chip-mac-build*'` or `find / -iname '*ChipPalBuilder-<version>*'`
finds it) — but avoid the mistake by using `"$HOME/chip-mac-build"` instead, which expands
reliably in this position.

Route `directories.output` outside `gui/dist` regardless — `gui/node_modules/palsync` is a real
symlink to the repo root (`"palsync": "file:.."`), which makes `gui/node_modules/palsync/gui`
**be** `gui/` itself. Anything sitting in `gui/dist/` during packaging (a previous build's
installers, another arch's output mid-build) is reachable through that symlink and can get
bundled straight into the new `app.asar`, ballooning it from ~140MB to 1-2GB+. `gui/scripts/afterPack.js`
prunes any leak that gets through anyway as a safety net, but it can't save an archive that's
already past ~2GB (an `@electron/asar` limitation) — the output redirect is what actually
prevents the bloat.

Signing (Developer ID Application cert) and notarization (Apple ID + app-specific password +
team ID) both happen automatically during that build as long as a valid "Developer ID
Application" identity is in the Mac's keychain and `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/
`APPLE_TEAM_ID` are set in its environment — electron-builder picks both up with no extra config,
and the build's own log lines show `signing ...` / `notarization successful` for each arch as it
happens. Verify over the same SSH connection before copying anything back — for each of
`$HOME/chip-mac-build/mac/Chip Pal Builder.app` (x64) and
`$HOME/chip-mac-build/mac-arm64/Chip Pal Builder.app` (arm64):

```
ssh davidmartineau@benjamins.local 'spctl -a -vv --type execute "$HOME/chip-mac-build/mac/Chip Pal Builder.app"'
ssh davidmartineau@benjamins.local 'codesign --verify --deep --strict "$HOME/chip-mac-build/mac/Chip Pal Builder.app"'
ssh davidmartineau@benjamins.local 'xcrun stapler validate "$HOME/chip-mac-build/mac/Chip Pal Builder.app"'
```

(repeat with `mac-arm64` for the other arch). Expect `accepted` + `source=Notarized Developer ID`,
a clean `codesign` exit, and `The validate action worked!` — confirms the notarization ticket is
actually stapled (works offline, no network check needed by the end user's Mac).

### Copying artifacts back and publishing to the download bucket

The Mac has no AWS CLI configured — copy the four installer files back to the Windows machine
via `scp` (not PuTTY's `pscp`: it hit an interactive host-key confirmation that `-batch` mode
can't get past from this pairing, even with `-hostkey` — plain OpenSSH `scp`/`ssh` work fine
once the host key is trusted once via an interactive `ssh` call), renaming to the
version-stripped convention as you go (`mac-versions.txt`, uploaded from a prior release, is the
source of truth for exact filenames):

```
# Use the actual resolved absolute remote path here, not a literal "$HOME" or "~" in the scp
# remote-path argument — unlike a command run through `ssh` (a real remote shell, where $HOME
# expands normally), scp's remote-path parsing is a different code path and expanding env vars
# there is untested/unconfirmed. Get the real path once (`ssh davidmartineau@benjamins.local
# 'echo $HOME'`) and use it literally, e.g. /Users/davidmartineau/chip-mac-build below.
BASE='davidmartineau@benjamins.local:/Users/davidmartineau/chip-mac-build'
scp "$BASE/Chip Pal Builder-<version>.dmg" ChipPalBuilder.dmg
scp "$BASE/Chip Pal Builder-<version>-mac.zip" ChipPalBuilder-mac.zip
scp "$BASE/Chip Pal Builder-<version>-arm64.dmg" ChipPalBuilder-arm64.dmg
scp "$BASE/Chip Pal Builder-<version>-arm64-mac.zip" ChipPalBuilder-arm64-mac.zip

aws s3 cp ChipPalBuilder.dmg s3://contractpal-cloudpiston-downloads/ChipPalBuilder.dmg
aws s3 cp ChipPalBuilder-mac.zip s3://contractpal-cloudpiston-downloads/ChipPalBuilder-mac.zip
aws s3 cp ChipPalBuilder-arm64.dmg s3://contractpal-cloudpiston-downloads/ChipPalBuilder-arm64.dmg
aws s3 cp ChipPalBuilder-arm64-mac.zip s3://contractpal-cloudpiston-downloads/ChipPalBuilder-arm64-mac.zip
aws s3 cp mac-versions.txt s3://contractpal-cloudpiston-downloads/mac-versions.txt

# Clean up the remote build output — it sits inside gui/ (or wherever cwd was), same
# app.asar-bloat risk as leftover gui/dist content if a future build's symlink traversal reaches it:
ssh davidmartineau@benjamins.local 'rm -rf "$HOME/chip-mac-build"'   # or wherever it actually landed, see the ~ gotcha above
```

No `.blockmap` files get uploaded — they're electron-updater delta-patch metadata and this app
doesn't use an auto-updater. **A Mac release is not complete until `mac-versions.txt` is
re-uploaded too** — plain text, version on line 1, one filename per line below it, also at the
bucket root:

```
0.9.0
ChipPalBuilder-arm64.dmg
ChipPalBuilder-arm64-mac.zip
ChipPalBuilder.dmg
ChipPalBuilder-mac.zip
```

`versionCheck.js`'s "new version available" check for macOS reads this file directly (not
`getVersionInfo.do` — that endpoint isn't OS-aware, a server-side gap outside this repo; Windows
and Linux now read their own equivalent `windows-versions.txt`/`linux-versions.txt` the same way)
and won't pick up a new release until it's updated to match.

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
(the VM itself doesn't need AWS credentials at all — copy the two files off it first).

**Cross-cutting note (2026-09-14): this whole flow (start VM, SSH in, `git pull` + `npm install`
in both the repo root and `gui/` since the VM's own checkout can be stale/have its own
platform-specific lockfile drift, build, copy back, upload, shut down) is now David's standing
way of producing all three platform builds from one Windows machine — Mac included, see its own
section above, same shape minus the VM start/stop.**

`VBoxManage.exe` isn't on PATH in a Git-Bash shell by default — call it via full path or from
PowerShell: `"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"`. Start it (if not already
running — `VBoxManage list runningvms` shows current state) with
`VBoxManage startvm ubuntu-palsync-build --type headless`, then **wait for it to actually finish
booting before SSHing in** — `ssh -p 2222 ...` fails with "Connection timed out during banner
exchange" while the guest is still coming up, which looks identical to a real networking problem
but usually just means "not ready yet." Observed once (2026-09-14) that the VM hung mid-boot
entirely and never became reachable no matter how long we waited — power-cycling it
(`VBoxManage controlvm ubuntu-palsync-build poweroff` then `startvm` again) resolved it; if SSH
still won't connect after a couple minutes of retrying, that's the more likely explanation than
continuing to wait.

Prefer plain OpenSSH `scp` over PuTTY's `pscp` for copying files back — `pscp` hit an interactive
host-key confirmation prompt that `-batch` mode couldn't get past even with an explicit
`-hostkey` argument, whereas `scp`/`ssh` (already available on this Windows machine) worked
immediately once the host key was trusted via one interactive `ssh` call
(`-o StrictHostKeyChecking=accept-new`):

```
# From the Windows machine, after `npm run build:linux` succeeded on the VM over SSH:
scp -P 2222 david@localhost:/home/david/palsync/gui/dist/ChipPalBuilder.AppImage .
scp -P 2222 david@localhost:/home/david/palsync/gui/dist/linux-versions.txt .

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
