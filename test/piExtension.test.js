"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const metadata = require("../src/mcp/pi-tools.json");
const { routeTools, eagerToolNames, activateAdditively, hasPiMcpCollision, piUsageEntry, appendPiUsage } = require("../src/core/piHelpers");
const { TOOLS } = require("../src/mcp/tools");
const { serializeToolDefinitions } = require("../src/mcp/toolSchema");
const registerPi = require("../src/mcp/registerPi");

test("published package contains every static relative require from src", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-npm-cache-"));
    const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: path.join(__dirname, ".."), encoding: "utf8",
        env: Object.assign({}, process.env, { npm_config_cache: cacheDir })
    });
    try {
        assert.equal(packed.status, 0, packed.stderr);
        const published = new Set(JSON.parse(packed.stdout)[0].files.map(file => file.path));
        const sourceFiles = [...published].filter(file => /^src\/.*\.js$/.test(file));
        for (const file of sourceFiles) {
            const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
            for (const match of source.matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g)) {
                const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
                const candidates = [base, base + ".js", base + ".json", path.posix.join(base, "index.js")];
                assert.ok(candidates.some(candidate => published.has(candidate)), file + " requires unpublished " + match[1]);
            }
        }
    } finally {
        fs.rmSync(cacheDir, { recursive: true, force: true });
    }
});

test("Pi tool metadata is generated from the MCP schema without drift", () => {
    const expected = serializeToolDefinitions(TOOLS);
    assert.deepStrictEqual(metadata.map(({ groups, keywords, ...tool }) => tool), expected);
});

test("every MCP tool is reachable by a deterministic keyword or group", () => {
    const reachable = new Set();
    for (const query of ["sync", "browser", "runtime", "project", "spec"]) {
        for (const name of routeTools(query, metadata)) reachable.add(name);
    }
    assert.deepStrictEqual([...reachable].sort(), TOOLS.map(tool => tool.name).sort());
    assert.deepStrictEqual(routeTools("browser testing", metadata).includes("pal_screenshot"), true);
    assert.deepStrictEqual(routeTools("browser testing", metadata).includes("pal_test"), true);
});

test("Pi activation is eager-small and additive with a mocked ExtensionAPI", () => {
    const state = { active: ["read", "bash"] };
    const pi = {
        getActiveTools: () => state.active,
        setActiveTools: names => { state.active = names; }
    };
    const eager = ["pal_tools", ...eagerToolNames(metadata)];
    assert.ok(eager.length <= 4);
    pi.setActiveTools(activateAdditively(pi.getActiveTools(), eager));
    pi.setActiveTools(activateAdditively(pi.getActiveTools(), routeTools("browser", metadata)));
    for (const name of eager) assert.ok(state.active.includes(name));
    assert.ok(state.active.includes("pal_preview"));
    assert.equal(new Set(state.active).size, state.active.length);
});

test("Pi collision detection recognizes pi-mcp's PalSync prefix", () => {
    assert.equal(hasPiMcpCollision(["read", "mcp_other_tool"]), false);
    assert.equal(hasPiMcpCollision(["mcp_palsync_pal_validate"]), true);
});

test("Pi usage telemetry is local, schema-stable, and never estimates cost", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-pi-usage-"));
    const event = { toolName: "pal_validate", content: [{ type: "text", text: "12345" }], isError: false };
    assert.deepStrictEqual(piUsageEntry(event, null), {
        schema: "palsync/pi-usage/1", tool: "pal_validate", bytes: 5, tokenEstimate: 2,
        provider: null, model: null, cost: null, currency: null, isError: false
    });
    const file = appendPiUsage(ws, event, { provider: "anthropic", id: "model-x" });
    assert.ok(file);
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(stored.provider, "anthropic");
    assert.equal(stored.model, "model-x");
    assert.equal(stored.cost, null);
    assert.equal(appendPiUsage(ws, { toolName: "bash", content: [] }, null), null);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("Pi installer copies owned extension files idempotently and reports pi-mcp", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-pi-home-"));
    const thirdParty = path.join(homeDir, ".pi", "agent", "extensions", "mcp", "index.ts");
    fs.mkdirSync(path.dirname(thirdParty), { recursive: true });
    fs.writeFileSync(thirdParty, "// pi-mcp\n");
    const first = await registerPi.register({ installExtension: true, homeDir });
    const second = await registerPi.register({ installExtension: true, homeDir });
    assert.equal(first.written, true);
    assert.equal(second.written, false);
    assert.equal(first.thirdPartyInstalled, true);
    assert.match(first.collisionGuidance, /lifecycle/);
    for (const file of registerPi.FILES) assert.equal(fs.existsSync(path.join(first.dir, file)), true);
    for (const [file, source] of Object.entries(registerPi.SHARED_SOURCES)) {
        assert.deepStrictEqual(fs.readFileSync(path.join(first.dir, file)), fs.readFileSync(source));
    }
    fs.rmSync(homeDir, { recursive: true, force: true });
});
