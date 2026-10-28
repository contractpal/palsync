"use strict";
// runTunnelAction: credential lifecycle (mint when absent, reuse when given, re-mint ONCE on
// 401) and wire format (tunnelAction/tunnelWorkflow headers, "{}" default body, JSON parsing,
// empty-body = workflow-threw signal). The network is stubbed at two seams: fetchImpl (the
// tunnel endpoint) and the apiManager/resolve pair (mocked via module cache) for minting.
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const { tmpWorkspace } = require("./helpers");

const apiManagerPath = require.resolve("../lib/apiManager");
const resolvePath = require.resolve("../src/core/resolve");
const tunnelPath = require.resolve("../src/core/tunnel");

// Install mocks for the mint path (resolve + CreateTunnel.do), then (re)load core/tunnel.
// mintResults is consumed one per mint so tests can make the SECOND mint differ from the first.
let mintCalls;
function loadTunnelWithMint(mintResults) {
    mintCalls = 0;
    delete require.cache[tunnelPath];
    require.cache[resolvePath] = {
        id: resolvePath, filename: resolvePath, loaded: true,
        exports: { resolveServerPalByGuid: async () => ({ id: "PAL-ID-1", guid: "GUID-1" }) }
    };
    require.cache[apiManagerPath] = {
        id: apiManagerPath, filename: apiManagerPath, loaded: true,
        exports: { CloudPistonAPIManager: { createTunnel: async () => mintResults[Math.min(mintCalls++, mintResults.length - 1)] } }
    };
    return require(tunnelPath);
}

const MINT_OK = { tunnelUrl: "https://cloud/cptservice/run.do", tunnelUsername: "TB-GUID-1", tunnelPassword: "NX-1" };
const MINT_OK2 = { tunnelUrl: "https://cloud/cptservice/run.do", tunnelUsername: "TB-GUID-1", tunnelPassword: "NX-2" };

function fetchStub(responses, calls) {
    return async (url, opts) => {
        calls.push({ url, opts });
        const r = responses[Math.min(calls.length - 1, responses.length - 1)];
        return { status: r.status, text: async () => r.text };
    };
}

afterEach(() => {
    delete require.cache[tunnelPath];
    delete require.cache[resolvePath];
    delete require.cache[apiManagerPath];
});

test("mints credentials when none are cached; sends headers + '{}' default body", async () => {
    const { runTunnelAction } = loadTunnelWithMint([MINT_OK]);
    const calls = [];
    const res = await runTunnelAction({}, "GUID-1", {
        action: "hello", fetchImpl: fetchStub([{ status: 200, text: '{"ok":"hello"}' }], calls)
    });
    assert.equal(res.ran, true);
    assert.equal(mintCalls, 1);
    assert.equal(res.refreshedCredentials, true);
    assert.deepEqual(res.response, { ok: "hello" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, MINT_OK.tunnelUrl);
    assert.equal(calls[0].opts.headers.tunnelAction, "hello");
    assert.equal(calls[0].opts.headers.tunnelWorkflow, undefined);
    assert.equal(calls[0].opts.body, "{}");
    assert.equal(calls[0].opts.headers.Authorization, "Basic " + Buffer.from("TB-GUID-1:NX-1").toString("base64"));
    // creds returned for the caller's session cache
    assert.equal(res.creds.password, "NX-1");
});

test("reuses cached creds (no mint); payload object serialized; tunnelWorkflow header sent", async () => {
    const { runTunnelAction } = loadTunnelWithMint([MINT_OK]);
    const calls = [];
    const res = await runTunnelAction({}, "GUID-1", {
        action: "echo", workflow: "tunnel.js", payload: { name: "world", n: 42 },
        creds: { url: "https://cloud/cptservice/run.do", username: "TB-GUID-1", password: "CACHED" },
        fetchImpl: fetchStub([{ status: 200, text: "{}" }], calls)
    });
    assert.equal(res.ran, true);
    assert.equal(mintCalls, 0);
    assert.equal(res.refreshedCredentials, false);
    assert.equal(calls[0].opts.headers.tunnelWorkflow, "tunnel.js");
    assert.equal(calls[0].opts.body, JSON.stringify({ name: "world", n: 42 }));
    assert.equal(calls[0].opts.headers.Authorization, "Basic " + Buffer.from("TB-GUID-1:CACHED").toString("base64"));
});

test("401 with cached creds -> re-mints once and retries with the fresh token", async () => {
    const { runTunnelAction } = loadTunnelWithMint([MINT_OK2]);
    const calls = [];
    const res = await runTunnelAction({}, "GUID-1", {
        action: "hello",
        creds: { url: "https://cloud/cptservice/run.do", username: "TB-GUID-1", password: "EXPIRED" },
        fetchImpl: fetchStub([{ status: 401, text: "" }, { status: 200, text: '{"ok":"hello"}' }], calls)
    });
    assert.equal(res.ran, true);
    assert.equal(mintCalls, 1);
    assert.equal(res.refreshedCredentials, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].opts.headers.Authorization, "Basic " + Buffer.from("TB-GUID-1:NX-2").toString("base64"));
    assert.equal(res.creds.password, "NX-2");
});

test("401 even after a fresh mint -> refused, no infinite retry", async () => {
    const { runTunnelAction } = loadTunnelWithMint([MINT_OK]);
    const calls = [];
    const res = await runTunnelAction({}, "GUID-1", {
        action: "hello", fetchImpl: fetchStub([{ status: 401, text: "" }], calls)
    });
    assert.equal(res.ran, false);
    assert.equal(res.refused, "unauthorized");
    assert.equal(calls.length, 1); // fresh mint's 401 is terminal — no second call
});

test("empty 200 body -> emptyBody flagged (workflow threw)", async () => {
    const { runTunnelAction } = loadTunnelWithMint([MINT_OK]);
    const res = await runTunnelAction({}, "GUID-1", {
        action: "boom", fetchImpl: fetchStub([{ status: 200, text: "" }], [])
    });
    assert.equal(res.ran, true);
    assert.equal(res.emptyBody, true);
    assert.equal(res.response, null);
});

test("non-JSON 200 body -> parseError set, raw preserved", async () => {
    const { runTunnelAction } = loadTunnelWithMint([MINT_OK]);
    const res = await runTunnelAction({}, "GUID-1", {
        action: "hello", fetchImpl: fetchStub([{ status: 200, text: "<html>oops</html>" }], [])
    });
    assert.equal(res.ran, true);
    assert.ok(res.parseError);
    assert.equal(res.raw, "<html>oops</html>");
});

test("non-200/401 -> refused with stripped-HTML reason", async () => {
    const { runTunnelAction } = loadTunnelWithMint([MINT_OK]);
    const res = await runTunnelAction({}, "GUID-1", {
        action: "hello",
        fetchImpl: fetchStub([{ status: 500, text: "<html><body>Error Message: No content sent</body></html>" }], [])
    });
    assert.equal(res.ran, false);
    assert.equal(res.refused, "http-500");
    assert.match(res.reason, /No content sent/);
});

test("action omitted -> call still runs, tunnelAction header not sent", async () => {
    const { runTunnelAction } = loadTunnelWithMint([MINT_OK]);
    const calls = [];
    const res = await runTunnelAction({}, "GUID-1", {
        fetchImpl: fetchStub([{ status: 200, text: "{}" }], calls)
    });
    assert.equal(res.ran, true);
    assert.equal(res.action, null);
    assert.equal(Object.prototype.hasOwnProperty.call(calls[0].opts.headers, "tunnelAction"), false);
});

test("listTunnelWorkflows: reads type-15 workflows + registered default from pal.json", () => {
    const { listTunnelWorkflows } = loadTunnelWithMint([MINT_OK]);
    const fs = require("fs");
    const dir = tmpWorkspace({
        "pal.json": JSON.stringify({
            layout: { tunnelServiceWorkflow: "tunnel.js" },
            workflows: { entry: [
                { string: "tunnel.js", Workflow: { workflowType: 15 } },
                { string: "other-tunnel.js", Workflow: { workflowType: 15 } },
                { string: "console.js", Workflow: { workflowType: 7 } }
            ] }
        })
    });
    try {
        const r = listTunnelWorkflows(dir);
        assert.deepEqual(r.tunnels, ["tunnel.js", "other-tunnel.js"]);
        assert.equal(r.defaultTunnel, "tunnel.js");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("listTunnelWorkflows: missing pal.json -> empty, no throw", () => {
    const { listTunnelWorkflows } = loadTunnelWithMint([MINT_OK]);
    const fs = require("fs");
    const dir = tmpWorkspace({});
    try {
        const r = listTunnelWorkflows(dir);
        assert.deepEqual(r.tunnels, []);
        assert.equal(r.defaultTunnel, null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("pal_tunnel_test tool: bare call -> interview-needed, no network; empty action string counts as answered", async () => {
    loadTunnelWithMint([MINT_OK]); // install mocks so tools.js's require of core/tunnel is safe
    const fs = require("fs");
    const { TOOLS } = require("../src/mcp/tools");
    const tool = TOOLS.find(t => t.name === "pal_tunnel_test");
    const dir = tmpWorkspace({
        "pal.json": JSON.stringify({
            layout: { tunnelServiceWorkflow: "tunnel.js" },
            workflows: { entry: [{ string: "tunnel.js", Workflow: { workflowType: 15 } }] }
        })
    });
    const ctx = { workspaceDir: dir, session: {}, record: { palGuid: "G" } };
    try {
        const bare = await tool.run(ctx, {});
        assert.equal(bare.ran, false);
        assert.equal(bare.refused, "interview-needed");
        assert.match(bare.message, /ask the user/i);
        assert.deepEqual(bare.tunnelWorkflows, ["tunnel.js"]);
        // an explicit action WITHOUT the attestation is treated as invented — still gated
        // (v1 exempted it and agents fabricated action:"test" to sail through)
        const invented = await tool.run(ctx, { action: "test", workflow: "tunnel" });
        assert.equal(invented.refused, "interview-needed");
        assert.match(invented.message, /INVENTED/);
        assert.match(invented.message, /action:"test"/);
        // askedUser:true gets PAST the gate: with mocked minting the run then reaches the
        // (unreachable) tunnel URL — proof it attempted the real call.
        await assert.rejects(() => tool.run(ctx, { askedUser: true }), /fetch failed/);
        await assert.rejects(() => tool.run(ctx, { action: "go", askedUser: true }), /fetch failed/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("matchTunnelWorkflow: exact, +.js, and case-insensitive sans-extension", () => {
    const { matchTunnelWorkflow } = loadTunnelWithMint([MINT_OK]);
    const tunnels = ["tunnel.js", "Xyz.js"];
    assert.equal(matchTunnelWorkflow("tunnel.js", tunnels), "tunnel.js");
    assert.equal(matchTunnelWorkflow("tunnel", tunnels), "tunnel.js");
    assert.equal(matchTunnelWorkflow("xyz", tunnels), "Xyz.js");
    assert.equal(matchTunnelWorkflow("XYZ.JS", tunnels), "Xyz.js");
    assert.equal(matchTunnelWorkflow("nope", tunnels), null);
    assert.equal(matchTunnelWorkflow(null, tunnels), null);
});
test(".tunnel helpers: payload path resolution, outFile validation, saved summary", () => {
    const { resolvePayloadPath, validateOutFileName, saveTunnelResponse, formatSavedSummary } = loadTunnelWithMint([MINT_OK]);
    const fs = require("fs"), path = require("path");
    const dir = tmpWorkspace({ ".tunnel/in.json": "{}", "only-root.json": "{}" });
    try {
        assert.equal(resolvePayloadPath(dir, "in.json"), path.join(dir, ".tunnel", "in.json"));
        // not in .tunnel but present at the workspace root: legacy workspace-relative path still works
        assert.equal(resolvePayloadPath(dir, "only-root.json"), path.join(dir, "only-root.json"));
        // missing everywhere: points at .tunnel so the error names the expected location
        assert.equal(resolvePayloadPath(dir, "nope.json"), path.join(dir, ".tunnel", "nope.json"));
        const abs = path.join(dir, "elsewhere", "x.json");
        assert.equal(resolvePayloadPath(dir, abs), abs);

        assert.equal(validateOutFileName("orders.json").ok, true);
        for (const bad of ["", "  ", "../x.json", "a/b.json", "a\b.json", "..", "C:evil.json", "a?.json"]) {
            assert.equal(validateOutFileName(bad).ok, false, JSON.stringify(bad));
        }

        const raw = '{"orders":[1,2],"total":2}';
        const s = saveTunnelResponse(dir, "orders.json", raw, JSON.parse(raw));
        assert.equal(s.saved, true);
        assert.equal(s.relPath, ".tunnel/orders.json");
        assert.equal(fs.readFileSync(path.join(dir, ".tunnel", "orders.json"), "utf8"), raw);
        assert.equal(s.bytes, Buffer.byteLength(raw));
        assert.deepEqual(s.shape.topLevelKeys, ["orders", "total"]);
        const line = formatSavedSummary(s);
        assert.match(line, /\.tunnel\/orders\.json/);
        assert.match(line, new RegExp("size: " + raw.length + " bytes"));
        assert.match(line, /top-level keys \(2\): orders, total/);

        assert.match(formatSavedSummary(saveTunnelResponse(dir, "a.json", "[1,2,3]", [1, 2, 3])), /array of 3 items/);
        assert.match(formatSavedSummary(saveTunnelResponse(dir, "e.json", "{}", {})), /empty JSON object/);
        const many = {}; for (let i = 0; i < 50; i++) many["k" + i] = i;
        assert.match(formatSavedSummary(saveTunnelResponse(dir, "m.json", JSON.stringify(many), many)), /… \+10 more/);
        assert.equal(saveTunnelResponse(dir, "../escape.json", "{}", {}).saved, false);
        assert.equal(fs.existsSync(path.join(dir, "escape.json")), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("pal_tunnel_test tool: outFile saves success to .tunnel and shows name/size/keys; failures never save", async () => {
    loadTunnelWithMint([MINT_OK]);
    const fs = require("fs"), path = require("path");
    const { TOOLS } = require("../src/mcp/tools");
    const tool = TOOLS.find(t => t.name === "pal_tunnel_test");
    const dir = tmpWorkspace({
        "pal.json": JSON.stringify({ workflows: { entry: [{ string: "tunnel.js", Workflow: { workflowType: 15 } }] } }),
        ".tunnel/req.json": '{"sku":"BX-200"}'
    });
    const ctx = () => ({ workspaceDir: dir, session: {}, record: { palGuid: "G" } });
    const realFetch = global.fetch;
    const sent = [];
    let next;
    global.fetch = async (url, opts) => { sent.push(opts.body); return { status: next.status, text: async () => next.text }; };
    try {
        // success + bare payloadFile name resolved from .tunnel
        next = { status: 200, text: '{"availability":"in stock","lowStock":false}' };
        const ok = await tool.run(ctx(), { askedUser: true, action: "quote", payloadFile: "req.json", outFile: "quote.json" });
        assert.equal(ok.ran, true);
        assert.equal(sent[0], '{"sku":"BX-200"}');
        assert.equal(ok.savedTo, ".tunnel/quote.json");
        assert.deepEqual(ok.topLevelKeys, ["availability", "lowStock"]);
        assert.match(ok.message, /\.tunnel\/quote\.json/);
        assert.match(ok.message, /size: 44 bytes/);
        assert.match(ok.message, /top-level keys \(2\): availability, lowStock/);
        assert.ok(!ok.message.includes("in stock"), "body stays on disk, not in the console");
        assert.equal(fs.readFileSync(path.join(dir, ".tunnel", "quote.json"), "utf8"), next.text);

        // failures: error shown, nothing written
        for (const [name, resp] of [
            ["http500.json", { status: 500, text: "<html>boom</html>" }],
            ["empty.json", { status: 200, text: "" }],
            ["notjson.json", { status: 200, text: "Exception: bad thing" }]
        ]) {
            next = resp;
            const r = await tool.run(ctx(), { askedUser: true, outFile: name });
            assert.equal(fs.existsSync(path.join(dir, ".tunnel", name)), false, name);
            assert.ok(!r.savedTo, name);
        }
        const h = await tool.run(ctx(), { askedUser: true, outFile: "x.json" }); // still http 200 "Exception..." -> last `next`
        assert.match(h.message, /NOT SAVED|Exception/);

        // bad outFile refused before any network call
        const before = sent.length;
        const bad = await tool.run(ctx(), { askedUser: true, outFile: "../x.json" });
        assert.equal(bad.refused, "out-file");
        assert.equal(sent.length, before);

        // without outFile the body is still printed inline and nothing is written
        next = { status: 200, text: '{"a":1}' };
        const inline = await tool.run(ctx(), { askedUser: true });
        assert.match(inline.message, /"a":1/);
        assert.deepEqual(fs.readdirSync(path.join(dir, ".tunnel")).sort(), ["quote.json", "req.json"]);
    } finally { global.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); }
});
