"use strict";
// Cross-platform OS keychain wrapper over @napi-rs/keyring. One API maps to:
//   macOS Keychain · Windows Credential Manager · Linux Secret Service (libsecret).
// Credentials are keyed by url + username (service = "palsync:<url>", account = username),
// so multiple accounts per cloud coexist. Nothing is ever written to disk here — the OS
// keychain stores the password encrypted at rest.
//
// PORTABILITY CAVEAT (flagged, not hidden): on a headless Linux box with no Secret Service
// provider running, libsecret has no backend and these calls will throw. We surface that as
// a clear, actionable error rather than crashing opaquely.
const { Entry, findCredentials } = require("@napi-rs/keyring");

const SERVICE_PREFIX = "palsync:";

function serviceFor(url) {
    return SERVICE_PREFIX + url;
}

// Platform-specific hint for a keychain failure. macOS over SSH (a non-GUI "Background" security
// session) refuses WRITES with "User interaction is not allowed" — the OS wants to show an
// allow-access dialog and can't. The fix is to unlock the login keychain in that session. On Linux
// the usual cause is no running Secret Service provider.
function backendHint() {
    if (process.platform === "darwin") {
        return " On macOS over SSH the login keychain can't prompt — unlock it in this session with " +
            "`security unlock-keychain ~/Library/Keychains/login.keychain-db`, or run from the Mac's own Terminal (a GUI login).";
    }
    if (process.platform === "linux") {
        return " On Linux, ensure a Secret Service provider (e.g. gnome-keyring / KWallet, or `libsecret`) is installed and unlocked.";
    }
    return "";
}

// Wrap keyring calls so a missing OS backend yields a clear message (decision 4 / x-platform).
function withBackend(action, fn) {
    try {
        return fn();
    } catch (err) {
        throw new Error(
            "OS keychain unavailable (" + action + "): " + (err && err.message ? err.message : err) +
            "." + backendHint()
        );
    }
}

// Store (or overwrite) the password for url+username. Encrypted at rest by the OS.
function setCredential(url, username, password) {
    withBackend("store", () => new Entry(serviceFor(url), username).setPassword(password));
}

// Return the stored password for url+username, or null if none.
function getPassword(url, username) {
    return withBackend("read", () => new Entry(serviceFor(url), username).getPassword());
}

// List usernames that have cached credentials for a cloud (no on-disk index needed).
function listUsernames(url) {
    const creds = withBackend("list", () => findCredentials(serviceFor(url))) || [];
    return creds.map(c => c.account);
}

// Remove the stored credential for url+username (used on logout / 401 invalidation).
function deleteCredential(url, username) {
    withBackend("delete", () => {
        try { new Entry(serviceFor(url), username).deleteCredential(); } catch (e) { /* already gone */ }
    });
}

module.exports = { setCredential, getPassword, listUsernames, deleteCredential, serviceFor, backendHint };
