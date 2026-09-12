"use strict";
// T3 — palsync's OWN context-contribution COLLECTORS (an honest proxy, NOT model token spend).
//
// palsync cannot see the model's billing. What it CAN measure honestly is its own footprint:
//   1. how many tool calls it served this session, and how many bytes those results returned to
//      the agent's context (recorded live by the MCP server, accumulated in .palsync.usage.json);
//   2. the size of the context block it injects up front — CLAUDE.palsync.md + the always-on skill
//      DESCRIPTIONS (frontmatter, the only part that's always loaded) + the tool definitions.
//
// "this session" = the current MCP server process. The tally is keyed by the server PID, so a new
// server (a new session) starts a fresh count without anyone having to reset it.
//
// This module WRITES and READS; it does not report. Every reader-facing aggregation and format
// lives in sessionStats.js, the single core behind `pal_stats` and `palsync stats`.
const fs = require("fs");
const path = require("path");
const { contentStats: sharedContentStats } = require("./piHelpers");
let workspaceIgnore = null;
function getWorkspaceIgnore() {
    if (!workspaceIgnore) {
        try { workspaceIgnore = require("./workspaceIgnore"); } catch (e) { workspaceIgnore = null; }
    }
    return workspaceIgnore;
}
function ensureTransientIgnore(workspaceDir) {
    const wi = getWorkspaceIgnore();
    if (!wi || !workspaceDir) return;
    try { wi.ensureGitignoreSync(workspaceDir); } catch (e) { /* best-effort */ }
}

const USAGE_FILE = ".palsync.usage.json";
const SESSION_COST_FILE = ".palsync/session-cost.json";
const RUN_USAGE_FILE = ".palsync/run-usage.json";
const PI_USAGE_FILE = ".palsync/pi-usage.jsonl";
const TOOL_EVIDENCE_FILE = ".palsync/tool-evidence.jsonl";
const TOOL_EVIDENCE_SCHEMA = "palsync/tool-evidence/1";
const SESSION_COST_LOCK = ".palsync/session-cost.lock";
const LOCK_RETRIES = 20;
const LOCK_RETRY_MS = 25;
const LOCK_STALE_MS = 2000;
const tallies = new Map();
const flushTimers = new Map();

// Soft threshold for palsync's OWN injected block (CLAUDE.palsync.md + skill descriptions + tool
// defs). Not a hard limit — palsync can't see the model's actual context window — just a "this
// has grown, go trim a skill description or a tool description" signal sized off the current
// real total (~30KB across CLAUDE.palsync.md + 11 skills + 24 tools as of this writing).
const SOFT_THRESHOLD_BYTES = 64 * 1024;

function usagePath(workspaceDir) { return path.join(workspaceDir, USAGE_FILE); }
function sessionCostPath(workspaceDir) { return path.join(workspaceDir, SESSION_COST_FILE); }
function runUsagePath(workspaceDir) { return path.join(workspaceDir, RUN_USAGE_FILE); }

function readJson(p) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { return null; }
}

function emptyTally(contextGenerations = []) {
    return {
        version: 2,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        totalCalls: 0,
        totalBytes: 0,
        totalTokens: 0,
        totalRawBytes: 0,
        totalReturnedBytes: 0,
        totalDurationMs: 0,
        totalErrors: 0,
        resultCacheHits: 0,
        resultCacheMisses: 0,
        tools: {},
        contextGenerations: contextGenerations.slice(-20)
    };
}

function normalizeV2(value) {
    if (!value) return null;
    const out = Object.assign(emptyTally(value.contextGenerations || []), value, { version: 2 });
    out.totalRawBytes = value.totalRawBytes != null ? value.totalRawBytes : (value.totalBytes || 0);
    out.totalReturnedBytes = value.totalReturnedBytes != null ? value.totalReturnedBytes : (value.totalBytes || 0);
    out.totalDurationMs = value.totalDurationMs || 0;
    out.totalErrors = value.totalErrors || 0;
    out.resultCacheHits = value.resultCacheHits || 0;
    out.resultCacheMisses = value.resultCacheMisses || 0;
    out.tools = {};
    for (const [name, old] of Object.entries(value.tools || {})) {
        out.tools[name] = Object.assign({}, old, {
            rawBytes: old.rawBytes != null ? old.rawBytes : (old.bytes || 0),
            returnedBytes: old.returnedBytes != null ? old.returnedBytes : (old.bytes || 0),
            durationMs: old.durationMs || 0,
            errors: old.errors || 0,
            resultCacheHits: old.resultCacheHits || 0,
            resultCacheMisses: old.resultCacheMisses || 0,
            maxReturnedBytes: old.maxReturnedBytes || 0
        });
    }
    return out;
}

function tallyFor(workspaceDir) {
    if (tallies.has(workspaceDir)) return tallies.get(workspaceDir);
    const old = normalizeV2(readJson(usagePath(workspaceDir)));
    let u = old && old.pid === process.pid ? old : emptyTally(old ? old.contextGenerations : []);
    tallies.set(workspaceDir, u);
    return u;
}

function flush(workspaceDir) {
    try {
        const timer = flushTimers.get(workspaceDir);
        if (timer) clearTimeout(timer);
        flushTimers.delete(workspaceDir);
        const u = tallies.get(workspaceDir);
        if (u) {
            ensureTransientIgnore(workspaceDir);
            fs.writeFileSync(usagePath(workspaceDir), JSON.stringify(u, null, 2));
        }
    } catch (e) { /* never let metering break a tool call */ }
}

function scheduleFlush(workspaceDir) {
    if (flushTimers.has(workspaceDir)) return;
    const timer = setTimeout(() => {
        flushTimers.delete(workspaceDir);
        flush(workspaceDir);
    }, 1000);
    timer.unref();
    flushTimers.set(workspaceDir, timer);
}

process.once("exit", () => {
    for (const workspaceDir of tallies.keys()) flush(workspaceDir);
});

// Byte size of a result returned to the agent's context: text content + any image payloads.
function contentBytes(content) {
    if (!Array.isArray(content)) return 0;
    return content.reduce((n, b) => n +
        (b && b.text ? Buffer.byteLength(b.text, "utf8") : 0) +
        (b && b.data ? b.data.length : 0), 0);
}

// Bytes AND estimated model tokens for a result: text ≈ bytes/4, images by pixel dimensions.
// An estimate (real tokenization varies), but it stops image-heavy byte counts from reading
// as the top token cost when they aren't.
function contentStats(content) {
    return sharedContentStats(content);
}

// Accumulate one tool call into the per-session tally. Best-effort: instrumentation must NEVER
// break a tool call, so every failure is swallowed. pid mismatch (or missing file) => new session.
// `successful` means the call produced durable completion EVIDENCE (pal_exercise/pal_push only);
// `errored` is the call's own outcome. They are different questions and are counted separately.
function recordToolCall(workspaceDir, toolName, bytes, tokens, {
    successful = false,
    errored = false,
    rawBytes = bytes,
    returnedBytes = bytes,
    resultCacheHits = 0,
    resultCacheMisses = 0,
    durationMs = 0
} = {}) {
    try {
        const u = tallyFor(workspaceDir);
        const t = u.tools[toolName] || {
            calls: 0, bytes: 0, tokens: 0, rawBytes: 0, returnedBytes: 0, errors: 0,
            resultCacheHits: 0, resultCacheMisses: 0, durationMs: 0, maxReturnedBytes: 0
        };
        t.calls += 1;
        t.bytes += bytes || 0;
        t.tokens = (t.tokens || 0) + (tokens || 0);
        t.rawBytes = (t.rawBytes || 0) + (rawBytes || 0);
        t.returnedBytes = (t.returnedBytes || 0) + (returnedBytes || 0);
        t.resultCacheHits = (t.resultCacheHits || 0) + resultCacheHits;
        t.resultCacheMisses = (t.resultCacheMisses || 0) + resultCacheMisses;
        t.durationMs = (t.durationMs || 0) + durationMs;
        t.maxReturnedBytes = Math.max(t.maxReturnedBytes || 0, returnedBytes || 0);
        if (successful) t.successfulCalls = (t.successfulCalls || 0) + 1;
        if (errored) { t.errors = (t.errors || 0) + 1; u.totalErrors = (u.totalErrors || 0) + 1; }
        u.tools[toolName] = t;
        u.totalCalls += 1;
        u.totalBytes += bytes || 0;
        u.totalTokens = (u.totalTokens || 0) + (tokens || 0);
        u.totalRawBytes += rawBytes || 0;
        u.totalReturnedBytes += returnedBytes || 0;
        u.totalDurationMs += durationMs;
        u.resultCacheHits += resultCacheHits;
        u.resultCacheMisses += resultCacheMisses;
        u.updatedAt = new Date().toISOString();
        scheduleFlush(workspaceDir);
    } catch (e) { /* never let metering break a tool call */ }
}

function recordContextGeneration(workspaceDir, event) {
    try {
        ensureTransientIgnore(workspaceDir);
        const existing = normalizeV2(readJson(usagePath(workspaceDir))) || emptyTally();
        existing.contextGenerations = (existing.contextGenerations || []).concat([event]).slice(-20);
        fs.writeFileSync(usagePath(workspaceDir), JSON.stringify(existing, null, 2) + "\n", "utf8");
        if (tallies.has(workspaceDir)) tallies.get(workspaceDir).contextGenerations = existing.contextGenerations;
    } catch (e) { /* observability must never break generation */ }
}

// Pull the description out of a SKILL.md YAML frontmatter (single-line value, quoted or plain).
function skillDescription(skillMd) {
    const fmMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return "";
    const line = fmMatch[1].split("\n").find(l => /^description:/.test(l));
    if (!line) return "";
    let v = line.replace(/^description:\s*/, "").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
}

// Measure the context block palsync injects up front (bytes on disk / in the tool table).
//   - palsyncDoc : CLAUDE.palsync.md (the owned coding + sync contract)
//   - skills     : the always-on skill DESCRIPTIONS (frontmatter) — the only always-loaded part;
//                  skill BODIES load on demand and are NOT counted (progressive disclosure).
//   - toolDefs   : the tool descriptions the server advertises.
function injectedContext(workspaceDir, tools) {
    const out = { palsyncDoc: 0, skills: { total: 0, perSkill: {} }, toolDefs: 0, total: 0 };

    const doc = path.join(workspaceDir, "CLAUDE.palsync.md");
    try { out.palsyncDoc = fs.statSync(doc).size; } catch (e) { /* not present */ }

    const skillsDir = path.join(workspaceDir, ".claude", "skills");
    try {
        for (const name of fs.readdirSync(skillsDir).sort()) {
            const md = path.join(skillsDir, name, "SKILL.md");
            let desc = "";
            try { desc = skillDescription(fs.readFileSync(md, "utf8")); } catch (e) { continue; }
            const bytes = Buffer.byteLength(desc, "utf8");
            out.skills.perSkill[name] = bytes;
            out.skills.total += bytes;
        }
    } catch (e) { /* no skills dir */ }

    if (Array.isArray(tools)) {
        out.toolDefs = tools.reduce((n, t) => n + Buffer.byteLength(t.description || "", "utf8"), 0);
    }

    out.total = out.palsyncDoc + out.skills.total + out.toolDefs;
    out.overSoftThreshold = out.total > SOFT_THRESHOLD_BYTES;
    return out;
}

// The session tally as the stats core should see it: the live in-process counters when this
// process is the metering MCP server, otherwise whatever the last session flushed to disk.
function readUsageTally(workspaceDir) {
    flush(workspaceDir);
    return tallies.get(workspaceDir) || readJson(usagePath(workspaceDir));
}

// Read the optional harness-reported model spend sidecar.
// Schema: { entries: [{ model, provider, tokensIn, tokensCached, tokensOut, cost?, currency?, phase? }] }
// Falls back to a bare array or a single object with the same fields.
function readSessionCost(workspaceDir) {
    const raw = readJson(sessionCostPath(workspaceDir));
    if (!raw) return null;
    let entries = [];
    if (Array.isArray(raw)) entries = raw;
    else if (Array.isArray(raw.entries)) entries = raw.entries;
    else if (raw && typeof raw.model === "string" && typeof raw.provider === "string") entries = [raw];
    entries = entries.filter(e => e && typeof e.model === "string" && typeof e.provider === "string");
    if (entries.length === 0) return null;
    return { entries };
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function normalizeSessionCostEntry(entry) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "entry is required" };
    if (typeof entry.model !== "string" || !entry.model.trim()) return { ok: false, error: "model is required" };
    if (typeof entry.provider !== "string" || !entry.provider.trim()) return { ok: false, error: "provider is required" };
    if (entry.cost != null && entry.cost !== "" && !Number.isFinite(Number(entry.cost))) {
        return { ok: false, error: "cost must be a finite number" };
    }
    for (const field of ["currency", "phase"]) {
        if (entry[field] != null && typeof entry[field] !== "string") return { ok: false, error: field + " must be a string" };
    }
    const token = (value) => {
        value = Number(value);
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    };
    const normalized = {
        model: entry.model,
        provider: entry.provider,
        tokensIn: token(entry.tokensIn),
        tokensCached: token(entry.tokensCached),
        tokensOut: token(entry.tokensOut)
    };
    if (entry.cost != null && entry.cost !== "") normalized.cost = Number(entry.cost);
    if (entry.currency != null) normalized.currency = entry.currency;
    if (entry.phase != null) normalized.phase = entry.phase;
    return { ok: true, entry: normalized };
}

// Append harness-reported model spend without losing concurrent writers. This stays synchronous
// like the rest of this module so a short-lived CLI process cannot exit before the sidecar lands.
function recordSessionCost(workspaceDir, entry) {
    let locked = false;
    let tmp = null;
    try {
        ensureTransientIgnore(workspaceDir);
        if (typeof workspaceDir !== "string" || !workspaceDir) return { ok: false, error: "workspace directory is required" };
        const valid = normalizeSessionCostEntry(entry);
        if (!valid.ok) return valid;
        const dest = sessionCostPath(workspaceDir);
        const lockDir = path.join(workspaceDir, SESSION_COST_LOCK);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        for (let attempt = 0; attempt <= LOCK_RETRIES; attempt++) {
            try {
                fs.mkdirSync(lockDir);
                locked = true;
                break;
            } catch (e) {
                if (e.code !== "EEXIST") throw e;
                try {
                    if (Date.now() - fs.statSync(lockDir).mtimeMs > LOCK_STALE_MS) {
                        fs.rmSync(lockDir, { recursive: true, force: true });
                        continue;
                    }
                } catch (statError) { if (statError.code !== "ENOENT") throw statError; }
                if (attempt === LOCK_RETRIES) return { ok: false, error: "session cost sidecar is locked" };
                sleepSync(LOCK_RETRY_MS);
            }
        }
        const existing = readSessionCost(workspaceDir);
        const entries = existing ? existing.entries.slice() : [];
        entries.push(valid.entry);
        tmp = dest + ".palsync-tmp-" + process.pid + "-" + Math.random().toString(16).slice(2);
        fs.writeFileSync(tmp, JSON.stringify({ entries }, null, 2) + "\n");
        fs.renameSync(tmp, dest);
        tmp = null;
        return { ok: true, entry: valid.entry, path: dest };
    } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
    } finally {
        if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch (e) { /* best effort */ } }
        if (locked) {
            try { fs.rmSync(path.join(workspaceDir, SESSION_COST_LOCK), { recursive: true, force: true }); }
            catch (e) { /* best effort */ }
        }
    }
}

// Pi exposes these exact counters on Usage. Run snapshots are cumulative Pi session totals;
// subtracting the durable start boundary keeps later conversation turns out of a completed phase.
function normalizeRunUsageSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return null;
    const normalized = {};
    for (const field of ["input", "cacheRead", "output", "cacheWrite", "cost"]) {
        const value = Number(snapshot[field]);
        if (!Number.isFinite(value) || value < 0) return null;
        normalized[field] = value;
    }
    return normalized;
}

function sumSessionCounters(snapshot) {
    return ["input", "cacheRead", "output", "cacheWrite"].reduce((total, field) => total + (Number(snapshot[field]) || 0), 0);
}

function runUsageDelta(start, end) {
    const delta = {};
    for (const field of ["input", "cacheRead", "output", "cacheWrite", "cost"]) {
        delta[field] = Math.max(0, end[field] - start[field]);
    }
    return delta;
}

function readRunUsage(workspaceDir) {
    const raw = readJson(runUsagePath(workspaceDir));
    if (!raw || raw.schema !== "palsync/run-usage/1" || !raw.phases || typeof raw.phases !== "object") return null;
    // The first shipped shape held one window directly on each phase. Normalize it on read so
    // interrupted early adopters retain their bounded evidence when sessions begin appending.
    const phases = {};
    for (const [phase, value] of Object.entries(raw.phases)) {
        if (!value || typeof value !== "object") continue;
        phases[phase] = Array.isArray(value.windows) ? value : { windows: value.start ? [value] : [] };
    }
    return { schema: "palsync/run-usage/1", phases };
}

function runUsagePhaseTotal(runUsage, phase) {
    const total = { input: 0, cacheRead: 0, output: 0, cacheWrite: 0, cost: 0 };
    const windows = runUsage && runUsage.phases && runUsage.phases[phase] && runUsage.phases[phase].windows;
    for (const window of Array.isArray(windows) ? windows : []) {
        if (!window || !window.end || !window.delta) continue;
        for (const field of Object.keys(total)) total[field] += Number(window.delta[field]) || 0;
    }
    return total;
}

// Persist immutable completed windows. A repeated start leaves an open baseline untouched; a
// repeated end leaves the last completed window untouched. Later sessions append a new window.
function captureRunUsage(workspaceDir, { phase, boundary, snapshot, model, provider } = {}) {
    if (phase !== "build" && phase !== "review") return { ok: false, error: "phase must be build or review" };
    if (boundary !== "start" && boundary !== "end") return { ok: false, error: "boundary must be start or end" };
    const normalized = normalizeRunUsageSnapshot(snapshot);
    if (!normalized) return { ok: false, error: "snapshot must contain finite non-negative Pi usage counters" };
    try {
        ensureTransientIgnore(workspaceDir);
        const existing = readRunUsage(workspaceDir) || { schema: "palsync/run-usage/1", phases: {} };
        const phaseRecord = existing.phases[phase] || { windows: [] };
        const windows = phaseRecord.windows;
        const open = windows.find(window => window && window.start && !window.end);
        // Session counters only ever grow WITHIN a session, so a new baseline below the open one
        // proves that window belongs to a session that ended without closing it (a crash or kill).
        // Replacing it is the only honest option: keeping it would span two sessions' counters.
        const staleOpen = open && sumSessionCounters(normalized) < sumSessionCounters(open.start);
        if (boundary === "start" && open && !staleOpen) {
            return { ok: true, unchanged: true, record: open, path: runUsagePath(workspaceDir) };
        }
        if (boundary === "end" && !open) {
            if (windows.length) return { ok: true, unchanged: true, record: windows[windows.length - 1], path: runUsagePath(workspaceDir) };
            return { ok: false, error: "cannot end a phase without a recorded start" };
        }
        const record = boundary === "start"
            ? { source: "pi/sessionManager.getEntries", model: model || null, provider: provider || null, start: normalized }
            : { ...open, end: normalized, delta: runUsageDelta(open.start, normalized) };
        if (boundary === "start" && staleOpen) windows[windows.indexOf(open)] = record;
        else if (boundary === "start") windows.push(record);
        else windows[windows.indexOf(open)] = record;
        existing.phases[phase] = { windows };
        const dest = runUsagePath(workspaceDir);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const tmp = dest + ".palsync-tmp-" + process.pid;
        fs.writeFileSync(tmp, JSON.stringify(existing, null, 2) + "\n");
        fs.renameSync(tmp, dest);
        return { ok: true, record, path: dest };
    } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
    }
}

function makeAcc() { return { tokensIn: 0, tokensCached: 0, tokensOut: 0, cost: 0, hasCost: false }; }
function addEntry(acc, e) {
    acc.tokensIn += Number(e.tokensIn) || 0;
    acc.tokensCached += Number(e.tokensCached) || 0;
    acc.tokensOut += Number(e.tokensOut) || 0;
    // Only a genuine numeric cost counts. null/""/false are "not provided" — never estimate them as $0.
    if (e.cost != null && e.cost !== "" && Number.isFinite(Number(e.cost))) { acc.cost += Number(e.cost); acc.hasCost = true; }
}

// Buckets every entry so the printed rows always sum to the total. build/review keep their own
// buckets; anything else (untagged or another phase) lands in "other" rather than vanishing.
function phaseTotals(entries) {
    const total = makeAcc();
    const phases = {};
    let hasNamedPhase = false;
    for (const e of entries) {
        addEntry(total, e);
        const named = e.phase === "build" || e.phase === "review";
        if (named) hasNamedPhase = true;
        const bucket = named ? e.phase : "other";
        addEntry((phases[bucket] = phases[bucket] || makeAcc()), e);
    }
    return { total, phases, hasNamedPhase };
}

function readJsonLines(file, schema) {
    let lines;
    try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); }
    catch (e) { return []; }
    const entries = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const entry = JSON.parse(line);
            if (entry && typeof entry === "object" && !Array.isArray(entry) && entry.schema === schema) entries.push(entry);
        } catch (e) { /* preserve valid neighboring rows */ }
    }
    return entries;
}

// Durable cross-process completion evidence. Only successful pal_exercise and pal_push handlers
// call this writer; failures remain non-fatal to the underlying tool operation.
function appendToolEvidence(workspaceDir, entry) {
    try {
        ensureTransientIgnore(workspaceDir);
        const file = path.join(workspaceDir, TOOL_EVIDENCE_FILE);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify(Object.assign({}, entry, {
            schema: TOOL_EVIDENCE_SCHEMA,
            successful: true,
            ts: entry && entry.ts ? entry.ts : new Date().toISOString()
        })) + "\n", "utf8");
        return true;
    } catch (e) { return false; }
}

function readToolEvidence(workspaceDir) {
    return readJsonLines(path.join(workspaceDir, TOOL_EVIDENCE_FILE), TOOL_EVIDENCE_SCHEMA);
}

function filterToolEvidence(entries, tool, palGuid, marker, sourceDigest) {
    if (!tool || !palGuid) return [];
    return (Array.isArray(entries) ? entries : []).filter(entry => {
        if (entry.successful !== true || entry.tool !== tool || entry.palGuid !== palGuid) return false;
        if (sourceDigest && entry.sourceDigest) return entry.sourceDigest === sourceDigest;
        return !entry.sourceDigest && !!marker && entry.marker === marker;
    });
}

function readPiUsage(workspaceDir) {
    return readJsonLines(path.join(workspaceDir, PI_USAGE_FILE), "palsync/pi-usage/1");
}

module.exports = { recordToolCall, recordContextGeneration, contentBytes, contentStats, injectedContext,
    readUsageTally, skillDescription, readSessionCost, recordSessionCost, readPiUsage,
    readRunUsage, captureRunUsage, normalizeRunUsageSnapshot, runUsageDelta, runUsagePhaseTotal,
    appendToolEvidence, readToolEvidence, filterToolEvidence,
    phaseTotals, normalizeV2, USAGE_FILE, SESSION_COST_FILE, RUN_USAGE_FILE, PI_USAGE_FILE, TOOL_EVIDENCE_FILE,
    SOFT_THRESHOLD_BYTES };
