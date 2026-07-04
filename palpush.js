#!/usr/bin/env node
"use strict";
// palpush — headless PalBuilder deploy CLI. No vscode dependency.
//
// STATUS: step 3 — full live sequence wired:
//   Ping.do -> LockPal.do -> GetPlatformInfo -> injectFileContent -> ProcessPalBuilder.do -> UnlockPal.do
// The pal is unlocked on EVERY exit path (success, save error, thrown exception) via try/finally.
//
// SAFETY GATE (step 3): the real ProcessPalBuilder.do save only fires when --push is given.
// Without --push the run is a dry run by default: it authenticates, locks, primes platform
// info, injects from disk, serializes, reports, and unlocks — but never saves. This keeps
// --dry-run the default until step 4 designates a throwaway test pal for the first real push.
const zlib = require("zlib");
const { Pal } = require("./lib/pal");
const { CloudPistonXMLBuilder } = require("./lib/xmlParser");
const { CloudPistonAPIManager } = require("./lib/apiManager");
const { buildSaveTask, normalizeValidation } = require("./src/core/push");
const { resolveServerPalByGuid, enumerateServerPals } = require("./src/core/resolve");

function parseArgs(argv) {
    const args = { palDir: undefined, dryRun: false, verbose: false, push: false, list: false, guid: undefined };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dry-run") args.dryRun = true;
        else if (a === "--verbose") args.verbose = true;
        else if (a === "--push") args.push = true;
        else if (a === "--list") args.list = true;
        else if (a === "--guid") { args.guid = argv[++i]; if (!args.guid) throw new Error("--guid requires a value"); }
        else if (a.startsWith("--guid=")) args.guid = a.slice("--guid=".length);
        else if (a.startsWith("-")) { throw new Error("Unknown flag: " + a); }
        else if (args.palDir === undefined) args.palDir = a;
        else throw new Error("Unexpected argument: " + a);
    }
    // --list is a standalone discovery mode and needs no pal-dir.
    if (!args.list && !args.palDir) {
        throw new Error("Usage: palpush <pal-dir> [--guid <GUID>] [--dry-run] [--verbose] [--push]   |   palpush --list [--verbose]");
    }
    return args;
}

function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
}

// Build a session from env vars alone, with no pal on disk (for --list discovery).
function buildSessionFromEnv() {
    const username = process.env.CP_USER;
    const password = process.env.CP_PASS;
    const url = process.env.CP_URL;
    const missing = [];
    if (!url) missing.push("CP_URL");
    if (!username) missing.push("CP_USER");
    if (!password) missing.push("CP_PASS");
    if (missing.length) throw new Error("Missing credentials: " + missing.join(", "));
    return { username, password, userId: undefined, environment: { url }, lockInfo: undefined };
}

// Discovery: authenticate, then enumerate every server pal (shared walk from src/core/resolve).
async function discoverPals(session, log) {
    const ping = await CloudPistonAPIManager.authenticate(session);
    if (!ping || !ping.success) throw new Error("Ping.do failed: invalid username or password");
    session.userId = ping.userPath;
    log("ping ok — userId=" + session.userId);
    return enumerateServerPals(session);
}

// Read credentials + environment strictly from env vars. Never hardcoded, never written
// to pal files. CP_URL overrides the pal.json environment block (spec: env var wins).
function buildSession(pal) {
    const username = process.env.CP_USER;
    const password = process.env.CP_PASS;
    const url = process.env.CP_URL || (pal.environment && pal.environment.url);

    const missing = [];
    if (!url) missing.push("CP_URL (or pal.json environment.url)");
    if (!username) missing.push("CP_USER");
    if (!password) missing.push("CP_PASS");
    if (missing.length) throw new Error("Missing credentials: " + missing.join(", "));

    return {
        username,
        password,
        userId: undefined,
        environment: { url, platformVersion: pal.environment && pal.environment.platformVersion },
        lockInfo: undefined
    };
}

// Print validation results legibly: group/file:line:col — message.
function printValidationResults(results) {
    if (!results.length) {
        console.log("Validation: no issues reported.");
        return;
    }
    console.log("Validation results (" + results.length + "):");
    for (const r of results) {
        const file = r.object !== undefined && r.object !== "" ? r.object : "(general)";
        const group = r.group !== undefined && r.group !== "" ? r.group + "/" : "";
        const line = (r.lineNumber !== undefined && r.lineNumber >= 0) ? r.lineNumber : "-";
        const col = (r.column !== undefined && r.column >= 0) ? r.column : "-";
        const where = group + file + ":" + line + ":" + col;
        console.log("  " + where + "  —  " + (r.message !== undefined ? r.message : ""));
    }
}

function reportFileList(pal, injected) {
    console.log("Pal: " + pal.id + "   (" + (pal.layout && pal.layout.name) + ")");
    console.log("Files to push: " + injected.length);
    const byFolder = {};
    for (const f of injected) (byFolder[f.folder] ||= []).push(f);
    for (const folder of Object.keys(byFolder).sort()) {
        console.log("  " + folder + "/");
        for (const f of byFolder[folder].sort((a, b) => a.file.localeCompare(b.file))) {
            console.log("    " + f.file + "  (" + fmtBytes(f.bytes) + ")");
        }
    }
    console.log("Passthrough (preserved, never recreated): datasets=" + pal.allDatasets.length +
        " dataviews=" + pal.allDataviews.length + " data=" + pal.allData.length +
        " datalists=" + pal.allDatalists.length);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const log = (msg) => { if (args.verbose) console.log("[palpush] " + msg); };

    // --list: discovery only. Authenticate and print every server pal. No lock, no save.
    if (args.list) {
        const session = buildSessionFromEnv();
        log("Environment: " + session.environment.url + " as " + session.username);
        const pals = await discoverPals(session, log);
        console.log("Server pals (" + pals.length + ")  —  name | guid | profileId | groupId");
        for (const p of pals.sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
            console.log(p.name + " | " + p.guid + " | " + p.profileId + " | " + p.groupId);
        }
        return;
    }

    // A real save requires --push; otherwise we run dry by default (step-3 safety).
    const willSave = args.push && !args.dryRun;

    log("Loading pal from: " + args.palDir);
    const pal = await Pal.fromPath(args.palDir);
    log("Loaded pal id=" + pal.id + " layout=" + (pal.layout && pal.layout.name));

    const session = buildSession(pal);
    log("Environment: " + session.environment.url + " as " + session.username);

    let acquiredLock = false;
    let saveSucceeded = undefined;
    // The id used for every server call (lock/platform/save/unlock). Defaults to the local
    // folder id; with --guid it is replaced by the fresh server id resolved below.
    let palIdForServer = pal.id;
    try {
        // 1) Ping.do — auth, obtain userId (userPath) for all subsequent paths.
        const ping = await CloudPistonAPIManager.authenticate(session);
        if (!ping || !ping.success) {
            throw new Error("Ping.do failed: invalid username or password");
        }
        session.userId = ping.userPath;
        log("ping ok — userId=" + session.userId);

        // 1b) Resolve the live server lock id by guid (never cached — fetched fresh each run).
        if (args.guid) {
            const resolved = await resolveServerPalByGuid(session, args.guid);
            if (!resolved) {
                throw new Error("Guid " + args.guid + " not found on " + session.environment.url + " — wrong cloud, or the pal does not exist there");
            }
            palIdForServer = resolved.id;
            // Keep the body pal.id consistent with the lock header id (the extension's
            // invariant: same id in both). In-memory only — never written back to pal.json.
            pal.id = resolved.id;
            console.log("Resolved by guid:");
            console.log("  guid          : " + resolved.guid + "   (stable)");
            console.log("  fresh lock id : " + resolved.id + "   (64-hex, transient — re-fetched each push)");
            console.log("  profile       : " + resolved.profileName + "  | profileId=" + resolved.profileId);
            console.log("  group         : " + resolved.groupName + "  | groupId=" + resolved.groupId);
            console.log("");
        }

        // 2) LockPal.do — must succeed before any save. Lock-Information header -> session.lockInfo.
        const lockResp = await CloudPistonAPIManager.lockPal(session, palIdForServer, false);
        if (!lockResp || !lockResp.success || !session.lockInfo) {
            throw new Error("LockPal.do failed — aborting without save (a save without a lock is rejected by the server)");
        }
        acquiredLock = true;
        log("lock acquired");

        // 3) GetPlatformInfo — primes platform version (best-effort, mirrors the extension).
        try {
            const platformInfoResp = await CloudPistonAPIManager.getPlatformInfo(session, palIdForServer);
            if (platformInfoResp && platformInfoResp.customObject) {
                session.environment.platformVersion = platformInfoResp.customObject.version;
                log("platform info ok — version=" + platformInfoResp.customObject.version);
            } else {
                log("platform info: no version returned (continuing)");
            }
        } catch (e) {
            log("platform info call failed (continuing): " + e.message);
        }

        // 4) Inject in-scope file content from disk (base64). Datasets/dataviews are untouched.
        const injected = await pal.injectFileContent();
        log(injected.length + " files injected");

        // Serialize the exact task that would be POSTed.
        const task = buildSaveTask(pal);
        const taskXml = CloudPistonXMLBuilder(false).build(task);
        const xmlBytes = Buffer.byteLength(taskXml, "utf8");
        const gzBytes = zlib.gzipSync(taskXml).length;

        if (!willSave) {
            // DRY RUN — everything up to (but not including) the ProcessPalBuilder.do POST.
            console.log("DRY RUN — authenticated, locked, injected, serialized. No save performed." +
                (args.push ? "" : "  (pass --push to perform a real save)"));
            console.log("");
            reportFileList(pal, injected);
            console.log("");
            console.log("Serialized ProcessPalBuilder task XML: " + fmtBytes(xmlBytes) + " (" + xmlBytes + " bytes)");
            console.log("Gzipped (task.xml.gz body)           : " + fmtBytes(gzBytes) + " (" + gzBytes + " bytes)");
        } else {
            // 5) ProcessPalBuilder.do — the actual save (UPDATE).
            log("saving (" + fmtBytes(xmlBytes) + " xml, " + fmtBytes(gzBytes) + " gz) ...");
            const saveResp = await CloudPistonAPIManager.savePal(session, pal, palIdForServer);
            const results = normalizeValidation(saveResp);
            saveSucceeded = !!(saveResp && saveResp.success);
            console.log(saveSucceeded ? "SAVE OK" : "SAVE FAILED");
            printValidationResults(results);
        }
    } finally {
        // 6) UnlockPal.do — always, on every exit path, if we hold a lock.
        if (acquiredLock && session.lockInfo) {
            try {
                const unlockResp = await CloudPistonAPIManager.unlockPal(session, palIdForServer);
                if (unlockResp && unlockResp.success) {
                    log("unlock ok");
                } else {
                    console.error("[palpush] WARNING: UnlockPal.do did not report success — the pal may remain locked.");
                }
            } catch (e) {
                console.error("[palpush] WARNING: unlock failed: " + (e && e.message ? e.message : e));
            }
        }
    }

    // Exit non-zero if a real save was attempted and failed.
    if (willSave && saveSucceeded === false) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error("palpush failed: " + (err && err.stack ? err.stack : err));
    process.exit(1);
});
