"use strict";
// Headless push for the MCP session. Reuses the proven palpush sequence and the unchanged lib:
// ensure we hold the lock (own-reclaim; never break another's) -> drift guard on
// lastModifiedDate -> inject from disk -> ProcessPalBuilder UPDATE -> update the stored marker.
// Unlike the standalone palpush CLI it does NOT unlock — the MCP session holds the lock until
// exit/idle. palpush imports buildSaveTask/normalizeValidation from here, so the save task and
// validation parsing are shared, not parallel copies.
const fs = require("fs");
const path = require("path");
const { Pal } = require("../../lib/pal");
const { CloudPistonAPIManager } = require("../../lib/apiManager");
const { resolveServerPalByGuid, refreshResolvedPal } = require("./resolve");
const { manifestPaths } = require("./pull");
const { validateWorkspace, lintContent, hasDesignSystem } = require("./validate");
const { cachedLint } = require("./lintCache");
const { WORKSPACE_GATE_RULES, WORKSPACE_WARNING_RULES } = require("./validate/registry");
const { diffWorkspace } = require("./localDrift");
const { prunePhantomFolderRegistrations } = require("./palFolders");
const baseline = require("./baseline");
const lock = require("./lock");
const drift = require("./drift");

// Creatable types: a file on disk in these folders with NO pal.json entry is NEVER pushed —
// the #1 silent failure of the OBE smoke test (22 new pages "pushed OK" but absent). Push now
// reports these loudly so the agent fixes pal.json instead of reporting false success.
// NOTE: workflows and documents were once banned here too (see UNCREATABLE below), but that
// turned out to be false for both: workflows was a Base64 artifact (Workflow.content is a
// byte[]; raw text sank the push — see guardWorkflows), and documents was this same file's
// non-array `entry` bug (see asArray below) letting a malformed new entry reach the server
// unguarded, which read as a hard ban. Both create fine once pushed correctly.
const CREATABLE = [
    { key: "pages", folder: "pages" },
    { key: "fragments", folder: "fragments" },
    { key: "styles", folder: "styles" },
    { key: "scripts", folder: "scripts" },
    { key: "images", folder: "images" },
    { key: "emails", folder: "emails" },
    { key: "attachments", folder: "attachments" },
    { key: "wizards", folder: "wizards" },
    { key: "documents", folder: "documents" }
];

// Files on disk in creatable folders that have no pal.json entry → will NOT be pushed.
function findStrayCreatable(pal, workspaceDir) {
    const stray = [];
    for (const t of CREATABLE) {
        const manifest = new Set(asArray(pal[t.key] && pal[t.key].entry).map(e => e.string));
        const files = listFilesRecursive(path.join(workspaceDir, t.folder));
        for (const f of files) if (!manifest.has(f)) stray.push(t.folder + "/" + f);
    }
    return stray;
}

// fonts: the server rejects a NEW entry outright and the rejection fails the WHOLE save
// transactionally. Editing an EXISTING font is fine. This is the backstop so a stray addition
// can't sink a push.
const UNCREATABLE = [
    { key: "fonts", folder: "fonts" }
];

// Valid workflowType numbers (from the platform's workflow-type enum). A new workflow with no
// workflowType is the one malformed case that still sinks the whole transactional save.
const WORKFLOW_TYPES = new Set([2, 3, 4, 5, 7, 9, 11, 12, 14, 15]);

// pal.json (and getPal responses) serialize a single-entry section as a bare object rather than
// a one-element array — the XML source has no way to distinguish "one repeated element" from
// "a scalar". A brand-new document/workflow/creatable file is very often the ONLY entry in its
// section, so every helper below that walks `section.entry` must normalize through this first;
// skipping it either silently no-ops the uncreatable-type guard (letting a new document reach
// the server, which then rejects the WHOLE transactional save) or throws (`.map` on a plain object).
function asArray(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }

function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

function listFilesRecursive(root) {
    const out = [];
    function walk(abs, relBase) {
        let entries;
        try { entries = fs.readdirSync(abs, { withFileTypes: true }); }
        catch (e) { if (e.code === "ENOENT") return; throw e; }
        for (const de of entries) {
            if (de.name.startsWith(".")) continue;
            const childAbs = path.join(abs, de.name);
            const childRel = relBase ? relBase + "/" + de.name : de.name;
            if (de.isDirectory()) walk(childAbs, childRel);
            else if (de.isFile()) out.push(childRel);
        }
    }
    walk(root, "");
    return out;
}

function errorsByRule(findings) {
    const m = {};
    for (const f of findings) if (f.severity === "error") m[f.rule] = (m[f.rule] || 0) + 1;
    return m;
}

function findingKey(f) {
    return [f.file, f.line, f.column || 0, f.rule, f.severity, f.message].join("\t");
}

function addWorkspaceGateFindings(workspaceDir, findings) {
    const seen = new Set(findings.map(findingKey));
    const whole = validateWorkspace(workspaceDir);
    for (const f of whole.findings) {
        const blockingError = f.severity === "error" && WORKSPACE_GATE_RULES.has(f.rule);
        const advisoryWarning = f.severity === "warn" &&
            (WORKSPACE_GATE_RULES.has(f.rule) || WORKSPACE_WARNING_RULES.has(f.rule));
        if (!blockingError && !advisoryWarning) continue;
        const key = findingKey(f);
        if (seen.has(key)) continue;
        findings.push(f);
        seen.add(key);
    }
}

// The PRE-PUSH GATE lint. Blocks a push ONLY on errors THIS change is responsible for:
//   - NEW files (added vs baseline): every error counts — the agent created the file.
//   - MODIFIED files with a baseline snapshot: lint the baseline vs the current version and block
//     only on the NET-NEW errors (per rule count). Pre-existing errors a touched file already had
//     (e.g. a legacy workflow's object literals) do NOT block — they're surfaced as informational,
//     not a wall the agent must rewrite legacy code to clear.
//   - Cross-file contract errors (including manifest/file registration) always block in their
//     CURRENT form. Per-file lint cannot see "fragment expects a DataList the workflow no longer
//     produces", which is exactly the class of false bypass weak models exploit.
//   - No per-file hash baseline (fresh/legacy record): lint the whole workspace (conservative).
//   - Baseline hashes but no baseline CONTENT (pre-feature workspace): block on all errors in
//     changed files (the prior behavior) — we can't tell new from old without the content.
// Returns the standard { errors, warnings, findings, filesChecked, scope } shape.
function gateLint(record, workspaceDir) {
    if (!record || !record.fileHashes) return validateWorkspace(workspaceDir); // no diff possible
    const designSystemPresent = hasDesignSystem(workspaceDir);
    const designSystemDep = [{ path: "design-system#present", content: String(designSystemPresent) }];
    const d = diffWorkspace(record, workspaceDir);
    const changed = [...d.added, ...d.changed];
    // localDrift reports manifest edits separately because pull treats them specially. The push
    // gate still needs pal.json in its per-file baseline diff (e.g. unknownPalJsonKey).
    if (d.manifestChanged) changed.push("pal.json");
    if (!changed.length) {
        const findings = [];
        addWorkspaceGateFindings(workspaceDir, findings);
        return { errors: findings.filter(f => f.severity === "error").length,
                 warnings: findings.filter(f => f.severity === "warn").length,
                 findings, filesChecked: 0, scope: "new-errors" };
    }
    const addedSet = new Set(d.added);
    const haveBaselineContent = baseline.exists(workspaceDir);
    const findings = [];
    for (const rel of changed) {
        let current;
        try {
            const content = fs.readFileSync(path.join(workspaceDir, ...rel.split("/")), "utf8");
            current = cachedLint(workspaceDir,
                { rel, content, mode: "push-gate", deps: designSystemDep },
                () => lintContent(rel, content, { designSystemPresent }));
        }
        catch (e) { continue; }
        // warnings never block but always surface
        for (const f of current) if (f.severity === "warn") findings.push(f);
        const curErr = current.filter(f => f.severity === "error");
        if (!curErr.length) continue;

        const baseContent = (!addedSet.has(rel) && haveBaselineContent) ? baseline.read(workspaceDir, rel) : null;
        if (baseContent == null) { findings.push(...curErr); continue; } // added / no baseline → all new

        // MODIFIED with a baseline: block only on the net-new errors per rule.
        const baseCount = errorsByRule(cachedLint(workspaceDir,
            { rel, content: baseContent, mode: "push-gate", deps: designSystemDep },
            () => lintContent(rel, baseContent, { designSystemPresent })));
        const curCount = errorsByRule(curErr);
        for (const rule of Object.keys(curCount)) {
            const introduced = curCount[rule] - (baseCount[rule] || 0);
            if (introduced <= 0) continue;
            const sample = curErr.find(f => f.rule === rule);
            findings.push({
                file: rel, line: sample.line, column: sample.column, severity: "error", rule,
                message: "Your edit INTRODUCED " + introduced + " new '" + rule + "' error(s) in " + rel +
                    (baseCount[rule] ? " (this file already had " + baseCount[rule] + " before your change — those do NOT block you)" : "") +
                    ". Fix the one(s) you added — " + sample.message
            });
        }
    }
    addWorkspaceGateFindings(workspaceDir, findings);
    const errors = findings.filter(f => f.severity === "error").length;
    const warnings = findings.filter(f => f.severity === "warn").length;
    return { errors, warnings, findings, filesChecked: changed.length, scope: haveBaselineContent ? "new-errors" : "changed" };
}

// Best-effort: the set of entry-strings the server already has, per uncreatable type, parsed
// from a getPal response. Used to tell a NEW (uncreatable) entry from an existing one we may
// legitimately edit. Returns null on a missing/odd response (caller then skips stripping rather
// than risk dropping a valid existing entry).
function serverKnownFrom(resp) {
    try {
        const sp = resp && resp.pal;
        if (!sp) return null;
        const setOf = (k) => new Set((((sp[k] && sp[k].entry)) ? (Array.isArray(sp[k].entry) ? sp[k].entry : [sp[k].entry]) : []).map(e => e.string));
        // workflows: needed by guardWorkflows (new-vs-existing); fonts: by guardUncreatableTypes.
        return { workflows: setOf("workflows"), fonts: setOf("fonts") };
    } catch (e) { return null; }
}

// Strip NEW entries of uncreatable types from the payload (keep server-known ones so edits work),
// and report stray on-disk files of those types. Mutates pal. Returns [{type, file, reason}].
function guardUncreatableTypes(pal, workspaceDir, serverKnown) {
    const skipped = [];
    for (const t of UNCREATABLE) {
        const known = (serverKnown && serverKnown[t.key]) || new Set();
        // (1) strip new entries (only when we have a baseline; otherwise leave them and let the
        //     server's transactional rejection protect us — never risk dropping a valid entry)
        if (serverKnown && pal[t.key]) {
            pal[t.key].entry = asArray(pal[t.key].entry).filter(e => {
                if (known.has(e.string)) return true;
                skipped.push({ type: t.key, file: e.string, reason: "new entry — not creatable via push (use PalBuilder)" });
                return false;
            });
        }
        // (2) report stray files on disk with no manifest entry (already excluded; informational)
        const manifest = new Set(asArray(pal[t.key] && pal[t.key].entry).map(e => e.string));
        let files = [];
        try { files = fs.readdirSync(path.join(workspaceDir, t.folder)).filter(f => isFile(path.join(workspaceDir, t.folder, f))); } catch (e) {}
        for (const f of files) if (!manifest.has(f) && !known.has(f)) skipped.push({ type: t.key, file: f, reason: "stray file — not pushed (use PalBuilder)" });
    }
    return skipped;
}

// New workflows ARE pushable (content is base64-encoded by injectFileContent, which is what the
// server's byte[] field needs). The one remaining hazard: a new workflow with no workflowType
// makes the server reject it and fail the WHOLE transactional save. So strip + report only those
// malformed new entries; well-formed new workflows and all edits to existing ones go through.
// Mutates pal. Returns [{type, file, reason}].
function guardWorkflows(pal, serverKnown) {
    const skipped = [];
    if (!serverKnown || !pal.workflows) return skipped; // no baseline -> let the server arbitrate
    const known = serverKnown.workflows || new Set();
    pal.workflows.entry = asArray(pal.workflows.entry).filter(e => {
        if (known.has(e.string)) return true;                 // existing workflow — edit is fine
        const obj = e.Workflow || e.workflow;
        const wt = obj && obj.workflowType;
        if (WORKFLOW_TYPES.has(Number(wt))) return true;      // well-formed new workflow
        skipped.push({ type: "workflows", file: e.string,
            reason: "new workflow missing/invalid workflowType — set it in pal.json (web=9, console=7, library=4, transaction=2)" });
        return false;
    });
    return skipped;
}

// A pal with a web workflow (workflowType 9) is only a "Web Pal" on the server if
// layout.webWorkflow names that workflow. palsync builds web workflows (agent edits)
// WITHOUT setting that pointer, so a freshly-pushed web pal validates as "Pal is not a Web Pal".
// If layout.webWorkflow is unset, point it at the first web workflow (workflowType 9).
// Mutates pal.layout. Returns the registered filename, or null if nothing was changed.
function ensureWebRegistration(pal) {
    if (!pal.layout || pal.layout.webWorkflow) return null;
    const webWf = (pal.allWorkflows || []).filter(e => {
        const obj = e.Workflow || e.workflow;
        return obj && Number(obj.workflowType) === 9;
    });
    if (webWf.length === 0) return null;
    pal.layout.webWorkflow = webWf[0].string;
    return webWf[0].string;
}

// Similar to webRegistration: if layout.consoleWorkflow is unset, point it at the first console
// workflow (workflowType 7) so the pal has a default entry point in the PalBuilder console.
// Mutates pal.layout. Returns the registered filename, or null if nothing was changed.
function ensureConsoleRegistration(pal) {
    if (!pal.layout || pal.layout.consoleWorkflow) return null;
    const consoleWf = (pal.allWorkflows || []).filter(e => {
        const obj = e.Workflow || e.workflow;
        return obj && Number(obj.workflowType) === 7;
    });
    if (consoleWf.length === 0) return null;
    pal.layout.consoleWorkflow = consoleWf[0].string;
    return consoleWf[0].string;
}

function buildSaveTask(pal) {
    return {
        "com.contractpal.palbuilder.PalBuilderRequest": {
            pal: pal,
            operation: "UPDATE",
            includeDependencies: false,
            platformMetaData: { palFirst: false }
        }
    };
}

function normalizeValidation(resp) {
    const vr = resp && resp.validationResults;
    if (!vr || vr === "") return [];
    const list = vr["com.contractpal.ValidationResult"];
    if (!list) return [];
    return Array.isArray(list) ? list : [list];
}

// Pushes workspaceDir to the pal identified by record.palGuid. Mutates record.lastModifiedDate
// on success. Returns a result object (never throws on drift/lock — returns a refusal).
async function push(session, record, workspaceDir, { force = false, overrideLock = false, skipValidation = false, commitMessage = null } = {}) {
    // 0) PRE-PUSH LINT (offline): catch the mistakes that silently break in PalBuilder (invalid
    //    workflow JS, bad markup) BEFORE spending a network round-trip. ERRORS block unless
    //    skipValidation is set; WARNINGS never block. The gate holds the agent responsible only
    //    for the errors its OWN change introduced — not the pal's pre-existing history (see
    //    gateLint): editing one function in a legacy-bad file won't force a rewrite of that file.
    const lint = gateLint(record, workspaceDir);
    if (lint.errors > 0 && !skipValidation) {
        return { pushed: false, refused: "validation", lint };
    }

    // 1) ensure the lock is ours. acquireByGuid reads the real holder from teamInfo and reports a
    //    blocked reason (gui-lock-self / gui-lock-other / override-disabled / unknown-holder).
    //    overrideLock only attempts Lock-Force, which is itself gated by OVERRIDE_ENABLED in lock.js.
    const lk = await lock.acquireByGuid(session, record.palGuid, { force: !!overrideLock });
    if (!lk.acquired) {
        return { pushed: false, refused: lk.blocked || "no-lock", holder: lk.holder, since: lk.since };
    }
    const id = lk.resolved.id;
    const liveMarker = lk.resolved.lastModifiedDate;

    // 2) drift guard: server saved since our last pull?
    if (drift.serverAdvanced(record.lastModifiedDate, liveMarker) && !force) {
        const li = session.lockInfo;
        const lastEditDate = li && li.lastEditDate && Number.isFinite(Number(li.lastEditDate))
            ? new Date(Number(li.lastEditDate)).toISOString() : null;
        return {
            pushed: false, refused: "drift",
            storedMarker: record.lastModifiedDate, liveMarker,
            lastEditUser: li ? li.lastEditUser : null, lastEditDate
        };
    }

    // 3) inject from disk + save (body pal.id == lock header id, matching the extension invariant)
    const pal = await Pal.fromPath(workspaceDir);
    pal.id = id;
    const prunedFolders = prunePhantomFolderRegistrations(pal);
    // Backstop: strip NEW entries of uncreatable types (fonts) so they can't sink the
    // whole push; report stray files. Plus strip only MALFORMED new workflows (no workflowType) —
    // well-formed new workflows now push. Creatable types (incl. documents) are never touched. Parsed from the
    // getPal response the lock acquisition already fetched — no second GetPal round-trip.
    const serverKnown = serverKnownFrom(lk.getPalResp);
    const skipped = guardUncreatableTypes(pal, workspaceDir, serverKnown)
        .concat(guardWorkflows(pal, serverKnown));
    const strayCreatable = findStrayCreatable(pal, workspaceDir);
// Register the web/console workflow so the server treats this as a Web/Console Pal (else TestWeb
    // returns "Pal is not a Web Pal"). Done after guardWorkflows so a stripped malformed entry
    // can't be registered. The pointer is sent with this save; pull afterwards to sync it into
    // pal.json.
    const webRegistered = ensureWebRegistration(pal);
    const consoleRegistered = ensureConsoleRegistration(pal);

    // sourceControlEnabled comes from the same GetPal response the lock acquisition already
    // fetched (lk.getPalResp) — no extra round-trip. When false the server doesn't understand
    // Source-Commit headers, so none are sent regardless of commitMessage.
    const sourceControlEnabled = !!(lk.getPalResp && lk.getPalResp.sourceControlEnabled);
    const finalCommitMessage = (sourceControlEnabled && commitMessage) ? "Chip: " + commitMessage : null;
    const injected = await pal.injectFileContent();
    const saveResp = await CloudPistonAPIManager.savePal(session, pal, id,
        { sourceControlEnabled, commitMessage: finalCommitMessage });
    const validation = normalizeValidation(saveResp);
    const success = !!(saveResp && saveResp.success);

    // 4) refresh the stored marker (the save advanced it). Scoped single getPalList first;
    //    full account walk only as fallback (e.g. pal moved groups mid-session).
    let pushedPaths = null;
    if (success) {
        const after = (await refreshResolvedPal(session, lk.resolved))
            || (await resolveServerPalByGuid(session, record.palGuid));
        record.lastModifiedDate = after ? after.lastModifiedDate : liveMarker;
        // The pushed files now == server — refresh the baseline CONTENT snapshot so the NEXT
        // push's new-errors gate diffs against this state (incl. any legacy errors the agent
        // legitimately pushed past with skipValidation, which then become "pre-existing").
        pushedPaths = [...manifestPaths(pal)];
        baseline.snapshot(workspaceDir, pushedPaths);
    }


    // serverPaths: what the server tracks after this save = the pushed manifest (uncreatable
    // strays already stripped by the guard above). Callers rebuild fileHashes from this.
    // lint carries any pre-push WARNINGS (errors would have blocked above) so the agent sees them
    // even on a clean push; skippedValidation flags an error-bypassing forced push.
    // On a SERVER-REJECTED save (success=false), mark refused:"save-rejected" and carry the
    // server's validation notes so callers can show WHY (e.g. "Tag script is not allowed") instead
    // of a bare "unknown" — the cold test showed an opaque message cost real diagnosis time.
    return { pushed: success, refused: success ? undefined : "save-rejected",
             forced: !!force, filesPushed: injected.length, strayCreatable, validation,
             newMarker: record.lastModifiedDate, skipped, lint, skippedValidation: skipValidation && lint.errors > 0,
             serverPaths: pushedPaths, webRegistered, consoleRegistered, prunedFolders,
             sourceControlEnabled, commitMessage: finalCommitMessage };
}

module.exports = { push, buildSaveTask, normalizeValidation, gateLint, guardWorkflows, guardUncreatableTypes, findStrayCreatable, ensureWebRegistration, ensureConsoleRegistration };
