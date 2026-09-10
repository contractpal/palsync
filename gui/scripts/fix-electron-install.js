#!/usr/bin/env node
// Guards against a silent extract-zip failure seen with some Node builds: the
// electron package's own postinstall downloads a valid zip but aborts partway
// through extraction with no error, leaving node_modules/electron/dist without
// the actual Electron binary. If that happened, retry the extraction with
// whatever other Node binaries are available on this machine.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');

if (!fs.existsSync(electronDir)) {
  process.exit(0);
}

function platformExecPath() {
  switch (process.platform) {
    case 'darwin':
      return path.join(electronDir, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
    case 'win32':
      return path.join(electronDir, 'dist', 'electron.exe');
    default:
      return path.join(electronDir, 'dist', 'electron');
  }
}

function isValid() {
  return fs.existsSync(platformExecPath()) && fs.existsSync(path.join(electronDir, 'path.txt'));
}

if (isValid()) {
  process.exit(0);
}

console.warn('[fix-electron-install] Electron binary missing/incomplete after install — attempting repair with alternate Node binaries...');

const candidates = new Set();
try {
  execFileSync('which', ['-a', 'node'], { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((p) => candidates.add(p));
} catch {
  // ignore
}
['/usr/local/bin/node', '/opt/homebrew/bin/node'].forEach((p) => {
  if (fs.existsSync(p)) candidates.add(p);
});
candidates.add(process.execPath);

const installScript = path.join(electronDir, 'install.js');
const distDir = path.join(electronDir, 'dist');

for (const nodeBin of candidates) {
  try {
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.mkdirSync(distDir, { recursive: true });
    fs.rmSync(path.join(electronDir, 'path.txt'), { force: true });
    execFileSync(nodeBin, [installScript], { stdio: 'inherit', cwd: electronDir });
    if (isValid()) {
      console.warn(`[fix-electron-install] Repaired using ${nodeBin}`);
      process.exit(0);
    }
  } catch (err) {
    console.warn(`[fix-electron-install] ${nodeBin} failed: ${err.message}`);
  }
}

console.error(
  '[fix-electron-install] Could not extract a working Electron binary with any available Node binary.\n' +
  'Try deleting node_modules/electron and re-running npm install with a different Node version (e.g. nvm/asdf/volta), ' +
  'or manually run: node node_modules/electron/install.js using a known-good Node binary.'
);
process.exit(1);
