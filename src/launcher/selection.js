"use strict";
// Interactive pal selection: getProfileList -> getGroupList -> getPalList as navigable menus
// with back-navigation (mirrors the extension's pullPal.js wizard). Returns the chosen pal's
// transient id, stable GUID, name, and lastModifiedDate (the drift marker). Prompts are
// injectable (real UI in launcher/prompts.js) so the flow is testable headlessly.
const { CloudPistonAPIManager } = require("../../lib/apiManager");
const { listKeys } = require("../core/createPal");
const { timestampText } = require("../core/resolve");
const { BACK } = require("../core/back");

async function listProfiles(session) {
    const resp = await CloudPistonAPIManager.getProfileList(session);
    if (!resp || !resp.success) throw new Error("getProfileList failed");
    return (resp.profileList && resp.profileList["com.contractpal.pal.ProfileInfo"]) || [];
}

async function listGroups(session, profileId) {
    const resp = await CloudPistonAPIManager.getGroupList(session, profileId);
    if (!resp || !resp.success) throw new Error("getGroupList failed");
    return (resp.groupList && resp.groupList["com.contractpal.pal.GroupInfo"]) || [];
}

async function listPals(session, profileId, groupId) {
    const resp = await CloudPistonAPIManager.getPalList(session, profileId, groupId);
    if (!resp || !resp.success) throw new Error("getPalList failed");
    return (resp.palInfoList && resp.palInfoList.PalInfoEx) || [];
}

// Normalize a PalInfoEx into the fields palsync cares about.
function normalizePal(p) {
    return {
        id: p.id,                                  // transient — used now for getPal/lock, never persisted
        guid: p.guid,                              // stable — persisted in .palsync.json
        name: p.name,
        description: p.description,
        branch: p.branchName || "",
        lastModifiedDate: timestampText(p.lastModifiedDate)  // drift marker
    };
}

// Walk profile -> [open existing | create new] with back support.
//   open:   profile -> group (single) -> pal   -> { mode:"open",   profile, group, pal }
//   create: profile -> groups (1+) -> details -> key -> { mode:"create", profile, groups, details, activationKey }
// Returns null if the user cancels out, or BACK if they back out of the very first step
// (profile) — there's no earlier step in here to fall back to; the caller (launcher/index.js)
// re-enters the login flow at its last step so the whole thing feels like one continuous stack.
// No mutations here — the orchestrator performs the create (CreatePalFromBuilder) so this stays
// pure prompts + GET-list calls.
// forceCreate skips the open/create mode prompt (eval-harness runs always create a fresh pal);
// defaultName prefills the new-pal name prompt (from the eval spec's `pal:` line).
async function runSelection(session, prompts, { forceCreate = false, defaultName } = {}) {
    let step = "profile";
    let profile, group, groups, details;
    while (true) {
        if (step === "profile") {
            const profiles = await listProfiles(session);
            const choice = await prompts.pickProfile(profiles);
            if (choice === BACK) return BACK;
            if (!choice) return null;
            profile = choice;
            step = forceCreate ? "groups" : "mode";
        } else if (step === "mode") {
            const choice = await prompts.pickMode();
            if (choice === BACK) { step = "profile"; continue; }
            if (!choice) return null;
            step = choice === "create" ? "groups" : "group";
        } else if (step === "group") {           // open existing — single group
            const all = await listGroups(session, profile.profileId);
            const choice = await prompts.pickGroup(all);
            if (choice === BACK) { step = "mode"; continue; }
            if (!choice) return null;
            group = choice;
            step = "pal";
        } else if (step === "pal") {
            const pals = await listPals(session, profile.profileId, group.groupId);
            const choice = await prompts.pickPal(pals);
            if (choice === BACK) { step = "group"; continue; }
            if (!choice) return null;
            return { mode: "open", profile, group, pal: normalizePal(choice) };
        } else if (step === "groups") {          // create new — one or more groups
            const all = await listGroups(session, profile.profileId);
            const choice = await prompts.pickGroups(all);
            if (choice === BACK) { step = forceCreate ? "profile" : "mode"; continue; }
            if (!choice || !choice.length) return null;
            groups = choice;
            step = "details";
        } else if (step === "details") { // name, description, category (desc/category default to name)
            const choice = await prompts.pickNewPalDetails(defaultName);
            if (choice === BACK) { step = "groups"; continue; }
            if (!choice) return null;
            details = choice;
            step = "key";
        } else { // key — entitlements vary per key (Developer keys can't run Web workflows) and
                 // the keys API doesn't expose them, so the human picks. One key -> use it silently.
            const keys = await listKeys(session, profile.profileId);
            if (!keys.length) throw new Error("No activation keys available for this profile (GetKeysForBuilder).");
            if (keys.length === 1) {
                return { mode: "create", profile, groups, details, activationKey: keys[0].value };
            }
            const choice = await prompts.pickActivationKey(keys);
            if (choice === BACK) { step = "details"; continue; }
            if (!choice) return null;
            return { mode: "create", profile, groups, details, activationKey: choice };
        }
    }
}

module.exports = { runSelection, normalizePal, BACK };
