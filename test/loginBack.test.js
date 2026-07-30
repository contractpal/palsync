"use strict";
// login()'s back-navigable step machine (src/auth/credentials.js): cloud -> account (skipped
// if no cached usernames) -> username -> password, with Esc/BACK at any step moving back one,
// and BACK from "cloud" (nothing earlier) propagating out of login() entirely. keychain/session
// are mocked via the module cache, like test/debug.test.js.
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const { BACK } = require("../src/core/back");

const keychainPath = require.resolve("../src/platform/keychain");
const sessionPath = require.resolve("../src/core/session");
const configPath = require.resolve("../src/platform/config");
const credentialsPath = require.resolve("../src/auth/credentials");

// queue(...) returns a function that yields each argument in order on successive calls.
function queue(...values) {
    let i = 0;
    return async (...args) => {
        const v = values[Math.min(i, values.length - 1)];
        i++;
        return typeof v === "function" ? v(...args) : v;
    };
}

function loadCredentialsMocked({ cachedUsernames = {}, authenticateImpl } = {}) {
    delete require.cache[credentialsPath];
    require.cache[keychainPath] = {
        id: keychainPath, filename: keychainPath, loaded: true,
        exports: {
            listUsernames: (url) => cachedUsernames[url] || [],
            getPassword: () => null,          // force a password prompt every time in these tests
            setCredential: () => {},
            deleteCredential: () => {}
        }
    };
    require.cache[sessionPath] = {
        id: sessionPath, filename: sessionPath, loaded: true,
        exports: { authenticate: authenticateImpl || (async (url, user) => ({ username: user, url })) }
    };
    require.cache[configPath] = {
        id: configPath, filename: configPath, loaded: true,
        exports: { get: (key, def) => def, set: () => {} }
    };
    return require(credentialsPath);
}

afterEach(() => {
    delete require.cache[credentialsPath];
    delete require.cache[keychainPath];
    delete require.cache[sessionPath];
    delete require.cache[configPath];
});

test("BACK at the cloud step (nothing earlier) propagates out of login()", async () => {
    const { login } = loadCredentialsMocked();
    const prompts = { pickCloud: queue(BACK) };
    const result = await login({ prompts });
    assert.equal(result, BACK);
});

test("BACK at the account step goes back to cloud, then a fresh pick proceeds", async () => {
    const { login } = loadCredentialsMocked({ cachedUsernames: { "https://a": ["alice"], "https://b": ["bob"] } });
    const prompts = {
        pickCloud: queue("https://a", "https://b"),
        pickAccount: queue(BACK, "bob"),
        askPassword: queue("pw")
    };
    const result = await login({ prompts });
    assert.equal(result.cloudUrl, "https://b");
    assert.equal(result.username, "bob");
});

test("account step is skipped when there are no cached usernames", async () => {
    const { login } = loadCredentialsMocked({ cachedUsernames: {} });
    const prompts = {
        pickCloud: queue("https://a"),
        pickAccount: queue("should not be called"),
        askUsername: queue("newuser"),
        askPassword: queue("pw")
    };
    const result = await login({ prompts });
    assert.equal(result.username, "newuser");
});

test("BACK at the username step returns to account when cached users exist", async () => {
    const { login } = loadCredentialsMocked({ cachedUsernames: { "https://a": ["alice"] } });
    const prompts = {
        pickCloud: queue("https://a"),
        pickAccount: queue("__new__", "alice"),
        askUsername: queue(BACK),
        askPassword: queue("pw")
    };
    const result = await login({ prompts });
    assert.equal(result.username, "alice");
});

test("BACK at the password step returns to account (username came from the cached list)", async () => {
    const { login } = loadCredentialsMocked({ cachedUsernames: { "https://a": ["alice", "bob"] } });
    const prompts = {
        pickCloud: queue("https://a"),
        pickAccount: queue("alice", "bob"),
        askPassword: queue(BACK, "pw")
    };
    const result = await login({ prompts });
    assert.equal(result.username, "bob");
});

test("BACK at the password step returns to username (freshly typed, not cached)", async () => {
    const { login } = loadCredentialsMocked({ cachedUsernames: {} });
    const prompts = {
        pickCloud: queue("https://a"),
        askUsername: queue("newuser", "otheruser"),
        askPassword: queue(BACK, "pw")
    };
    const result = await login({ prompts });
    assert.equal(result.username, "otheruser");
});

test("resuming with cloudUrl+username fast-forwards to the password step", async () => {
    const { login } = loadCredentialsMocked({ cachedUsernames: { "https://a": ["alice"] } });
    let cloudCalled = false, accountCalled = false;
    const prompts = {
        pickCloud: async () => { cloudCalled = true; return "https://a"; },
        pickAccount: async () => { accountCalled = true; return "alice"; },
        askPassword: queue("pw")
    };
    const result = await login({ cloudUrl: "https://a", username: "alice", prompts });
    assert.equal(cloudCalled, false);
    assert.equal(accountCalled, false);
    assert.equal(result.username, "alice");
});

test("resumed login: BACK from password walks back to account, then cloud", async () => {
    const { login } = loadCredentialsMocked({ cachedUsernames: { "https://a": ["alice"], "https://b": ["carol"] } });
    const prompts = {
        pickCloud: queue("https://b"),
        pickAccount: queue(BACK, "carol"),
        askPassword: queue(BACK, "pw")
    };
    const result = await login({ cloudUrl: "https://a", username: "alice", prompts });
    assert.equal(result.cloudUrl, "https://b");
    assert.equal(result.username, "carol");
});

test("auth failure re-prompts the password, retaining back-navigation", async () => {
    let authCalls = 0;
    const { login } = loadCredentialsMocked({
        cachedUsernames: {},
        authenticateImpl: async (url, user, pass) => {
            authCalls++;
            if (pass === "wrong") throw new Error("bad creds");
            return { username: user, url };
        }
    });
    const prompts = {
        pickCloud: queue("https://a"),
        askUsername: queue("newuser"),
        askPassword: queue("wrong", "right"),
        onAuthFailure: () => {}
    };
    const result = await login({ prompts });
    assert.equal(authCalls, 2);
    assert.equal(result.username, "newuser");
});
