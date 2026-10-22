"use strict";
// What the agent is told after pal_pull / pal_push on a repository pal. Description-only guidance
// gets skipped, so the facts that matter — "these empty files are not-downloaded placeholders" and
// "push sends only your edits" — ride in the tool results the agent reads every time.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { CloudPistonAPIManager } = require("../lib/apiManager");
const { TOOLS } = require("../src/mcp/tools");
const { pull } = require("../src/core/pull");
const { tmpWorkspace } = require("./helpers");

const palPull = TOOLS.find(t => t.name === "pal_pull");

function serverResponse(repositoryPal) {
    return {
        success: true, repositoryPal,
        pal: {
            layout: { name: "Repo", category: "Repo" },
            pages: { entry: [{ string: "console.html", Page: { filename: "console.html", contentType: "text/html", palType: "palTypeConsole" } }] }
        }
    };
}

async function withServer(resp, fn) {
    const orig = CloudPistonAPIManager.getPal;
    CloudPistonAPIManager.getPal = async () => resp;
    const ws = tmpWorkspace({});
    try { await fn(ws); }
    finally { CloudPistonAPIManager.getPal = orig; fs.rmSync(ws, { recursive: true, force: true }); }
}

const SESSION = { environment: { url: "https://example.invalid" } };
const resolved = { id: "ID", guid: "G", profileId: "P", lastModifiedDate: "2026-01-01 00:00:00.0" };

test("pull() reports repositoryPal from the server's answer", async () => {
    await withServer(serverResponse(true), async ws => {
        assert.equal((await pull(SESSION, "G", ws, { resolved })).repositoryPal, true);
    });
    await withServer(serverResponse(false), async ws => {
        assert.equal((await pull(SESSION, "G", ws, { resolved })).repositoryPal, false);
    });
});

function ctxFor(ws) {
    const record = { palGuid: "G", palName: "Repo", fileHashes: {} };
    return { workspaceDir: ws, record, session: SESSION, persist: async () => {},
        lifecycle: { lockState: { resolved }, onActivity() {} } };
}

test("pal_pull of a repository pal tells the agent the empty files are placeholders and how to get them", async () => {
    await withServer(serverResponse(true), async ws => {
        const res = await palPull.run(ctxFor(ws), {});
        assert.equal(res.pulled, true);
        assert.equal(res.repositoryPal, true);
        assert.match(res.message, /REPOSITORY PAL/);
        assert.match(res.message, /EMPTY PLACEHOLDERS \(0 bytes\)/);
        assert.match(res.message, /pal_repo_fetch/);
        assert.match(res.message, /repository-pal\.md/);
        assert.equal(fs.statSync(path.join(ws, "pages", "console.html")).size, 0, "the placeholder really is on disk");
    });
});

test("pal_pull of an ordinary pal carries no repository note", async () => {
    await withServer(serverResponse(false), async ws => {
        const res = await palPull.run(ctxFor(ws), {});
        assert.equal(res.pulled, true);
        assert.equal(res.repositoryPal, undefined);
        assert.doesNotMatch(res.message, /REPOSITORY PAL/);
    });
});

test("the agent docs agree with the tools: the reference exists, is indexed, and is routed from CLAUDE.md", () => {
    const core = path.join(__dirname, "..", "bundled-context", "skills", "palbuilder-core");
    const ref = fs.readFileSync(path.join(core, "references", "repository-pal.md"), "utf8");
    assert.match(ref, /pal_repo_fetch/);
    assert.match(ref, /askedUser/);
    assert.match(fs.readFileSync(path.join(core, "SKILL.md"), "utf8"), /references\/repository-pal\.md/);
    assert.match(fs.readFileSync(path.join(__dirname, "..", "bundled-context", "CLAUDE.md"), "utf8"), /repository-pal\.md/);
    // the chain reference must not claim chain pals arrive with full content any more
    const chain = fs.readFileSync(path.join(core, "references", "pal-chain.md"), "utf8");
    assert.doesNotMatch(chain, /each with its full\s+content/);
    assert.match(chain, /Only workflows are guaranteed to arrive with their content/);
});
