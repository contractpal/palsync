"use strict";
// Test accounts: extra platform logins a developer stores per cloud so "test login with Bob" can
// sign in as someone other than herself. Kept in the OS keychain under a SEPARATE service
// ("palsync-test:<cloud url>") from the developer's own credentials ("palsync:<url>") — if they
// shared a namespace, keychain.listUsernames() would count a test account as the developer's own
// sign-in and break the single-account auto-login.
//
// account = alias (what the developer types: "Bob", "Bob Admin"); secret = JSON {username,password}
// because the alias is not the username. The password never leaves this module except to the
// in-process login step — never to an agent, a log, or an MCP result.
const { Entry, findCredentials } = require("@napi-rs/keyring");

const SERVICE_PREFIX = "palsync-test:";

function serviceFor(url) {
    return SERVICE_PREFIX + url;
}

// Aliases match case-insensitively with surrounding/duplicate whitespace ignored.
function normalizeAlias(alias) {
    return String(alias == null ? "" : alias).trim().replace(/\s+/g, " ").toLowerCase();
}

function parseSecret(raw) {
    try {
        const v = JSON.parse(raw);
        return v && typeof v.username === "string" && typeof v.password === "string" ? v : null;
    } catch (e) { return null; }
}

function entries(url) {
    return findCredentials(serviceFor(url)) || [];
}

// Aliases stored for a cloud, as the developer typed them. Never includes secrets.
function listAliases(url) {
    return entries(url).map(c => c.account).sort((a, b) => a.localeCompare(b));
}

// Same list with the (non-secret) username, for the GUI's management screen.
function listAccounts(url) {
    return entries(url)
        .map(c => { const s = parseSecret(c.password); return { alias: c.account, username: s ? s.username : "" }; })
        .sort((a, b) => a.alias.localeCompare(b.alias));
}

// { alias, username, password } for the alias on this cloud, or null when none matches.
function getTestAccount(url, alias) {
    const want = normalizeAlias(alias);
    if (!want) return null;
    for (const c of entries(url)) {
        if (normalizeAlias(c.account) !== want) continue;
        const s = parseSecret(c.password);
        return s ? { alias: c.account, username: s.username, password: s.password } : null;
    }
    return null;
}

// Add or replace. Re-saving an alias that differs only by case/spacing replaces that entry rather
// than creating a second one the lookup could not tell apart.
function setTestAccount(url, alias, username, password) {
    const clean = String(alias == null ? "" : alias).trim().replace(/\s+/g, " ");
    if (!clean) throw new Error("A test account needs an alias.");
    if (!username || !password) throw new Error("A test account needs a username and a password.");
    const existing = entries(url).find(c => normalizeAlias(c.account) === normalizeAlias(clean));
    if (existing && existing.account !== clean) new Entry(serviceFor(url), existing.account).deleteCredential();
    new Entry(serviceFor(url), clean).setPassword(JSON.stringify({ username, password }));
}

function deleteTestAccount(url, alias) {
    const want = normalizeAlias(alias);
    const hit = entries(url).find(c => normalizeAlias(c.account) === want);
    if (!hit) return false;
    try { new Entry(serviceFor(url), hit.account).deleteCredential(); } catch (e) { return false; }
    return true;
}

module.exports = { listAliases, listAccounts, getTestAccount, setTestAccount, deleteTestAccount, normalizeAlias, serviceFor };
