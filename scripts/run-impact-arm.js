#!/usr/bin/env node
"use strict";
// Self-driven impact-pilot arm: seed a fresh Pal, then run the arm headlessly with zero intervention.
//
// WHY THIS EXISTS: `palsync --eval <task>` seeds and then hands off to an INTERACTIVE agent
// (src/launcher/agents.js:13 spawns bare `claude` with stdio inherited), so every arm needed an
// operator sitting in a terminal. This drives the same seeding code with the prompts answered from
// recorded facts, then runs the agent as `claude -p`, which needs no TTY.
//
// WHAT IS HELD IDENTICAL TO ARMS 1-3 (all verified, not assumed):
//   - the SEEDING CODE: the installed launcher's own `run({ autoLaunch: false })`. Not a
//     reimplementation — same fresh-Pal creation, baseline push, fixture injection and receipt.
//   - the FROZEN INSTALL, never the repo checkout. The pilot forbids the harness moving between
//     arms, and the repo is ahead of the pinned install by scoring-only commits.
//   - profile + group: read off the recorded arms' own Pals (they all live in one group).
//   - description/category == name: the create prompt's documented default (selection.js:87), and
//     what all three recorded Pals actually carry.
//   - model: ANTHROPIC_MODEL, because the launcher passes no --model and settings.json pins opus.
//     The runsheet calls this the MODEL TRAP. Verify from the transcript, never from /status.
//   - permission mode: bypassPermissions, recorded on every turn of arms 1-3.
//   - prompt: eval/runs/impact-arm-prompt.txt, byte-identical, exactly one turn.
//
// WHAT DIFFERS: interactive TUI vs `-p`. That is the one open confound; see
// eval/runs/headless-equivalence-preregistration.md for the validation run that gates its use.
//
// ZERO INTERVENTION is structural here: this process holds no channel to the agent after spawn.
// It must not read or write the workspace while the agent runs.
//
// Usage:
//   node scripts/run-impact-arm.js --task impact_01_shared_fragment-off --name impact_01_shared_fragment04
//   node scripts/run-impact-arm.js --task ... --name ... --seed-only        (stop after seeding)
//   node scripts/run-impact-arm.js --task ... --name ... --no-digest-check  (first arm of a NEW task)
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const INSTALL = "/Users/apple/.local/lib/node_modules/palsync";
const CLOUD = "https://secure.cloudpiston.com";
const USERNAME = "sam.martineau2000@gmail.com";
// The arm's fresh Pal must land where the recorded arms live. `profileId`/`groupId` CANNOT be
// hardcoded — they are session-transient (a fresh login returns entirely different values, the same
// way `PalInfoEx.id` is transient while `guid` is stable). So a preflight locates the profile+group
// that actually holds a recorded arm's Pal GUID, and the prompt stubs then match by NAME. Anchoring
// on evidence beats a name literal: if the Pals move, the preflight follows them.
const ANCHOR_PAL_GUID = "PAL-SE-19FD4515428-662060A5";   // impact01-r1 off, the first recorded arm
const MODEL = "claude-haiku-4-5-20251001";
const PROMPT_FILE = path.join(__dirname, "..", "eval", "runs", "impact-arm-prompt.txt");
// Every recorded arm of task 01 carries this digest. A fresh seed that disagrees is not the same
// experiment, and the cost of finding out is one junk Pal instead of a corrupted arm.
const EXPECTED_DIGEST = { impact_01_shared_fragment: "sha256:0153bbac9272e9580140c2eb3f7b53ed85cea47f2f9a8a52a6719a28aeacfa5d" };

function parseArgs(argv) {
    const flags = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--task") flags.task = argv[++i];
        else if (a === "--name") flags.name = argv[++i];
        else if (a === "--seed-only") flags.seedOnly = true;
        else if (a === "--no-digest-check") flags.noDigestCheck = true;
        else if (a === "--key") flags.key = argv[++i];
        else throw new Error("unknown flag " + a);
    }
    if (!flags.task) throw new Error("--task is required (e.g. impact_01_shared_fragment-off)");
    if (!flags.name) throw new Error("--name is required (the fresh Pal's name)");
    if (!/-(on|off)$/.test(flags.task)) throw new Error("--task must end in -on or -off");
    if (!flags.key) throw new Error("--key is required: the activation key NAME. The fixture ships a " +
        "Console Workflow, so a key without that entitlement fails the baseline push after the Pal " +
        "already exists on the server. Never let this default.");
    return flags;
}

// Find the profile+group holding the anchor Pal, and return their NAMES (stable across sessions,
// unlike the ids). Uses its own session so it cannot perturb the launcher's.
async function locatePlacement() {
    const { login } = require(INSTALL + "/src/auth/credentials");
    const { CloudPistonAPIManager: api } = require(INSTALL + "/lib/apiManager");
    const result = await login({ cloudUrl: CLOUD, username: USERNAME });
    if (!result || !result.session) throw new Error("preflight login failed (no cached credentials?)");
    const { session } = result;
    const profileResp = await api.getProfileList(session);
    const profiles = (profileResp.profileList && profileResp.profileList["com.contractpal.pal.ProfileInfo"]) || [];
    for (const profile of profiles) {
        const groupResp = await api.getGroupList(session, profile.profileId);
        const groups = (groupResp.groupList && groupResp.groupList["com.contractpal.pal.GroupInfo"]) || [];
        for (const group of groups) {
            const palResp = await api.getPalList(session, profile.profileId, group.groupId);
            const raw = (palResp.palInfoList && palResp.palInfoList.PalInfoEx) || [];
            const pals = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
            if (pals.some(pal => pal.guid === ANCHOR_PAL_GUID)) {
                return { profileName: profile.profileName, groupName: group.name };
            }
        }
    }
    throw new Error("anchor pal " + ANCHOR_PAL_GUID + " not found in any profile/group — cannot place the arm " +
        "where the recorded arms live");
}

// Answers to every prompt the interactive launcher would ask, each one a recorded fact rather than a
// choice this script is making. Anything unexpected throws instead of picking something.
function stubs(palName, placement, keyName) {
    return {
        loginPrompts: {
            pickCloud: () => CLOUD,
            pickAccount: () => USERNAME,
        },
        selectionPrompts: {
            pickProfile: profiles => {
                const found = profiles.filter(p => p.profileName === placement.profileName);
                if (found.length !== 1) {
                    throw new Error("expected exactly 1 profile named " + JSON.stringify(placement.profileName) +
                        ", found " + found.length);
                }
                return found[0];
            },
            pickGroups: all => {
                const found = all.filter(g => g.name === placement.groupName);
                if (found.length !== 1) {
                    throw new Error("expected exactly 1 group named " + JSON.stringify(placement.groupName) +
                        " in " + placement.profileName + ", found " + found.length);
                }
                return [found[0]];
            },
            pickNewPalDetails: () => ({ name: palName, description: palName, category: palName }),
            // THE KEY IS NOT A GUESS AND MUST NOT BECOME ONE. Entitlements vary per activation key,
            // the keys API does not expose them (selection.js says so), and the Pal detail carries no
            // activation field, so the recorded arms' key is unrecoverable. Picking keys[0]
            // ("** Developer Activation Key I **") cost a junk Pal: the baseline push came back
            // `Activation key does not allow Console Workflow`, because the fixture ships
            // workflows/console.js. So --key names it explicitly and an unknown name throws.
            pickActivationKey: keys => {
                const found = keys.filter(k => k.name === keyName);
                if (found.length !== 1) {
                    throw new Error("activation key " + JSON.stringify(keyName) + " not found (or ambiguous). " +
                        "Available: " + keys.map(k => JSON.stringify(k.name)).join(", "));
                }
                return found[0].value;
            },
            pickMode: () => { throw new Error("mode prompt reached — eval runs must force create"); },
            pickGroup: () => { throw new Error("open-existing prompt reached — an arm must be a FRESH pal"); },
            pickPal: () => { throw new Error("pal-pick prompt reached — an arm must be a FRESH pal"); },
        },
        onDrift: () => { throw new Error("drift prompt on a fresh pal — refusing to guess"); },
    };
}

async function seed({ task, name, placement, keyName }) {
    const { run } = require(INSTALL + "/src/launcher/index.js");
    const s = stubs(name, placement, keyName);
    const workspaceDir = path.join(os.homedir(), "PalBuilder", name);
    if (fs.existsSync(workspaceDir)) throw new Error("workspace already exists: " + workspaceDir);
    const result = await run({
        evalSpec: task,
        agent: "claude",
        autoLaunch: false,          // seed only; this script owns the agent launch
        loginPrompts: s.loginPrompts,
        selectionPrompts: s.selectionPrompts,
        onDrift: s.onDrift,
        chooseWorkspaceDir: () => workspaceDir,
        log: message => console.log("  [launcher] " + message),
    });
    if (!result) throw new Error("launcher returned null (cancelled)");
    return result;
}

function readReceipt(workspaceDir) {
    const file = path.join(workspaceDir, ".palsync", "impact-start.json");
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value.schema !== "palsync/impact-start/1") throw new Error("unexpected receipt schema " + value.schema);
    return value;
}

function checkDigest(task, receipt, skip) {
    const taskKey = task.replace(/-(on|off)$/, "");
    const expected = EXPECTED_DIGEST[taskKey];
    if (!expected) {
        console.log("  no recorded digest for " + taskKey + " — this is the first arm of a new task; " +
            "digest " + receipt.fixtureDigest + " becomes its baseline");
        return;
    }
    if (receipt.fixtureDigest === expected) { console.log("  fixture digest matches the recorded arms"); return; }
    const message = "fixture digest " + receipt.fixtureDigest + " != recorded " + expected +
        " — this seed is NOT the same experiment as the recorded arms";
    if (!skip) throw new Error(message);
    console.log("  WARNING (--no-digest-check): " + message);
}

// Run the agent with no channel back to this process: stdin closed, output captured, nothing shared.
function runAgent(workspaceDir, prompt) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        // --mcp-config is NOT optional and NOT a preference. A project-scoped .mcp.json server sits
        // at "Pending approval" until a human trusts it interactively, and `-p` cannot approve. The
        // first headless validation run therefore had ZERO palsync MCP tools: the agent drove the
        // CLI over bash, never called pal_context, and the on arm silently became an off arm. Naming
        // the launcher-written config loads that exact server. No --strict-mcp-config: the globally
        // approved servers were present in arms 1-3 too, so dropping them would be its own confound.
        const child = spawn("claude", ["-p", prompt, "--permission-mode", "bypassPermissions",
            "--mcp-config", path.join(workspaceDir, ".mcp.json")], {
            cwd: workspaceDir,
            env: { ...process.env, ANTHROPIC_MODEL: MODEL },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "", err = "";
        child.stdout.on("data", d => { out += d; });
        child.stderr.on("data", d => { err += d; });
        child.on("error", reject);
        child.on("close", code => resolve({ code, out, err, wallMs: Date.now() - startedAt }));
    });
}

// The transcript the scoring pipeline reads. Claude Code names the project dir after the workspace
// path with every non-alphanumeric run replaced by a dash.
function transcriptsFor(workspaceDir) {
    const dir = path.join(os.homedir(), ".claude", "projects", workspaceDir.replace(/[^A-Za-z0-9]/g, "-"));
    let files = [];
    try { files = fs.readdirSync(dir).filter(n => n.endsWith(".jsonl")).map(n => path.join(dir, n)); }
    catch (error) { return { dir, files: [] }; }
    return { dir, files };
}

async function main() {
    const flags = parseArgs(process.argv);
    const prompt = fs.readFileSync(PROMPT_FILE, "utf8").trim();
    console.log("task: " + flags.task);
    console.log("pal:  " + flags.name);
    console.log("key:  " + JSON.stringify(flags.key));
    console.log("model: " + MODEL + "   prompt: " + prompt.length + " bytes from " + path.basename(PROMPT_FILE));

    console.log("\n-- preflight: where do the recorded arms live? --");
    const placement = await locatePlacement();
    console.log("  anchor " + ANCHOR_PAL_GUID + " is in profile " + JSON.stringify(placement.profileName) +
        " / group " + JSON.stringify(placement.groupName));

    console.log("\n-- seeding (installed launcher, autoLaunch off) --");
    const seeded = await seed({ ...flags, placement, keyName: flags.key });
    const workspaceDir = seeded.workspaceDir;
    const receipt = readReceipt(workspaceDir);
    console.log("  workspace " + workspaceDir);
    console.log("  palGuid   " + receipt.palGuid);
    console.log("  marker    " + receipt.serverMarker);
    checkDigest(flags.task, receipt, flags.noDigestCheck);

    if (flags.seedOnly) { console.log("\n--seed-only: stopping before the agent runs"); return; }

    console.log("\n-- running the arm (zero intervention: stdin closed, nothing shared) --");
    const agentRun = await runAgent(workspaceDir, prompt);
    console.log("  exit " + agentRun.code + " after " + Math.round(agentRun.wallMs / 1000) + "s");
    if (agentRun.err.trim()) console.log("  stderr: " + agentRun.err.trim().split("\n").slice(-3).join(" | "));
    console.log("  final message: " + agentRun.out.trim().split("\n").slice(-2).join(" | ").slice(0, 400));

    const { dir, files } = transcriptsFor(workspaceDir);
    console.log("\n-- transcript --");
    console.log("  dir " + dir);
    for (const file of files) console.log("  " + path.basename(file));
    if (files.length !== 1) {
        console.log("  WARNING: expected exactly 1 transcript; the scoring pipeline assumes one file per arm");
    }
    console.log("\nnext: copy the transcript to eval/runs/, then extract-session-cost.js --dir " +
        workspaceDir + ", then extract-impact-trajectory.js, then record-eval --output eval/impact-results.jsonl");
}

if (require.main === module) {
    main().catch(error => { console.error("run-impact-arm: " + error.message); process.exit(1); });
}
module.exports = { transcriptsFor, stubs };
