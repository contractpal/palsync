#!/usr/bin/env node
"use strict";
// Deterministic trajectory extractor for impact-pilot arms.
//
// WHY THIS EXISTS: eval/impact/README.md forbids coding a trajectory with an LLM or a heuristic
// transcript parser, because a model must not invent the numbers that judge its own harness. In
// practice "code it by hand" proved unusable — a 171-entry JSONL is not something an operator can
// tally reliably. This script is the honest middle: it EXTRACTS exact facts from the structured
// transcript (ordered tool_use entries, timestamps, tool names, file paths) and computes only the
// counts that follow mechanically from them. It makes no judgment.
//
// It deliberately does NOT decide:
//   - firstCorrectWrite (which write "advances a required check" is an oracle judgment)
//   - failedVerificationLoops (what counts as a loop)
//   - hardRuleViolations (did the agent ask the operator a question)
//   - falseExactReferences (was an impact fact wrong)
// Those are printed as ADJUDICATE lines with the evidence needed to settle each one.
//
// Usage: node scripts/extract-impact-trajectory.js --transcript <file.jsonl> --task <taskKey>
//        [--first-correct-write <toolUseIndex>]
const fs = require("fs");
const path = require("path");

// Tool taxonomy for the trajectory's calls{mcp,read,other} buckets. MCP tools are the palsync
// server's; everything else is host tooling.
const READ_TOOLS = new Set(["Read", "NotebookRead"]);
const SEARCH_TOOLS = new Set(["Grep", "Glob", "Search"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

function parseArgs(argv) {
    const flags = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--transcript") flags.transcript = argv[++i];
        else if (a === "--task") flags.task = argv[++i];
        else if (a === "--first-correct-write") flags.firstCorrectWrite = Number(argv[++i]);
        else if (a === "--oracle") flags.oracle = argv[++i];
        else if (a === "--json") flags.json = true;
        else throw new Error("unknown flag " + a);
    }
    if (!flags.transcript) throw new Error("--transcript is required");
    return flags;
}

function isMcpTool(name) {
    return /^(mcp__)?pal(sync)?[_-]/i.test(name) || /^pal_/.test(name);
}

// Bash invocations of the palsync CLI are the same operations as the MCP tools; the agent may use
// either. Record them so `pushes` and acceptance-command detection do not silently miss a CLI run.
// Agents mutate tracked files through the shell as readily as through Write/Edit — the on arm
// renamed the fragment with `mv`, the off arm used Write. Counting only tool writes made the two
// arms' first-correct-write incomparable, which would silently corrupt the primary metric. Returns
// the workspace-relative paths a command CREATES or overwrites (mv/cp destination, touch/redirect/
// sed -i target); sources of a move are removals, not writes that advance a required check.
const TRACKED = "(?:pages|fragments|styles|workflows|scripts|images|emails|documents|datasets|data|datalists|dataviews|attachments|wizards)\\/[^\\s;&|'\"]+|pal\\.json";
function bashWrites(command) {
    if (!command) return [];
    const out = [];
    const push = value => { if (value && !out.includes(value)) out.push(value); };
    for (const segment of command.split(/(?:&&|\|\||;|\n)/)) {
        const s = segment.trim();
        let m = s.match(new RegExp("^(?:git\\s+)?(?:mv|cp)\\s+(?:-\\S+\\s+)*(?:" + TRACKED + ")\\s+(" + TRACKED + ")"));
        if (m) { push(m[1]); continue; }
        m = s.match(new RegExp("^touch\\s+(?:-\\S+\\s+)*(" + TRACKED + ")"));
        if (m) { push(m[1]); continue; }
        m = s.match(new RegExp("^sed\\s+-i\\b.*?\\s(" + TRACKED + ")\\s*$"));
        if (m) { push(m[1]); continue; }
        m = s.match(new RegExp(">>?\\s*(" + TRACKED + ")"));
        if (m) push(m[1]);
    }
    return out;
}

function palsyncCliCalls(command) {
    const out = [];
    const re = /\bpalsync\s+([a-z-]+)/g;
    let m;
    while ((m = re.exec(command)) !== null) out.push("palsync " + m[1]);
    return out;
}

function extract(transcriptPath) {
    const entries = fs.readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean).map(JSON.parse);
    const events = [];
    const results = new Map();

    for (const entry of entries) {
        const content = entry.message && entry.message.content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
            if (part.type === "tool_use") {
                const input = part.input || {};
                events.push({
                    index: events.length,
                    id: part.id,
                    name: part.name,
                    timestamp: entry.timestamp || null,
                    filePath: input.file_path || input.path || null,
                    target: input.target || null,
                    command: input.command || null,
                    cli: input.command ? palsyncCliCalls(input.command) : [],
                    shellWrites: input.command ? bashWrites(input.command) : [],
                    // Searching via bash (rg/grep/find) counts the same as the Grep/Glob tools; a
                    // count that ignored it would understate exploration for CLI-driven agents.
                    bashSearch: !!(input.command && /(^|[|;&\s])(rg|grep|egrep|fgrep|find|ls\s+-R)\b/.test(input.command))
                });
            } else if (part.type === "tool_result") {
                const text = typeof part.content === "string"
                    ? part.content
                    : Array.isArray(part.content)
                        ? part.content.filter(c => c && c.type === "text").map(c => c.text).join("")
                        : "";
                results.set(part.tool_use_id, text);
            }
        }
    }
    return { entries, events, results };
}

function relativize(filePath, taskKey) {
    if (!filePath) return null;
    const marker = taskKey ? null : null;
    const posix = filePath.split(path.sep).join("/");
    // Reduce an absolute workspace path to its workspace-relative form by locating a tracked root.
    const m = posix.match(/\/((?:pages|fragments|styles|workflows|scripts|images|emails|documents|datasets|data|datalists|dataviews|attachments|wizards)\/[^\s]*|pal\.json)$/);
    return m ? m[1] : posix;
}

function main() {
    const flags = parseArgs(process.argv);
    const { events, results } = extract(flags.transcript);

    const counts = { mcp: 0, read: 0, other: 0 };
    let reads = 0, searches = 0, pushes = 0;
    const writes = [], targetCalls = [], cliRuns = [];

    for (const e of events) {
        if (isMcpTool(e.name)) counts.mcp++;
        else if (READ_TOOLS.has(e.name)) counts.read++;
        else counts.other++;

        if (READ_TOOLS.has(e.name)) reads++;
        if (SEARCH_TOOLS.has(e.name) || e.bashSearch) searches++;
        if (WRITE_TOOLS.has(e.name)) writes.push(e);
        for (const rel of e.shellWrites) writes.push({ index: e.index, name: "Bash", filePath: rel, shell: true });
        if (/pal_push/i.test(e.name)) pushes++;
        for (const c of e.cli) {
            cliRuns.push({ index: e.index, cli: c });
            if (c === "palsync push") pushes++;
        }
        if (/pal_context/i.test(e.name) && e.target) targetCalls.push(e);
    }

    const stamps = events.map(e => e.timestamp).filter(Boolean).sort();
    const wallTimeMs = stamps.length >= 2
        ? new Date(stamps[stamps.length - 1]).getTime() - new Date(stamps[0]).getTime()
        : null;

    writes.sort((a, b) => a.index - b.index);
    const firstWriteIndex = writes.length ? writes[0].index : null;
    const cut = flags.firstCorrectWrite !== undefined ? flags.firstCorrectWrite : null;
    const before = cut === null ? null : events.filter(e => e.index < cut);

    const report = {
        transcript: flags.transcript,
        toolUseEvents: events.length,
        calls: counts,
        pushes,
        wallTimeMs,
        targetCalls: targetCalls.length,
        targetBeforeFirstEdit: targetCalls.length > 0 && firstWriteIndex !== null
            ? targetCalls[0].index < firstWriteIndex
            : targetCalls.length > 0 ? true : false,
        impactResponseBytes: targetCalls.length
            ? Buffer.byteLength(results.get(targetCalls[0].id) || "", "utf8") || null
            : null,
        totals: { reads, searches },
        readsBeforeFirstCorrectWrite: before === null ? null : before.filter(e => READ_TOOLS.has(e.name)).length,
        searchesBeforeFirstCorrectWrite: before === null ? null : before.filter(e => SEARCH_TOOLS.has(e.name)).length
    };

    if (flags.json) {
        process.stdout.write(JSON.stringify({ report, writes: writes.map(w => ({ index: w.index, name: w.name, file: relativize(w.filePath) })), cliRuns }, null, 2) + "\n");
        return;
    }

    console.log("TRANSCRIPT: " + flags.transcript);
    console.log("tool_use events: " + events.length + "   wallTimeMs: " + wallTimeMs);
    console.log("calls: mcp=" + counts.mcp + " read=" + counts.read + " other=" + counts.other);
    console.log("pushes: " + pushes + "   reads(total): " + reads + "   searches(total): " + searches);
    console.log("pal_context target calls: " + targetCalls.length +
        (targetCalls.length ? "  first at #" + targetCalls[0].index + "  responseBytes=" + report.impactResponseBytes : ""));
    console.log("");
    console.log("WRITE EVENTS in order (pick the first CORRECT one per the oracle):");
    for (const w of writes) console.log("  #" + w.index + "  " + w.name + "  " + relativize(w.filePath));
    console.log("");
    console.log("palsync CLI invocations in order (for regression timing vs push):");
    for (const c of cliRuns) console.log("  #" + c.index + "  " + c.cli);
    console.log("");
    console.log("Re-run with --first-correct-write <#> to get the pre-correct-write counts.");
    if (cut !== null) {
        console.log("  readsBeforeFirstCorrectWrite    = " + report.readsBeforeFirstCorrectWrite);
        console.log("  searchesBeforeFirstCorrectWrite = " + report.searchesBeforeFirstCorrectWrite);
    }
    // Oracle-aware derivations. These stay deterministic: "first write to an allowed path that
    // advances a required check" is decidable by set membership once the oracle is supplied, and
    // writesOutsideOracle is pure set difference. Printed with the evidence so a human can audit.
    if (flags.oracle) {
        const oracle = JSON.parse(fs.readFileSync(flags.oracle, "utf8"));
        const allowed = new Set(oracle.allowedServerTrackedWrites || []);
        const advances = new Set([
            ...(oracle.requiredPresent || []),
            ...(oracle.requiredContentChecks || []).map(c => c.path)
        ]);
        const rows = writes.map(w => {
            const rel = relativize(w.filePath);
            return { index: w.index, rel, allowed: allowed.has(rel), advances: advances.has(rel) };
        });
        const outside = rows.filter(r => !r.allowed);
        const firstCorrect = rows.find(r => r.allowed && r.advances) || null;
        console.log("ORACLE-DERIVED:");
        for (const r of rows) {
            console.log("  #" + r.index + "  " + r.rel +
                "  allowed=" + r.allowed + "  advancesRequiredCheck=" + r.advances);
        }
        console.log("  writesOutsideOracle = " + outside.length +
            (outside.length ? " (" + outside.map(o => o.rel).join(", ") + ")" : ""));
        if (firstCorrect) {
            const cutIdx = firstCorrect.index;
            const pre = events.filter(e => e.index < cutIdx);
            console.log("  firstCorrectWrite = #" + cutIdx + " (" + firstCorrect.rel + ")");
            console.log("  readsBeforeFirstCorrectWrite    = " + pre.filter(e => READ_TOOLS.has(e.name)).length);
            console.log("  searchesBeforeFirstCorrectWrite = " +
                (pre.filter(e => SEARCH_TOOLS.has(e.name)).length + pre.filter(e => e.bashSearch).length));
        } else {
            console.log("  firstCorrectWrite = NONE -> both pre-correct-write metrics are null");
        }
        console.log("");
    }

    // Regression timing and verdict are both facts in the log: the ordered CLI positions settle
    // "before or after the push", and the tool_result text is the tool's own summary line.
    const regressionEvent = events.find(e => e.cli.includes("palsync regression") || /pal_regression/i.test(e.name));
    const pushEvent = events.find(e => e.cli.includes("palsync push") || /pal_push/i.test(e.name));
    console.log("REGRESSION EVIDENCE:");
    if (!regressionEvent) console.log("  no regression call found -> arm has NO regression verdict");
    else {
        console.log("  regression at #" + regressionEvent.index +
            (pushEvent ? ", push at #" + pushEvent.index +
                " -> regression ran " + (regressionEvent.index < pushEvent.index ? "BEFORE" : "AFTER") + " the push"
                : ", no push found"));
        const text = (results.get(regressionEvent.id) || "").trim();
        console.log("  result: " + (text ? text.split("\n").slice(0, 4).join(" | ").slice(0, 400) : "(no captured result)"));
    }
    console.log("");
    console.log("OPERATOR CONFIRMATION (judgment, with evidence above):");
    console.log("  failedVerificationLoops — a verification that FAILED and was retried");
    console.log("  hardRuleViolations      — the agent asked the operator a question mid-run");
    console.log("  falseExactReferences    — an impact fact that was wrong (off arm: 0 by definition)");
}

if (require.main === module) main();
module.exports = { extract, palsyncCliCalls, isMcpTool };
