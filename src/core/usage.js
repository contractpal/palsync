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

// Byte size of a result returned to the agent's context: text content + any image payloads.
function contentBytes(content) {
    if (!Array.isArray(content)) return 0;
    return content.reduce((n, b) => n +
        (b && b.text ? Buffer.byteLength(b.text, "utf8") : 0) +
        (b && b.data ? b.data.length : 0), 0);
}

// Accumulate one tool call into the per-session tally. Best-effort: instrumentation must NEVER
// break a tool call, so every failure is swallowed. pid mismatch (or missing file) => new session.
function recordToolCall(workspaceDir, toolName, bytes) {
    try {
        const p = usagePath(workspaceDir);
        let u = readJson(p);
        if (!u || u.pid !== process.pid) {
            u = { pid: process.pid, startedAt: new Date().toISOString(), totalCalls: 0, totalBytes: 0, tools: {} };
        }
        const t = u.tools[toolName] || { calls: 0, bytes: 0 };
        t.calls += 1;
        t.bytes += bytes || 0;
        u.tools[toolName] = t;
        u.totalCalls += 1;
        u.totalBytes += bytes || 0;
        u.updatedAt = new Date().toISOString();
        fs.writeFileSync(p, JSON.stringify(u, null, 2));
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
    const u = readJson(usagePath(workspaceDir));
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
        for (const n of names) {
            const t = u.tools[n];
            L.push("  " + n.padEnd(20) + " " + String(t.calls).padStart(4) + " call(s)   " + fmtBytes(t.bytes).padStart(9) + " returned");
        }
        L.push("  " + "TOTAL".padEnd(20) + " " + String(u.totalCalls).padStart(4) + " call(s)   " + fmtBytes(u.totalBytes).padStart(9) + " returned");
    }
    L.push("");

    L.push("Injected context block (always loaded, per session):");
    L.push("  CLAUDE.palsync.md       " + fmtBytes(inj.palsyncDoc).padStart(9));
    L.push("  skill descriptions      " + fmtBytes(inj.skills.total).padStart(9) + "   (" + Object.keys(inj.skills.perSkill).length + " skills; BODIES load on demand, not counted)");
    L.push("  tool definitions        " + fmtBytes(inj.toolDefs).padStart(9) + "   (" + (Array.isArray(tools) ? tools.length : 0) + " tools)");
    L.push("  " + "TOTAL injected".padEnd(22) + "  " + fmtBytes(inj.total).padStart(9));
    L.push(inj.overSoftThreshold
        ? "  ABOVE SOFT THRESHOLD (" + fmtBytes(SOFT_THRESHOLD_BYTES) + ") — consider trimming a skill description or a tool description."
        : "  within soft threshold (" + fmtBytes(SOFT_THRESHOLD_BYTES) + ")");
    return L.join("\n");
}

module.exports = { recordToolCall, contentBytes, injectedContext, formatCost, USAGE_FILE, SOFT_THRESHOLD_BYTES };
