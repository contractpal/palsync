"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const metadata = require("../src/mcp/pi-tools.json");
const { routeTools, eagerToolNames, activateAdditively, hasPiMcpCollision, piUsageEntry, appendPiUsage,
    isPalsyncWorkspace, completionFingerprint, completionFollowUp,
    piWriteEvent, piAppendContent, promptGuidelinesFor, activationGuidance } = require("../src/core/piHelpers");
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
    // Telemetry never writes outside a PalSync workspace — no stray .palsync/ in unrelated repos.
    assert.equal(appendPiUsage(ws, event, null), null);
    assert.equal(fs.existsSync(path.join(ws, ".palsync")), false);
    fs.writeFileSync(path.join(ws, "EXECUTION.md"), "tasks");
    const file = appendPiUsage(ws, event, { provider: "anthropic", id: "model-x" });
    assert.ok(file);
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(stored.provider, "anthropic");
    assert.equal(stored.model, "model-x");
    assert.equal(stored.cost, null);
    assert.equal(appendPiUsage(ws, { toolName: "bash", content: [] }, null), null);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("Pi completion handling is settled, workspace-scoped, and loop-resistant", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "pi-extension", "index.ts"), "utf8");
    // session_start must bail out in non-workspace dirs — tools/client never activate outside a PalSync repo.
    assert.match(source, /pi\.on\("session_start"[\s\S]{0,120}?if \(!isPalsyncWorkspace\(ctx\.cwd\)\) return;/);
    assert.match(source, /pi\.on\("agent_settled"/);
    assert.doesNotMatch(source, /pi\.on\("agent_end"/);
    assert.match(source, /sendUserMessage\(followUp\.message, \{ deliverAs: "followUp" \}\)/);

    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-pi-completion-"));
    assert.equal(isPalsyncWorkspace(ws), false);
    fs.writeFileSync(path.join(ws, "EXECUTION.md"), "tasks");
    assert.equal(isPalsyncWorkspace(ws), true);
    const gate = { code: "REVIEW_FAILED", allow: false, message: "Review missing" };
    const fingerprint = completionFingerprint(ws, gate);
    const first = completionFollowUp(gate, fingerprint, null);
    assert.ok(first);
    assert.equal(completionFollowUp(gate, fingerprint, first.fingerprint), null, "unchanged failure does not loop");
    fs.writeFileSync(path.join(ws, "REVIEW.md"), "changed");
    const changed = completionFingerprint(ws, gate);
    assert.notEqual(changed, fingerprint);
    assert.ok(completionFollowUp(gate, changed, first.fingerprint), "changed state can trigger correction");
    for (const allowed of [
        { code: "COMPLETE", allow: true }, { code: "NOT_APPLICABLE", allow: true }, { code: "BLOCKED_HANDOFF", allow: true }
    ]) assert.equal(completionFollowUp(allowed, completionFingerprint(ws, allowed), null), null);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("Pi write events translate to the Claude shape the hook cores expect", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-pi-write-"));
    fs.writeFileSync(path.join(ws, ".palsync.json"), "{}");
    // Pi names its editors in lowercase and its path field `path`; the cores read `file_path`.
    for (const [toolName, expected] of [["edit", "Edit"], ["write", "Write"], ["EDIT", "Edit"]]) {
        const event = piWriteEvent(ws, { toolName, input: { path: "pages/home.html" } });
        assert.equal(event.tool_name, expected);
        assert.equal(event.tool_input.file_path, "pages/home.html");
        assert.equal(event.cwd, ws);
    }
    // Everything else is not a direct write, or has nothing to check. `bash` is absent for the same
    // reason the Claude guard omits it: deciding which shell commands write means guessing.
    for (const event of [{ toolName: "read", input: { path: "pages/home.html" } },
        { toolName: "bash", input: { command: "sed -i s/a/b/ pages/home.html" } },
        { toolName: "edit", input: {} }, { toolName: "edit" }, null]) {
        assert.equal(piWriteEvent(ws, event), null, JSON.stringify(event));
    }
    // Outside a PalSync workspace the hooks must not fire at all.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-pi-bare-"));
    assert.equal(piWriteEvent(bare, { toolName: "edit", input: { path: "pages/home.html" } }), null);
    assert.equal(piWriteEvent(null, { toolName: "edit", input: { path: "pages/home.html" } }), null);
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
});

test("Pi post-write feedback appends a block and preserves the original result", () => {
    const original = { type: "tool_result", toolName: "edit", content: [{ type: "text", text: "edited" }],
        details: { diff: "@@" }, isError: false };
    const result = piAppendContent(original, "PalSync post-write check: ...");
    assert.equal(result.content.length, 2);
    assert.deepEqual(result.content[0], original.content[0], "the tool's own output must survive intact");
    assert.equal(result.content[1].type, "text");
    // The edit succeeded and stays succeeded -- advisory feedback must never flip isError.
    assert.equal(result.isError, false);
    assert.deepEqual(result.details, original.details);
    // A failed edit keeps its failure, and no text means no result object at all (Pi leaves it alone).
    assert.equal(piAppendContent({ ...original, isError: true }, "x").isError, true);
    assert.equal(piAppendContent(original, null), null);
    assert.equal(piAppendContent(original, ""), null);
    // A result with no content array still yields exactly one appended block.
    assert.equal(piAppendContent({ toolName: "write" }, "only").content.length, 1);
});

test("both Pi hooks reach the same cores through the CLI adapter's --event flag", () => {
    // pi.exec has no stdin channel, so --event is the only way Pi can hand an event to a core. If this
    // breaks, Pi silently loses the guard and post-write feedback while Claude keeps both.
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-pi-hooks-"));
    fs.writeFileSync(path.join(ws, ".palsync.json"), JSON.stringify({ fileHashes: {} }));
    const cli = path.join(__dirname, "..", "bin", "palsync.js");
    const run = (adapter, event) => spawnSync(process.execPath,
        [cli, "hook", adapter, "--mode", "json", "--dir", ws, "--event", JSON.stringify(event)],
        { encoding: "utf8" });

    const guard = run("guard", piWriteEvent(ws, { toolName: "edit", input: { path: ".palsync.json" } }));
    assert.equal(guard.status, 0, "hook adapters always exit 0");
    assert.equal(JSON.parse(guard.stdout.trim()).blocked, true);

    const allowed = run("guard", piWriteEvent(ws, { toolName: "edit", input: { path: "pages/home.html" } }));
    assert.equal(JSON.parse(allowed.stdout.trim()).blocked, false);

    // A clean workspace has nothing to say, and malformed input fails open rather than erroring out.
    const quiet = run("post-write", piWriteEvent(ws, { toolName: "edit", input: { path: "pages/home.html" } }));
    assert.equal(quiet.status, 0);
    assert.equal(JSON.parse(quiet.stdout.trim()).text, null);
    const broken = spawnSync(process.execPath,
        [cli, "hook", "post-write", "--mode", "json", "--dir", ws, "--event", "{not json"], { encoding: "utf8" });
    assert.equal(broken.status, 0);
    assert.equal(broken.stdout.trim(), "");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("promptGuidelinesFor specifies pal_impact/pal_ast routing as Pi guideline arrays", () => {
    const impact = promptGuidelinesFor("pal_impact");
    assert.equal(impact.length, 1);
    assert.match(impact[0], /Use pal_impact before editing/);
    assert.match(impact[0], /pages\/ or fragments\//);
    assert.match(impact[0], /dependents and registration/);
    const ast = promptGuidelinesFor("pal_ast");
    assert.equal(ast.length, 1);
    assert.match(ast[0], /Use pal_ast for syntax-aware code-shape searches and rewrites/);
    assert.match(ast[0], /grep\/read only for exact text/);
    assert.deepStrictEqual(promptGuidelinesFor("pal_validate"), []);
    assert.deepStrictEqual(promptGuidelinesFor("unknown"), []);
});

test("activationGuidance returns relevant lines in stable order without duplicates", () => {
    const both = activationGuidance(["pal_ast", "pal_impact"]);
    assert.equal(both.length, 2);
    assert.ok(both[0].includes("pal_impact"));
    assert.ok(both[1].includes("pal_ast"));
    const dup = activationGuidance(["pal_impact", "pal_impact", "pal_ast", "pal_impact"]);
    assert.deepStrictEqual(dup, both, "deduped and stable");
    const reversed = activationGuidance(["pal_ast", "pal_impact", "pal_ast"]);
    assert.deepStrictEqual(reversed, both, "stable order regardless of input order");
    assert.deepStrictEqual(activationGuidance(["pal_validate", "pal_status"]), []);
    assert.deepStrictEqual(activationGuidance([]), []);
    assert.deepStrictEqual(activationGuidance(["pal_impact"]), promptGuidelinesFor("pal_impact"));
});

test("Pi extension wires promptGuidelines and immediate activation guidance", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "pi-extension", "index.ts"), "utf8");
    assert.match(source, /promptGuidelines:\s*promptGuidelines\.length \? promptGuidelines : undefined/);
    assert.match(source, /const guidance = activationGuidance\(names\)/);
    assert.match(source, /Routing:\\n- /);
    assert.match(source, /details:\s*\{\s*activated:\s*names\s*\}/);
});

test("Pi routing guidance is entrypoint-local and the installer replaces index.ts last", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "pi-extension", "index.ts"), "utf8");
    assert.match(source, /const TOOL_GUIDELINES/);
    assert.doesNotMatch(source, /promptGuidelinesFor, activationGuidance \} = helpers/);
    assert.deepStrictEqual(registerPi.FILES, ["helpers.js", "tools.json", "index.ts"]);
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
