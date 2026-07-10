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
const fs = require("fs");
const path = require("path");

const USAGE_FILE = ".palsync.usage.json";
const tallies = new Map();
const flushTimers = new Map();

// Soft threshold for palsync's OWN injected block (CLAUDE.palsync.md + skill descriptions + tool
// defs). Not a hard limit — palsync can't see the model's actual context window — just a "this
// has grown, go trim a skill description or a tool description" signal sized off the current
// real total (~30KB across CLAUDE.palsync.md + 11 skills + 13 tools as of this writing).
const SOFT_THRESHOLD_BYTES = 40 * 1024;

function usagePath(workspaceDir) { return path.join(workspaceDir, USAGE_FILE); }

function readJson(p) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { return null; }
}

function tallyFor(workspaceDir) {
    if (tallies.has(workspaceDir)) return tallies.get(workspaceDir);
    let u = readJson(usagePath(workspaceDir));
    if (!u || u.pid !== process.pid) {
        u = { pid: process.pid, startedAt: new Date().toISOString(), totalCalls: 0, totalBytes: 0, totalTokens: 0, tools: {} };
    }
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

// Model-token estimate for one inline image. Anthropic bills images by PIXELS (~w*h/750
// tokens), not payload bytes — a heavily-compressed JPEG costs the same tokens as a lossless
// PNG at the same dimensions. Dimensions come from the image header (PNG IHDR / JPEG SOF).
function imageTokens(b64) {
    try {
        const buf = Buffer.from(b64.slice(0, 65536), "base64");
        let w = 0, h = 0;
        if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) { // PNG magic
            w = buf.readUInt32BE(16); h = buf.readUInt32BE(20);
        } else if (buf.length > 10 && buf.readUInt16BE(0) === 0xffd8) { // JPEG SOI, scan for SOF
            let i = 2;
            while (i + 9 < buf.length) {
                if (buf[i] !== 0xff) { i++; continue; }
                const m = buf[i + 1];
                if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
                    h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break;
                }
                i += 2 + buf.readUInt16BE(i + 2);
            }
        }
        if (w && h) return Math.ceil((w * h) / 750);
    } catch (e) { /* fall through to the default */ }
    return 1365; // header unreadable — assume a 1280x800 viewport capture
}

// Bytes AND estimated model tokens for a result: text ≈ bytes/4, images by pixel dimensions.
// An estimate (real tokenization varies), but it stops image-heavy byte counts from reading
// as the top token cost when they aren't.
function contentStats(content) {
    if (!Array.isArray(content)) return { bytes: 0, tokens: 0 };
    let bytes = 0, tokens = 0;
    for (const b of content) {
        if (b && b.text) {
            const n = Buffer.byteLength(b.text, "utf8");
            bytes += n; tokens += Math.ceil(n / 4);
        }
        if (b && b.data) { bytes += b.data.length; tokens += imageTokens(b.data); }
    }
    return { bytes, tokens };
}

// Accumulate one tool call into the per-session tally. Best-effort: instrumentation must NEVER
// break a tool call, so every failure is swallowed. pid mismatch (or missing file) => new session.
function recordToolCall(workspaceDir, toolName, bytes, tokens) {
    try {
        const u = tallyFor(workspaceDir);
        const t = u.tools[toolName] || { calls: 0, bytes: 0, tokens: 0 };
        t.calls += 1;
        t.bytes += bytes || 0;
        t.tokens = (t.tokens || 0) + (tokens || 0);
        u.tools[toolName] = t;
        u.totalCalls += 1;
        u.totalBytes += bytes || 0;
        u.totalTokens = (u.totalTokens || 0) + (tokens || 0);
        u.updatedAt = new Date().toISOString();
        scheduleFlush(workspaceDir);
    } catch (e) { /* never let metering break a tool call */ }
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
        for (const name of fs.readdirSync(skillsDir)) {
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

// Render the cost report. Always labels the numbers as palsync's OWN context contribution.
function formatCost(workspaceDir, tools) {
    flush(workspaceDir);
    const u = tallies.get(workspaceDir) || readJson(usagePath(workspaceDir));
    const inj = injectedContext(workspaceDir, tools);
    const L = [];
    L.push("palsync context contribution — " + workspaceDir);
    L.push("(palsync's OWN footprint: tool results + injected block. NOT model token spend — palsync can't see that.)");
    L.push("");

    L.push("Tool calls this session:");
    if (!u || !u.totalCalls) {
        L.push("  (none recorded — no MCP tool has run in this workspace yet, or the session just started)");
    } else {
        L.push("  session started: " + u.startedAt + (u.updatedAt ? "   last call: " + u.updatedAt : ""));
        const names = Object.keys(u.tools).sort((a, b) => u.tools[b].bytes - u.tools[a].bytes);
        const fmtTok = (t) => (t.tokens != null ? ("  ≈" + String(t.tokens).padStart(6) + " tok") : "");
        for (const n of names) {
            const t = u.tools[n];
            L.push("  " + n.padEnd(20) + " " + String(t.calls).padStart(4) + " call(s)   " + fmtBytes(t.bytes).padStart(9) + " returned" + fmtTok(t));
        }
        L.push("  " + "TOTAL".padEnd(20) + " " + String(u.totalCalls).padStart(4) + " call(s)   " + fmtBytes(u.totalBytes).padStart(9) + " returned" + fmtTok({ tokens: u.totalTokens }));
        L.push("  (tok = estimated model tokens: text ≈ bytes/4, images by pixel area — bytes alone overstate image cost)");
    }
    L.push("");

    L.push("Injected context block (always loaded, per session):");
    L.push("  CLAUDE.palsync.md       " + fmtBytes(inj.palsyncDoc).padStart(9));
    L.push("  skill descriptions      " + fmtBytes(inj.skills.total).padStart(9) + "   (" + Object.keys(inj.skills.perSkill).length + " skills; BODIES load on demand, not counted)");
    L.push("  tool definitions        " + fmtBytes(inj.toolDefs).padStart(9) + "   (" + (Array.isArray(tools) ? tools.length : 0) + " tools)");
    L.push("  " + "TOTAL injected".padEnd(22) + "  " + fmtBytes(inj.total).padStart(9) + "   (≈" + Math.ceil(inj.total / 4) + " tokens, re-read EVERY turn — the real per-session multiplier)");
    L.push(inj.overSoftThreshold
        ? "  ABOVE SOFT THRESHOLD (" + fmtBytes(SOFT_THRESHOLD_BYTES) + ") — consider trimming a skill description or a tool description."
        : "  within soft threshold (" + fmtBytes(SOFT_THRESHOLD_BYTES) + ")");
    return L.join("\n");
}

module.exports = { recordToolCall, contentBytes, contentStats, injectedContext, formatCost, skillDescription, USAGE_FILE, SOFT_THRESHOLD_BYTES };
