"use strict";
// Backing logic for the GUI's pal-level and workspace-level Stats panels — reads
// palsync's already-consolidated `src/core/sessionStats.js` aggregator directly (the same
// core the MCP `pal_stats` tool and `palsync stats` CLI both use), so the GUI reports exactly
// the same numbers with the same quality labels (exact/measured/estimated/unavailable) an agent
// would see. This is read-only, offline, and safe to call for a workspace that isn't currently
// open — it just reads whatever telemetry already exists on disk for that pal folder; there is
// no live Pi counter to report in that case, same "unavailable" handling as any other gap.
const { buildSessionStats } = require("palsync/src/core/sessionStats");
const { loadWorkspace } = require("./workspaceStore");

function statsForPal(workspaceDir) {
    return buildSessionStats(workspaceDir);
}

// One independent buildSessionStats read per pal folder in the workspace (no change to
// sessionStats.js's own per-workspace scoping), plus a rollup row. A pal whose folder is
// missing/unreadable gets its own row's error instead of failing the whole modal — one bad pal
// shouldn't hide every other pal's numbers.
async function statsForWorkspace(filePath) {
    const workspace = await loadWorkspace(filePath);
    if (!workspace) throw new Error("Workspace file not found or unreadable: " + filePath);

    const pals = (workspace.pals || []).map(pal => {
        try {
            return { pal, stats: statsForPal(pal.path) };
        } catch (e) {
            return { pal, error: (e && e.message) || String(e) };
        }
    });

    // Cost is never estimated (buildSessionStats leaves it null with a reason when unknown) —
    // so the rollup only sums pals whose cost is quality "exact", and separately reports how
    // many pals were left out, rather than silently treating a null cost as zero.
    let totalCost = null;
    let currency = null;
    let excludedCount = 0;
    for (const { stats } of pals) {
        const model = stats && stats.model;
        if (model && model.quality === "exact" && typeof model.cost === "number") {
            totalCost = (totalCost || 0) + model.cost;
            currency = currency || model.currency;
        } else {
            excludedCount++;
        }
    }

    let totalToolCalls = null;
    for (const { stats } of pals) {
        const calls = stats && stats.tools && stats.tools.available ? stats.tools.calls : null;
        if (typeof calls === "number") totalToolCalls = (totalToolCalls || 0) + calls;
    }

    return {
        workspaceName: workspace.name,
        pals,
        totals: { cost: totalCost, currency, excludedFromCost: excludedCount, toolCalls: totalToolCalls }
    };
}

module.exports = { statsForPal, statsForWorkspace };
