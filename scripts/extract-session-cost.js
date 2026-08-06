#!/usr/bin/env node
"use strict";
// Deterministic model-spend extractor for impact-pilot arms.
//
// WHY THIS EXISTS: `record-eval` reads model spend from `.palsync/session-cost.json`, but nothing
// writes that sidecar, so every recorded impact row carried `modelUsage: null` and the pilot's
// `model-token-non-inferiority` gate could only ever report `incomplete`. The numbers were visible
// only in Claude Code's status line — a hand-transcribed self-report, which is exactly the kind of
// evidence ETHOS principle 2 rejects when a verifiable artifact exists. The artifact does exist:
// the host transcript records the provider's own `usage` block for every API request.
//
// This is a SCORING script, not a harness change. It runs after an arm, from this repo, against the
// transcript the row already pins by sha256. It does not touch the frozen global install, so it
// needs no re-pin and introduces no asymmetry between arms recorded before and after it landed.
//
// TWO RULES THAT CARRY THE WHOLE RESULT:
//
// 1. DEDUP BY requestId. Claude Code splits one API response across several assistant lines (text
//    and each tool_use land as separate entries) and repeats the identical `usage` object on each.
//    Summing lines overcounts by ~2x (measured on arm 1: 19,076 in+out raw vs 8,773 deduped). We
//    keep the first line per requestId; `--json` reports `inconsistentRequests` so a future host
//    change that makes those objects diverge shows up instead of being silently averaged away.
//
// 2. tokensIn = input_tokens + cache_creation_input_tokens; tokensCached = cache_read_input_tokens.
//    Cache-creation tokens are fresh input the provider had to process — they belong in "in", not
//    in "cached", which `palsync cost` labels "provider-reported cached" (i.e. cache READS).
//    `record-eval` fixes totalTokens = tokensIn + tokensOut, so this mapping is the only lever on
//    the gated metric. DO NOT change it mid-pilot: consistency across all 12 arms matters more than
//    the choice, and a half-changed definition silently voids cross-arm comparison.
//
// Tokens are OBSERVED (the provider reported them). Cost is DERIVED from the pinned rate table
// below and is reported for reconciliation only — no pilot gate reads it. An unpriceable model
// yields tokens with no cost rather than an estimate.
//
// Usage: node scripts/extract-session-cost.js --transcript <file.jsonl> --dir <workspace>
//        [--phase build|review] [--json] [--force]
//        node scripts/extract-session-cost.js --transcript <file.jsonl> --json   (preview, no write)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Marker written into the sidecar so a re-run can tell its own output from a sidecar some other
// writer (e.g. a future SessionEnd hook calling `palsync cost record`) produced.
const SOURCE = "palsync/extract-session-cost/1";

// Published per-MTok rates, keyed by exact model id. Deliberately only the models the pilot pins —
// adding rates for models we have not run would be inventing numbers nobody checked. `cacheWrite5m`
// is 1.25x base input, `cacheWrite1h` is 2x, `cacheRead` is 0.1x.
const RATES = {
    "claude-haiku-4-5-20251001": { input: 1.00, output: 5.00, cacheWrite5m: 1.25, cacheWrite1h: 2.00, cacheRead: 0.10, currency: "USD" },
};

function parseArgs(argv) {
    const flags = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--transcript") flags.transcript = argv[++i];
        else if (a === "--dir") flags.dir = argv[++i];
        else if (a === "--phase") flags.phase = argv[++i];
        else if (a === "--json") flags.json = true;
        else if (a === "--force") flags.force = true;
        else throw new Error("unknown flag " + a);
    }
    if (!flags.transcript) throw new Error("--transcript is required");
    if (flags.phase && flags.phase !== "build" && flags.phase !== "review") {
        throw new Error("--phase must be build or review");
    }
    return flags;
}

function count(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function usageKey(usage) {
    return [usage.input_tokens, usage.cache_creation_input_tokens,
        usage.cache_read_input_tokens, usage.output_tokens].map(count).join("/");
}

// Sum the provider's usage blocks for one transcript. Returns per-model accumulators plus the
// provenance counters that let a reader audit what was included and what was skipped.
function extract(transcriptText) {
    const lines = transcriptText.split(/\r?\n/);
    const models = new Map();
    const seen = new Map();
    const stats = { lines: 0, usageLines: 0, requests: 0, inconsistentRequests: 0,
        missingRequestId: 0, sidechainRequests: 0, syntheticSkipped: 0,
        firstUsageAt: null, lastUsageAt: null };

    for (const [index, line] of lines.entries()) {
        if (!line.trim()) continue;
        stats.lines++;
        let entry;
        try { entry = JSON.parse(line); } catch (e) { continue; }
        const message = entry && entry.message;
        const usage = message && message.usage;
        if (!usage || typeof usage !== "object") continue;
        stats.usageLines++;

        // Verified invariant: only `type: "assistant"` lines carry usage. The host also logs
        // `ai-title`, `mode`, `permission-mode` and `last-prompt` lines, and title generation IS a
        // real API call — if a host version starts logging its usage here, that spend is harness
        // overhead, not arm spend, and whether to count it is a decision for an operator. Throwing
        // forces that decision instead of silently shifting the gated metric.
        if (entry.type !== "assistant") {
            throw new Error("transcript line " + index + " has type '" + entry.type +
                "' but carries message.usage — the host format changed; adjudicate before scoring");
        }

        // Host-fabricated assistant turns (API errors, interrupts) carry a placeholder model id like
        // "<synthetic>" and no real spend. Counting them would invent a model in the ledger.
        const model = typeof message.model === "string" ? message.model : "";
        if (!model || model.startsWith("<")) { stats.syntheticSkipped++; continue; }

        // A line with no requestId cannot be deduped against anything, so it is kept on its own key
        // rather than dropped — dropping real spend is the worse error, and the count is reported.
        let key = typeof entry.requestId === "string" && entry.requestId ? entry.requestId : null;
        if (key === null) { stats.missingRequestId++; key = "line:" + index; }

        if (seen.has(key)) {
            if (seen.get(key) !== usageKey(usage)) stats.inconsistentRequests++;
            continue;
        }
        seen.set(key, usageKey(usage));
        stats.requests++;
        if (entry.isSidechain === true) stats.sidechainRequests++;
        // The billed window, so a caller can assert the counted spend falls inside the arm rather
        // than trusting a file the host keeps appending to (see backfill-impact-model-usage.js).
        if (typeof entry.timestamp === "string" && entry.timestamp) {
            if (stats.firstUsageAt === null || entry.timestamp < stats.firstUsageAt) stats.firstUsageAt = entry.timestamp;
            if (stats.lastUsageAt === null || entry.timestamp > stats.lastUsageAt) stats.lastUsageAt = entry.timestamp;
        }

        const creation = usage.cache_creation && typeof usage.cache_creation === "object" ? usage.cache_creation : null;
        const cacheWrite = count(usage.cache_creation_input_tokens);
        // Price the TTL split from the data, never a flat multiplier. When the host omits the split
        // the whole write is treated as 5-minute — that is the API default TTL and the cheaper of
        // the two, so an unknown TTL cannot inflate the reported cost.
        const write1h = creation ? count(creation.ephemeral_1h_input_tokens) : 0;
        const write5m = creation ? count(creation.ephemeral_5m_input_tokens) : 0;
        const split = write1h + write5m === cacheWrite
            ? { write1h, write5m }
            : { write1h: 0, write5m: cacheWrite };

        const acc = models.get(model) || { model, inputTokens: 0, cacheWrite1h: 0, cacheWrite5m: 0,
            cacheReadTokens: 0, outputTokens: 0, requests: 0 };
        acc.inputTokens += count(usage.input_tokens);
        acc.cacheWrite1h += split.write1h;
        acc.cacheWrite5m += split.write5m;
        acc.cacheReadTokens += count(usage.cache_read_input_tokens);
        acc.outputTokens += count(usage.output_tokens);
        acc.requests++;
        models.set(model, acc);
    }

    return { models: [...models.values()].sort((a, b) => a.model.localeCompare(b.model)), stats };
}

// Turn accumulators into the `.palsync/session-cost.json` entry shape that
// `record-eval`'s validateModelUsage and `palsync cost` both already accept.
function toEntries(models, phase) {
    return models.map(acc => {
        const rate = RATES[acc.model] || null;
        const entry = {
            model: acc.model,
            provider: "anthropic",
            tokensIn: acc.inputTokens + acc.cacheWrite1h + acc.cacheWrite5m,
            tokensCached: acc.cacheReadTokens,
            tokensOut: acc.outputTokens,
        };
        if (rate) {
            const cost = (acc.inputTokens * rate.input + acc.cacheWrite1h * rate.cacheWrite1h +
                acc.cacheWrite5m * rate.cacheWrite5m + acc.cacheReadTokens * rate.cacheRead +
                acc.outputTokens * rate.output) / 1e6;
            // Six decimals keeps sub-cent cache-read spend from rounding to zero while staying an
            // exact decimal, so re-running the extractor reproduces the byte-identical sidecar.
            entry.cost = Number(cost.toFixed(6));
            entry.currency = rate.currency;
        }
        if (phase) entry.phase = phase;
        return entry;
    });
}

function build({ transcriptText, transcriptPath, phase }) {
    const { models, stats } = extract(transcriptText);
    const entries = toEntries(models, phase);
    return {
        sidecar: {
            source: SOURCE,
            transcript: path.basename(transcriptPath),
            transcriptSha256: crypto.createHash("sha256").update(transcriptText).digest("hex"),
            tokenBasis: "tokensIn=input+cache_creation, tokensCached=cache_read, deduped by requestId",
            costBasis: entries.some(e => e.cost != null) ? "derived from pinned per-MTok rate table" : "not priced",
            entries,
        },
        models,
        stats,
        unpriced: models.filter(acc => !RATES[acc.model]).map(acc => acc.model),
    };
}

function writeSidecar(workspaceDir, sidecar, force) {
    const target = path.join(path.resolve(workspaceDir), ".palsync", "session-cost.json");
    if (fs.existsSync(target) && !force) {
        let existing = null;
        try { existing = JSON.parse(fs.readFileSync(target, "utf8")); } catch (e) { existing = null; }
        if (!existing || existing.source !== SOURCE) {
            throw new Error("refusing to overwrite a session-cost.json this script did not write: " +
                target + " (pass --force to replace it)");
        }
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(sidecar, null, 2) + "\n");
    return target;
}

function main() {
    const flags = parseArgs(process.argv);
    const transcriptPath = path.resolve(flags.transcript);
    const transcriptText = fs.readFileSync(transcriptPath, "utf8");
    const result = build({ transcriptText, transcriptPath, phase: flags.phase });

    let written = null;
    if (flags.dir) written = writeSidecar(flags.dir, result.sidecar, flags.force);

    if (flags.json) {
        console.log(JSON.stringify({ ...result, written }, null, 2));
        return;
    }

    console.log("transcript: " + path.basename(transcriptPath));
    console.log("  sha256 " + result.sidecar.transcriptSha256);
    console.log("  " + result.stats.usageLines + " usage lines -> " + result.stats.requests +
        " requests (deduped by requestId)");
    if (result.stats.inconsistentRequests) {
        console.log("  WARNING: " + result.stats.inconsistentRequests +
            " requests carried differing usage across lines — dedup kept the first; verify the host format");
    }
    if (result.stats.missingRequestId) {
        console.log("  NOTE: " + result.stats.missingRequestId + " usage lines had no requestId (counted individually)");
    }
    if (result.stats.syntheticSkipped) {
        console.log("  NOTE: " + result.stats.syntheticSkipped + " synthetic/placeholder-model lines skipped");
    }
    if (result.stats.sidechainRequests) {
        console.log("  NOTE: " + result.stats.sidechainRequests + " requests came from subagents (included)");
    }
    for (const entry of result.sidecar.entries) {
        console.log("  " + entry.model + " (" + entry.provider + ")");
        console.log("    in " + entry.tokensIn + "   cached(read) " + entry.tokensCached +
            "   out " + entry.tokensOut + "   total(in+out) " + (entry.tokensIn + entry.tokensOut) +
            "   cost " + (entry.cost != null ? "$" + entry.cost.toFixed(4) + " " + entry.currency : "not priced"));
    }
    for (const model of result.unpriced) {
        console.log("  NOTE: no rate table entry for " + model + " — tokens recorded, cost omitted (never estimated)");
    }
    console.log(written ? "wrote " + written : "no --dir given: nothing written");
}

if (require.main === module) main();
module.exports = { extract, toEntries, build, writeSidecar, RATES, SOURCE };
