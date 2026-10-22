"use strict";
// fetchResourceFile: one file of one chain pal, on demand, via CheckOut.do. The chain and the
// CheckOut call are stubbed on CloudPistonAPIManager; shapes follow what was verified live
// against secure.cloudpiston.com (2026-10-21).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CloudPistonAPIManager } = require("../lib/apiManager");
const { fetchResourceFile } = require("../src/core/resources");

function chainResp() {
    const pal = (name, files) => ({
        layout: { name },
        pages: { entry: (files.pages || []).map(n => ({ string: n, Page: { content: "" } })) },
        fragments: { entry: (files.fragments || []).map(n => ({ string: n, Fragment: { content: "" } })) }
    });
    return {
        success: true,
        customObject: { palInfoList: { PalInfoEx: [
            { id: "ID-REPO", guid: "PAL-REPO", repository: true, importPal: pal("Repo", { pages: ["console.html"], fragments: ["a/b.html"] }) },
            { guid: "PAL-ROOT", importPal: pal("Root", { fragments: ["x.html"] }) }
        ] } }
    };
}

async function withStubs(checkOut, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resfile-"));
    const calls = [];
    const origFetch = CloudPistonAPIManager.fetchAPI;
    const origCheck = CloudPistonAPIManager.checkOutFile;
    CloudPistonAPIManager.fetchAPI = async () => chainResp();
    CloudPistonAPIManager.checkOutFile = async (...a) => { calls.push(a.slice(1)); return checkOut(...a); };
    const session = { lockInfo: { toHeaderString: () => "x" } };
    try { await fn({ dir, calls, session }); }
    finally {
        CloudPistonAPIManager.fetchAPI = origFetch;
        CloudPistonAPIManager.checkOutFile = origCheck;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const resolved = { id: "DEV", profileId: "P" };
const ok = text => async () => ({ success: true, palFile: { content: Buffer.from(text).toString("base64") } });

test("reads one file, decodes base64, writes it under .resources/<slug>/<folder>/", async () => {
    await withStubs(ok("<html/>"), async ({ dir, calls, session }) => {
        const r = await fetchResourceFile(session, resolved, dir, { pal: "Repo", type: "page", file: "console.html" });
        assert.equal(r.ok, true);
        assert.equal(r.bytes, 7);
        assert.equal(r.path, ".resources/Repo/pages/console.html");
        assert.equal(fs.readFileSync(path.join(dir, ".resources", "Repo", "pages", "console.html"), "utf8"), "<html/>");
        assert.deepEqual(calls, [["ID-REPO", "page", "console.html"]]);
    });
});

test("accepts folder-style plural type and a guid / case-insensitive pal, and subfolder names", async () => {
    await withStubs(ok("z"), async ({ dir, calls, session }) => {
        const r = await fetchResourceFile(session, resolved, dir, { pal: "pal-repo", type: "Fragments", file: "a/b.html" });
        assert.equal(r.ok, true);
        assert.equal(r.type, "fragment");
        assert.equal(fs.readFileSync(path.join(dir, ".resources", "Repo", "fragments", "a", "b.html"), "utf8"), "z");
        assert.equal(calls[0][1], "fragment", "CheckOut.do needs the SINGULAR fileType");
    });
});

test("a name the pal does not list is refused WITHOUT calling CheckOut (the server answers empty success)", async () => {
    await withStubs(ok("never"), async ({ dir, calls, session }) => {
        const r = await fetchResourceFile(session, resolved, dir, { pal: "Repo", type: "page", file: "nope.html" });
        assert.equal(r.ok, false);
        assert.match(r.reason, /no page named "nope\.html"/);
        assert.equal(calls.length, 0);
    });
});

test("unreadable types, unknown pals and missing args are refused with guidance", async () => {
    await withStubs(ok("x"), async ({ dir, calls, session }) => {
        assert.match((await fetchResourceFile(session, resolved, dir, { pal: "Repo", type: "font", file: "f" })).reason, /not readable on demand/);
        assert.match((await fetchResourceFile(session, resolved, dir, { pal: "Repo", type: "workflow", file: "w" })).reason, /already carry their content/);
        assert.match((await fetchResourceFile(session, resolved, dir, { pal: "Nope", type: "page", file: "console.html" })).reason, /Chain pals: Repo, Root/);
        assert.match((await fetchResourceFile(session, resolved, dir, { pal: "Repo" })).reason, /repository pal and is read one file at a time/);
        assert.match((await fetchResourceFile(session, resolved, dir, { pal: "Repo", type: "page" })).reason, /go together/);
        assert.match((await fetchResourceFile(session, resolved, dir, {})).reason, /pal is required/);
        assert.equal(calls.length, 0);
    });
});

test("a chain pal with no server id (Root) points at the copy already on disk", async () => {
    await withStubs(ok("x"), async ({ dir, calls, session }) => {
        const r = await fetchResourceFile(session, resolved, dir, { pal: "Root", type: "fragment", file: "x.html" });
        assert.equal(r.ok, false);
        assert.match(r.reason, /already at \.resources\/Root\/fragments\/x\.html/);
        assert.equal(calls.length, 0);
    });
});

test("a server refusal (deployed/system pal) is reported, not written", async () => {
    const refuse = async () => ({ success: false, messages: { "com.contractpal.Message": { message: "The Pal is not a development Pal." } } });
    await withStubs(refuse, async ({ dir, session }) => {
        const r = await fetchResourceFile(session, resolved, dir, { pal: "Repo", type: "page", file: "console.html" });
        assert.equal(r.ok, false);
        assert.match(r.reason, /not a development Pal/);
        assert.match(r.reason, /refuses on-demand reads/);
        assert.equal(fs.existsSync(path.join(dir, ".resources", "Repo", "pages", "console.html")), false);
    });
});

test("a genuinely empty file is written as 0 bytes and reported as such", async () => {
    await withStubs(async () => ({ success: true, palFile: { content: "" } }), async ({ dir, session }) => {
        const r = await fetchResourceFile(session, resolved, dir, { pal: "Repo", type: "page", file: "console.html" });
        assert.equal(r.ok, true);
        assert.equal(r.bytes, 0);
    });
});
