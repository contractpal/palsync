"use strict";
// pal_sync_datasets core: provision dataset TABLES on the server from the definitions in
// pal.json (datasets/<name>.json on disk). This lifts the old "datasets are PalBuilder-only"
// limitation — the reference extension does exactly this (define in pal.json → save → SyncDataSet.do).
//
// TWO-STEP TRUTH: a dataset has a DEFINITION (schema, lives in pal.json — saved by a normal push)
// and a TABLE (the actual storage — provisioned by SyncDataSet.do). Editing the .json only
// changes the definition; the table is created/updated only when you sync. So sync first SAVES
// the pal (so the server has the current definition) then calls SyncDataSet.do.
//
// RECREATE SAFETY (non-negotiable): recreate DROPS AND REBUILDS the table, destroying every row.
// It is gated behind a typed confirmation phrase that NAMES the datasets and the word DELETE, so
// no model can trigger it by "setting recreate: true" — it must echo an exact, intentional string.
const fs = require("fs");
const path = require("path");
const { CloudPistonAPIManager } = require("../../lib/apiManager");
const { resolveServerPalByGuid } = require("./resolve");
const { push } = require("./push");

// The EXACT phrase a caller must pass as confirmRecreate to allow a destructive recreate of the
// given datasets. Names are sorted + comma-joined so the phrase is deterministic. Designed to be
// impossible to produce by accident: it states the consequence in words.
function recreatePhrase(names) {
    return "RECREATE AND DELETE ALL DATA IN: " + [...names].sort().join(", ");
}

// Read the dataset entries from the workspace's pal.json. Returns a Map name → { string, Dataset }.
function readDatasetDefs(workspaceDir) {
    let pj;
    try { pj = JSON.parse(fs.readFileSync(path.join(workspaceDir, "pal.json"), "utf8")); }
    catch (e) { return new Map(); }
    const entries = (pj.datasets && Array.isArray(pj.datasets.entry)) ? pj.datasets.entry : [];
    const m = new Map();
    for (const e of entries) if (e && e.string) m.set(e.string, e);
    return m;
}

// Provisioning-critical default: a Dataset with `freeform` unset (or false) provisions a table with
// NO per-field columns, so `SELECT <fieldName>` throws "Unknown column" at runtime even though the
// definition saved and the workflow compiled. (Verified live: freeform:false → "Unknown column
// 'equipmentId'"; freeform:true → clean render.) The server defaults it to false, so a def that omits
// it is silently broken. Before saving, default `freeform` to true on every TARGET dataset that hasn't
// set it explicitly — an omission is the common (broken) case; an explicit false is honored. Rewrites
// pal.json only when something actually changed, and returns the names it defaulted so the caller can
// tell the user. `indexed`/`notNull`/`notEmpty`/`enterpriseImageAccess` are server-defaulted safely and
// need no help — freeform is the one that breaks provisioning.
function ensureFreeformDefault(workspaceDir, targetNames) {
    const pjPath = path.join(workspaceDir, "pal.json");
    let pj;
    try { pj = JSON.parse(fs.readFileSync(pjPath, "utf8")); }
    catch (e) { return []; }
    const entries = (pj.datasets && Array.isArray(pj.datasets.entry)) ? pj.datasets.entry : [];
    const want = new Set(targetNames);
    const defaulted = [];
    for (const e of entries) {
        if (!e || !e.string || !want.has(e.string) || !e.Dataset) continue;
        if (e.Dataset.freeform === undefined || e.Dataset.freeform === null || e.Dataset.freeform === "") {
            e.Dataset.freeform = true;
            defaulted.push(e.string);
        }
    }
    if (defaulted.length) fs.writeFileSync(pjPath, JSON.stringify(pj, null, 1));
    return defaulted;
}

// A human/dumb-model-readable one-line schema summary for a dataset definition. Example:
//   "players: 3 columns — playerId (Primary key), name (String, max 80), score (Integer)"
function describeSchema(name, datasetEntry) {
    const ds = datasetEntry && datasetEntry.Dataset;
    const fieldsNode = ds && ds.fields && ds.fields.DatasetField;
    const fields = !fieldsNode ? [] : (Array.isArray(fieldsNode) ? fieldsNode : [fieldsNode]);
    const cols = fields.map(f => {
        const size = (f.fieldSize !== undefined && f.fieldSize !== null && f.fieldSize !== "") ? ", max " + f.fieldSize : "";
        const flags = [];
        if (f.notNull === true || f.notNull === "true") flags.push("required");
        if (f.notEmpty === true || f.notEmpty === "true") flags.push("not empty");
        const flagStr = flags.length ? " [" + flags.join(", ") + "]" : "";
        return f.fieldName + " (" + (f.fieldType || "?") + size + ")" + flagStr;
    });
    return name + ": " + cols.length + " column" + (cols.length === 1 ? "" : "s") + " — " + cols.join(", ");
}

// Normalize a SyncDataSet.do response. The server returns a ComposerResult; we treat a truthy
// success as the table being provisioned. validationResults (if any) are surfaced.
function syncSucceeded(resp) {
    return !!(resp && resp.success);
}

// Core sync. Returns a structured result; NEVER sends Recreate-Dataset unless `recreate` is true
// AND `confirmRecreate` exactly matches recreatePhrase(targetNames).
//   datasets: string[] | undefined  — names to sync (default: every dataset in pal.json)
//   recreate: boolean               — request the destructive drop+rebuild
//   confirmRecreate: string         — the exact typed phrase that authorizes recreate
//   force: boolean                  — pass through to the save step's drift guard
// Returns: { synced, refused?, targets, recreated, schemas, saveResult?, message-less (caller formats) }
async function syncDatasets(session, record, workspaceDir, { datasets, recreate = false, confirmRecreate, force = false } = {}) {
    const defs = readDatasetDefs(workspaceDir);
    if (defs.size === 0) {
        return { synced: false, refused: "no-datasets", targets: [],
                 reason: "There are no datasets defined in this pal's pal.json. To create one, write datasets/<name>.json with the schema and add a matching datasets.entry to pal.json, then sync." };
    }

    // Resolve target names: requested subset (validated) or all.
    let targets;
    if (Array.isArray(datasets) && datasets.length) {
        const unknown = datasets.filter(n => !defs.has(n));
        if (unknown.length) {
            return { synced: false, refused: "unknown-dataset", targets: [], unknown,
                     reason: "These dataset names are not defined in pal.json: " + unknown.join(", ") +
                         ". Known datasets: " + [...defs.keys()].join(", ") + "." };
        }
        targets = datasets.slice();
    } else {
        targets = [...defs.keys()];
    }

    // Default freeform:true on any target that omitted it — without it the provisioned table has no
    // per-field columns and every column query throws "Unknown column" at runtime. Do this BEFORE the
    // save so the server stores the corrected definition. Re-read defs if anything changed so the
    // schema summary + the rest of the flow see the patched entries.
    const freeformDefaulted = ensureFreeformDefault(workspaceDir, targets);
    const effectiveDefs = freeformDefaulted.length ? readDatasetDefs(workspaceDir) : defs;
    const schemas = targets.map(n => describeSchema(n, effectiveDefs.get(n)));

    // RECREATE GATE — the only path that can send the destructive header.
    if (recreate) {
        const required = recreatePhrase(targets);
        if (confirmRecreate !== required) {
            return {
                synced: false, refused: "recreate-unconfirmed", targets, recreate: true,
                requiredPhrase: required,
                reason: "RECREATE was requested. Recreate DROPS each table and DELETES ALL ITS DATA, then rebuilds it from the schema. " +
                    "This is NOT done without an exact typed confirmation. To proceed, call again with confirmRecreate set to EXACTLY this string:\n  " + required +
                    "\nIf you only want to create a new table or apply additive schema changes, do NOT use recreate — a normal sync does that without deleting data."
            };
        }
    }

    // STEP 1: save the pal so the server has the current dataset DEFINITIONS (push = lock + drift
    // guard + lint(scoped) + save). If the save is refused (drift/lock/lint), surface it; we do not
    // sync against a stale definition.
    const saveResult = await push(session, record, workspaceDir, { force });
    if (!saveResult.pushed) {
        // push refuses with a named reason (drift/validation/lock) OR returns pushed:false with no
        // reason when the SAVE itself was rejected by the server — in that case the server's notes
        // are in saveResult.validation. Surface whichever we have so the message is actionable.
        const serverNotes = (saveResult.validation || []).map(v => (v.group || "?") + "/" + (v.object || "-") + ": " + v.message);
        const why = saveResult.refused || (serverNotes.length ? "server rejected the save" : "unknown");
        return { synced: false, refused: "save-failed", saveResult, targets, schemas, serverNotes,
                 reason: "Could not save the pal before syncing (" + why + "). The dataset definitions must be saved first." +
                     (serverNotes.length ? "\nServer said:\n   - " + serverNotes.join("\n   - ") : "") };
    }

    // STEP 2: provision the tables. We hold the lock from the push (session.lockInfo set).
    const resolved = await resolveServerPalByGuid(session, record.palGuid);
    if (!resolved) {
        return { synced: false, refused: "resolve-failed", targets, schemas, reason: "Could not re-resolve the pal id after saving." };
    }
    const resp = await CloudPistonAPIManager.syncDataSets(session, resolved.id, !!recreate, targets);
    const ok = syncSucceeded(resp);

    // SyncDataSet.do is itself a server-side save — it ADVANCES lastModifiedDate. Refresh the
    // stored marker so the NEXT operation (another sync, a push) doesn't see false drift against
    // a stale marker. (Without this, a second sync always fails "drift".)
    if (ok) {
        const after = await resolveServerPalByGuid(session, record.palGuid);
        if (after) record.lastModifiedDate = after.lastModifiedDate;
    }

    return {
        synced: ok, targets, schemas, recreated: !!recreate, freeformDefaulted,
        saveResult,
        serverResponse: ok ? "success" : "failure",
        reason: ok ? null : "The server did not report success for SyncDataSet.do. The definitions were saved, but the table(s) may not have been provisioned — check the pal in PalBuilder."
    };
}

module.exports = { syncDatasets, recreatePhrase, readDatasetDefs, describeSchema, ensureFreeformDefault };
