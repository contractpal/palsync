"use strict";
// Keychain-backed CLI login. Flow: pick cloud -> resolve account -> get password (cached or
// masked prompt) -> validate via Ping.do -> store in OS keychain on success. Second run finds
// valid cached creds and skips the prompt entirely. No env vars, no plaintext on disk.
//
// Back-navigable step machine (mirrors launcher/selection.js's runSelection): cloud -> account
// (skipped if no cached usernames) -> username (only shown when there's no cached account to
// pick, or the user chose "different account") -> password. Esc at any step goes back one;
// Esc at "cloud" (nothing earlier) returns BACK to the caller, which decides what that means.
//
// Resumable entry: passing `username` (and `cloudUrl`) fast-forwards straight to "password",
// which is what lets launcher/index.js re-enter login at its last step when the user backs out
// of the profile picker — the whole login+selection flow reads as one continuous back stack.
//
// Prompts are injectable (defaults use @clack/prompts) so the flow is testable headlessly.
const { loadClack } = require("../platform/uiPrompts");
const { authenticate } = require("../core/session");
const keychain = require("../platform/keychain");
const config = require("../platform/config");
const { BACK } = require("../core/back");

// Known clouds; users can also enter a custom URL. Remembered selection handled by the launcher.
const DEFAULT_CLOUDS = [
    { name: "Cloudpiston", url: "https://secure.cloudpiston.com" },
    { name: "Nimblewire", url: "https://secure.nimblewire.net" }
];

function getClouds() {
    const custom = config.get("customClouds", []);
    return [...DEFAULT_CLOUDS, ...custom];
}

function addCustomCloud(url) {
    if (!url || typeof url !== "string") return;
    url = url.trim();
    if (!url) return;

    // Ensure protocol for URL parsing
    let normalizedUrl = url;
    if (!/^https?:\/\//i.test(url)) normalizedUrl = "https://" + url;

    try {
        const parsed = new URL(normalizedUrl);
        const name = parsed.hostname || url;

        if (DEFAULT_CLOUDS.some(c => c.url === normalizedUrl)) return;
        const custom = config.get("customClouds", []);
        if (custom.some(c => c.url === normalizedUrl)) return;

        custom.push({ name, url: normalizedUrl });
        config.set("customClouds", custom);
    } catch (e) {
        // Ignore invalid URLs
    }
}

// Default interactive prompts (TTY). Each returns the user's input, or BACK on Esc.
const defaultPrompts = {
    // Self-contained retry loop: Esc on the cloud list returns BACK (nothing earlier); Esc on
    // the follow-up custom-URL text just re-shows the cloud list rather than going further back.
    async pickCloud(clouds) {
        if (!clouds) clouds = getClouds();
        const clack = await loadClack();
        while (true) {
            const choice = await clack.select({
                message: "Select cloud",
                options: [...clouds.map(c => ({ value: c.url, label: c.name + "  (" + c.url + ")" })),
                          { value: "__custom__", label: "Custom URL…" }]
            });
            if (clack.isCancel(choice)) return BACK;
            if (choice !== "__custom__") return choice;
            const url = await clack.text({ message: "Cloud base URL", placeholder: "https://…" });
            if (clack.isCancel(url)) continue;
            return url;
        }
    },
    // Returns a cached username, the literal "__new__" (chose "different account"), or BACK.
    async pickAccount(usernames) {
        const clack = await loadClack();
        const choice = await clack.select({
            message: "Account",
            options: [...usernames.map(u => ({ value: u, label: u + "  (cached)" })),
                      { value: "__new__", label: "Use a different account…" }]
        });
        return clack.isCancel(choice) ? BACK : choice;
    },
    async askUsername() {
        const clack = await loadClack();
        const v = await clack.text({ message: "Username" });
        return clack.isCancel(v) ? BACK : v;
    },
    async askPassword(username, cloudUrl) {
        const clack = await loadClack();
        const v = await clack.password({ message: "Password for " + username + " @ " + cloudUrl });
        return clack.isCancel(v) ? BACK : v;
    },
    onAuthFailure(username, cloudUrl, attempt, err) {
        const detail = err && err.message ? " (" + err.message + ")" : "";
        process.stderr.write("Login failed for " + username + detail + " — try again.\n");
    }
};

// Returns BACK (backed out past "cloud" — the caller decides what that means, e.g. cancel the
// whole app), or { session, cloudUrl, username, prompted }. `prompted` is false when valid
// cached creds let us skip straight past every prompt.
//
// Passing `cloudUrl`/`username` fast-forwards the starting step (see the module comment) —
// used to resume login right at "password" when the caller re-enters after a BACK from a later
// screen (e.g. the pal-selection profile picker).
async function login({ cloudUrl, username, prompts = defaultPrompts, forcePrompt = false } = {}) {
    let step = username ? "password" : (cloudUrl ? "account" : "cloud");
    let prompted = false;
    let password = null;
    let cachedUsers = [];
    if (cloudUrl) {
        try { cachedUsers = keychain.listUsernames(cloudUrl); } catch (e) { /* keychain unavailable */ }
    }

    while (true) {
        if (step === "cloud") {
            const choice = await prompts.pickCloud(getClouds());
            if (choice === BACK) return BACK;
            cloudUrl = choice;
            prompted = true;
            cachedUsers = [];
            try { cachedUsers = keychain.listUsernames(cloudUrl); } catch (e) { /* keychain unavailable */ }
            step = "account";
            continue;
        }

        if (step === "account") {
            if (!cachedUsers.length) { step = "username"; continue; }
            const choice = await prompts.pickAccount(cachedUsers);
            if (choice === BACK) { step = "cloud"; continue; }
            if (choice === "__new__") { step = "username"; continue; }
            username = choice;
            password = null;
            step = "password";
            continue;
        }

        if (step === "username") {
            const choice = await prompts.askUsername();
            if (choice === BACK) { step = cachedUsers.length ? "account" : "cloud"; continue; }
            username = choice;
            prompted = true;
            password = null;
            step = "password";
            continue;
        }

        // step === "password"
        // Prefer cached password; only prompt if absent or explicitly forced. A locked/
        // unavailable keychain (e.g. SSH session into macOS) must not block login — degrade to
        // prompting.
        if (!password && !forcePrompt) {
            try { password = keychain.getPassword(cloudUrl, username); }
            catch (err) { process.stderr.write("Warning: " + err.message + " — continuing without cached credentials.\n"); }
        }
        if (!password) {
            const choice = await prompts.askPassword(username, cloudUrl);
            if (choice === BACK) {
                step = (cachedUsers.length && cachedUsers.includes(username)) ? "account" : "username";
                continue;
            }
            password = choice;
            prompted = true;
        }

        let session;
        let authAttempt = 0;
        let authFailed = false;
        while (true) {
            try {
                session = await authenticate(cloudUrl, username, password);
                break;
            } catch (err) {
                // Invalid creds: drop any cached value and re-prompt the password.
                try { keychain.deleteCredential(cloudUrl, username); } catch (e) { /* keychain unavailable */ }
                password = null;
                if (typeof prompts.onAuthFailure === "function") {
                    prompts.onAuthFailure(username, cloudUrl, authAttempt, err);
                }
                authAttempt++;
                if (authAttempt >= 4) throw new Error("Authentication failed after multiple attempts for " + username + " @ " + cloudUrl);
                const choice = await prompts.askPassword(username, cloudUrl);
                if (choice === BACK) { authFailed = true; break; }
                password = choice;
            }
        }
        if (authFailed) {
            step = (cachedUsers.length && cachedUsers.includes(username)) ? "account" : "username";
            continue;
        }

        try {
            keychain.setCredential(cloudUrl, username, password); // persist validated creds
        } catch (err) {
            process.stderr.write("Warning: " + err.message + " — credentials will not be remembered.\n");
        }
        // If it was a custom cloud URL, remember it for next time.
        addCustomCloud(cloudUrl);
        return { session, cloudUrl, username, prompted };
    }
}

module.exports = { login, getClouds, defaultPrompts };
