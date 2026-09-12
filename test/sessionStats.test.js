"use strict";
// The single stats surface: pal_stats (MCP) and `palsync stats` (CLI) must aggregate through
// sessionStats.js and nothing else. These tests pin the honesty rules (unavailable never becomes
// zero, billing is never estimated, estimates are labeled) and the source-of-truth precedence that
// keeps overlapping telemetry from being summed.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const stats = require("../src/core/sessionStats");
const usage = require("../src/core/usage");
const manifestApi = require("../src/core/contextManifest");
const contextInject = require("../src/launcher/contextInject");
const { TOOLS } = require("../src/mcp/tools");
const { tmpWorkspace } = require("./helpers");

function tool(name) {
    const found = TOOLS.find(item => item.name === name);
    assert.ok(found, name + " must exist");
    return found;
}

function writeSessionCost(ws, entries) {
    fs.mkdirSync(path.join(ws, ".palsync"), { recursive: true });
    fs.writeFileSync(path.join(ws, usage.SESSION_COST_FILE), JSON.stringify({ entries }));
}

test("pal_stats exists, is read-only/idempotent, and needs no arguments", async () => {
    const palStats = tool("pal_stats");
    assert.equal(palStats.annotations.readOnlyHint, true);
    assert.equal(palStats.annotations.idempotentHint, true);
    assert.equal(palStats.annotations.destructiveHint, false);
    assert.deepEqual(Object.keys(palStats.inputShape), []);
    assert.equal(palStats.needsCtx, false);

    const ws = tmpWorkspace();
    const before = fs.readdirSync(ws).sort();
    const first = await palStats.run({ workspaceDir: ws });
    const second = await palStats.run({ workspaceDir: ws });
    assert.equal(first.message, second.message);
    assert.deepEqual(fs.readdirSync(ws).sort(), before, "a stats read must not write to the workspace");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_stats and palsync stats render the same aggregation core", async () => {
    const ws = tmpWorkspace({ "CLAUDE.palsync.md": "doc" });
    usage.recordToolCall(ws, "pal_validate", 40, 10, { rawBytes: 100, returnedBytes: 40, durationMs: 5 });
    usage.readUsageTally(ws);

    const viaTool = await tool("pal_stats").run({ workspaceDir: ws });
    const viaCore = stats.formatSessionStats(stats.buildSessionStats(ws, { tools: TOOLS }));
    assert.equal(viaTool.message, viaCore);
    assert.equal(viaTool.stats.schema, stats.SCHEMA);

    // The CLI alias must hold no stats implementation of its own.
    const cli = fs.readFileSync(path.join(__dirname, "..", "src", "cli", "syncCommands.js"), "utf8");
    assert.match(cli, /require\("\.\.\/core\/sessionStats"\)/);
    assert.doesNotMatch(cli, /formatCost|formatInspect|formatDiff/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("PalSync tool statistics are included and per-tool rows sum to the aggregate", () => {
    const ws = tmpWorkspace();
    usage.recordToolCall(ws, "pal_validate", 40, 10, { rawBytes: 100, returnedBytes: 40, durationMs: 12, successful: true });
    usage.recordToolCall(ws, "pal_validate", 20, 5, { rawBytes: 50, returnedBytes: 20, durationMs: 8 });
    usage.recordToolCall(ws, "pal_status", 10, 3, { rawBytes: 10, returnedBytes: 10, durationMs: 4, errored: true });
    usage.readUsageTally(ws);

    const report = stats.buildSessionStats(ws, { tools: TOOLS });
    const tools = report.tools;
    assert.equal(tools.available, true);
    assert.equal(tools.source, ".palsync.usage.json");
    assert.equal(tools.calls, 3);
    assert.equal(tools.errors, 1, "errors are the call's own outcome");
    assert.equal(tools.successful, 2);
    assert.equal(tools.evidenceCalls, 1, "completion evidence is counted separately from erroring");
    assert.equal(tools.rawBytes, 160);
    assert.equal(tools.returnedBytes, 70);
    assert.equal(tools.durationMs, 24);
    for (const field of ["calls", "rawBytes", "returnedBytes", "estimatedTokens", "durationMs", "errors", "evidenceCalls"]) {
        assert.equal(tools.perTool.reduce((sum, row) => sum + row[field], 0), tools[field], field);
    }
    assert.equal(tools.reductionPercent.toFixed(1), "56.3");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("context totals match eagerSummary and carry the stable-prefix split", async () => {
    const ws = tmpWorkspace();
    await contextInject.inject(ws, { palName: "Demo", agent: "claude" });
    const manifest = manifestApi.readManifest(ws);
    const summary = manifestApi.eagerSummary(manifest);

    const context = stats.buildSessionStats(ws, { tools: TOOLS }).context;
    assert.equal(context.eagerBytes, summary.totalBytes);
    assert.equal(context.stablePrefixBytes, summary.stablePrefixBytes);
    assert.equal(context.dynamicTailBytes, summary.dynamicTailBytes);
    assert.equal(context.stablePercent, summary.stablePercent);
    assert.equal(context.estimatedEagerTokens, Math.ceil(summary.totalBytes / 4));
    assert.ok(summary.stablePrefixHash.startsWith(context.stablePrefixHash));
    assert.equal(context.contextWindowUtilization, null, "context-window utilization is never claimed");
    assert.match(context.providerCache, /not a provider cache hit/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("context generation history matches the manifest's recorded generations", async () => {
    const ws = tmpWorkspace();
    await contextInject.inject(ws, { palName: "Demo", agent: "claude" });
    await contextInject.inject(ws, { palName: "Renamed", agent: "claude" });
    const tally = usage.normalizeV2(usage.readUsageTally(ws));

    const context = stats.buildSessionStats(ws, { tools: TOOLS }).context;
    assert.equal(context.generations, tally.contextGenerations.length);
    assert.equal(context.lastGenerationChanged, true);
    assert.equal(context.firstDivergentSection, "sync-section");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("live Pi usage wins and is never summed with the sidecars that overlap it", () => {
    const ws = tmpWorkspace();
    writeSessionCost(ws, [{ model: "m", provider: "p", tokensIn: 1000, tokensCached: 10, tokensOut: 20, cost: 0.5 }]);
    assert.equal(usage.captureRunUsage(ws, { phase: "build", boundary: "start",
        snapshot: { input: 0, cacheRead: 0, output: 0, cacheWrite: 0, cost: 0 } }).ok, true);
    assert.equal(usage.captureRunUsage(ws, { phase: "build", boundary: "end",
        snapshot: { input: 100, cacheRead: 10, output: 20, cacheWrite: 5, cost: 0.25 } }).ok, true);

    const runtime = { snapshot: { input: 400, cacheRead: 50, output: 60, cacheWrite: 7, cost: 1.5 },
        model: "opus", provider: "anthropic", agent: "pi" };
    const model = stats.buildSessionStats(ws, { tools: TOOLS, runtime }).model;
    assert.equal(model.source, "pi/sessionManager.getEntries (live)");
    assert.equal(model.quality, "exact");
    assert.equal(model.input, 400, "live counters are used as-is, not added to run-usage or session-cost");
    assert.equal(model.cost, 1.5);
    assert.equal(model.total, 400 + 50 + 60 + 7);
    assert.deepEqual(model.corroboration, ["pi/run-usage", "harness/session-cost"]);
    assert.equal(model.phases.build.input, 100, "bounded phase windows stay reported separately");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("run-usage outranks session-cost when no live counters exist", () => {
    const ws = tmpWorkspace();
    writeSessionCost(ws, [{ model: "m", provider: "p", tokensIn: 1000, tokensCached: 0, tokensOut: 0, cost: 9 }]);
    usage.captureRunUsage(ws, { phase: "build", boundary: "start",
        snapshot: { input: 0, cacheRead: 0, output: 0, cacheWrite: 0, cost: 0 } });
    usage.captureRunUsage(ws, { phase: "build", boundary: "end",
        snapshot: { input: 100, cacheRead: 10, output: 20, cacheWrite: 5, cost: 0.25 } });

    const model = stats.buildSessionStats(ws, { tools: TOOLS }).model;
    assert.equal(model.source, "pi/run-usage");
    assert.equal(model.input, 100);
    assert.equal(model.cost, 0.25);
    assert.deepEqual(model.corroboration, ["harness/session-cost"]);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("a missing model cost reports unavailable, never $0", () => {
    const bare = tmpWorkspace();
    const report = stats.buildSessionStats(bare, { tools: TOOLS });
    assert.equal(report.model.available, false);
    assert.equal(report.model.quality, "unavailable");
    assert.equal(report.model.cost, undefined);
    const text = stats.formatSessionStats(report);
    assert.match(text, /MODEL USAGE \[unavailable\]/);
    assert.doesNotMatch(text, /\$0\.0000/);
    assert.match(text, /never estimates model billing/);

    // Present entries without a cost field must stay "not provided" too.
    const priced = tmpWorkspace();
    writeSessionCost(priced, [{ model: "m", provider: "p", tokensIn: 800, tokensCached: 0, tokensOut: 200 }]);
    const withoutCost = stats.buildSessionStats(priced, { tools: TOOLS });
    assert.equal(withoutCost.model.cost, null);
    assert.equal(withoutCost.model.input, 800);
    assert.equal(withoutCost.model.cacheWrite, null, "an unreported counter is null, not zero");
    const pricedText = stats.formatSessionStats(withoutCost);
    assert.match(pricedText, /cost not provided/);
    assert.doesNotMatch(pricedText, /cost \$/);
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(priced, { recursive: true, force: true });
});

test("token figures derived from bytes are labeled estimates", () => {
    const ws = tmpWorkspace({ "CLAUDE.palsync.md": "doc" });
    usage.recordToolCall(ws, "pal_validate", 40, 10, { rawBytes: 100, returnedBytes: 40 });
    usage.readUsageTally(ws);
    const report = stats.buildSessionStats(ws, { tools: TOOLS });
    assert.equal(report.tools.qualityByField.estimatedTokens, "estimated");
    assert.equal(report.context.qualityByField.estimatedTokens, "estimated");
    assert.ok("estimatedTokens" in report.tools);
    assert.ok("estimatedEagerTokens" in report.context);
    const text = stats.formatSessionStats(report);
    assert.match(text, /est\. tokens/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pi-usage is a fallback for the same tool results, never an addition to them", () => {
    const ws = tmpWorkspace();
    const file = path.join(ws, usage.PI_USAGE_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
        JSON.stringify({ schema: "palsync/pi-usage/1", tool: "pal_validate", bytes: 100, tokenEstimate: 25, isError: false }),
        "{malformed Pi row",
        JSON.stringify({ schema: "palsync/pi-usage/1", tool: "pal_test", bytes: 20, tokenEstimate: 5, isError: true })
    ].join("\n") + "\n");

    const fallback = stats.buildSessionStats(ws, { tools: TOOLS }).tools;
    assert.match(fallback.source, /pi-usage\.jsonl \(fallback\)/);
    assert.equal(fallback.calls, 2);
    assert.equal(fallback.returnedBytes, 120);
    assert.equal(fallback.errors, 1);
    assert.equal(fallback.rawBytes, null, "Pi telemetry has no raw-result size to report");

    usage.recordToolCall(ws, "pal_validate", 40, 10, { rawBytes: 100, returnedBytes: 40 });
    usage.readUsageTally(ws);
    const authoritative = stats.buildSessionStats(ws, { tools: TOOLS }).tools;
    assert.equal(authoritative.source, ".palsync.usage.json");
    assert.equal(authoritative.calls, 1, "the tally wins outright; the two sources are never summed");
    assert.equal(authoritative.returnedBytes, 40);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("evidence is reported as bounded counts, never as evidence bodies", () => {
    const ws = tmpWorkspace();
    usage.appendToolEvidence(ws, { tool: "pal_push", palGuid: "g", marker: "m", body: "x".repeat(5000) });
    usage.appendToolEvidence(ws, { tool: "pal_exercise", palGuid: "g", marker: "m" });
    const report = stats.buildSessionStats(ws, { tools: TOOLS });
    assert.deepEqual(report.evidence.byTool, { pal_push: 1, pal_exercise: 1 });
    const text = stats.formatSessionStats(report);
    assert.doesNotMatch(text, /xxxx/);
    assert.ok(Buffer.byteLength(text, "utf8") < 4096, "the stats result stays compact");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("a non-Pi harness degrades gracefully instead of failing", () => {
    const ws = tmpWorkspace({ "CLAUDE.palsync.md": "doc" });
    usage.recordToolCall(ws, "pal_validate", 40, 10, { rawBytes: 100, returnedBytes: 40 });
    usage.readUsageTally(ws);
    const report = stats.buildSessionStats(ws, { tools: TOOLS });
    assert.equal(report.model.available, false);
    assert.equal(report.tools.available, true, "PalSync-measured stats survive a harness with no usage API");
    assert.equal(report.context.available, true);
    assert.ok(stats.formatSessionStats(report).includes("MODEL USAGE [unavailable]"));
    fs.rmSync(ws, { recursive: true, force: true });
});

test("consolidation left exactly one stats surface and added no telemetry file", () => {
    const root = path.join(__dirname, "..");
    const sources = ["src/core/sessionStats.js", "src/core/usage.js", "src/cli/syncCommands.js", "src/mcp/tools.js"]
        .map(rel => fs.readFileSync(path.join(root, rel), "utf8")).join("\n");
    for (const file of ["USAGE_FILE", "SESSION_COST_FILE", "RUN_USAGE_FILE", "PI_USAGE_FILE", "TOOL_EVIDENCE_FILE"]) {
        assert.ok(usage[file], file + " remains a collector, not a new reporting file");
    }
    assert.doesNotMatch(sources, /session-stats\.json|stats-cache|\.palsync\.stats/, "no new telemetry file");
    assert.equal(TOOLS.filter(item => /^pal_(stats|cost|usage|telemetry)$/.test(item.name))
        .map(item => item.name).join(","), "pal_stats");
});

test("a harness can hand pal_stats live counters over MCP request _meta", async () => {
    const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
    const { createServer } = require("../src/mcp/server");
    const ws = tmpWorkspace({ "CLAUDE.palsync.md": "doc" });
    const server = createServer(async () => { throw new Error("stats must never need login or a lock"); },
        ws, { profile: "pi-minimal" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "stats-test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const listed = (await client.listTools()).tools.map(item => item.name);
    assert.ok(listed.includes("pal_stats"), "pal_stats is eager: no pal_tools activation round trip");

    const result = await client.callTool({
        name: "pal_stats", arguments: {},
        _meta: { "palsync/runtime": { snapshot: { input: 1234, cacheRead: 99, output: 55, cacheWrite: 7, cost: 0.42 },
            model: "opus", provider: "anthropic", agent: "pi" } }
    });
    const text = result.content.map(item => item.text).join("\n");
    assert.match(text, /MODEL USAGE \[exact · pi\/sessionManager\.getEntries \(live\)\]/);
    assert.match(text, /input 1,234\s+cacheRead 99\s+cacheWrite 7\s+output 55/);
    assert.match(text, /cost \$0\.4200 USD/);
    assert.match(text, /agent=pi\s+model=opus/);

    // A call with no harness metadata must degrade, not inherit the previous call's numbers.
    const bare = await client.callTool({ name: "pal_stats", arguments: {} });
    assert.match(bare.content.map(item => item.text).join("\n"), /MODEL USAGE \[unavailable\]/);
    await client.close();
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_context behavior is untouched by the stats consolidation", async () => {
    const ws = tmpWorkspace();
    const palContext = tool("pal_context");
    assert.equal(palContext.needsCtx, false);
    assert.deepEqual(Object.keys(palContext.inputShape).sort(), ["query", "section"]);
    const catalog = await palContext.run({ workspaceDir: ws }, {});
    assert.deepEqual(JSON.parse(catalog.message).sections.map(item => item.id),
        require("../src/launcher/contextInject").onDemandSyncSections(null, { cli: false, skillsDir: ".claude/skills" })
            .map(item => item.id));
    const selected = await palContext.run({ workspaceDir: ws }, { section: "datasets" });
    assert.equal(JSON.parse(selected.message).sections[0].id, "datasets");
    fs.rmSync(ws, { recursive: true, force: true });
});
