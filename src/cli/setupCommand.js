"use strict";
// `palsync setup` — NON-INTERACTIVE workspace creation for headless / autonomous use.
// The interactive `palsync` launcher logs in, walks profile→group→pal menus, pulls, injects,
// registers, and opens an agent. This does the same PREP with zero prompts so an agent box
// (Hermes on headless Linux, a CI job, a container) can create a ready workspace, then connect
// its own harness (OpenCode / Codex / Claude Code / Hermes) to the palsync MCP server.
//
//   palsync setup --pal "<name>"   [--guid <guid>] [--dir <dir>] [--cloud <url>] [--user <name>]
//                 [--profile <p>] [--group <g>] [--agent claude|codex|pi|opencode]
//                 [--overwrite-local] [--json]
//
// Auth is headless via credentialStore (CP_PASS / PALSYNC_PASSWORD_<…> / keychain). The pal is
// resolved BY NAME (preferred — never hardcode GUIDs) or by --guid. Unlike the launcher, setup
// RELEASES the lock when done: no agent is launched here, so the MCP server re-acquires it
// (own-stale-reclaim) on the agent's first tool call rather than leaving it stranded.
const path = require("path");
const os = require("os");
const { authenticate } = require("../core/session");
const { resolvePassword, credentialError } = require("../auth/credentialStore");
const { resolveServerPalByGuid, resolveServerPalByName } = require("../core/resolve");
const keychain = require("../platform/keychain");
const workspace = require("../launcher/workspace");
const lock = require("../core/lock");
const registerPi = require("../mcp/registerPi");

const DEFAULT_CLOUD = "https://secure.cloudpiston.com";

const USAGE = [
    "Usage:",
    "  palsync setup --pal \"<name>\" [options]      Create a workspace by pal NAME (preferred)",
    "  palsync setup --guid <guid>   [options]      ...or by stable GUID",
    "",
    "  --dir <dir>          workspace directory (default: ~/PalBuilder/<pal-name>)",
    "  --cloud <url>        CloudPiston base URL (default/env CP_URL: " + DEFAULT_CLOUD + ")",
    "  --user <username>    account (default: env CP_USER, else the single keychain account)",
    "  --profile <name>     narrow by profile name (disambiguates a duplicate pal name)",
    "  --group <name>       narrow by group name",
    "  --agent claude|codex|pi|opencode  which agent's context/MCP to write (default: claude; pi installs the native lazy-loading extension globally)",
    "  --overwrite-local    if the workspace has un-pushed local edits, overwrite them (default: refuse)",
    "  --json               machine-readable result",
    "",
    "Password is read from CP_PASS (or PALSYNC_PASSWORD_<host_user>, or the OS keychain).",
    "No prompts are shown — this is the headless setup path. Run `palsync` (no subcommand) for the interactive flow."
].join("\n");

function parse(argv) {
    const f = { pal: undefined, guid: undefined, dir: undefined, cloud: undefined, user: undefined,
                profile: undefined, group: undefined, agent: "claude",
                overwriteLocal: false, json: false, help: false };
    const need = (i, name) => { const v = argv[i + 1]; if (v === undefined) throw new Error(name + " requires a value"); return v; };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--help" || a === "-h") f.help = true;
        else if (a === "--overwrite-local") f.overwriteLocal = true;
        else if (a === "--json") f.json = true;
        else if (a === "--pal") { f.pal = need(i, "--pal"); i++; }
        else if (a === "--guid") { f.guid = need(i, "--guid"); i++; }
        else if (a === "--dir") { f.dir = need(i, "--dir"); i++; }
        else if (a === "--cloud") { f.cloud = need(i, "--cloud"); i++; }
        else if (a === "--user") { f.user = need(i, "--user"); i++; }
        else if (a === "--profile") { f.profile = need(i, "--profile"); i++; }
        else if (a === "--group") { f.group = need(i, "--group"); i++; }
        else if (a === "--agent") { f.agent = need(i, "--agent"); i++; }
        else if (a.startsWith("--")) throw new Error("Unknown flag: " + a + "\n\n" + USAGE);
        else throw new Error("Unexpected argument: " + a + "\n\n" + USAGE);
    }
    return f;
}

// Pick the account headlessly: explicit --user, else CP_USER, else the single keychain account
// for this cloud. Ambiguity (0 or >1 keychain accounts, none specified) is a clear error.
function resolveUser(flags, cloudUrl) {
    if (flags.user) return flags.user;
    if (process.env.CP_USER) return process.env.CP_USER;
    let cached = [];
    try { cached = keychain.listUsernames(cloudUrl); } catch (e) { /* no keychain (headless) */ }
    if (cached.length === 1) return cached[0];
    if (cached.length === 0) {
        throw new Error("No account specified and none cached. Pass --user <username> (or set CP_USER).");
    }
    throw new Error("Multiple accounts cached for " + cloudUrl + " (" + cached.join(", ") + "). Pass --user <username> to choose.");
}

async function run(argv) {
    const flags = parse(argv);
    if (flags.help) { console.log(USAGE); return 0; }
    if (!flags.pal && !flags.guid) { console.error("Specify the pal: --pal \"<name>\" (preferred) or --guid <guid>.\n\n" + USAGE); return 1; }

    const cloudUrl = flags.cloud || process.env.CP_URL || DEFAULT_CLOUD;
    const username = resolveUser(flags, cloudUrl);
    const { password } = resolvePassword(cloudUrl, username);
    if (!password) throw credentialError(cloudUrl, username);

    const session = await authenticate(cloudUrl, username, password);

    // Resolve the pal — by guid (exact) or by name (preferred; report ambiguity / not-found).
    let resolved;
    if (flags.guid) {
        resolved = await resolveServerPalByGuid(session, flags.guid);
        if (!resolved) throw new Error("GUID " + flags.guid + " not found on " + cloudUrl + " for " + username + ".");
    } else {
        const { resolved: r, candidates, all } = await resolveServerPalByName(session, flags.pal, { profile: flags.profile, group: flags.group });
        if (!r) {
            if (candidates.length > 1) {
                throw new Error("Pal name \"" + flags.pal + "\" is ambiguous (" + candidates.length + " matches):\n" +
                    candidates.map(c => "   - " + c.name + "  (profile " + c.profileName + " / group " + c.groupName + ", guid " + c.guid + ")").join("\n") +
                    "\nNarrow with --profile/--group, or use --guid.");
            }
            const near = all.filter(p => String(p.name).toLowerCase().includes(String(flags.pal).toLowerCase())).slice(0, 8);
            throw new Error("Pal \"" + flags.pal + "\" not found on " + cloudUrl + " for " + username + "." +
                (near.length ? "\nDid you mean: " + near.map(p => "\"" + p.name + "\"").join(", ") + "?" : ""));
        }
        resolved = r;
    }

    const workspaceDir = path.resolve(flags.dir || workspace.defaultWorkspaceDir(resolved.name, resolved.branch));
    const log = flags.json ? () => {} : (m) => console.log("  " + m);
    if (!flags.json) console.log("palsync setup — " + resolved.name + " @ " + cloudUrl + " → " + workspaceDir + "\n");

    // Headless drift policy: refuse to clobber un-pushed local edits unless --overwrite-local.
    const onDrift = flags.overwriteLocal ? async () => "overwrite" : null;

    const sel = { profile: { profileId: resolved.profileId }, group: { groupId: resolved.groupId },
                  pal: { guid: resolved.guid, name: resolved.name, lastModifiedDate: resolved.lastModifiedDate } };

    const result = await workspace.setup({ session, cloudUrl, sel, workspaceDir, agent: flags.agent, onDrift, log });

    if (flags.agent === "pi") {
        const pi = result.mcpRegistration || await registerPi.register({ installExtension: true });
        result.mcpRegistration = pi;
        result.mcpConfig = null;
        if (!flags.json) {
            log((pi.written ? "Native Pi extension installed at " : "Native Pi extension current at ") + pi.filePath + ". No project file written.");
            if (pi.collisionGuidance) log("⚠ " + pi.collisionGuidance);
        }
    }

    // Release the lock — no agent is launched here, so don't strand it. The MCP server re-acquires
    // it on the agent's first tool call (own-stale-reclaim).
    try { await lock.releaseByGuid(session, resolved.guid); } catch (e) { /* best-effort */ }

    if (flags.json) {
        console.log(JSON.stringify({
            ok: true, pal: resolved.name, guid: resolved.guid, workspaceDir,
            pulledFiles: result.pulledFiles, dataFiles: result.dataFiles,
            skills: result.injected && result.injected.skills, agent: flags.agent,
            mcpConfig: result.mcpConfig,
        }, null, 2));
    } else {
        console.log("\nWorkspace ready: " + workspaceDir);
        console.log("  pulled " + result.pulledFiles + " code files + " + result.dataFiles + " data/schema files; skills injected.");
        console.log("  Connect your agent's MCP client to the palsync server with env PALSYNC_WORKSPACE=" + workspaceDir);
        console.log("  (Claude Code: .mcp.json written. OpenCode: opencode.json written. Codex: registered via `codex mcp add`. Hermes: see the headless docs.)");
        console.log("  Auth: set CP_PASS in the agent's environment so the MCP server can authenticate headless.");
    }
    return 0;
}

module.exports = { run, parse, resolveUser, USAGE };
