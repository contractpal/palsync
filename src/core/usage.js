"use strict";
// T3 — palsync's OWN context-contribution meter (an honest proxy, NOT model token spend).
//
// palsync cannot see the model's billing. What it CAN measure honestly is its own footprint:
//   1. how many tool calls it served this session, and how many bytes those results returned to
//      the agent's context (recorded live by the MCP server, accumulated in .palsync.usage.json);
//   2. the size of the context block it injects up front — CLAUDE.palsync.md + the always-on skill
//      DESCRIPTIONS (frontmatter, the only part that's always loaded) + the tool definitions.
//
// "this session" = the current MCP server process. The tally is keyed by the server PID, so a new
// server (a new session) starts a fresh count without anyone having to reset it. `palsync cost`
// reads whatever the last/current session wrote.
//
// When a harness writes `.palsync/session-cost.json` (model id, provider, tokens, cost, phase),
// `palsync cost` joins that harness-reported spend into the report; when the sidecar is absent,
// the report says so explicitly and makes no estimate.
const fs = require("fs");
const path = require("path");
const { contentStats: sharedContentStats } = require("./piHelpers");

const USAGE_FILE = ".palsync.usage.json";
const SESSION_COST_FILE = ".palsync/session-cost.json";
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
// real total (~30KB across CLAUDE.palsync.md + 11 skills + 20 tools as of this writing).
const SOFT_THRESHOLD_BYTES = 64 * 1024;

function usagePath(workspaceDir) { return path.join(workspaceDir, USAGE_FILE); }
function sessionCostPath(workspaceDir) { return path.join(workspaceDir, SESSION_COST_FILE); }

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
    out.resultCacheHits = value.resultCacheHits || 0;
    out.resultCacheMisses = value.resultCacheMisses || 0;
    out.tools = {};
    for (const [name, old] of Object.entries(value.tools || {})) {
        out.tools[name] = Object.assign({}, old, {
            rawBytes: old.rawBytes != null ? old.rawBytes : (old.bytes || 0),
            returnedBytes: old.returnedBytes != null ? old.returnedBytes : (old.bytes || 0),
            durationMs: old.durationMs || 0,
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
        if (u) fs.writeFileSync(usagePath(workspaceDir), JSON.stringify(u, null, 2));
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
function recordToolCall(workspaceDir, toolName, bytes, tokens, {
    successful = false,
    rawBytes = bytes,
    returnedBytes = bytes,
    resultCacheHits = 0,
    resultCacheMisses = 0,
    durationMs = 0
} = {}) {
    try {
        const u = tallyFor(workspaceDir);
        const t = u.tools[toolName] || {
            calls: 0, bytes: 0, tokens: 0, rawBytes: 0, returnedBytes: 0,
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

function fmtBytes(n) {
    if (n < 1024) return n + " B";
    return (n / 1024).toFixed(1) + " KB";
}

function fmtNum(n) {
    n = Number(n);
    return Number.isFinite(n) ? n.toLocaleString() : "—";
}

function fmtMoney(n, currency) {
    if (n == null || n === "") return "not provided"; // never estimate an absent cost as $0
    n = Number(n);
    if (!Number.isFinite(n)) return "not provided";
    return "$" + n.toFixed(4) + " " + (currency || "USD");
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

function formatSessionCost(workspaceDir) {
    const sc = readSessionCost(workspaceDir);
    const L = [];
    L.push("Model-token spend (harness-reported via " + SESSION_COST_FILE + "):");
    if (!sc) {
        L.push("  not available — sidecar absent or empty; palsync does not estimate model spend.");
        return L;
    }
    const { total, phases, hasNamedPhase } = phaseTotals(sc.entries);
    const currency = (sc.entries[0] && sc.entries[0].currency) || "USD";
    const costRow = (label, acc) => "  " + label.padEnd(8) + " in: " + fmtNum(acc.tokensIn).padStart(8) + "   provider-reported cached: " + fmtNum(acc.tokensCached).padStart(8) + "   out: " + fmtNum(acc.tokensOut).padStart(8) + "   cost: " + (acc.hasCost ? fmtMoney(acc.cost, currency) : "not provided");
    if (hasNamedPhase) {
        // Print every bucket present ("other" catches untagged entries) so rows sum to the total.
        for (const phase of ["build", "review", "other"]) {
            if (phases[phase]) L.push(costRow(phase, phases[phase]));
        }
    } else {
        for (const e of sc.entries) {
            L.push("  " + e.model + " (" + e.provider + ")");
            L.push("    in: " + fmtNum(e.tokensIn) + "   provider-reported cached: " + fmtNum(e.tokensCached) + "   out: " + fmtNum(e.tokensOut) + "   cost: " + fmtMoney(e.cost, e.currency || currency));
        }
    }
    L.push(costRow("total", total));
    return L;
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

function filterToolEvidence(entries, tool, palGuid, marker) {
    if (!tool || !palGuid || !marker) return [];
    return (Array.isArray(entries) ? entries : []).filter(entry =>
        entry.successful === true && entry.tool === tool &&
        entry.palGuid === palGuid && entry.marker === marker);
}

function readPiUsage(workspaceDir) {
    return readJsonLines(path.join(workspaceDir, PI_USAGE_FILE), "palsync/pi-usage/1");
}

function formatPiUsage(workspaceDir) {
    const entries = readPiUsage(workspaceDir);
    const L = ["Pi extension tool telemetry (" + PI_USAGE_FILE + "):" ];
    if (!entries.length) return L.concat("  no Pi telemetry recorded.");
    const bytes = entries.reduce((sum, entry) => sum + (Number(entry.bytes) || 0), 0);
    const tokens = entries.reduce((sum, entry) => sum + (Number(entry.tokenEstimate) || 0), 0);
    const providers = [...new Set(entries.map(entry => entry.provider).filter(Boolean))];
    const models = [...new Set(entries.map(entry => entry.model).filter(Boolean))];
    L.push("  " + entries.length + " tool result(s), " + fmtBytes(bytes) + " returned, ≈" + fmtNum(tokens) + " estimated tokens");
    L.push("  provider: " + (providers.length ? providers.join(", ") : "not reported") + "   model: " + (models.length ? models.join(", ") : "not reported"));
    L.push("  cost: not provided — PalSync never estimates billing from tool-result telemetry.");
    return L;
}

// Render the cost report. Always labels the numbers as palsync's OWN context contribution.
function formatCost(workspaceDir, tools) {
    flush(workspaceDir);
    const u = tallies.get(workspaceDir) || normalizeV2(readJson(usagePath(workspaceDir)));
    const manifestApi = require("./contextManifest");
    const manifest = manifestApi.readManifest(workspaceDir);
    const inj = manifest ? null : injectedContext(workspaceDir, tools);
    const L = [];
    L.push("palsync context contribution — " + workspaceDir);
    L.push("(palsync's OWN footprint: tool results + injected block. NOT model token spend — palsync can't see that.)");
    L.push("");

    L.push("Tool calls this session:");
    if (!u || !u.totalCalls) {
        L.push("  (none recorded — no MCP tool has run in this workspace yet, or the session just started)");
    } else {
        L.push("  session started: " + u.startedAt + (u.updatedAt ? "   last call: " + u.updatedAt : ""));
        const names = Object.keys(u.tools).sort((a, b) => u.tools[b].returnedBytes - u.tools[a].returnedBytes);
        const fmtTok = (t) => (t.tokens != null ? ("  ≈" + String(t.tokens).padStart(6) + " tok") : "");
        for (const n of names) {
            const t = u.tools[n];
            const saved = t.rawBytes ? Math.max(0, (1 - (t.returnedBytes / t.rawBytes)) * 100) : 0;
            L.push("  " + n.padEnd(20) + " " + String(t.calls).padStart(4) + " call(s)   " +
                fmtBytes(t.rawBytes).padStart(9) + " raw result → " + fmtBytes(t.returnedBytes).padStart(9) +
                " returned (" + saved.toFixed(1) + "% condensed)" + fmtTok(t));
        }
        const totalSaved = u.totalRawBytes ? Math.max(0, (1 - (u.totalReturnedBytes / u.totalRawBytes)) * 100) : 0;
        L.push("  " + "TOTAL".padEnd(20) + " " + String(u.totalCalls).padStart(4) + " call(s)   " +
            fmtBytes(u.totalRawBytes).padStart(9) + " raw result → " + fmtBytes(u.totalReturnedBytes).padStart(9) +
            " returned (" + totalSaved.toFixed(1) + "% condensed)" + fmtTok({ tokens: u.totalTokens }));
        const resultTotal = u.resultCacheHits + u.resultCacheMisses;
        L.push("  result cache: " + u.resultCacheHits + " hit(s), " + u.resultCacheMisses + " miss(es)" +
            (resultTotal ? " — " + ((u.resultCacheHits / resultTotal) * 100).toFixed(1) + "% hit rate" : ""));
        const largest = names.slice().sort((a, b) => u.tools[b].maxReturnedBytes - u.tools[a].maxReturnedBytes).slice(0, 3);
        if (largest.length) L.push("  largest responses: " + largest.map(name => name + " " + fmtBytes(u.tools[name].maxReturnedBytes)).join(" · "));
        L.push("  total tool duration: " + Math.round(u.totalDurationMs) + " ms");
        L.push("  (tok = estimated model tokens: text ≈ bytes/4, images by pixel area — bytes alone overstate image cost)");
    }
    L.push("");

    const lintStats = require("./lintCache").readStats(workspaceDir);
    const cacheTotal = lintStats.hits + lintStats.misses;
    L.push("Local lint result cache:");
    L.push("  " + lintStats.hits + " hit(s), " + lintStats.misses + " miss(es)" +
        (cacheTotal ? " — " + ((lintStats.hits / cacheTotal) * 100).toFixed(1) + "% hit rate" : "") +
        (lintStats.bypasses ? "; " + lintStats.bypasses + " bypass(es)" : ""));
    L.push("");

    L.push(...formatSessionCost(workspaceDir));
    L.push("");
    L.push(...formatPiUsage(workspaceDir));
    L.push("");

    if (manifest) {
        const summary = manifestApi.eagerSummary(manifest);
        L.push("Injected context manifest (eager sections):");
        L.push("  " + "MODELED eager sections".padEnd(22) + "  " + fmtBytes(summary.totalBytes).padStart(9) + "   (≈" + Math.ceil(summary.totalBytes / 4) + " tokens; wrapper bytes excluded)");
        L.push("  locally stable prefix  " + fmtBytes(summary.stablePrefixBytes).padStart(9) + "   (" + summary.stablePercent.toFixed(1) + "% estimated reusable prefix)");
        L.push("  dynamic tail           " + fmtBytes(summary.dynamicTailBytes).padStart(9));
        L.push("  provider cache status unavailable; local stability is not a provider cache hit.");
        L.push(summary.totalBytes > SOFT_THRESHOLD_BYTES
            ? "  ABOVE SOFT THRESHOLD (" + fmtBytes(SOFT_THRESHOLD_BYTES) + ")"
            : "  within soft threshold (" + fmtBytes(SOFT_THRESHOLD_BYTES) + ")");
    } else {
        L.push("Injected context block (legacy measurement; relaunch palsync to generate a manifest):");
        L.push("  CLAUDE.palsync.md       " + fmtBytes(inj.palsyncDoc).padStart(9));
        L.push("  skill descriptions      " + fmtBytes(inj.skills.total).padStart(9) + "   (" + Object.keys(inj.skills.perSkill).length + " skills; BODIES load on demand, not counted)");
        L.push("  tool definitions        " + fmtBytes(inj.toolDefs).padStart(9) + "   (" + (Array.isArray(tools) ? tools.length : 0) + " tools)");
        L.push("  " + "TOTAL injected".padEnd(22) + "  " + fmtBytes(inj.total).padStart(9) + "   (≈" + Math.ceil(inj.total / 4) + " tokens)");
        L.push(inj.overSoftThreshold
            ? "  ABOVE SOFT THRESHOLD (" + fmtBytes(SOFT_THRESHOLD_BYTES) + ") — consider trimming a skill description or a tool description."
            : "  within soft threshold (" + fmtBytes(SOFT_THRESHOLD_BYTES) + ")");
    }
    if (u && u.contextGenerations && u.contextGenerations.length) {
        L.push("Context generation events: " + u.contextGenerations.length + " changed generation(s); latest first divergent section: " +
            (u.contextGenerations[u.contextGenerations.length - 1].firstDivergentSection || "initial generation"));
    }
    return L.join("\n");
}

module.exports = { recordToolCall, recordContextGeneration, contentBytes, contentStats, injectedContext,
    formatCost, skillDescription, readSessionCost, recordSessionCost, readPiUsage, formatPiUsage,
    appendToolEvidence, readToolEvidence, filterToolEvidence,
    phaseTotals, normalizeV2, USAGE_FILE, SESSION_COST_FILE, PI_USAGE_FILE, TOOL_EVIDENCE_FILE,
    SOFT_THRESHOLD_BYTES };
