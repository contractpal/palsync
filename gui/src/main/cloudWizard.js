"use strict";
// Backing logic for the "Create new pal" wizard: cloud -> login -> profile -> groups -> details.
// Reuses palsync's own session/API/orchestration code rather than reimplementing any of it —
// see gui/BUILD.md's sibling design notes / the plan this was built from for the full trace.
const { authenticate } = require("palsync/src/core/session");
const { resolvePassword } = require("palsync/src/auth/credentialStore");
const keychain = require("palsync/src/platform/keychain");
const config = require("palsync/src/platform/config");
const { getClouds } = require("palsync/src/auth/credentials");
const { CloudPistonAPIManager } = require("palsync/lib/apiManager");
const { createNewPal } = require("palsync/src/core/createPal");
const workspace = require("palsync/src/launcher/workspace");
const palFolder = require("./palFolder");
const { ensureElectronRunAsNode, ensureElectronRunAsNodeForHooks } = require("./agentLaunch");
const fs = require("fs");
const path = require("path");

// Maps workspace.setup()'s `agent` key to the MCP config file it wrote, for the same
// electron.exe-as-node patch ensureMcpRegistered() applies to the existing-folder flow.
const AGENT_KEY_TO_CONFIG_FILE = { claude: ".mcp.json", opencode: "opencode.json" };

// Held for the lifetime of one wizard run. Only one workspace/wizard is ever active at a time
// in this app, so a single module-level session is sufficient (not a per-request map).
let currentSession = null;
let currentCloudUrl = null;

// Display-name overrides, keyed by URL, stored entirely GUI-side (not in palsync's own
// customClouds list) so renaming works uniformly for both custom clouds AND the two hardcoded
// defaults (Cloudpiston, Nimblewire) — those aren't in any list this app can edit directly.
function getNameOverrides() {
    return config.get("cloudNameOverrides", {});
}

function listClouds() {
    const overrides = getNameOverrides();
    return getClouds().map(c => overrides[c.url] ? Object.assign({}, c, { name: overrides[c.url] }) : c);
}

function renameCloud(url, name) {
    if (!name || !name.trim()) return;
    const overrides = getNameOverrides();
    overrides[url] = name.trim();
    config.set("cloudNameOverrides", overrides);
}

// Mirrors credentials.js's private addCustomCloud() — that function isn't exported, so this
// re-implements its small persistence logic directly over the same "customClouds" config key
// rather than widening palsync's own exports for one helper.
function addCloud(url, displayName) {
    if (!url || typeof url !== "string") return;
    url = url.trim();
    if (!url) return;
    let normalizedUrl = url;
    if (!/^https?:\/\//i.test(url)) normalizedUrl = "https://" + url;
    try {
        const parsed = new URL(normalizedUrl);
        const name = (displayName && displayName.trim()) || parsed.hostname || url;
        const defaults = getClouds();
        if (defaults.some(c => c.url === normalizedUrl)) return;
        const custom = config.get("customClouds", []);
        if (custom.some(c => c.url === normalizedUrl)) return;
        custom.push({ name, url: normalizedUrl });
        config.set("customClouds", custom);
    } catch (e) {
        // ignore invalid URL
    }
}

function knownAccountsForCloud(cloudUrl) {
    try { return keychain.listUsernames(cloudUrl); }
    catch (e) { return []; }
}

// Only custom (user-added) clouds — the two hardcoded defaults (Cloudpiston/Nimblewire) aren't
// deletable, so this is exactly the deletable list for a "manage clouds" screen.
function listCustomClouds() {
    return config.get("customClouds", []);
}

// Deletes every cached credential under the cloud, and removes it from the custom-clouds list
// if it's a custom entry. Hardcoded default clouds (Cloudpiston, Nimblewire) have no list entry
// to remove — deleting one just clears its cached credentials, so the next login there prompts
// fresh again; the cloud itself still shows up (it's hardcoded), same as it always has.
function deleteCloud(url) {
    for (const username of knownAccountsForCloud(url)) {
        try { keychain.deleteCredential(url, username); } catch (e) { /* best-effort */ }
    }
    const custom = listCustomClouds().filter(c => c.url !== url);
    config.set("customClouds", custom);
    const overrides = getNameOverrides();
    if (overrides[url]) { delete overrides[url]; config.set("cloudNameOverrides", overrides); }
}

// If exactly one cached account exists for this cloud and its password resolves (keychain or
// env), log in silently with it so the wizard can skip the password form entirely. Returns
// null (not an error) if there's nothing to auto-login with, or if the cached credential no
// longer works — caller falls back to the normal username/password form either way.
async function tryAutoLogin(cloudUrl) {
    const usernames = knownAccountsForCloud(cloudUrl);
    if (usernames.length !== 1) return null;
    const username = usernames[0];
    const { password } = resolvePassword(cloudUrl, username);
    if (!password) return null;
    try {
        return await doAuthenticate(cloudUrl, username, password);
    } catch (e) {
        return null;
    }
}

async function doAuthenticate(cloudUrl, username, password, cloudName) {
    const session = await authenticate(cloudUrl, username, password);
    keychain.setCredential(cloudUrl, username, password);
    addCloud(cloudUrl, cloudName);
    currentSession = session;
    currentCloudUrl = cloudUrl;
    return { username, cloudUrl };
}

function requireSession() {
    if (!currentSession) throw new Error("Not logged in — authenticate before listing profiles/groups.");
    return currentSession;
}

async function listProfiles() {
    const session = requireSession();
    const resp = await CloudPistonAPIManager.getProfileList(session);
    if (!resp || !resp.success) throw new Error("Could not load profiles (getProfileList failed).");
    return (resp.profileList && resp.profileList["com.contractpal.pal.ProfileInfo"]) || [];
}

async function listGroups(profileId) {
    const session = requireSession();
    const resp = await CloudPistonAPIManager.getGroupList(session, profileId);
    if (!resp || !resp.success) throw new Error("Could not load groups (getGroupList failed).");
    return (resp.groupList && resp.groupList["com.contractpal.pal.GroupInfo"]) || [];
}

async function createPal({ profileId, groupIds, name, description, category }) {
    const session = requireSession();
    return createNewPal(session, { profileId, groupIds, name, description, category });
}

// PalInfoEx's own field names (name, guid, description, branchName, lastModifiedDate) —
// unlike Profile/GroupInfo there's no gotcha here, but normalize the same way selection.js's
// (unexported) normalizePal does, for consistency if that ever needs comparing side by side.
async function listPals(profileId, groupId) {
    const session = requireSession();
    // includeTest/includeInstalled default to false server-side, silently filtering out most
    // real-world pals — src/core/resolve.js always passes both true; match that.
    const resp = await CloudPistonAPIManager.getPalList(session, profileId, groupId, { includeTest: true, includeInstalled: true });
    if (!resp || !resp.success) throw new Error("Could not load pals (getPalList failed).");
    return (resp.palInfoList && resp.palInfoList.PalInfoEx) || [];
}

// baseDir overrides the default `~/PalBuilder` parent — the GUI's own configurable default pal
// folder location setting (File menu), read by the caller from appState and passed through here.
function defaultWorkspaceDir(name, baseDir) {
    return workspace.defaultWorkspaceDir(name, null, baseDir);
}

// Create/open-from-cloud always pull into a brand-new folder, even for a pal already checked
// out elsewhere (the standing rule: every local process/checkout gets its own distinct folder,
// never a shared one, even for the same server-side pal). If the default path is already
// taken, suffix it " (2)", " (3)", ... like a file manager would, until a free one is found.
function resolveAvailableDir(baseDir) {
    if (!fs.existsSync(baseDir)) return baseDir;
    let n = 2;
    while (fs.existsSync(baseDir + " (" + n + ")")) n++;
    return baseDir + " (" + n + ")";
}

// Pull the newly created pal to disk, lock it, inject context, write .palsync.json, and
// register MCP for the given agent — all via palsync's own workspace.setup() orchestration —
// then turn the resulting folder into a workspace tab entry the same way "existing folder" does.
async function materialize({ profile, palGuid, palName, workspaceDir, agentKey, onLog, onStep, forceLock }) {
    const session = requireSession();
    const resolvedAgentKey = agentKey || "claude";
    await workspace.setup({
        session,
        cloudUrl: currentCloudUrl,
        sel: { profile, pal: { guid: palGuid, name: palName } },
        workspaceDir,
        agent: resolvedAgentKey,
        log: onLog || (() => {}),
        onStep: onStep || (() => {}),
        forceLock: !!forceLock
    });
    const configFile = AGENT_KEY_TO_CONFIG_FILE[resolvedAgentKey];
    if (configFile) await ensureElectronRunAsNode(path.join(workspaceDir, configFile), configFile);
    await ensureElectronRunAsNodeForHooks(workspaceDir);
    const validation = await palFolder.validatePalFolder(workspaceDir);
    if (!validation.ok) throw new Error("Pal created, but the local folder didn't validate afterward: " + validation.reason);
    return palFolder.tabFromRecord(workspaceDir, validation.record);
}

module.exports = {
    listClouds, listCustomClouds, addCloud, deleteCloud, renameCloud, knownAccountsForCloud, authenticate: doAuthenticate, tryAutoLogin,
    listProfiles, listGroups, listPals, createPal, defaultWorkspaceDir, resolveAvailableDir, materialize
};
