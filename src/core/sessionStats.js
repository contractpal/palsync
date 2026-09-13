"use strict";
// The ONE aggregator behind `pal_stats` and `palsync stats`. Every session-efficiency number
// PalSync can honestly measure is read here, from the collectors that already write it — this
// module measures nothing itself and writes nothing.
//
// SOURCE-OF-TRUTH PRECEDENCE (overlapping telemetry is NEVER summed):
//   model usage  1. live Pi counters handed to pal_stats through request _meta
//                2. .palsync/run-usage.json completed windows (Pi, bounded phases)
//                3. .palsync/session-cost.json (harness-reported)
//                Sources 2/3 are listed as corroboration only; the first hit wins.
//   tool usage   1. .palsync.usage.json (the MCP server meters every call for every harness)
//                2. .palsync/pi-usage.jsonl (Pi-side returned bytes; fallback only — it
//                   describes the SAME tool results as source 1)
//   context      1. .palsync/context-manifest.json  2. legacy on-disk measurement
//
// Quality labels are mandatory: "exact" (harness-reported), "measured" (PalSync counted the
// bytes), "estimated" (bytes/4 or pixel-area token proxies), "unavailable". An unavailable
// metric is null with a reason — never zero, and model billing is never estimated.
const path = require("path");
const usage = require("./usage");
const manifestApi = require("./contextManifest");
const lintCache = require("./lintCache");

const SCHEMA = "palsync/session-stats/1";
const VERSION = require("../../package.json").version;
const USAGE_FIELDS = ["input", "cacheRead", "cacheWrite", "output"];
const MAX_TOOL_ROWS = 8;
const MAX_SECTIONS = 5;

function unavailable(reason) {
    return { available: false, quality: "unavailable", reason };
}

function sumSnapshot(snapshot) {
    return USAGE_FIELDS.reduce((total, field) => total + (Number(snapshot[field]) || 0), 0);
}

function phaseWindow(runUsage, phase) {
    const windows = runUsage && runUsage.phases && runUsage.phases[phase] && runUsage.phases[phase].windows;
    return Array.isArray(windows) ? windows : [];
}

function windowIdentity(runUsage) {
    for (const phase of ["review", "build"]) {
        const windows = phaseWindow(runUsage, phase);
        for (let i = windows.length - 1; i >= 0; i--) {
            if (windows[i] && windows[i].model) return { model: windows[i].model, provider: windows[i].provider || null };
        }
    }
    return { model: null, provider: null };
}

function phaseUsage(runUsage, phase, sessionId) {
    const completed = phaseWindow(runUsage, phase).filter(window => window && window.end && window.delta &&
        (sessionId ? window.sessionId === sessionId : false));
    if (!completed.length) return null;
    const total = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0 };
    for (const window of completed) for (const field of Object.keys(total)) total[field] += Number(window.delta[field]) || 0;
    return Object.assign(total, { windows: completed.length, scope: "current session" });
}

function latestSessionId(runUsage) {
    const rows = [];
    for (const phase of ["build", "review"]) for (const window of phaseWindow(runUsage, phase)) {
        if (window && window.sessionId && window.startedAt) rows.push(window);
    }
    rows.sort((a, b) => String(b.endedAt || b.startedAt).localeCompare(String(a.endedAt || a.startedAt)));
    return rows[0] && rows[0].sessionId;
}

// Which telemetry files actually hold model usage, so the report can name the sources it did
// NOT use instead of silently discarding them (or, worse, adding them to the chosen source).
function modelCorroboration(runUsage, sessionCost, chosen, sessionId) {
    const others = [];
    if (runUsage && chosen !== "pi/run-usage" &&
        (phaseUsage(runUsage, "build", sessionId) || phaseUsage(runUsage, "review", sessionId))) {
        others.push("pi/run-usage");
    }
    if (sessionCost && chosen !== "harness/session-cost") others.push("harness/session-cost");
    return others;
}

function resolveModelUsage(workspaceDir, runtime) {
    const runUsage = usage.readRunUsage(workspaceDir);
    const sessionCost = usage.readSessionCost(workspaceDir);
    const sessionId = runtime && runtime.sessionId || latestSessionId(runUsage);
    const build = phaseUsage(runUsage, "build", sessionId);
    const review = phaseUsage(runUsage, "review", sessionId);

    const live = usage.normalizeRunUsageSnapshot(runtime && runtime.snapshot);
    if (live) {
        return {
            available: true, quality: "exact", source: "pi/sessionManager.getEntries (live)",
            model: (runtime && runtime.model) || null, provider: (runtime && runtime.provider) || null,
            input: live.input, cacheRead: live.cacheRead, cacheWrite: live.cacheWrite, output: live.output,
            total: sumSnapshot(live),
            cost: live.cost, currency: "USD",
            scope: "whole Pi session (cumulative, not a bounded phase)",
            phases: { build: build || null, review: review || null },
            corroboration: modelCorroboration(runUsage, sessionCost, "pi/sessionManager.getEntries (live)", sessionId)
        };
    }

    if (build || review) {
        const totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0 };
        for (const phase of [build, review]) {
            if (!phase) continue;
            for (const field of Object.keys(totals)) totals[field] += phase[field];
        }
        const identity = windowIdentity(runUsage);
        return {
            available: true, quality: "exact", source: "pi/run-usage",
            model: identity.model, provider: identity.provider,
            input: totals.input, cacheRead: totals.cacheRead, cacheWrite: totals.cacheWrite,
            output: totals.output, total: sumSnapshot(totals), cost: totals.cost, currency: "USD",
            scope: "completed PalSync phase windows only",
            phases: { build: build || null, review: review || null },
            corroboration: modelCorroboration(runUsage, sessionCost, "pi/run-usage", sessionId)
        };
    }

    if (sessionCost) {
        const { total, phases, hasNamedPhase } = usage.phaseTotals(sessionCost.entries);
        const models = [...new Set(sessionCost.entries.map(entry => entry.model))];
        const providers = [...new Set(sessionCost.entries.map(entry => entry.provider))];
        const named = (name) => (hasNamedPhase && phases[name])
            ? { input: phases[name].tokensIn, cacheRead: phases[name].tokensCached, cacheWrite: null,
                output: phases[name].tokensOut, cost: phases[name].hasCost ? phases[name].cost : null }
            : null;
        return {
            available: true, quality: "exact", source: "harness/session-cost",
            model: models.join(", ") || null, provider: providers.join(", ") || null,
            input: total.tokensIn, cacheRead: total.tokensCached,
            cacheWrite: null, cacheWriteReason: "harness does not report cache-write tokens",
            output: total.tokensOut, total: total.tokensIn + total.tokensCached + total.tokensOut,
            cost: total.hasCost ? total.cost : null,
            costReason: total.hasCost ? null : "no harness-reported cost; PalSync never estimates billing",
            currency: (sessionCost.entries[0] && sessionCost.entries[0].currency) || "USD",
            scope: "harness-reported entries",
            phases: { build: named("build"), review: named("review") },
            corroboration: []
        };
    }

    return Object.assign(unavailable(
        "no live Pi counters, no completed run-usage window, and no session-cost sidecar; PalSync never estimates model billing"
    ), { phases: { build: null, review: null } });
}

function toolRow(name, tool) {
    return {
        tool: name,
        calls: tool.calls || 0,
        errors: tool.errors || 0,
        evidenceCalls: tool.successfulCalls || 0,
        rawBytes: tool.rawBytes || 0,
        returnedBytes: tool.returnedBytes || 0,
        estimatedTokens: tool.tokens || 0,
        maxReturnedBytes: tool.maxReturnedBytes || 0,
        durationMs: Math.round(tool.durationMs || 0)
    };
}

function reductionPercent(rawBytes, returnedBytes) {
    if (!rawBytes) return null;
    return Math.max(0, (1 - (returnedBytes / rawBytes)) * 100);
}

function resolveToolUsage(workspaceDir, sessionId) {
    const tally = usage.normalizeV2(usage.readUsageTally(workspaceDir));
    if (tally && (!sessionId || tally.sessionId === sessionId || tally.pid === process.pid)) {
        const rows = Object.entries(tally.tools).map(([name, tool]) => toolRow(name, tool))
            .sort((a, b) => b.returnedBytes - a.returnedBytes);
        const cache = lintCache.readStats(workspaceDir);
        return {
            available: true, quality: "measured", source: ".palsync.usage.json",
            qualityByField: { bytes: "measured", durations: "measured", estimatedTokens: "estimated" },
            startedAt: tally.startedAt || null, updatedAt: tally.updatedAt || null,
            calls: tally.totalCalls,
            errors: tally.totalErrors || 0,
            successful: tally.totalCalls - (tally.totalErrors || 0),
            // Completion evidence (pal_exercise/pal_push), a different question from erroring.
            evidenceCalls: rows.reduce((sum, row) => sum + row.evidenceCalls, 0),
            rawBytes: tally.totalRawBytes, returnedBytes: tally.totalReturnedBytes,
            reductionPercent: reductionPercent(tally.totalRawBytes, tally.totalReturnedBytes),
            estimatedTokens: tally.totalTokens || 0,
            durationMs: Math.round(tally.totalDurationMs || 0),
            resultCache: { hits: tally.resultCacheHits || 0, misses: tally.resultCacheMisses || 0 },
            lintCache: { scope: "workspace-cumulative", hits: cache.hits, misses: cache.misses, bypasses: cache.bypasses || 0 },
            perTool: rows.slice(0, MAX_TOOL_ROWS),
            perToolTruncated: Math.max(0, rows.length - MAX_TOOL_ROWS)
        };
    }

    // Fallback only: pi-usage.jsonl describes the SAME tool results the tally counts, so it is
    // used when (and only when) the tally is missing. Adding the two would double count.
    const piEntries = usage.readPiUsage(workspaceDir);
    if (piEntries.length) {
        const returnedBytes = piEntries.reduce((sum, entry) => sum + (Number(entry.bytes) || 0), 0);
        const tokens = piEntries.reduce((sum, entry) => sum + (Number(entry.tokenEstimate) || 0), 0);
        const errors = piEntries.filter(entry => entry.isError === true).length;
        return {
            available: true, quality: "measured", source: ".palsync/pi-usage.jsonl (fallback)",
            scope: "workspace-cumulative",
            qualityByField: { bytes: "measured", estimatedTokens: "estimated" },
            startedAt: null, updatedAt: null,
            calls: piEntries.length,
            successful: piEntries.length - errors, errors, evidenceCalls: null,
            rawBytes: null, rawBytesReason: "Pi-side telemetry records returned bytes only",
            returnedBytes, reductionPercent: null,
            estimatedTokens: tokens, durationMs: null,
            resultCache: null, lintCache: null,
            perTool: [], perToolTruncated: 0
        };
    }

    return Object.assign(unavailable("no PalSync tool call has been metered in this workspace"), { perTool: [] });
}

function resolveContext(workspaceDir, tools) {
    const manifest = manifestApi.readManifest(workspaceDir);
    // Generation events outlive any one metering session: they live in the tally file even when
    // no tool call has been recorded, so they are read here rather than off the tool stats.
    const tally = usage.normalizeV2(usage.readUsageTally(workspaceDir));
    const generations = (tally && tally.contextGenerations) || [];
    const latest = generations.length ? generations[generations.length - 1] : null;
    if (manifest) {
        const summary = manifestApi.eagerSummary(manifest);
        const diff = manifestApi.diffManifests(manifestApi.readManifest(workspaceDir, true), manifest);
        return {
            available: true, quality: "measured", source: ".palsync/context-manifest.json",
            qualityByField: { bytes: "measured", estimatedTokens: "estimated" },
            agent: manifest.agent, palsyncVersion: manifest.palsyncVersion,
            eagerBytes: summary.totalBytes,
            estimatedEagerTokens: Math.ceil(summary.totalBytes / 4),
            stablePrefixBytes: summary.stablePrefixBytes,
            dynamicTailBytes: summary.dynamicTailBytes,
            stablePercent: summary.stablePercent,
            stablePrefixHash: summary.stablePrefixHash.slice(0, 12),
            providerCache: "unknown — a locally stable prefix is not a provider cache hit",
            contextWindowUtilization: null,
            generations: generations.length,
            lastGenerationChanged: latest ? latest.changed === true : null,
            firstDivergentSection: diff.firstDivergentSection,
            divergenceReason: diff.reason,
            overSoftThreshold: summary.totalBytes > usage.SOFT_THRESHOLD_BYTES,
            softThresholdBytes: usage.SOFT_THRESHOLD_BYTES,
            largestSections: manifest.sections.slice().sort((a, b) => b.bytes - a.bytes).slice(0, MAX_SECTIONS)
                .map(item => ({ name: item.name, bytes: item.bytes, class: item.class }))
        };
    }

    const injected = usage.injectedContext(workspaceDir, tools);
    if (!injected.total) {
        return Object.assign(unavailable("no context manifest and no injected context on disk"), { largestSections: [] });
    }
    return {
        available: true, quality: "measured", source: "workspace files (legacy; relaunch palsync for a manifest)",
        qualityByField: { bytes: "measured", estimatedTokens: "estimated" },
        agent: null, palsyncVersion: null,
        eagerBytes: injected.total,
        estimatedEagerTokens: Math.ceil(injected.total / 4),
        stablePrefixBytes: null, dynamicTailBytes: null, stablePercent: null, stablePrefixHash: null,
        stableReason: "stable-prefix split needs a context manifest",
        providerCache: "unknown — a locally stable prefix is not a provider cache hit",
        contextWindowUtilization: null,
        generations: generations.length,
        lastGenerationChanged: latest ? latest.changed === true : null,
        firstDivergentSection: latest ? latest.firstDivergentSection : null,
        divergenceReason: null,
        overSoftThreshold: injected.overSoftThreshold,
        softThresholdBytes: usage.SOFT_THRESHOLD_BYTES,
        largestSections: [
            { name: "contract-doc", bytes: injected.palsyncDoc, class: "release-stable" },
            { name: "skill-catalog", bytes: injected.skills.total, class: "release-stable" },
            { name: "tool-definitions", bytes: injected.toolDefs, class: "release-stable" }
        ].filter(item => item.bytes > 0).sort((a, b) => b.bytes - a.bytes)
    };
}

// Bounded counts only. Evidence bodies stay in the ledger; this is a session statistic.
function resolveEvidence(workspaceDir, sessionId) {
    const entries = usage.readToolEvidence(workspaceDir).filter(entry => sessionId && entry.sessionId === sessionId);
    if (!entries.length) return unavailable(sessionId ? "no verification evidence recorded this session" : "no session identity; durable evidence is historical/unbounded");
    const byTool = {};
    for (const entry of entries) byTool[entry.tool] = (byTool[entry.tool] || 0) + 1;
    return {
        available: true, quality: "measured", source: ".palsync/tool-evidence.jsonl",
        entries: entries.length, byTool,
        lastAt: entries[entries.length - 1].ts || null
    };
}

function sessionState(model) {
    const phases = (model && model.phases) || {};
    if (phases.review) return "review measured";
    if (phases.build) return "build window complete";
    return model && model.available ? "in progress" : null;
}

function buildSessionStats(workspaceDir, { tools, runtime } = {}) {
    const dir = path.resolve(workspaceDir);
    const model = resolveModelUsage(dir, runtime);
    const sessionId = runtime && runtime.sessionId || latestSessionId(usage.readRunUsage(dir));
    const toolStats = resolveToolUsage(dir, sessionId);
    const context = resolveContext(dir, tools);
    return {
        schema: SCHEMA,
        session: {
            workspaceDir: dir,
            palsyncVersion: VERSION,
            agent: (runtime && runtime.agent) || context.agent || null,
            model: model.model || (runtime && runtime.model) || null,
            provider: model.provider || (runtime && runtime.provider) || null,
            startedAt: toolStats.startedAt || null,
            updatedAt: toolStats.updatedAt || null,
            id: sessionId || null,
            state: sessionState(model)
        },
        model,
        tools: toolStats,
        context,
        evidence: resolveEvidence(dir, sessionId)
    };
}

function fmtBytes(n) {
    if (n == null) return "n/a";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function fmtNum(n) {
    return n == null ? "n/a" : Number(n).toLocaleString("en-US");
}

function fmtMoney(n, currency) {
    return n == null ? "not provided" : "$" + Number(n).toFixed(4) + " " + (currency || "USD");
}

function header(title, group) {
    return title + " [" + (group.available ? group.quality + " · " + group.source : "unavailable") + "]";
}

function modelLines(model) {
    if (!model.available) return ["  " + model.reason];
    const lines = [
        "  input " + fmtNum(model.input) + "   cacheRead " + fmtNum(model.cacheRead) +
        "   cacheWrite " + (model.cacheWrite == null ? "not reported" : fmtNum(model.cacheWrite)) +
        "   output " + fmtNum(model.output) + "   total " + fmtNum(model.total),
        "  cost " + fmtMoney(model.cost, model.currency) + (model.costReason ? " (" + model.costReason + ")" : "") +
        "   scope: " + model.scope
    ];
    for (const phase of ["build", "review"]) {
        const value = model.phases && model.phases[phase];
        if (value) {
            lines.push("  " + phase + ": input " + fmtNum(value.input) + "   cacheRead " + fmtNum(value.cacheRead) +
                "   output " + fmtNum(value.output) + "   cost " + fmtMoney(value.cost, model.currency) +
                (value.windows ? "   (" + value.windows + " window(s))" : ""));
        }
    }
    if (model.corroboration && model.corroboration.length) {
        lines.push("  also reported by (not summed): " + model.corroboration.join(", "));
    }
    return lines;
}

function toolLines(tools) {
    if (!tools.available) return ["  " + tools.reason];
    const lines = [
        "  " + fmtNum(tools.calls) + " call(s)" +
        (tools.successful != null ? " (" + tools.successful + " ok, " + tools.errors + " error)" : "") +
        (tools.evidenceCalls ? " " + tools.evidenceCalls + " with evidence" : "") +
        "   raw " + fmtBytes(tools.rawBytes) + " → returned " + fmtBytes(tools.returnedBytes) +
        (tools.reductionPercent != null ? " (" + tools.reductionPercent.toFixed(1) + "% reduced)" : "") +
        "   ≈" + fmtNum(tools.estimatedTokens) + " est. tokens" +
        (tools.durationMs != null ? "   " + fmtNum(tools.durationMs) + " ms" : "")
    ];
    const cacheRow = (label, cache) => {
        const total = cache.hits + cache.misses;
        return "  " + label + ": " + cache.hits + " hit(s), " + cache.misses + " miss(es)" +
            (total ? " (" + ((cache.hits / total) * 100).toFixed(1) + "%)" : "") +
            (cache.bypasses ? ", " + cache.bypasses + " bypass(es)" : "");
    };
    if (tools.resultCache) lines.push(cacheRow("result cache", tools.resultCache));
    if (tools.lintCache) lines.push(cacheRow("lint cache (workspace cumulative)", tools.lintCache));
    for (const row of tools.perTool) {
        lines.push("  " + row.tool.padEnd(18) + String(row.calls).padStart(4) + " call(s)  " +
            fmtBytes(row.rawBytes).padStart(9) + " → " + fmtBytes(row.returnedBytes).padStart(9) +
            "  ≈" + fmtNum(row.estimatedTokens) + " tok  max " + fmtBytes(row.maxReturnedBytes) +
            "  " + fmtNum(row.durationMs) + " ms");
    }
    if (tools.perToolTruncated) lines.push("  (+" + tools.perToolTruncated + " smaller tool(s) omitted)");
    return lines;
}

function contextLines(context) {
    if (!context.available) return ["  " + context.reason];
    const lines = [
        "  eager " + fmtBytes(context.eagerBytes) + " (≈" + fmtNum(context.estimatedEagerTokens) + " est. tokens)" +
        (context.stablePrefixBytes != null
            ? "   stable prefix " + fmtBytes(context.stablePrefixBytes) + " (" + context.stablePercent.toFixed(1) + "%)" +
              "   dynamic tail " + fmtBytes(context.dynamicTailBytes)
            : "   " + context.stableReason),
        "  provider cache " + context.providerCache + "; context-window utilization not exposed by the harness"
    ];
    if (context.stablePrefixHash) lines.push("  prefix hash " + context.stablePrefixHash);
    lines.push("  generations " + context.generations +
        (context.lastGenerationChanged == null ? "" : "   last changed: " + (context.lastGenerationChanged ? "yes" : "no")) +
        (context.firstDivergentSection ? "   first divergent: " + context.firstDivergentSection +
            (context.divergenceReason ? " (" + context.divergenceReason + ")" : "") : ""));
    if (context.largestSections.length) {
        lines.push("  largest: " + context.largestSections.map(item => item.name + " " + fmtBytes(item.bytes)).join(" · "));
    }
    lines.push(context.overSoftThreshold
        ? "  ABOVE SOFT THRESHOLD (" + fmtBytes(context.softThresholdBytes) + ")"
        : "  within soft threshold (" + fmtBytes(context.softThresholdBytes) + ")");
    return lines;
}

function evidenceLines(evidence) {
    if (!evidence.available) return ["  " + evidence.reason];
    return ["  " + evidence.entries + " entry(ies): " +
        Object.entries(evidence.byTool).map(([tool, count]) => tool + " " + count).join(", ")];
}

function formatSessionStats(stats) {
    const s = stats.session;
    const lines = [
        "palsync stats — " + s.workspaceDir + " (palsync " + s.palsyncVersion + ")",
        "session: agent=" + (s.agent || "unknown") + "  model=" + (s.model || "unknown") +
        "  provider=" + (s.provider || "unknown") + "  started=" + (s.startedAt || "unknown") +
        "  state=" + (s.state || "unknown"),
        "",
        header("MODEL USAGE", stats.model),
        ...modelLines(stats.model),
        "",
        header("PALSYNC TOOLS", stats.tools),
        ...toolLines(stats.tools),
        "",
        header("CONTEXT", stats.context),
        ...contextLines(stats.context),
        "",
        header("EVIDENCE", stats.evidence),
        ...evidenceLines(stats.evidence)
    ];
    return lines.join("\n");
}

module.exports = { buildSessionStats, formatSessionStats, SCHEMA };
