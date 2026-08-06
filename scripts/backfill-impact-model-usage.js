#!/usr/bin/env node
"use strict";
// One-shot backfill: fill `modelUsage` on impact rows recorded before anything wrote
// `.palsync/session-cost.json`. Arms 1-3 of the pilot were recorded with `modelUsage: null`, which
// pins the checker's `model-token-non-inferiority` gate at `incomplete` regardless of results.
//
// It does NOT re-run `record-eval`. That would rewrite each row's `date` and `sha` to the current
// HEAD, destroying the provenance of when the arm actually ran (c33dbd8 / 824b7e5 / 11404a1). Only
// the `modelUsage` field is replaced; every other byte of the row is preserved, and key order is
// kept because the field already exists as null.
//
// WHY NOT GUARD ON THE PINNED TRANSCRIPT HASH: `experiment.transcriptFile.sha256` looks like the
// right pin and is not one. The host keeps appending untimestamped bookkeeping lines (`mode`,
// `permission-mode`, `ai-title`, `last-prompt`) after an arm ends, so the live file's hash has
// already drifted from every recorded row's pin. Verified: all three rows mismatch, while every
// usage-bearing line stays inside the arm's time window. The pin is unverifiable, not the spend.
//
// The guard chain used instead is identity on two independently recorded values plus a window check:
//   1. row.startPalGuid + row.startMarker == workspace/.palsync/impact-start.json {palGuid, serverMarker}
//   2. workspace path -> host transcript dir (path separators and underscores become dashes)
//   3. that dir holds exactly one transcript, and its basename == row.transcriptFile.name
//   4. the counted usage window starts at/after the server marker and is no longer than
//      wallTimeMs + WINDOW_SLACK_MS  <- this is what actually catches the failure the hash was
//      meant to catch: a resumed session that appended REAL API calls after the arm finished.
//
// Usage: node scripts/backfill-impact-model-usage.js [--results <file>] [--write]
//        (dry run by default; --write patches the rows and writes each workspace sidecar)
const fs = require("fs");
const path = require("path");
const os = require("os");
const { build } = require("./extract-session-cost");
const { validateModelUsage } = require("./record-eval");

const DEFAULT_RESULTS = path.join(__dirname, "..", "eval", "impact-results.jsonl");
const WORKSPACE_ROOT = path.join(os.homedir(), "PalBuilder");
const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
// The agent starts a handful of seconds after the seeding marker and the last usage line lands a
// few seconds after the wall clock the trajectory recorded (measured 10-20s across arms 1-3).
// A minute of slack accepts that jitter while still rejecting a session resumed minutes later.
const WINDOW_SLACK_MS = 60_000;

function parseArgs(argv) {
    const flags = { results: DEFAULT_RESULTS };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--results") flags.results = argv[++i];
        else if (a === "--write") flags.write = true;
        else throw new Error("unknown flag " + a);
    }
    return flags;
}

// `palsync` writes the server marker in local wall-clock time ("2026-08-05 17:45:34.0"), while
// transcript timestamps are ISO UTC. Parse the marker as local time so the comparison is apples to
// apples; Date's "YYYY-MM-DDTHH:MM:SS" form without a zone is local by definition.
function markerToDate(marker) {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(marker || ""));
    if (!match) return null;
    const date = new Date(match[1] + "T" + match[2]);
    return Number.isNaN(date.getTime()) ? null : date;
}

// Claude Code names a project dir after the workspace path with every non-alphanumeric run turned
// into a dash: /Users/apple/PalBuilder/impact_01_shared_fragment03 -> -Users-apple-PalBuilder-impact-01-shared-fragment03
function projectDirFor(workspaceDir) {
    return path.join(PROJECTS_ROOT, workspaceDir.replace(/[^A-Za-z0-9]/g, "-"));
}

function readReceipt(workspaceDir) {
    try {
        const value = JSON.parse(fs.readFileSync(path.join(workspaceDir, ".palsync", "impact-start.json"), "utf8"));
        return value && value.schema === "palsync/impact-start/1" ? value : null;
    } catch (error) { return null; }
}

// Find the one workspace whose receipt matches this row on BOTH recorded identity values. Matching
// on the Pal GUID alone would be enough today, but the marker costs nothing and the pilot reuses
// fixture digests across arms, so a single-value match is the kind of thing that silently attributes
// one arm's spend to another.
function findWorkspace(row) {
    const wanted = { guid: row.experiment.startPalGuid, marker: row.experiment.startMarker };
    const matches = [];
    let candidates = [];
    try { candidates = fs.readdirSync(WORKSPACE_ROOT); } catch (error) { candidates = []; }
    for (const name of candidates.sort()) {
        const dir = path.join(WORKSPACE_ROOT, name);
        const receipt = readReceipt(dir);
        if (receipt && receipt.palGuid === wanted.guid && receipt.serverMarker === wanted.marker) matches.push(dir);
    }
    if (matches.length === 0) throw new Error("no workspace under " + WORKSPACE_ROOT + " has receipt palGuid " +
        wanted.guid + " and marker " + wanted.marker);
    if (matches.length > 1) throw new Error("ambiguous workspaces for palGuid " + wanted.guid + ": " + matches.join(", "));
    return matches[0];
}

function findTranscript(workspaceDir, row) {
    const dir = projectDirFor(workspaceDir);
    let files;
    try { files = fs.readdirSync(dir).filter(name => name.endsWith(".jsonl")); }
    catch (error) { throw new Error("no host transcript dir for " + workspaceDir + " (looked in " + dir + ")"); }
    // More than one transcript means the session was resumed or compacted into a new file, so the
    // single pinned transcript is only part of the arm's spend and summing it would undercount.
    if (files.length !== 1) {
        throw new Error(dir + " holds " + files.length + " transcripts; expected exactly 1 — " +
            "a resumed/compacted session needs its files summed by hand");
    }
    const expected = row.experiment.transcriptFile && row.experiment.transcriptFile.name;
    if (files[0] !== expected) {
        throw new Error("transcript mismatch: row pins " + expected + " but " + dir + " holds " + files[0]);
    }
    return path.join(dir, files[0]);
}

function assertWindow(row, stats) {
    const marker = markerToDate(row.experiment.startMarker);
    if (!marker) throw new Error("unparseable startMarker " + row.experiment.startMarker);
    if (!stats.firstUsageAt || !stats.lastUsageAt) throw new Error("transcript has no timestamped usage lines");
    const first = new Date(stats.firstUsageAt);
    const last = new Date(stats.lastUsageAt);
    if (first.getTime() < marker.getTime()) {
        throw new Error("first usage " + stats.firstUsageAt + " precedes the arm's server marker " +
            row.experiment.startMarker + " — the transcript contains pre-arm spend");
    }
    const span = last.getTime() - first.getTime();
    const allowed = row.experiment.trajectory.wallTimeMs + WINDOW_SLACK_MS;
    if (span > allowed) {
        throw new Error("usage window " + Math.round(span / 1000) + "s exceeds wall time " +
            Math.round(row.experiment.trajectory.wallTimeMs / 1000) + "s + slack — the session was " +
            "likely resumed after the arm and the extra API calls are not arm spend");
    }
    return { markerToFirstMs: first.getTime() - marker.getTime(), spanMs: span };
}

function backfill({ results, write }) {
    const raw = fs.readFileSync(results, "utf8");
    const lines = raw.split("\n");
    const report = [];
    let changed = 0;

    for (const [index, line] of lines.entries()) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        if (!row.experiment || row.experiment.schema !== "palsync/impact-experiment/1") continue;
        const label = row.experiment.pair + " " + row.experiment.variant;
        if (row.modelUsage !== null) { report.push({ label, status: "skipped", detail: "modelUsage already present" }); continue; }

        const workspaceDir = findWorkspace(row);
        const transcriptPath = findTranscript(workspaceDir, row);
        const transcriptText = fs.readFileSync(transcriptPath, "utf8");
        const result = build({ transcriptText, transcriptPath });
        const window = assertWindow(row, result.stats);
        const modelUsage = validateModelUsage({ exists: true, value: result.sidecar, bytes: null });
        if (modelUsage === null) throw new Error(label + ": extraction produced no usage entries");

        row.modelUsage = modelUsage;
        lines[index] = JSON.stringify(row);
        changed++;

        const sidecar = path.join(workspaceDir, ".palsync", "session-cost.json");
        if (write) {
            fs.mkdirSync(path.dirname(sidecar), { recursive: true });
            fs.writeFileSync(sidecar, JSON.stringify(result.sidecar, null, 2) + "\n");
        }
        report.push({
            label, status: write ? "patched" : "would patch",
            workspace: path.basename(workspaceDir),
            transcript: path.basename(transcriptPath),
            requests: result.stats.requests,
            usageLines: result.stats.usageLines,
            markerToFirstS: Math.round(window.markerToFirstMs / 1000),
            usageSpanS: Math.round(window.spanMs / 1000),
            wallS: Math.round(row.experiment.trajectory.wallTimeMs / 1000),
            modelUsage, sidecar,
        });
    }

    // Rewrite only after every row passed its guards, so a failure halfway through cannot leave the
    // results file half-backfilled.
    if (write && changed) fs.writeFileSync(results, lines.join("\n"));
    return { report, changed };
}

function main() {
    const flags = parseArgs(process.argv);
    const { report, changed } = backfill(flags);
    for (const item of report) {
        console.log(item.label + ": " + item.status + (item.detail ? " (" + item.detail + ")" : ""));
        if (!item.modelUsage) continue;
        console.log("  workspace " + item.workspace + "   transcript " + item.transcript);
        console.log("  " + item.usageLines + " usage lines -> " + item.requests + " requests deduped");
        console.log("  window: first usage +" + item.markerToFirstS + "s after marker, span " +
            item.usageSpanS + "s vs wall " + item.wallS + "s");
        const u = item.modelUsage;
        console.log("  in " + u.tokensIn + "   cached(read) " + u.tokensCached + "   out " + u.tokensOut +
            "   total " + u.totalTokens + "   cost " + (u.cost != null ? "$" + u.cost.toFixed(4) + " " + u.currency : "not priced"));
        console.log("  sidecar " + (flags.write ? "wrote " : "would write ") + item.sidecar);
    }
    console.log((flags.write ? "patched " : "would patch ") + changed + " row(s)" +
        (flags.write ? "" : " — re-run with --write"));
}

if (require.main === module) main();
module.exports = { backfill, projectDirFor, markerToDate, assertWindow };
